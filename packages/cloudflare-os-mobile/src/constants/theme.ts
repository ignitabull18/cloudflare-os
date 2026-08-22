import { DynamicColorIOS } from "react-native";

export const colors = {
  background: "#fcfcfb",
  surface: "#ffffff",
  surfaceMuted: "#f3f3f1",
  line: "rgba(20, 17, 16, 0.09)",
  text: "#14110f",
  textMuted: "#75716e",
  textFaint: "#9c9894",
  orange: "#ff5a13",
  orangeText: "#c83f00",
  orangeSoft: "#fff0e8",
};

export const adaptiveOrange =
  process.env.EXPO_OS === "ios"
    ? DynamicColorIOS({ light: colors.orange, dark: "#ff7a45" })
    : colors.orange;
