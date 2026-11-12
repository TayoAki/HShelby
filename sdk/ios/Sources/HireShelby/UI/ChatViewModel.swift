#if canImport(UIKit)
import PhotosUI
import SwiftUI

/// The chat screen's state: the conversation's messages laid out in rows, the draft and the picked photos.
@MainActor
final class ChatViewModel: ObservableObject {
    typealias Message = HireShelbyConversation.Message

    /// One message with what the row shows around it.
    struct Row: Identifiable {
        enum Status: Equatable {
            case sending, sent, seen, failed
        }

        let message: Message
        var id: String { message.id }
        var isUser: Bool { message.sender == .user }
        /// "Today", "Yesterday" or a date, above the first message of a day.
        let dayHeader: String?
        /// The teammate's name above the first reply of a group.
        let showsAuthorName: Bool
        /// The "AI" label above the first AI reply of a group.
        let showsAILabel: Bool
        /// The avatar beside the last reply of a group.
        let showsAvatar: Bool
        let reservesAvatarSpace: Bool
        let isLastInGroup: Bool
        let status: Status?
        let cardAction: HireShelbyConversation.CardAction?
        /// 0…0.4: how far an older outgoing bubble fades toward white.
        let fade: Double
    }

    @Published var draft = ""
    @Published private(set) var photos: [HireShelbyPhoto] = []
    @Published private(set) var isProcessingPhotos = false
    @Published var photoError: String?
    @Published private(set) var rows: [Row] = []
    @Published private(set) var isSavingAIChoice = false
    @Published var aiError: String?

    let facade: HireShelby
    let conversation: HireShelbyConversation?
    let style: ChatStyle
    private var observation: HireShelbyObservation?
    private var appeared = false

    init(facade: HireShelby) {
        self.facade = facade
        conversation = facade.client?.conversation
        let remote = facade.options.usesRemoteAppearance ? facade.client?.appearance : nil
        style = ChatStyle(theme: facade.options.theme, remote: remote)
        observation = conversation?.observe { [weak self] in self?.rebuild() }
        rebuild()
    }

    var isConfigured: Bool { conversation != nil }

    func appear() {
        guard !appeared else { return }
        appeared = true
        conversation?.open()
    }

    func disappear() {
        guard appeared else { return }
        appeared = false
        conversation?.close()
    }

    // MARK: State for the view

    var hasOlderMessages: Bool { conversation?.hasOlderMessages ?? false }
    var isLoadingOlder: Bool { conversation?.isLoadingOlder ?? false }
    var hasLoaded: Bool { conversation?.hasLoaded ?? false }
    var typing: HireShelbyConversation.Typing? { conversation?.typing }
    var isOffline: Bool { conversation?.connection == .offline }
    var sending: HireShelbyConversation.SendingState { conversation?.sending ?? .allowed }
    var aiReplies: HireShelbyConversation.AIReplies { conversation?.aiReplies ?? .off }
    var lastRowID: String? { rows.last?.id }
    var showsWelcome: Bool { rows.isEmpty && !hasOlderMessages }

    var trimmedDraft: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
    /// UTF-16 units over the API's 4,000 (it counts as JavaScript does).
    var overLimit: Int { max(0, trimmedDraft.utf16.count - 4000) }
    var canAddPhotos: Bool { photos.count < 4 && !isProcessingPhotos }
    var canSend: Bool {
        sending.isAllowed && !isProcessingPhotos && overLimit == 0 && (!trimmedDraft.isEmpty || !photos.isEmpty)
    }

    // MARK: Actions

    func send() {
        guard canSend, let conversation else { return }
        conversation.send(text: trimmedDraft, photos: photos)
        draft = ""
        photos = []
    }

    /// The person's answer to the AI question, or a change of mind from the menu.
    func setAIReplies(allowed: Bool) {
        guard let conversation, !isSavingAIChoice else { return }
        isSavingAIChoice = true
        aiError = nil
        Task { @MainActor in
            do {
                try await conversation.setAIReplies(allowed: allowed)
            } catch {
                aiError = L10n.aiChoiceFailed
            }
            isSavingAIChoice = false
        }
    }

    func draftChanged() {
        guard !draft.isEmpty else { return }
        conversation?.userIsTyping()
    }

    func loadOlder() async {
        await conversation?.loadOlder()
    }

    func retry(_ message: Message) {
        conversation?.retry(message)
    }

    func discard(_ message: Message) {
        conversation?.discard(message)
    }

    func reload(_ message: Message) {
        Task { await conversation?.reload(message) }
    }

    func tapCard(_ message: Message) {
        guard let action = conversation?.tapCard(message) else { return }
        facade.perform(action)
    }

    func removePhoto(at index: Int) {
        guard photos.indices.contains(index) else { return }
        photos.remove(at: index)
    }

    /// Converts picked items to photos the API accepts (resized, re-encoded, metadata dropped), off the main thread.
    func addPicked(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        isProcessingPhotos = true
        photoError = nil
        Task {
            var added: [HireShelbyPhoto] = []
            for item in items {
                guard let data = try? await item.loadTransferable(type: Data.self),
                      let photo = await HireShelbyPhotoProcessing.photo(from: data)
                else { continue }
                added.append(photo)
            }
            photos = Array((photos + added).prefix(4))
            isProcessingPhotos = false
            if added.count < items.count { photoError = L10n.photoFailed }
        }
    }

    // MARK: Layout

    private func rebuild() {
        guard let conversation else {
            rows = []
            return
        }
        let messages = conversation.messages
        let calendar = Calendar.current
        let reservesAvatarSpace = messages.contains { $0.sender == .team && ($0.author?.photoURL != nil || $0.author?.initial != nil) }
        let lastUserIndex = messages.lastIndex { $0.sender == .user }
        let userCount = messages.filter { $0.sender == .user }.count
        var userSeen = 0
        var result: [Row] = []
        result.reserveCapacity(messages.count)

        for (index, message) in messages.enumerated() {
            let previous = index > 0 ? messages[index - 1] : nil
            let next = index + 1 < messages.count ? messages[index + 1] : nil
            let startsDay = previous.map { !calendar.isDate($0.createdAt, inSameDayAs: message.createdAt) } ?? true
            let startsGroup = startsDay || previous.map { !Self.sameGroup($0, message) } ?? true
            let endsGroup = next.map { !Self.sameGroup(message, $0) || !calendar.isDate(message.createdAt, inSameDayAs: $0.createdAt) } ?? true

            var status: Row.Status?
            if message.sender == .user {
                userSeen += 1
                switch message.status {
                case .failed: status = .failed
                case .sending: status = .sending
                case .sent:
                    if index == lastUserIndex {
                        status = (message.seq ?? .max) <= conversation.teamReadSeq ? .seen : .sent
                    }
                }
            }
            let fade = style.fadesOlderMessages && message.sender == .user ? min(0.4, Double(userCount - userSeen) * 0.08) : 0

            result.append(Row(
                message: message,
                dayHeader: startsDay ? Self.dayLabel(message.createdAt, calendar: calendar) : nil,
                showsAuthorName: message.sender == .team && startsGroup && message.author?.name != nil,
                showsAILabel: message.isByAI && startsGroup,
                showsAvatar: message.sender == .team && endsGroup && reservesAvatarSpace,
                reservesAvatarSpace: message.sender == .team && reservesAvatarSpace,
                isLastInGroup: endsGroup,
                status: status,
                cardAction: conversation.cardAction(for: message),
                fade: fade
            ))
        }
        rows = result
    }

    /// Consecutive messages from the same side (and the same teammate) within five minutes form a group.
    private static func sameGroup(_ a: Message, _ b: Message) -> Bool {
        a.sender == b.sender && a.author?.name == b.author?.name && a.isByAI == b.isByAI
            && abs(b.createdAt.timeIntervalSince(a.createdAt)) < 5 * 60
    }

    private static func dayLabel(_ date: Date, calendar: Calendar) -> String {
        if calendar.isDateInToday(date) { return L10n.today }
        if calendar.isDateInYesterday(date) { return L10n.yesterday }
        let thisYear = calendar.isDate(date, equalTo: Date(), toGranularity: .year)
        return thisYear
            ? date.formatted(.dateTime.weekday(.wide).day().month(.wide))
            : date.formatted(date: .long, time: .omitted)
    }
}
#endif
