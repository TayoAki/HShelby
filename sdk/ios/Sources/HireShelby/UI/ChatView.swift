#if canImport(UIKit)
import PhotosUI
import SwiftUI
import UIKit

extension HireShelby {
    /// The chat, for SwiftUI apps: `.sheet(isPresented: $showsSupport) { HireShelby.ChatView() }`, or pushed onto
    /// the app's own navigation stack with `HireShelby.ChatView(includesNavigationStack: false)`.
    public typealias ChatView = HireShelbyChatView
}

/// The support chat: messages with paging, the composer with photos, typing, cards, team names and avatars.
///
/// It goes live while on screen and marks messages read. Presented in a sheet, it has its own navigation bar
/// and close button; pushed onto the app's `NavigationStack`, pass `includesNavigationStack: false`.
public struct HireShelbyChatView: View {
    @StateObject private var model: ChatViewModel
    private let includesNavigationStack: Bool

    /// - Parameter includesNavigationStack: true (the default) when presented on its own, as in a sheet; false
    ///   when pushed onto the app's navigation stack.
    @MainActor
    public init(includesNavigationStack: Bool = true) {
        self.includesNavigationStack = includesNavigationStack
        _model = StateObject(wrappedValue: ChatViewModel(facade: HireShelby.shared))
    }

    public var body: some View {
        if includesNavigationStack {
            NavigationStack {
                ChatScreen(model: model, showsCloseButton: model.style.showsCloseButton)
            }
            .tint(model.style.accent)
            .preferredColorScheme(model.style.colorScheme)
        } else {
            ChatScreen(model: model, showsCloseButton: false)
                .tint(model.style.accent)
        }
    }
}

// MARK: - Screen

private struct ChatScreen: View {
    @ObservedObject var model: ChatViewModel
    let showsCloseButton: Bool
    @Environment(\.dismiss) private var dismiss
    @FocusState private var composerFocused: Bool
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var viewer: PhotoViewer.Item?
    @State private var didInitialScroll = false

    private var style: ChatStyle { model.style }
    private static let bottomID = "hireshelby.bottom"

    var body: some View {
        Group {
            if model.isConfigured {
                VStack(spacing: 0) {
                    if model.isOffline { banner(L10n.offline) }
                    messageList
                    footer
                }
            } else {
                Text(L10n.notConfigured)
                    .font(style.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(style.background.ignoresSafeArea())
        .navigationTitle(style.hidesTitle ? "" : style.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                if showsCloseButton {
                    Button { dismiss() } label: {
                        StyleIcon(icon: style.closeIcon, size: 15)
                    }
                    .accessibilityLabel(L10n.close)
                }
            }
        }
        .onAppear { model.appear() }
        .onDisappear { model.disappear() }
        .fullScreenCover(item: $viewer) { item in
            PhotoViewer(item: item)
        }
    }

    // MARK: Messages

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 2) {
                    if model.hasOlderMessages {
                        olderMessagesLoader(proxy)
                    }
                    if model.showsWelcome {
                        WelcomeView(style: style, isLoading: !model.hasLoaded)
                    }
                    ForEach(model.rows) { row in
                        MessageRowView(
                            row: row,
                            style: style,
                            onTapCard: { model.tapCard(row.message) },
                            onRetry: { model.retry(row.message) },
                            onDelete: { model.discard(row.message) },
                            onOpenPhoto: { attachment in viewer = PhotoViewer.Item(attachment: attachment) },
                            onPhotoFailed: { model.reload(row.message) }
                        )
                        .id(row.id)
                    }
                    if let typing = model.typing {
                        TypingBubble(name: typing.name, style: style)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, 4)
                    }
                    Color.clear.frame(height: 1).id(Self.bottomID)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            .onAppear {
                proxy.scrollTo(Self.bottomID, anchor: .bottom)
                Task { @MainActor in
                    await Task.yield()
                    didInitialScroll = true
                }
            }
            .onChange(of: model.lastRowID) { _ in
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(Self.bottomID, anchor: .bottom) }
            }
            .onChange(of: model.typing != nil) { isTyping in
                if isTyping { withAnimation { proxy.scrollTo(Self.bottomID, anchor: .bottom) } }
            }
            .onChange(of: composerFocused) { focused in
                guard focused else { return }
                // after the keyboard animation
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    withAnimation { proxy.scrollTo(Self.bottomID, anchor: .bottom) }
                }
            }
        }
    }

    /// Loads the previous page when scrolled into view, keeping the first visible message in place.
    private func olderMessagesLoader(_ proxy: ScrollViewProxy) -> some View {
        OlderMessagesLoader(model: model, proxy: proxy, autoLoads: didInitialScroll)
    }

    // MARK: Footer

    @ViewBuilder
    private var footer: some View {
        if let restriction = model.sending.restriction, !model.sending.isAllowed {
            Text(restriction == .verificationRequired ? L10n.signInToSend : L10n.deviceBlocked)
                .font(style.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding()
                .background(.bar)
        } else {
            composer
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !model.photos.isEmpty || model.isProcessingPhotos {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(model.photos.enumerated()), id: \.offset) { index, photo in
                            PendingPhotoThumbnail(photo: photo) { model.removePhoto(at: index) }
                        }
                        if model.isProcessingPhotos {
                            ProgressView().frame(width: 56, height: 56)
                        }
                    }
                }
            }
            if let error = model.photoError {
                Text(error).font(style.caption).foregroundStyle(.red)
            }
            if model.overLimit > 0 {
                Text(L10n.tooLong(model.overLimit)).font(style.caption).foregroundStyle(.red)
            }
            HStack(alignment: .bottom, spacing: 8) {
                PhotosPicker(selection: $pickerItems, maxSelectionCount: max(1, 4 - model.photos.count), matching: .images) {
                    Image(systemName: "photo.on.rectangle")
                        .font(.system(size: 20))
                        .frame(width: 36, height: 36)
                }
                .disabled(!model.canAddPhotos)
                .accessibilityLabel(L10n.addPhoto)
                .onChange(of: pickerItems) { items in
                    guard !items.isEmpty else { return }
                    model.addPicked(items)
                    pickerItems = []
                }

                TextField(L10n.messagePlaceholder, text: $model.draft, axis: .vertical)
                    .lineLimit(1...6)
                    .font(style.body)
                    .focused($composerFocused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(Color(uiColor: .tertiarySystemFill))
                    )
                    .accessibilityLabel(L10n.messagePlaceholder)
                    .onChange(of: model.draft) { _ in model.draftChanged() }

                Button {
                    model.send()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(model.canSend ? style.accent : Color.secondary)
                }
                .disabled(!model.canSend)
                .accessibilityLabel(L10n.send)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private func banner(_ text: String) -> some View {
        Text(text)
            .font(style.footnote)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(8)
            .background(Color(uiColor: .secondarySystemBackground))
            .accessibilityAddTraits(.updatesFrequently)
    }
}

/// "Load earlier messages": loads by itself once scrolled into view (after the first scroll to the bottom).
private struct OlderMessagesLoader: View {
    @ObservedObject var model: ChatViewModel
    let proxy: ScrollViewProxy
    let autoLoads: Bool
    /// Paging by itself at most every 1.5 s, so a lazy stack re-creating this view can't page through everything.
    @State private var lastLoad = Date.distantPast

    var body: some View {
        Group {
            if model.isLoadingOlder {
                ProgressView().padding(8)
            } else {
                Button(L10n.loadEarlier) { load() }
                    .font(model.style.footnote)
                    .padding(8)
                    .onAppear {
                        if autoLoads, Date().timeIntervalSince(lastLoad) > 1.5 { load() }
                    }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func load() {
        lastLoad = Date()
        let anchor = model.rows.first?.id
        Task {
            await model.loadOlder()
            if let anchor { proxy.scrollTo(anchor, anchor: .top) }
        }
    }
}

// MARK: - Rows

private struct MessageRowView: View {
    let row: ChatViewModel.Row
    let style: ChatStyle
    let onTapCard: () -> Void
    let onRetry: () -> Void
    let onDelete: () -> Void
    let onOpenPhoto: (HireShelbyConversation.Attachment) -> Void
    let onPhotoFailed: () -> Void

    @ScaledMetric(relativeTo: .body) private var avatarSize: CGFloat = 28

    private var message: HireShelbyConversation.Message { row.message }

    var body: some View {
        VStack(alignment: row.isUser ? .trailing : .leading, spacing: 3) {
            if let day = row.dayHeader {
                Text(day)
                    .font(style.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 12)
                    .padding(.bottom, 4)
                    .accessibilityAddTraits(.isHeader)
            }
            if row.showsAuthorName || row.showsAILabel {
                authorLine
                    .padding(.leading, row.reservesAvatarSpace ? avatarSize + 6 : 0)
                    .padding(.top, 6)
            }
            HStack(alignment: .bottom, spacing: 6) {
                if row.isUser { Spacer(minLength: 48) }
                if row.reservesAvatarSpace {
                    if row.showsAvatar {
                        AvatarView(author: message.author, size: avatarSize, style: style)
                    } else {
                        Color.clear.frame(width: avatarSize, height: 1)
                    }
                }
                bubble
                if !row.isUser { Spacer(minLength: 48) }
            }
            if let status = row.status {
                statusLine(status)
            }
        }
        .padding(.bottom, row.isLastInGroup ? 6 : 0)
    }

    private var authorLine: some View {
        HStack(spacing: 6) {
            if row.showsAuthorName, let name = message.author?.name {
                Text(name).font(style.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            if row.showsAILabel {
                Text(L10n.aiLabel)
                    .font(style.caption.weight(.bold))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .foregroundStyle(style.accent)
                    .overlay(Capsule().stroke(style.accent, lineWidth: 1))
                    .accessibilityLabel(L10n.aiAccessibility)
            }
        }
    }

    private var bubbleColor: Color { row.isUser ? style.accent : style.incomingBackground }
    private var textColor: Color { row.isUser ? style.onAccent : style.incomingForeground }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 8) {
                if !message.attachments.isEmpty {
                    AttachmentGrid(attachments: message.attachments, onOpen: onOpenPhoto, onFailed: onPhotoFailed)
                }
                if !message.text.isEmpty {
                    Text(verbatim: message.text)
                        .font(style.body)
                        .foregroundStyle(textColor)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilityText)
            if let action = row.cardAction {
                CardButton(card: message.card, action: action, style: style, onTap: onTapCard)
            }
        }
        .padding(.horizontal, message.text.isEmpty && message.card == nil ? 4 : 12)
        .padding(.vertical, message.text.isEmpty && message.card == nil ? 4 : 8)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(bubbleColor)
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white.opacity(row.fade))
                )
        )
        .opacity(message.status == .sending ? 0.75 : 1)
        .contextMenu {
            if !message.text.isEmpty {
                Button { UIPasteboard.general.string = message.text } label: { Label(L10n.copy, systemImage: "doc.on.doc") }
            }
            if case .failed = message.status {
                Button(action: onRetry) { Label(L10n.retry, systemImage: "arrow.clockwise") }
                Button(role: .destructive, action: onDelete) { Label(L10n.delete, systemImage: "trash") }
            }
        }
    }

    private var accessibilityText: String {
        var parts: [String] = []
        let who = row.isUser ? L10n.you : (message.author?.name ?? L10n.team)
        parts.append(message.isByAI ? "\(who), \(L10n.aiAccessibility)" : who)
        if !message.text.isEmpty { parts.append(message.text) }
        if message.attachments.count == 1 { parts.append(L10n.photo) }
        if message.attachments.count > 1 { parts.append(L10n.photoCount(message.attachments.count)) }
        parts.append(message.createdAt.formatted(date: .omitted, time: .shortened))
        return parts.joined(separator: ". ")
    }

    @ViewBuilder
    private func statusLine(_ status: ChatViewModel.Row.Status) -> some View {
        switch status {
        case .failed:
            Button(action: onRetry) {
                Label(L10n.notDelivered, systemImage: "exclamationmark.circle.fill")
                    .font(style.caption)
                    .foregroundStyle(.red)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L10n.tapToRetry)
        case .sending:
            Text(L10n.sending).font(style.caption).foregroundStyle(.secondary)
        case .sent:
            Text(L10n.sent).font(style.caption).foregroundStyle(.secondary)
        case .seen:
            Text(L10n.seen).font(style.caption).foregroundStyle(.secondary)
        }
    }
}

// MARK: - Pieces

private struct AvatarView: View {
    let author: HireShelbyConversation.Author?
    let size: CGFloat
    let style: ChatStyle

    var body: some View {
        Group {
            if let url = author?.photoURL {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        initial
                    }
                }
            } else {
                initial
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var initial: some View {
        ZStack {
            Circle().fill(style.accent.opacity(0.18))
            Text(author?.initial ?? "")
                .font(.system(size: size * 0.45, weight: .semibold, design: style.fontDesign))
                .foregroundStyle(style.accent)
        }
    }
}

private struct CardButton: View {
    let card: HireShelbyConversation.Card?
    let action: HireShelbyConversation.CardAction
    let style: ChatStyle
    let onTap: () -> Void

    var body: some View {
        if action == .unavailable {
            Text(L10n.noLongerAvailable)
                .font(style.body.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(uiColor: .tertiarySystemFill)))
        } else {
            Button(action: onTap) {
                HStack(spacing: 6) {
                    if let icon = leadingIcon {
                        StyleIcon(icon: icon, size: style.cardIconSize)
                    }
                    Text(label).font(style.body.weight(.semibold))
                    if let trailing = style.cardTrailingIcon {
                        StyleIcon(icon: trailing, size: style.cardIconSize * 0.8)
                    }
                }
                .foregroundStyle(style.cardButtonTextColor)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .padding(.horizontal, 12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(style.cardButtonColor))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
            .accessibilityAddTraits(.isButton)
        }
    }

    private var label: String {
        switch card {
        case .review(_, let custom)?: return custom ?? L10n.rateOnAppStore
        case .offer(_, let custom)?: return custom ?? L10n.viewOffer
        case nil: return L10n.viewOffer
        }
    }

    private var leadingIcon: ChatStyle.Icon? {
        if let icon = style.cardButtonIcon { return icon }
        if case .review? = card { return .systemImage("star.fill") }
        return nil
    }
}

private struct AttachmentGrid: View {
    let attachments: [HireShelbyConversation.Attachment]
    let onOpen: (HireShelbyConversation.Attachment) -> Void
    let onFailed: () -> Void

    var body: some View {
        let columns = attachments.count == 1 ? 1 : 2
        let side: CGFloat = columns == 1 ? 220 : 108
        LazyVGrid(columns: Array(repeating: GridItem(.fixed(side), spacing: 4), count: columns), spacing: 4) {
            ForEach(attachments) { attachment in
                Button { onOpen(attachment) } label: {
                    AttachmentImage(attachment: attachment, onFailed: onFailed)
                        .frame(width: side, height: columns == 1 ? side * aspect(attachment) : side)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.photo)
            }
        }
    }

    private func aspect(_ attachment: HireShelbyConversation.Attachment) -> CGFloat {
        guard attachment.width > 0 else { return 1 }
        return min(1.4, max(0.6, CGFloat(attachment.height) / CGFloat(attachment.width)))
    }
}

/// A photo from its signed link (which expires after 15 minutes: a failure asks for a fresh one) or, while
/// sending, from the file on the device.
private struct AttachmentImage: View {
    let attachment: HireShelbyConversation.Attachment
    let onFailed: () -> Void
    @State private var localImage: UIImage?
    @State private var reportedFailure = false

    var body: some View {
        switch attachment.source {
        case .remote(let url):
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                case .failure:
                    ZStack {
                        Color(uiColor: .tertiarySystemFill)
                        Image(systemName: "arrow.clockwise").foregroundStyle(.secondary)
                    }
                    .accessibilityLabel(L10n.photoUnavailable)
                    .onAppear {
                        guard !reportedFailure else { return }
                        reportedFailure = true
                        onFailed()
                    }
                default:
                    ZStack {
                        Color(uiColor: .tertiarySystemFill)
                        ProgressView()
                    }
                }
            }
        case .local(let url):
            Group {
                if let localImage {
                    Image(uiImage: localImage).resizable().scaledToFill()
                } else {
                    Color(uiColor: .tertiarySystemFill)
                }
            }
            .onAppear { localImage = UIImage(contentsOfFile: url.path) }
        }
    }
}

private struct PendingPhotoThumbnail: View {
    let photo: HireShelbyPhoto
    let onRemove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let image = UIImage(data: photo.data) {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Color(uiColor: .tertiarySystemFill)
                }
            }
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .accessibilityLabel(L10n.photo)

            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(Color.white, Color.black.opacity(0.6))
                    .font(.system(size: 18))
            }
            .offset(x: 6, y: -6)
            .accessibilityLabel(L10n.removePhoto)
        }
        .padding(.top, 6)
        .padding(.trailing, 6)
    }
}

private struct WelcomeView: View {
    let style: ChatStyle
    let isLoading: Bool

    var body: some View {
        VStack(spacing: 10) {
            if isLoading {
                ProgressView().padding(.top, 40)
            } else {
                if let icon = style.welcomeIcon {
                    StyleIcon(icon: icon, size: style.welcomeIconSize)
                        .foregroundStyle(style.welcomeIconColor)
                        .frame(width: style.welcomeIconSize, height: style.welcomeIconSize)
                        .clipShape(RoundedRectangle(cornerRadius: style.welcomeIconCornerRadius, style: .continuous))
                        .offset(style.welcomeIconOffset)
                        .accessibilityHidden(true)
                }
                if let title = style.welcomeTitle {
                    Text(title)
                        .font(style.headline)
                        .multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                }
                if let text = style.welcomeText {
                    Text(text)
                        .font(style.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 48)
        .frame(maxWidth: .infinity)
    }
}

private struct TypingBubble: View {
    let name: String?
    let style: ChatStyle

    var body: some View {
        HStack(spacing: 8) {
            TimelineView(.periodic(from: .now, by: 0.35)) { context in
                TypingDots(phase: Int(context.date.timeIntervalSinceReferenceDate / 0.35) % 3, color: style.incomingForeground)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(style.incomingBackground))
            if let name, !name.isEmpty {
                Text(L10n.typing(name)).font(style.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L10n.typing(name))
    }
}

private struct TypingDots: View {
    let phase: Int
    let color: Color

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(color.opacity(index == phase ? 0.9 : 0.35))
                    .frame(width: 7, height: 7)
            }
        }
    }
}

/// A photo on the full screen, with pinch and double-tap zoom.
private struct PhotoViewer: View {
    struct Item: Identifiable {
        let attachment: HireShelbyConversation.Attachment
        var id: String { attachment.id }
    }

    let item: Item
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            image
                .scaleEffect(scale)
                .gesture(
                    MagnificationGesture()
                        .onChanged { value in scale = min(5, max(1, lastScale * value)) }
                        .onEnded { _ in lastScale = scale }
                )
                .onTapGesture(count: 2) {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        scale = scale > 1 ? 1 : 2.5
                        lastScale = scale
                    }
                }
                .accessibilityLabel(L10n.photo)
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(12)
                    .background(Circle().fill(Color.white.opacity(0.2)))
            }
            .padding()
            .accessibilityLabel(L10n.close)
        }
    }

    @ViewBuilder
    private var image: some View {
        switch item.attachment.source {
        case .remote(let url):
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFit()
                } else {
                    ProgressView().tint(.white)
                }
            }
        case .local(let url):
            if let image = UIImage(contentsOfFile: url.path) {
                Image(uiImage: image).resizable().scaledToFit()
            }
        }
    }
}
#endif
