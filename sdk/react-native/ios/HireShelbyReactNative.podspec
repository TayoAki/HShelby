require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'HireShelbyReactNative'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: package['repository']['url'] }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # The bridge, plus the iOS SDK's sources (copied into HireShelbySDK by scripts/sync-ios-sdk.mjs) compiled
  # into this one module.
  s.source_files = ['*.swift', 'HireShelbySDK/**/*.swift']
  # The SDK's strings and privacy manifest, found at run time as HireShelby.bundle (see ResourceBundle.swift)
  s.resource_bundles = {
    'HireShelby' => ['HireShelbySDK/UI/Resources/**/*', 'HireShelbySDK/UI/PrivacyInfo.xcprivacy']
  }
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
end
