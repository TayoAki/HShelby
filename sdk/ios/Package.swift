// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "HireShelby",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v16),
        // macOS only so the core can be built and unit tested off-device; the chat UI is iOS-only.
        .macOS(.v13),
    ],
    products: [
        .library(name: "HireShelby", targets: ["HireShelby"]),
    ],
    targets: [
        // Foundation-only engine: models, API client, session, conversation store, outbox, live, uploads.
        .target(
            name: "HireShelbyCore",
            path: "Sources/HireShelbyCore"
        ),
        // The public product: re-exports the core and adds the SwiftUI chat, presentation and push helpers.
        .target(
            name: "HireShelby",
            dependencies: ["HireShelbyCore"],
            path: "Sources/HireShelby",
            resources: [
                .process("PrivacyInfo.xcprivacy"),
                .process("Resources"),
            ]
        ),
        .testTarget(
            name: "HireShelbyCoreTests",
            dependencies: ["HireShelbyCore", "HireShelby"],
            path: "Tests/HireShelbyCoreTests",
            resources: [.copy("Fixtures")]
        ),
    ],
    swiftLanguageModes: [.v6]
)
