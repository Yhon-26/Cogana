import { Stack } from "expo-router";

import { useAppStackScreenOptions } from "@/hooks/use-app-stack-screen-options";

export default function InventoryLayout() {
  const screenOptions = useAppStackScreenOptions();

  return <Stack screenOptions={screenOptions} />;
}
