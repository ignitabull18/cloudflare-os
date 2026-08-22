import { Stack } from "expo-router";

import { HeaderProfileButton } from "@/components/header-profile-button";
import { colors } from "@/constants/theme";

export default function DashboardStack() {
  return (
    <Stack
      screenOptions={{
        title: "Cloudflare OS",
        headerTitleAlign: "center",
        headerShadowVisible: true,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerRight: () => <HeaderProfileButton />,
      }}
    />
  );
}
