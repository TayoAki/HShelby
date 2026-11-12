#if canImport(ImageIO) && canImport(CoreGraphics) && canImport(UniformTypeIdentifiers)
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Turns a picked image (HEIC, JPEG, PNG…) into what the API accepts: a JPEG at most 2048 pixels on its longest
/// side and 1 MB, with the orientation applied, transparency on white, and no metadata (location, camera).
///
/// ImageIO and Core Graphics only, so it runs off the main thread and decodes large photos at the target size.
public enum HireShelbyPhotoProcessing {
    /// Converts image data; nil if it isn't an image ImageIO can read.
    public static func photo(from data: Data) async -> HireShelbyPhoto? {
        await Task.detached(priority: .userInitiated) { makePhoto(from: data) }.value
    }

    static func makePhoto(from data: Data, maxPixels: Int = 2048, maxBytes: Int = 1024 * 1024) -> HireShelbyPhoto? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetCount(source) > 0
        else { return nil }
        // never scale a small image up
        var side = maxPixels
        if let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
           let width = properties[kCGImagePropertyPixelWidth] as? Int, let height = properties[kCGImagePropertyPixelHeight] as? Int,
           max(width, height) > 0 {
            side = min(side, max(width, height))
        }
        for _ in 0..<6 {
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: side,
                kCGImageSourceShouldCacheImmediately: true,
            ]
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
                  let flattened = flatten(image)
            else { return nil }
            for quality in [0.82, 0.7, 0.55, 0.4] {
                if let jpeg = encodeJPEG(flattened, quality: quality), jpeg.count <= maxBytes,
                   let photo = try? HireShelbyPhoto(data: jpeg) {
                    return photo
                }
            }
            side = side * 3 / 4
        }
        return nil
    }

    /// Draws the image on opaque white in sRGB (JPEG has no transparency).
    static func flatten(_ image: CGImage) -> CGImage? {
        let width = image.width
        let height = image.height
        guard width > 0, height > 0, let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(
                  data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace,
                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
              )
        else { return nil }
        let rect = CGRect(x: 0, y: 0, width: width, height: height)
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(rect)
        context.interpolationQuality = .high
        context.draw(image, in: rect)
        return context.makeImage()
    }

    static func encodeJPEG(_ image: CGImage, quality: Double) -> Data? {
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else {
            return nil
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }
}
#endif
