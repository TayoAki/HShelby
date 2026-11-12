import { HireShelby, useUnreadCount } from "@hireshelby/react-native";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Alert, Pressable, SafeAreaView, StyleSheet, Switch, Text, View } from "react-native";

// Banners for Hire Shelby notifications, except while the chat already shows the message
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const show = HireShelby.shouldShowNotification(notification);
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
  },
});

export default function App() {
  const unread = useUnreadCount();
  const [aiAllowed, setAiAllowed] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);

  useEffect(() => {
    HireShelby.identify({ userId: "example-user", name: "Example User" });
    HireShelby.reportPaywalls([{ id: "pro_yearly", title: "Pro yearly" }]);

    // forward the APNs token if the app already has permission; the SDK never asks
    Notifications.getPermissionsAsync().then(async ({ granted }) => {
      if (granted) HireShelby.setPushToken((await Notifications.getDevicePushTokenAsync()).data);
    });
    // a tap on a Hire Shelby notification opens the chat
    const responses = Notifications.addNotificationResponseReceivedListener((response) => {
      void HireShelby.handleNotification(response);
    });
    const paywalls = HireShelby.setPaywallHandler((paywallId) => Alert.alert("Paywall", `Show the paywall "${paywallId}" here.`));
    HireShelby.getAIReplies().then((ai) => {
      setAiEnabled(ai.isEnabled);
      setAiAllowed(ai.isAllowed);
    });
    return () => {
      responses.remove();
      paywalls.remove();
    };
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Hire Shelby</Text>
      <Text style={styles.subtitle}>{HireShelby.isSupported ? `iOS SDK ${HireShelby.version}` : "Not available on this platform"}</Text>

      <Pressable accessibilityRole="button" style={styles.button} onPress={() => HireShelby.presentChat()}>
        <Text style={styles.buttonText}>Support</Text>
        {unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread}</Text>
          </View>
        )}
      </Pressable>

      {aiEnabled && (
        <View style={styles.row}>
          <Text>AI replies in Support</Text>
          <Switch
            value={aiAllowed}
            onValueChange={(allowed) => {
              setAiAllowed(allowed);
              HireShelby.setAIRepliesAllowed(allowed).catch(() => setAiAllowed(!allowed));
            }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  title: { fontSize: 28, fontWeight: "600" },
  subtitle: { color: "#6e6e73" },
  button: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FF5A1F", paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999 },
  buttonText: { color: "white", fontSize: 17, fontWeight: "600" },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: "white", alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { color: "#FF5A1F", fontWeight: "700", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
});
