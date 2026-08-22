import { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";

import { colors } from "@/constants/theme";

export function SectionScreen({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 30, paddingBottom: 36, gap: 28 }}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" selectable style={{ color: colors.text, fontSize: 31, fontWeight: "700", letterSpacing: -0.9 }}>
          {title}
        </Text>
        <Text selectable style={{ color: colors.textMuted, fontSize: 16, lineHeight: 23 }}>
          {description}
        </Text>
      </View>
      {children}
    </ScrollView>
  );
}
