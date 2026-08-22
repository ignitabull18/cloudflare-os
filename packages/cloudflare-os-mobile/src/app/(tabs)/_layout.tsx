import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";

import { colors } from "@/constants/theme";

export default function TabLayout() {
  return (
    <NativeTabs tintColor={colors.orange}>
      <NativeTabs.Trigger name="(work)">
        <Icon sf={{ default: "bubble.left", selected: "bubble.left.fill" }} />
        <Label>Work</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(dashboard)">
        <Icon sf={{ default: "chart.xyaxis.line", selected: "chart.xyaxis.line" }} />
        <Label>Dashboard</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(outputs)">
        <Icon sf={{ default: "doc", selected: "doc.fill" }} />
        <Label>Outputs</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(connections)">
        <Icon sf={{ default: "point.3.connected.trianglepath.dotted", selected: "point.3.filled.connected.trianglepath.dotted" }} />
        <Label>Connections</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
