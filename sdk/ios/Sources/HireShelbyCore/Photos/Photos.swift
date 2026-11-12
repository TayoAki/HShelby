import Foundation
#if canImport(CryptoKit)
import CryptoKit
#endif

/// A photo ready to send: JPEG or PNG, at most 1 MB and 2048 pixels on its longest side.
///
/// The chat UI makes these from the photo picker (resized, re-encoded as JPEG, which applies the orientation and
/// drops metadata such as location). Custom UIs can make their own.
public struct HireShelbyPhoto: Sendable, Equatable {
    public enum ContentType: String, Sendable, CaseIterable {
        case jpeg = "image/jpeg"
        case png = "image/png"

        var fileExtension: String { self == .jpeg ? "jpg" : "png" }
    }

    public let data: Data
    public let contentType: ContentType
    /// Pixels, read from the file itself.
    public let width: Int
    public let height: Int

    /// Checks the bytes: a JPEG or PNG within the API's limits.
    /// - Throws: ``HireShelbyError`` with code ``HireShelbyError/Code/invalidInput`` otherwise.
    public init(data: Data) throws {
        guard let info = ImageHeader.inspect(data) else {
            throw HireShelbyError.invalidInput("Photos must be JPEG or PNG")
        }
        guard data.count <= Limits.photoBytes else {
            throw HireShelbyError.invalidInput("Photos must be at most 1 MB; resize or compress it first")
        }
        guard max(info.width, info.height) <= Limits.photoPixels else {
            throw HireShelbyError.invalidInput("Photos must be at most 2048 pixels on their longest side")
        }
        self.data = data
        self.contentType = info.contentType
        self.width = info.width
        self.height = info.height
    }

    /// Base64 SHA-256 of the bytes, which the upload URL is signed with.
    var checksum: String { SHA256Digest.base64(of: data) }
}

/// Reads a JPEG's or PNG's type and pixel size from its header, without decoding (as the API does).
enum ImageHeader {
    struct Info: Equatable {
        let contentType: HireShelbyPhoto.ContentType
        let width: Int
        let height: Int
    }

    static func inspect(_ data: Data) -> Info? {
        let b = [UInt8](data.prefix(256 * 1024))
        func u16(_ i: Int) -> Int { Int(b[i]) << 8 | Int(b[i + 1]) }
        func u32(_ i: Int) -> Int { Int(b[i]) << 24 | Int(b[i + 1]) << 16 | Int(b[i + 2]) << 8 | Int(b[i + 3]) }
        func valid(_ info: Info) -> Info? { info.width > 0 && info.height > 0 ? info : nil }

        if b.count >= 24, b[0..<8].elementsEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), b[12..<16].elementsEqual(Array("IHDR".utf8)) {
            return valid(Info(contentType: .png, width: u32(16), height: u32(20)))
        }
        if b.count >= 4, b[0] == 0xFF, b[1] == 0xD8, b[2] == 0xFF {
            var i = 2
            while i + 9 < b.count {
                guard b[i] == 0xFF else { return nil }
                let marker = b[i + 1]
                if marker == 0xFF { i += 1; continue }
                if marker == 0x01 || (0xD0...0xD8).contains(marker) { i += 2; continue }
                if (0xC0...0xCF).contains(marker), marker != 0xC4, marker != 0xC8, marker != 0xCC {
                    return valid(Info(contentType: .jpeg, width: u16(i + 7), height: u16(i + 5)))
                }
                if marker == 0xDA { return nil }
                i += 2 + u16(i + 2)
            }
        }
        return nil
    }
}

/// SHA-256: CryptoKit where it exists, a small portable implementation elsewhere (Linux CI).
enum SHA256Digest {
    static func hash(_ data: Data) -> [UInt8] {
        #if canImport(CryptoKit)
        return Array(SHA256.hash(data: data))
        #else
        return portableHash(data)
        #endif
    }

    static func base64(of data: Data) -> String {
        Data(hash(data)).base64EncodedString()
    }

    private static let k: [UInt32] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]

    /// FIPS 180-4 SHA-256.
    static func portableHash(_ data: Data) -> [UInt8] {
        var h: [UInt32] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
        var message = [UInt8](data)
        let bitLength = UInt64(message.count) * 8
        message.append(0x80)
        while message.count % 64 != 56 { message.append(0) }
        for shift in stride(from: 56, through: 0, by: -8) { message.append(UInt8(truncatingIfNeeded: bitLength >> UInt64(shift))) }

        func rotr(_ x: UInt32, _ n: UInt32) -> UInt32 { (x >> n) | (x << (32 - n)) }
        var w = [UInt32](repeating: 0, count: 64)
        for chunk in stride(from: 0, to: message.count, by: 64) {
            for i in 0..<16 {
                let j = chunk + i * 4
                w[i] = UInt32(message[j]) << 24 | UInt32(message[j + 1]) << 16 | UInt32(message[j + 2]) << 8 | UInt32(message[j + 3])
            }
            for i in 16..<64 {
                let s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3)
                let s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10)
                w[i] = w[i - 16] &+ s0 &+ w[i - 7] &+ s1
            }
            var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7]
            for i in 0..<64 {
                let s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
                let ch = (e & f) ^ (~e & g)
                let t1 = hh &+ s1 &+ ch &+ k[i] &+ w[i]
                let s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
                let maj = (a & b) ^ (a & c) ^ (b & c)
                let t2 = s0 &+ maj
                hh = g; g = f; f = e; e = d &+ t1; d = c; c = b; b = a; a = t1 &+ t2
            }
            h[0] = h[0] &+ a; h[1] = h[1] &+ b; h[2] = h[2] &+ c; h[3] = h[3] &+ d
            h[4] = h[4] &+ e; h[5] = h[5] &+ f; h[6] = h[6] &+ g; h[7] = h[7] &+ hh
        }
        return h.flatMap { word in (0..<4).map { UInt8(truncatingIfNeeded: word >> UInt32(24 - $0 * 8)) } }
    }
}
