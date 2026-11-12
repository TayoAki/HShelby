import Foundation
#if canImport(Network)
import Network
#endif
#if canImport(StoreKit)
import StoreKit
#endif

/// Calls back when the network comes back, so pending messages go out right away.
final class NetworkMonitor: @unchecked Sendable {
    #if canImport(Network)
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.hireshelby.sdk.network")
    private let wasSatisfied = Locked<Bool?>(nil)
    #endif

    init(onAvailable: @escaping @Sendable () -> Void) {
        #if canImport(Network)
        let wasSatisfied = self.wasSatisfied
        monitor.pathUpdateHandler = { path in
            let satisfied = path.status == .satisfied
            let previous = wasSatisfied.withLock { value -> Bool? in
                defer { value = satisfied }
                return value
            }
            if satisfied, previous == false { onAvailable() }
        }
        monitor.start(queue: queue)
        #endif
    }

    func cancel() {
        #if canImport(Network)
        monitor.cancel()
        #endif
    }
}

#if canImport(StoreKit)
extension HireShelbyClient {
    /// Reads StoreKit 2's current entitlements and reports whether the person pays (an active subscription or a
    /// non-consumable purchase) and their subscriptions' original transaction IDs. Call it at launch and after
    /// purchases; apps on RevenueCat, Superwall or Adapty can call ``reportStoreKit(paying:originalTransactionIds:)``
    /// from their own state instead.
    public func reportStoreKitEntitlements() async {
        var paying = false
        var originalIds: [String] = []
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result, transaction.revocationDate == nil else { continue }
            if let expiration = transaction.expirationDate, expiration < Date() { continue }
            switch transaction.productType {
            case .autoRenewable:
                paying = true
                originalIds.append(String(transaction.originalID))
            case .nonRenewable, .nonConsumable:
                paying = true
            default:
                break
            }
        }
        reportStoreKit(paying: paying, originalTransactionIds: originalIds)
    }
}
#endif
