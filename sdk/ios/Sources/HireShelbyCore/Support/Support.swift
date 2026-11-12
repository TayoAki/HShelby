import Foundation
#if canImport(os)
import os
#endif

/// The SDK's version, reported to the API with the device details.
public enum HireShelbyVersion {
    /// Semantic version of this SDK build.
    public static let current = "0.1.0"
}

// MARK: - Logging

/// How much the SDK logs. Logs never contain tokens, secrets, message text, identity or metadata values.
public enum HireShelbyLogLevel: Int, Sendable, Comparable, CaseIterable {
    /// Nothing.
    case off
    /// Problems that need the developer's attention (a wrong App ID, a rejected identity token).
    case error
    /// Lifecycle: registration, connection changes.
    case info
    /// Every request's method, path and status.
    case debug

    public static func < (lhs: HireShelbyLogLevel, rhs: HireShelbyLogLevel) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// A custom log destination. Called on an arbitrary thread.
public typealias HireShelbyLogHandler = @Sendable (HireShelbyLogLevel, String) -> Void

/// The SDK's logger: OSLog (subsystem `com.hireshelby.sdk`) on Apple platforms, stdout elsewhere.
struct Log: Sendable {
    var level: HireShelbyLogLevel
    var handler: HireShelbyLogHandler?

    static let silent = Log(level: .off, handler: nil)

    func error(_ message: @autoclosure () -> String) { write(.error, message) }
    func info(_ message: @autoclosure () -> String) { write(.info, message) }
    func debug(_ message: @autoclosure () -> String) { write(.debug, message) }

    private func write(_ messageLevel: HireShelbyLogLevel, _ message: () -> String) {
        guard messageLevel != .off, level != .off, messageLevel <= level else { return }
        let text = message()
        if let handler {
            handler(messageLevel, text)
            return
        }
        #if canImport(os)
        let logger = Logger(subsystem: "com.hireshelby.sdk", category: "HireShelby")
        switch messageLevel {
        case .error: logger.error("\(text, privacy: .public)")
        case .info: logger.info("\(text, privacy: .public)")
        default: logger.debug("\(text, privacy: .public)")
        }
        #else
        print("[HireShelby] \(text)")
        #endif
    }
}

// MARK: - Concurrency helpers

/// A value guarded by a lock, for the few places that share mutable state outside an actor.
final class Locked<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    init(_ value: Value) { self.value = value }

    @discardableResult
    func withLock<Result>(_ body: (inout Value) throws -> Result) rethrows -> Result {
        lock.lock()
        defer { lock.unlock() }
        return try body(&value)
    }

    var current: Value { withLock { $0 } }
}

/// Waits; injectable so tests run without real delays.
protocol Sleeper: Sendable {
    func sleep(seconds: Double) async throws
}

struct TaskSleeper: Sleeper {
    func sleep(seconds: Double) async throws {
        guard seconds > 0 else {
            try Task.checkCancellation()
            return
        }
        try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }
}

/// Exponential backoff with jitter: `base × 2^attempt`, capped at `maximum`, then scaled by a random factor
/// in 0.5…1 so many devices don't retry in lockstep.
struct Backoff: Sendable {
    var base: Double
    var maximum: Double
    var jitter: @Sendable () -> Double

    init(base: Double, maximum: Double, jitter: @escaping @Sendable () -> Double = { Double.random(in: 0.5...1) }) {
        self.base = base
        self.maximum = maximum
        self.jitter = jitter
    }

    func delay(forAttempt attempt: Int) -> Double {
        let exponential = base * pow(2, Double(min(max(attempt, 0), 20)))
        return min(maximum, exponential) * min(1, max(0, jitter()))
    }

    /// Retries of a single HTTP request.
    static let request = Backoff(base: 0.5, maximum: 8)
    /// Reconnecting the live socket.
    static let live = Backoff(base: 1, maximum: 30)
    /// Replaying the outbox after a transient failure.
    static let outbox = Backoff(base: 2, maximum: 60)
}

/// Removes an observer when cancelled or deallocated. Keep a reference for as long as you want updates.
public final class HireShelbyObservation: @unchecked Sendable {
    private let onCancel: Locked<(@Sendable () -> Void)?>

    init(_ onCancel: @escaping @Sendable () -> Void) {
        self.onCancel = Locked(onCancel)
    }

    /// Stops the updates.
    public func cancel() {
        let action = onCancel.withLock { value -> (@Sendable () -> Void)? in
            defer { value = nil }
            return value
        }
        action?()
    }

    deinit { cancel() }
}

/// Observers of a main-actor value, each keyed so it can be removed.
@MainActor
final class ObserverList<Value> {
    private var observers: [UUID: (Value) -> Void] = [:]

    func add(_ observer: @escaping (Value) -> Void) -> HireShelbyObservation {
        let id = UUID()
        observers[id] = observer
        return HireShelbyObservation { [weak self] in
            Task { @MainActor in self?.observers[id] = nil }
        }
    }

    func notify(_ value: Value) {
        for observer in observers.values { observer(value) }
    }
}

// MARK: - Dates

enum ISODate {
    /// The API's timestamps (`toISOString()`: always UTC with milliseconds).
    static func parse(_ string: String?) -> Date? {
        guard let string else { return nil }
        if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(string) { return date }
        return try? Date.ISO8601FormatStyle().parse(string)
    }

    static func format(_ date: Date) -> String {
        date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
    }
}
