import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { useAppStackScreenOptions } from "@/hooks/use-app-stack-screen-options";

export default function CustomerLayout() {
  const screenOptions = useAppStackScreenOptions();

  return (
    <>
      <Stack screenOptions={screenOptions} />
      <StatusBar style="dark" />
    </>
  );
}
