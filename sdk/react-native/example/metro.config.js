// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Let Metro read the package's files in the parent folder. `experiments.autolinkingModuleResolution` in
// app.json resolves the package, and react-native, expo and the rest, to the copies this app uses.
config.watchFolders = [path.resolve(__dirname, "..")];

module.exports = config;
