import { Linking, Pressable, Text, View } from "react-native";
import { ArrowSquareOut } from "phosphor-react-native";

import { colors } from "@/constants/theme";

const BASE_URL = "https://os.ignitabull.org";

export function WorkshopView({ path, prompt }: { path?: string; prompt?: string }) {
  const url = new URL(path?.startsWith("/") ? path : "/", BASE_URL);
  if (prompt?.trim()) url.searchParams.set("prompt", prompt.trim());

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 20, padding: 28, backgroundColor: colors.background }}>
      <Text selectable style={{ color: colors.text, fontSize: 27, fontWeight: "700", textAlign: "center" }}>
        Continue in Cloudflare OS
      </Text>
      <Text selectable style={{ maxWidth: 430, color: colors.textMuted, fontSize: 16, lineHeight: 23, textAlign: "center" }}>
        The installed iPhone app keeps this flow inside its persistent Workshop view. The web preview opens the hosted product in a separate tab.
      </Text>
      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(url.toString())}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 9,
          borderRadius: 16,
          backgroundColor: colors.orange,
          paddingHorizontal: 18,
          paddingVertical: 13,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>Open Workshop</Text>
        <ArrowSquareOut color="white" size={20} weight="bold" />
      </Pressable>
    </View>
  );
}

