#!/usr/bin/env node
// Copies the iOS SDK's sources (../ios/Sources) into ios/HireShelbySDK, where the podspec compiles them into this
// package's module. Runs before packing and before the example app's `pod install`; the copy isn't committed,
// so the Swift package stays the one source of truth.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "..", "ios", "Sources");
const target = join(root, "ios", "HireShelbySDK");

if (!existsSync(source)) {
  // installed from npm: the copy shipped in the package
  if (existsSync(target)) process.exit(0);
  console.error(`Can't find the iOS SDK's sources at ${source}`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(join(source, "HireShelbyCore"), join(target, "Core"), { recursive: true });
cpSync(join(source, "HireShelby"), join(target, "UI"), { recursive: true });

const version = readFileSync(join(root, "..", "ios", "Sources", "HireShelbyCore", "Support", "Support.swift"), "utf8").match(
  /current\s*=\s*"([^"]+)"/,
)?.[1];
writeFileSync(join(target, "README.md"), `Copied from sdk/ios/Sources by scripts/sync-ios-sdk.mjs${version ? ` (SDK ${version})` : ""}. Don't edit.\n`);
console.log(`Copied the iOS SDK${version ? ` ${version}` : ""} into ios/HireShelbySDK`);
