// SwiftPM builds the engine as its own module. Other builds (the React Native package compiles both folders
// into one module with CocoaPods) have nothing to import.
#if SWIFT_PACKAGE
@_exported import HireShelbyCore
#endif
