#if canImport(ImageIO) && canImport(CoreGraphics) && canImport(UniformTypeIdentifiers)
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import XCTest
@testable import HireShelby
@testable import HireShelbyCore

/// What only runs on Apple platforms (macOS CI): photo conversion with ImageIO, CryptoKit, the Keychain.
final class ApplePlatformTests: XCTestCase {
    /// An image file of the given size, optionally with an EXIF orientation and transparency.
    private func makeImage(width: Int, height: Int, type: UTType, orientation: Int? = nil, transparent: Bool = false, noise: Bool = false) throws -> Data {
        let context = try XCTUnwrap(CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        if !transparent {
            context.setFillColor(CGColor(red: 0.2, green: 0.4, blue: 0.8, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
        if noise, let data = context.data {
            // incompressible pixels, to force the size limit
            let bytes = data.bindMemory(to: UInt8.self, capacity: context.bytesPerRow * height)
            var state: UInt32 = 12345
            for i in 0..<(context.bytesPerRow * height) {
                state = state &* 1_103_515_245 &+ 12345
                bytes[i] = i % 4 == 3 ? 255 : UInt8(truncatingIfNeeded: state >> 16)
            }
        }
        let image = try XCTUnwrap(context.makeImage())
        let output = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(output as CFMutableData, type.identifier as CFString, 1, nil))
        var properties: [CFString: Any] = [:]
        if let orientation { properties[kCGImagePropertyOrientation] = orientation }
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return output as Data
    }

    func testResizesLargePhotosToTheAPILimits() throws {
        let png = try makeImage(width: 3000, height: 2250, type: .png, noise: true)
        let photo = try XCTUnwrap(HireShelbyPhotoProcessing.makePhoto(from: png))
        XCTAssertEqual(photo.contentType, .jpeg)
        XCTAssertLessThanOrEqual(max(photo.width, photo.height), 2048)
        XCTAssertLessThanOrEqual(photo.data.count, 1024 * 1024)
        XCTAssertEqual(Double(photo.width) / Double(photo.height), 4.0 / 3.0, accuracy: 0.01)
    }

    func testAppliesTheOrientationAndDropsTransparency() throws {
        // stored 400 × 200, displayed rotated 90° (EXIF 6): the upload is 200 × 400
        let rotated = try makeImage(width: 400, height: 200, type: .jpeg, orientation: 6)
        let photo = try XCTUnwrap(HireShelbyPhotoProcessing.makePhoto(from: rotated))
        XCTAssertEqual(photo.width, 200)
        XCTAssertEqual(photo.height, 400)

        let transparent = try makeImage(width: 64, height: 64, type: .png, transparent: true)
        let flattened = try XCTUnwrap(HireShelbyPhotoProcessing.makePhoto(from: transparent))
        XCTAssertEqual(flattened.contentType, .jpeg, "transparency becomes white JPEG")
        XCTAssertEqual(flattened.width, 64, "small photos aren't scaled up")

        // no metadata survives (EXIF orientation, location…)
        let source = try XCTUnwrap(CGImageSourceCreateWithData(photo.data as CFData, nil))
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        XCTAssertNil(properties?[kCGImagePropertyGPSDictionary])
        XCTAssertNotEqual(properties?[kCGImagePropertyOrientation] as? Int, 6)
    }

    func testRejectsWhatIsNotAnImage() {
        XCTAssertNil(HireShelbyPhotoProcessing.makePhoto(from: Data("not an image".utf8)))
    }

    #if canImport(CryptoKit)
    func testCryptoKitAndThePortableHashAgree() {
        let data = Data((0..<100_000).map { UInt8(truncatingIfNeeded: $0 &* 31) })
        XCTAssertEqual(SHA256Digest.hash(data), SHA256Digest.portableHash(data))
    }
    #endif

    #if canImport(Security)
    func testKeychainRoundTrip() throws {
        let store = KeychainCredentialStore(appId: "app_\(UUID().uuidString.prefix(8))", apiHost: "tests.invalid")
        let credentials = StoredCredentials(session: .init(deviceSecret: "dvs_test", accessToken: "tok", accessTokenExpiresAt: Date()), pendingLogouts: ["dvs_old"])
        do {
            try store.save(credentials)
        } catch let error as HireShelbyError where error.code == .secureStorageUnavailable {
            throw XCTSkip("No Keychain access for unsigned test runs here (\(error.message))")
        }
        XCTAssertEqual(try store.load()?.session?.deviceSecret, "dvs_test")
        var updated = credentials
        updated.pendingLogouts = []
        try store.save(updated)
        XCTAssertEqual(try store.load()?.pendingLogouts, [])
        try store.delete()
        XCTAssertNil(try store.load())
    }
    #endif
}
#endif
