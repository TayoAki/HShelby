import Foundation

/// What the session tells the client, in order.
enum SessionNotice: Sendable, Equatable {
    /// The server's view of who the device is changed (nil after logout or deletion).
    case identity(WireIdentity?)
    /// A new device record was registered: its conversation starts empty.
    case deviceRegistered
    /// The server refused an identity token; the rest of the update went through without it.
    case identityRejected(HireShelbyError)
}

/// The device's session with the API.
///
/// - Registers the install (`POST /v1/devices`) with everything staged, and keeps the device secret and access
///   token in the ``CredentialStore`` (the Keychain).
/// - Hands out access tokens, refreshing them before they expire, single-flight.
/// - On a 401, refreshes once and retries; if the device is gone (logged out elsewhere, deleted from the
///   dashboard), registers a new one.
/// - Sends staged device state with `PATCH /v1/device`, only what changed, dropping a rejected identity token
///   or a field the API refuses so one bad value never blocks the rest.
actor DeviceSession {
    static let stateFile = "device.json"

    private let appId: String
    private let api: APIClient
    private let credentialStore: any CredentialStore
    private let files: FileStore
    private let log: Log
    private let now: @Sendable () -> Date

    nonisolated let notices: AsyncStream<SessionNotice>
    private let noticeContinuation: AsyncStream<SessionNotice>.Continuation

    private var loaded = false
    private var credentials = StoredCredentials()
    private var state = PersistedDeviceState()
    /// identify(token:) keeps the token in memory only; the app passes it again on every launch.
    private var identityToken: String?
    private var acknowledgedToken: String?
    private var authTask: Task<String, Error>?

    init(appId: String, api: APIClient, credentialStore: any CredentialStore, files: FileStore, log: Log, now: @escaping @Sendable () -> Date) {
        self.appId = appId
        self.api = api
        self.credentialStore = credentialStore
        self.files = files
        self.log = log
        self.now = now
        (notices, noticeContinuation) = AsyncStream.makeStream(of: SessionNotice.self)
    }

    deinit {
        noticeContinuation.finish()
    }

    // MARK: State

    private func loadIfNeeded() {
        guard !loaded else { return }
        loaded = true
        do {
            credentials = try credentialStore.load() ?? StoredCredentials()
        } catch {
            log.error("Couldn't read the session from the Keychain (\(error)); registering a new device")
        }
        state = files.read(PersistedDeviceState.self, from: Self.stateFile) ?? PersistedDeviceState()
    }

    private func saveCredentials() {
        do {
            if credentials.session == nil && credentials.pendingLogouts.isEmpty {
                try credentialStore.delete()
            } else {
                try credentialStore.save(credentials)
            }
        } catch {
            // the session still works for this launch; the next launch registers again
            log.error("Couldn't save the session to the Keychain (\(error)). Is the app signed?")
        }
    }

    private func persistState() {
        files.write(state, to: Self.stateFile)
    }

    var isRegistered: Bool {
        loadIfNeeded()
        return credentials.session != nil
    }

    var identity: WireIdentity? {
        loadIfNeeded()
        return state.identity
    }

    var desired: DeviceStateSnapshot {
        loadIfNeeded()
        return state.desired
    }

    var hasPendingLogouts: Bool {
        loadIfNeeded()
        return !credentials.pendingLogouts.isEmpty
    }

    /// Stages a change for the next ``sync()``.
    func updateDesired(_ change: @Sendable (inout DeviceStateSnapshot) -> Void) {
        loadIfNeeded()
        change(&state.desired)
        persistState()
    }

    func setIdentityToken(_ token: String?) {
        identityToken = token
    }

    // MARK: Tokens

    /// A valid access token, registering or refreshing as needed.
    func accessToken(allowRegistration: Bool = true) async throws -> String {
        loadIfNeeded()
        if let authTask { return try await authTask.value }
        if let session = credentials.session, let token = session.accessToken, let expiresAt = session.accessTokenExpiresAt,
           expiresAt.timeIntervalSince(now()) > 30 {
            return token
        }
        let task = Task { try await self.obtainToken(allowRegistration: allowRegistration) }
        authTask = task
        defer { authTask = nil }
        return try await task.value
    }

    /// Forgets an access token the server refused, so the next ``accessToken(allowRegistration:)`` refreshes.
    func invalidate(accessToken token: String) {
        guard credentials.session?.accessToken == token else { return }
        credentials.session?.accessToken = nil
        credentials.session?.accessTokenExpiresAt = nil
    }

    private struct DeviceGone: Error {}

    private func obtainToken(allowRegistration: Bool) async throws -> String {
        if let secret = credentials.session?.deviceSecret {
            do {
                return try await refresh(secret: secret)
            } catch is DeviceGone {
                log.info("This device's session has ended on the server")
                endLocalSession()
            }
        }
        guard allowRegistration else {
            throw HireShelbyError(code: .unauthorized, status: 401, message: "This device's session has ended")
        }
        return try await register()
    }

    private func refresh(secret: String) async throws -> String {
        do {
            let token = try await api.send(
                .post("/v1/session/refresh", WireDeviceSecretInput(deviceSecret: secret)),
                accessToken: nil,
                as: WireAccessToken.self
            )
            if credentials.session?.deviceSecret == secret {
                credentials.session?.accessToken = token.accessToken
                credentials.session?.accessTokenExpiresAt = now().addingTimeInterval(Double(token.expiresIn))
                saveCredentials()
            }
            return token.accessToken
        } catch let error as HireShelbyError where error.status == 401 {
            throw DeviceGone()
        }
    }

    private func register() async throws -> String {
        var snapshot = state.desired
        var token = identityToken
        for _ in 0..<4 {
            let body = snapshot.registrationBody(appId: appId, identityToken: token)
            do {
                // a lost response would leave a stray device, so only retry when the request never left
                let session = try await api.send(.post("/v1/devices", body, retry: .unsentOnly), accessToken: nil, as: WireDeviceSession.self)
                credentials.session = StoredCredentials.Session(
                    deviceSecret: session.deviceSecret,
                    accessToken: session.accessToken,
                    accessTokenExpiresAt: now().addingTimeInterval(Double(session.expiresIn))
                )
                saveCredentials()
                state.acknowledged = snapshot
                state.identity = session.identity
                acknowledgedToken = token
                persistState()
                log.info("Registered this device")
                noticeContinuation.yield(.deviceRegistered)
                noticeContinuation.yield(.identity(session.identity))
                return session.accessToken
            } catch let error as HireShelbyError where error.code == .identityTokenInvalid || error.code == .identityTokenExpired {
                rejectToken(token, error)
                token = nil
            } catch let error as HireShelbyError where error.code == .validationFailed {
                let dropped = snapshot.dropFields(namedIn: error.message)
                guard !dropped.isEmpty else { throw error }
                state.desired.dropFields(namedIn: error.message)
                persistState()
                log.error("The API refused \(dropped.sorted().joined(separator: ", ")): \(error.message). Continuing without.")
            } catch let error as HireShelbyError where error.code == .notFound {
                log.error("Unknown App ID \(appId): check HireShelby.configure(appId:) against the dashboard")
                throw error
            }
        }
        throw HireShelbyError.invalidResponse("Registration was refused repeatedly")
    }

    private func rejectToken(_ token: String?, _ error: HireShelbyError) {
        log.error("The identity token was rejected (\(error.code.rawValue)): \(error.message)")
        if identityToken == token { identityToken = nil }
        noticeContinuation.yield(.identityRejected(error))
    }

    /// The device record is gone: forget it, keep what's staged so the next registration sends it again.
    private func endLocalSession() {
        credentials.session = nil
        saveCredentials()
        state.acknowledged = DeviceStateSnapshot()
        acknowledgedToken = nil
        state.identity = nil
        persistState()
    }

    // MARK: Authorized requests

    /// Sends an authorized request: on a 401, refreshes once and retries (registering a new device if the old
    /// one is gone, unless `allowRegistration` is false).
    func send(_ request: APIRequest, allowRegistration: Bool = true) async throws -> HTTPResponse {
        let token = try await accessToken(allowRegistration: allowRegistration)
        do {
            return try await api.send(request, accessToken: token)
        } catch let error as HireShelbyError where error.status == 401 {
            invalidate(accessToken: token)
            let fresh = try await accessToken(allowRegistration: allowRegistration)
            return try await api.send(request, accessToken: fresh)
        }
    }

    func send<Response: Decodable & Sendable>(_ request: APIRequest, as type: Response.Type) async throws -> Response {
        try APIClient.decode(type, from: try await send(request))
    }

    // MARK: Device state

    /// Registers, or sends what changed since the server last accepted the device's state.
    func sync() async throws {
        loadIfNeeded()
        if credentials.session == nil {
            _ = try await accessToken()
            return
        }
        for _ in 0..<4 {
            let snapshot = state.desired
            let token = identityToken
            let body = snapshot.updateBody(since: state.acknowledged, identityToken: token, acknowledgedToken: acknowledgedToken)
            if body.isEmpty { return }
            do {
                let result = try APIClient.decode(WireDeviceUpdateResult.self, from: try await send(.patch("/v1/device", body)))
                state.acknowledged = snapshot
                if token != nil { acknowledgedToken = token }
                state.identity = result.identity
                persistState()
                noticeContinuation.yield(.identity(result.identity))
                return
            } catch let error as HireShelbyError where error.code == .identityTokenInvalid || error.code == .identityTokenExpired {
                rejectToken(token, error)
            } catch let error as HireShelbyError where error.code == .validationFailed {
                var probe = snapshot
                let dropped = probe.dropFields(namedIn: error.message)
                if dropped.isEmpty, body.identityToken != nil {
                    // a malformed token fails validation before it's verified
                    rejectToken(token, error)
                    continue
                }
                guard !dropped.isEmpty else { throw error }
                state.desired.dropFields(namedIn: error.message)
                persistState()
                log.error("The API refused \(dropped.sorted().joined(separator: ", ")): \(error.message). Continuing without.")
            } catch let error as HireShelbyError where error.code == .identityMismatch {
                // this device belongs to another user: end it, then register for the new one
                log.info("A different user identified on this device; starting a new session")
                endDevice(keepStaged: true)
                await flushPendingLogouts()
                _ = try await accessToken()
                return
            }
        }
    }

    // MARK: Ending the device

    /// logout(): ends the device on the server (retried until it gets through) and forgets the user here.
    /// Details, push token, paywalls, StoreKit state and appearance stay for the next registration.
    func logout() async {
        loadIfNeeded()
        endDevice(keepStaged: false)
        await flushPendingLogouts()
    }

    private func endDevice(keepStaged: Bool) {
        if let secret = credentials.session?.deviceSecret, !credentials.pendingLogouts.contains(secret) {
            credentials.pendingLogouts.append(secret)
        }
        credentials.session = nil
        saveCredentials()
        state.acknowledged = DeviceStateSnapshot()
        state.identity = nil
        acknowledgedToken = nil
        if !keepStaged {
            state.desired.identity = nil
            state.desired.metadata = nil
            identityToken = nil
        }
        persistState()
        noticeContinuation.yield(.identity(nil))
    }

    /// Sends the logouts that haven't reached the server yet. Offline, they wait for the next call.
    func flushPendingLogouts() async {
        loadIfNeeded()
        while let secret = credentials.pendingLogouts.first {
            do {
                _ = try await api.send(.post("/v1/session/logout", WireDeviceSecretInput(deviceSecret: secret)), accessToken: nil)
            } catch let error as HireShelbyError where !error.isTransient {
                log.error("The server refused a logout (\(error.code.rawValue)); dropping it")
            } catch {
                log.info("Logout will be retried when the API is reachable")
                return
            }
            credentials.pendingLogouts.removeAll { $0 == secret }
            saveCredentials()
        }
    }

    /// deleteData(): deletes the device and its conversations on the server, then forgets the user here.
    /// Never registers a device just to delete it.
    func deleteDevice() async throws {
        loadIfNeeded()
        if credentials.session != nil {
            do {
                _ = try await send(.delete("/v1/device"), allowRegistration: false)
            } catch let error as HireShelbyError where error.status == 401 {
                log.info("The device was already gone")
            }
        }
        credentials.session = nil
        saveCredentials()
        state.acknowledged = DeviceStateSnapshot()
        state.desired.identity = nil
        state.desired.metadata = nil
        state.identity = nil
        identityToken = nil
        acknowledgedToken = nil
        persistState()
        noticeContinuation.yield(.identity(nil))
    }

    /// Forgets everything, Keychain included (a reinstall, where the Keychain outlived the app).
    func wipe() {
        credentials = StoredCredentials()
        try? credentialStore.delete()
        state = PersistedDeviceState()
        identityToken = nil
        acknowledgedToken = nil
        files.remove(Self.stateFile)
        loaded = true
    }
}
