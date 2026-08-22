import "react-native-gesture-handler";

import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { colors } from "@/constants/theme";

const appTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    border: colors.line,
    card: colors.background,
    primary: colors.orange,
    text: colors.text,
  },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={appTheme}>
      <StatusBar style="dark" />
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="workshop"
          options={{
            title: "Cloudflare OS",
            headerBackTitle: "Back",
            headerShadowVisible: true,
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}
