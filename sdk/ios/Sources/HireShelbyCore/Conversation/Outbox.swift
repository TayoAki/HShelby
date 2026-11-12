import Foundation

/// A message the user sent that the server hasn't confirmed yet. Persisted, so it survives a relaunch.
struct OutboxItem: Codable, Equatable, Sendable {
    /// Lowercase UUID; the API stores one message per device and clientId, so resending never duplicates.
    var clientId: String
    var text: String
    var photos: [OutboxPhoto]
    var createdAt: Date
    /// Failed attempts so far.
    var attempts = 0
    /// The last failure's error code; nil while nothing has failed.
    var failure: String?
    /// Times its photos were uploaded again after the API refused them.
    var photoResets = 0

    /// Failures the SDK retries on its own, keeping the order of messages.
    static func isTransient(_ code: String) -> Bool {
        code == HireShelbyError.Code.connectionFailed.rawValue || code == HireShelbyError.Code.rateLimited.rawValue
            || code == HireShelbyError.Code.internalError.rawValue
    }

    /// Waits for the user's Retry: a failure only they can resolve (validation, blocked, sign in).
    var isStuck: Bool {
        guard let failure else { return false }
        return !Self.isTransient(failure)
    }
}

/// A photo of an ``OutboxItem``: the file on disk and how far its upload got.
struct OutboxPhoto: Codable, Equatable, Sendable {
    var file: String
    var contentType: String
    var bytes: Int
    var width: Int
    var height: Int
    var checksum: String
    var attachmentId: String?
    var uploaded = false
}

/// The pending messages, in the order the user sent them (`outbox.json`, photos in `outbox/`).
@MainActor
final class Outbox {
    static let file = "outbox.json"
    static let photoDirectory = "outbox"

    private let files: FileStore
    private(set) var items: [OutboxItem]

    init(files: FileStore) {
        self.files = files
        items = files.read([OutboxItem].self, from: Self.file) ?? []
    }

    func item(_ clientId: String) -> OutboxItem? {
        items.first { $0.clientId == clientId }
    }

    func contains(_ clientId: String) -> Bool {
        items.contains { $0.clientId == clientId }
    }

    func append(clientId: String, text: String, photos: [HireShelbyPhoto], createdAt: Date) {
        let stored = photos.enumerated().map { index, photo in
            let name = "\(Self.photoDirectory)/\(clientId)-\(index).\(photo.contentType.fileExtension)"
            files.writeData(photo.data, to: name)
            return OutboxPhoto(
                file: name, contentType: photo.contentType.rawValue, bytes: photo.data.count,
                width: photo.width, height: photo.height, checksum: photo.checksum
            )
        }
        items.append(OutboxItem(clientId: clientId, text: text, photos: stored, createdAt: createdAt))
        save()
    }

    func update(_ clientId: String, _ change: (inout OutboxItem) -> Void) {
        guard let index = items.firstIndex(where: { $0.clientId == clientId }) else { return }
        change(&items[index])
        save()
    }

    func remove(_ clientId: String) {
        guard let index = items.firstIndex(where: { $0.clientId == clientId }) else { return }
        for photo in items[index].photos { files.remove(photo.file) }
        items.remove(at: index)
        save()
    }

    func removeAll() {
        for item in items { for photo in item.photos { files.remove(photo.file) } }
        items = []
        files.remove(Self.photoDirectory)
        save()
    }

    func photoData(_ photo: OutboxPhoto) -> Data? {
        files.readData(photo.file)
    }

    func photoURL(_ photo: OutboxPhoto) -> URL {
        files.url(for: photo.file)
    }

    private func save() {
        if items.isEmpty {
            files.remove(Self.file)
        } else {
            files.write(items, to: Self.file)
        }
    }
}
