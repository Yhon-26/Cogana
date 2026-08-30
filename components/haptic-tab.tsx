import { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import { PlatformPressable } from "@react-navigation/elements";
import * as Haptics from "expo-haptics";

import { useAppPreferences } from "@/context/app-preferences-context";

export function HapticTab(props: BottomTabBarButtonProps) {
  const { preferences } = useAppPreferences();
  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        if (preferences.hapticsEnabled && process.env.EXPO_OS === "ios") {
          // Add a soft haptic feedback when pressing down on the tabs.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        props.onPressIn?.(ev);
      }}
    />
  );
}
