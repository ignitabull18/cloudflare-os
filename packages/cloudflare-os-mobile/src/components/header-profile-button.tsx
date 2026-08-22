import { useRouter } from "expo-router";
import { Pressable } from "react-native";
import { UserCircle } from "phosphor-react-native";

import { colors } from "@/constants/theme";

export function HeaderProfileButton() {
  const router = useRouter();

  return (
    <Pressable
      accessibilityLabel="Open profile"
      accessibilityRole="button"
      hitSlop={10}
      onPress={() => router.push({ pathname: "/workshop", params: { path: "/profile" } })}
      style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1, padding: 2 })}
    >
      <UserCircle color={colors.textMuted} size={29} weight="regular" />
    </Pressable>
  );
}
