import type { PropsWithChildren } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  BrandColors,
  Layout,
  OverlayColors,
  Radius,
  Spacing,
} from "@/constants/theme";
import { useAppPreferences } from "@/context/app-preferences-context";

export function ModalSurface({
  animationType = "fade",
  children,
  dialogStyle,
  dismissOnBackdrop = true,
  onClose,
  placement = "center",
  visible,
}: PropsWithChildren<{
  animationType?: "fade" | "none" | "slide";
  dialogStyle?: StyleProp<ViewStyle>;
  dismissOnBackdrop?: boolean;
  onClose: () => void;
  placement?: "center" | "bottom";
  visible: boolean;
}>) {
  const { preferences } = useAppPreferences();

  return (
    <Modal
      animationType={preferences.reduceMotion ? "none" : animationType}
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <SafeAreaView
        edges={["top", "right", "bottom", "left"]}
        style={styles.overlay}
      >
        {dismissOnBackdrop ? (
          <Pressable
            accessible={false}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
          style={[styles.frame, placement === "bottom" && styles.frameBottom]}
        >
          <View
            accessibilityViewIsModal
            onAccessibilityEscape={onClose}
            style={[
              styles.dialog,
              placement === "bottom" && styles.dialogBottom,
              dialogStyle,
            ]}
          >
            {children}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: OverlayColors.modal,
  },
  frame: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  frameBottom: {
    justifyContent: "flex-end",
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  dialog: {
    width: "100%",
    maxWidth: Layout.dialogMaxWidth,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  dialogBottom: {
    maxWidth: Layout.commerceMaxWidth,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
});
