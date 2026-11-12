import { registerRootComponent } from "expo";
import { HireShelby } from "@hireshelby/react-native";
import App from "./App";

// Once, at startup, outside any component. Use your app's App ID and theme; never invented colors.
HireShelby.configure(process.env.EXPO_PUBLIC_HIRESHELBY_APP_ID ?? "app_0000000000000000000000", {
  apiBaseUrl: process.env.EXPO_PUBLIC_HIRESHELBY_API_URL,
  theme: { accentColor: "#FF5A1F" },
  logLevel: "info",
});

registerRootComponent(App);
