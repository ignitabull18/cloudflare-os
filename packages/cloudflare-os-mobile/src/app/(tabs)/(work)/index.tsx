import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import {
  ArrowUp,
  ChatCircle,
  EnvelopeSimple,
  Lightning,
  MagnifyingGlass,
  UsersThree,
  Wrench,
} from "phosphor-react-native";

import { colors } from "@/constants/theme";

type WorkMode = "ask" | "make" | "automate";

const modeContent: Record<WorkMode, { title: string; description: string; placeholder: string; suggestions: Array<{ title: string; detail: string; icon: typeof MagnifyingGlass }> }> = {
  ask: {
    title: "Ask",
    description: "Ask anything. I’ll use your tools and data to find answers.",
    placeholder: "What would you like to know?",
    suggestions: [
      { title: "Investigate a recent error spike", detail: "Find the root cause and impacted services", icon: MagnifyingGlass },
      { title: "Prep for security review", detail: "Summarize open findings and risk", icon: UsersThree },
      { title: "Draft stakeholder update", detail: "Highlight key changes and next steps", icon: EnvelopeSimple },
    ],
  },
  make: {
    title: "Make",
    description: "Create an output or app that works with your tools and data.",
    placeholder: "What should we make?",
    suggestions: [
      { title: "Build a team meeting deck", detail: "Turn current progress into decision-ready slides", icon: UsersThree },
      { title: "Create an operations brief", detail: "Summarize risks, owners, and next actions", icon: EnvelopeSimple },
      { title: "Prototype a private tool", detail: "Start an app backed by your connected services", icon: Wrench },
    ],
  },
  automate: {
    title: "Automate",
    description: "Set up an agent workflow that keeps running when you leave.",
    placeholder: "What should happen automatically?",
    suggestions: [
      { title: "Triage incoming issues", detail: "Classify urgency and prepare the next action", icon: Lightning },
      { title: "Create a daily owner brief", detail: "Summarize changes from connected systems", icon: EnvelopeSimple },
      { title: "Watch for failed deployments", detail: "Investigate errors and prepare a response", icon: MagnifyingGlass },
    ],
  },
};

const modes: Array<{ id: WorkMode; label: string; icon: typeof ChatCircle }> = [
  { id: "ask", label: "Ask", icon: ChatCircle },
  { id: "make", label: "Make", icon: Wrench },
  { id: "automate", label: "Automate", icon: Lightning },
];

function hapticSelection() {
  if (process.env.EXPO_OS === "ios") void Haptics.selectionAsync();
}

export default function WorkScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<WorkMode>("ask");
  const [draft, setDraft] = useState("");
  const content = modeContent[mode];
  const canContinue = draft.trim().length > 0;
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const continueInWorkshop = () => {
    if (!canContinue) return;
    if (process.env.EXPO_OS === "ios") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({ pathname: "/workshop", params: { path: "/", prompt: draft.trim() } });
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 25, paddingBottom: 24, gap: 21 }}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <View style={{ gap: 7 }}>
        <Text selectable style={{ color: colors.text, fontSize: 20, fontWeight: "700", letterSpacing: -0.4 }}>
          {greeting}.
        </Text>
        <Text selectable style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}>
          Choose how you want to work, then tell me what to do.
        </Text>
      </View>

      <View style={{ flexDirection: "row", borderRadius: 18, borderCurve: "continuous", backgroundColor: colors.surface, padding: 5, boxShadow: "0 5px 18px rgba(20,17,15,0.08)", borderWidth: 1, borderColor: colors.line }}>
        {modes.map(({ id, label, icon: Icon }) => {
          const selected = id === mode;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => { hapticSelection(); setMode(id); }}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 46,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                borderRadius: 14,
                borderCurve: "continuous",
                borderWidth: selected ? 1 : 0,
                borderColor: colors.orange,
                backgroundColor: selected ? colors.orangeSoft : "transparent",
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <Icon color={selected ? colors.orangeText : colors.textMuted} size={21} weight={selected ? "bold" : "regular"} />
              <Text style={{ color: selected ? colors.orangeText : colors.textMuted, fontSize: 15, fontWeight: selected ? "700" : "600" }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: 10 }}>
        <Text accessibilityRole="header" selectable style={{ color: colors.text, fontSize: 23, fontWeight: "700", letterSpacing: -0.6 }}>{content.title}</Text>
        <Text selectable style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>{content.description}</Text>
      </View>

      <View style={{ overflow: "hidden", borderRadius: 20, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, boxShadow: "0 6px 20px rgba(20,17,15,0.08)" }}>
        <View style={{ minHeight: 70, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 14 }}>
          <ChatCircle color={colors.textMuted} size={22} weight="regular" />
          <TextInput
            accessibilityLabel={content.placeholder}
            blurOnSubmit={false}
            multiline
            onChangeText={setDraft}
            onSubmitEditing={continueInWorkshop}
            placeholder={content.placeholder}
            placeholderTextColor={colors.textMuted}
            returnKeyType="next"
            style={{ flex: 1, minHeight: 44, color: colors.text, fontSize: 15, lineHeight: 20, paddingVertical: 10 }}
            value={draft}
          />
          <Pressable
            accessibilityLabel="Continue in Cloudflare OS"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canContinue }}
            disabled={!canContinue}
            onPress={continueInWorkshop}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 14,
              borderCurve: "continuous",
              backgroundColor: canContinue ? colors.orange : colors.orangeSoft,
              opacity: pressed ? 0.72 : 1,
            })}
          >
            <ArrowUp color={canContinue ? "white" : colors.orange} size={21} weight="bold" />
          </Pressable>
        </View>
        <View
          accessibilityLabel="Agent model uses the hosted default, GPT 5.6 Sol"
          style={{
            minHeight: 52,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            borderTopWidth: 1,
            borderTopColor: colors.line,
            paddingHorizontal: 16,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>Agent model</Text>
          <Text style={{ color: colors.textMuted, fontSize: 14 }}>Hosted default · GPT 5.6 Sol</Text>
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Text selectable style={{ color: colors.textMuted, fontSize: 13, fontWeight: "700", letterSpacing: 0.8 }}>SUGGESTED NEXT MOVES</Text>
        {content.suggestions.map(({ title, detail, icon: Icon }, index) => (
          <Pressable
            key={title}
            accessibilityRole="button"
            onPress={() => { hapticSelection(); setDraft(title); }}
            style={({ pressed }) => ({
              minHeight: 58,
              flexDirection: "row",
              alignItems: "center",
              gap: 13,
              borderBottomWidth: index === content.suggestions.length - 1 ? 0 : 1,
              borderBottomColor: colors.line,
              opacity: pressed ? 0.58 : 1,
            })}
          >
            <View style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 12, borderCurve: "continuous", backgroundColor: colors.surfaceMuted }}>
              <Icon color={colors.textMuted} size={21} weight="regular" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text selectable style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>{title}</Text>
              <Text selectable numberOfLines={2} style={{ color: colors.textMuted, fontSize: 12, lineHeight: 16 }}>{detail}</Text>
            </View>
            <ArrowUp color={colors.textMuted} size={18} style={{ transform: [{ rotate: "90deg" }] }} weight="bold" />
          </Pressable>
        ))}
      </View>

      <Text selectable style={{ color: colors.textMuted, fontSize: 13, textAlign: "center" }}>Cloudflare OS · Hosted workspace</Text>
    </ScrollView>
  );
}
