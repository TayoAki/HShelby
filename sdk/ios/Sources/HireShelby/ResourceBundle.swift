#if !SWIFT_PACKAGE
import Foundation

/// SwiftPM generates `Bundle.module` for the package's resources. Other builds (the React Native package's
/// CocoaPods spec) ship them in a `HireShelby.bundle` next to the code instead.
private final class HireShelbyBundleToken {}

extension Bundle {
    static let module: Bundle = {
        let code = Bundle(for: HireShelbyBundleToken.self)
        if let url = code.url(forResource: "HireShelby", withExtension: "bundle"), let bundle = Bundle(url: url) {
            return bundle
        }
        return code
    }()
}
#endif
