import { useCallback, useMemo, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { WebView, WebViewNavigation } from "react-native-webview";

import { colors } from "@/constants/theme";

const BASE_URL = "https://os.ignitabull.org";
const TRUSTED_WEBVIEW_HOSTS = new Set(["os.ignitabull.org", "ignitabull.cloudflareaccess.com"]);

export function WorkshopView({ path, prompt }: { path?: string; prompt?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const uri = useMemo(() => {
    const safePath = path?.startsWith("/") && !path.startsWith("//") ? path : "/";
    const url = new URL(safePath, BASE_URL);
    if (prompt?.trim()) url.searchParams.set("prompt", prompt.trim());
    return url.toString();
  }, [path, prompt]);

  const allowNavigation = useCallback((request: WebViewNavigation) => {
    const scheme = request.url.split(":", 1)[0]?.toLowerCase();
    if (scheme && ["mailto", "sms", "tel"].includes(scheme)) {
      void Linking.openURL(request.url);
      return false;
    }
    if (["about", "data", "blob"].includes(scheme ?? "")) return true;
    try {
      const destination = new URL(request.url);
      if (destination.protocol === "https:" && TRUSTED_WEBVIEW_HOSTS.has(destination.hostname)) return true;
      if (destination.protocol === "https:") void WebBrowser.openBrowserAsync(request.url);
    } catch {
      // Reject malformed or unknown navigation targets.
    }
    return false;
  }, []);

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 28, backgroundColor: colors.background }}>
        <Text selectable style={{ color: colors.text, fontSize: 20, fontWeight: "700", textAlign: "center" }}>
          Cloudflare OS could not load
        </Text>
        <Text selectable style={{ color: colors.textMuted, fontSize: 15, lineHeight: 21, textAlign: "center" }}>
          {error}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => { setError(null); setReloadKey((value) => value + 1); }}
          style={({ pressed }) => ({
            minHeight: 44,
            justifyContent: "center",
            marginTop: 8,
            paddingHorizontal: 20,
            borderRadius: 14,
            borderCurve: "continuous",
            backgroundColor: colors.orange,
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <Text style={{ color: "white", fontSize: 15, fontWeight: "700" }}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <WebView
      key={reloadKey}
      allowsBackForwardNavigationGestures
      applicationNameForUserAgent="CloudflareOS-Expo/1.0"
      javaScriptCanOpenWindowsAutomatically
      onError={(event) => setError(event.nativeEvent.description)}
      onContentProcessDidTerminate={() => setReloadKey((value) => value + 1)}
      onOpenWindow={(event) => {
        const targetUrl = event.nativeEvent.targetUrl;
        if (/^(about|data|blob):/i.test(targetUrl)) return;
        void WebBrowser.openBrowserAsync(targetUrl, {
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
        }).catch((browserError: unknown) => {
          setError(browserError instanceof Error ? browserError.message : "The external sign-in window could not open.");
        });
      }}
      onShouldStartLoadWithRequest={allowNavigation}
      originWhitelist={["https://*", "http://*", "about:*", "data:*", "blob:*"]}
      pullToRefreshEnabled
      setSupportMultipleWindows
      sharedCookiesEnabled
      source={{ uri }}
      startInLoadingState
      thirdPartyCookiesEnabled
      style={{ flex: 1, backgroundColor: colors.background }}
    />
  );
}
