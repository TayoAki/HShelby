import { requireOptionalNativeModule, type NativeModule } from "expo-modules-core";
import type { HireShelbyEvent } from "./types";

type Events = {
  onUnreadCountChange(event: { count: number }): void;
  onEvent(event: HireShelbyEvent): void;
  onPaywall(event: { paywallId: string }): void;
};

/** The native module (ios/HireShelbyModule.swift). Every call hands over to the iOS SDK on the main thread. */
export declare class HireShelbyNativeModule extends NativeModule<Events> {
  readonly sdkVersion: string;
  configure(appId: string, options: object): Promise<void>;
  identify(userId: string | null, name: string | null, email: string | null): Promise<void>;
  identifyWithToken(token: string): Promise<void>;
  logout(): Promise<void>;
  deleteData(): Promise<void>;
  setMetadata(metadata: Record<string, string>): Promise<void>;
  presentChat(): Promise<void>;
  dismissChat(): Promise<void>;
  getUnreadCount(): Promise<number>;
  setPushToken(hex: string, environment: string): Promise<void>;
  clearPushToken(): Promise<void>;
  setPromotionalPushAllowed(allowed: boolean): Promise<void>;
  handleNotification(payload: Record<string, unknown>, openChat: boolean): Promise<boolean>;
  reportPaywalls(paywalls: object[]): Promise<void>;
  reportStoreKit(paying: boolean | null, originalTransactionIds: string[]): Promise<void>;
  reportStoreKitEntitlements(): Promise<void>;
  track(event: string, opensChat: boolean): Promise<void>;
  getAIReplies(): Promise<{ isEnabled: boolean; consent: string | null; processors: string[]; isAllowed: boolean; needsConsent: boolean }>;
  setAIRepliesAllowed(allowed: boolean): Promise<void>;
}

/** Null where there's no native module: Android, web, Expo Go, or an iOS build made before installing. */
export const native = requireOptionalNativeModule<HireShelbyNativeModule>("HireShelby");
