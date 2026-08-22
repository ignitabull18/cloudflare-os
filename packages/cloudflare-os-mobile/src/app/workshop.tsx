import { useLocalSearchParams } from "expo-router";

import { WorkshopView } from "@/components/workshop-view";

export default function WorkshopScreen() {
  const params = useLocalSearchParams<{ path?: string; prompt?: string }>();
  return <WorkshopView path={params.path} prompt={params.prompt} />;
}

