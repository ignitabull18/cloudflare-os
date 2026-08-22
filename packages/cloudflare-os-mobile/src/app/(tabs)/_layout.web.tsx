import { Tabs } from "expo-router";
import { ChartLineUp, ChatCircle, CirclesThreePlus, FileText } from "phosphor-react-native";

import { colors } from "@/constants/theme";

export default function WebTabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.orange,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        tabBarStyle: { height: 72, paddingTop: 8, paddingBottom: 8, backgroundColor: colors.background, borderTopColor: colors.line },
      }}
    >
      <Tabs.Screen name="(work)" options={{ title: "Work", tabBarIcon: ({ color }) => <ChatCircle color={color} size={24} weight="regular" /> }} />
      <Tabs.Screen name="(dashboard)" options={{ title: "Dashboard", tabBarIcon: ({ color }) => <ChartLineUp color={color} size={24} weight="regular" /> }} />
      <Tabs.Screen name="(outputs)" options={{ title: "Outputs", tabBarIcon: ({ color }) => <FileText color={color} size={24} weight="regular" /> }} />
      <Tabs.Screen name="(connections)" options={{ title: "Connections", tabBarIcon: ({ color }) => <CirclesThreePlus color={color} size={24} weight="regular" /> }} />
    </Tabs>
  );
}
