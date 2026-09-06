import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { type ComponentProps, PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  BrandColors,
  ComponentMetrics,
  ControlSize,
  Elevation,
  Interaction,
  Layout,
  OverlayColors,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useAppPreferences } from "@/context/app-preferences-context";
import { useAdaptiveLayout } from "@/hooks/use-adaptive-layout";

type ScreenProps = PropsWithChildren<{
  eyebrow?: string;
  title: string;
  subtitle: string;
  back?: boolean;
  right?: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
}>;

export function AdminScreen({
  eyebrow = "OPERACIÓN COGANA",
  title,
  subtitle,
  back = false,
  right,
  footer,
  children,
  scroll = true,
}: ScreenProps) {
  const { preferences } = useAppPreferences();
  const { gutter } = useAdaptiveLayout();
  const compact = preferences.density === "compact";
  const bodySpacing = compact ? Spacing.sm : Math.max(gutter, Spacing.lg);
  const content = (
    <>
      <View style={styles.header}>
        <View style={[styles.headerInner, { paddingHorizontal: bodySpacing }]}>
          {back ? (
            <Pressable
              accessibilityLabel="Volver"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.pressed,
              ]}
            >
              <MaterialCommunityIcons
                name="chevron-left"
                size={25}
                color={BrandColors.white}
              />
            </Pressable>
          ) : null}
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
          {right}
        </View>
      </View>
      <View
        style={[
          styles.body,
          { padding: bodySpacing, gap: bodySpacing },
          !scroll && styles.bodyFill,
        ]}
      >
        {children}
      </View>
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.main}
      >
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {content}
          </ScrollView>
        ) : (
          content
        )}
        {footer ? (
          <SafeAreaView edges={["bottom"]} style={styles.footer}>
            {footer}
          </SafeAreaView>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function SectionTitle({
  children,
  action,
}: PropsWithChildren<{ action?: ReactNode }>) {
  return (
    <View style={styles.sectionRow}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {children}
      </Text>
      {action}
    </View>
  );
}

export function Pill({
  label,
  tone = "green",
}: {
  label: string;
  tone?: "green" | "gold" | "danger" | "neutral";
}) {
  const toneStyle = {
    green: styles.pillGreen,
    gold: styles.pillGold,
    danger: styles.pillDanger,
    neutral: styles.pillNeutral,
  }[tone];
  const textToneStyle = {
    green: styles.pillGreenText,
    gold: styles.pillGoldText,
    danger: styles.pillDangerText,
    neutral: styles.pillNeutralText,
  }[tone];

  return (
    <View style={[styles.pill, toneStyle]}>
      <Text style={[styles.pillText, textToneStyle]}>{label}</Text>
    </View>
  );
}

type ActionTone = "primary" | "accent" | "secondary" | "ghost" | "danger";

export function ActionButton({
  label,
  icon,
  onPress,
  disabled = false,
  loading = false,
  compact = false,
  tone = "primary",
  style,
}: {
  label: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  tone?: ActionTone;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  const toneStyle = {
    primary: styles.buttonPrimary,
    accent: styles.buttonAccent,
    secondary: styles.buttonSecondary,
    ghost: styles.buttonGhost,
    danger: styles.buttonDanger,
  }[tone];
  const contentColor =
    tone === "accent"
      ? BrandColors.ink
      : tone === "secondary" || tone === "ghost"
        ? BrandColors.greenDark
        : BrandColors.white;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        compact && styles.actionButtonCompact,
        toneStyle,
        style,
        isDisabled && styles.actionButtonDisabled,
        pressed && !isDisabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={contentColor} size="small" />
      ) : icon ? (
        <MaterialCommunityIcons
          name={icon}
          size={compact ? 18 : 20}
          color={contentColor}
        />
      ) : null}
      <Text style={[styles.actionButtonText, { color: contentColor }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function PrimaryButton(
  props: Omit<ComponentProps<typeof ActionButton>, "tone">,
) {
  return <ActionButton {...props} tone="primary" />;
}

export const sharedStyles = StyleSheet.create({
  card: {
    backgroundColor: BrandColors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.md,
  },
  shadow: { ...Elevation.ambientCard },
  fieldLabel: {
    color: BrandColors.text,
    ...Typography.caption,
    fontWeight: "700",
  },
  input: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: 13,
    ...Typography.body,
  },
  helperText: { color: BrandColors.muted, ...Typography.caption },
  errorText: { color: BrandColors.danger, ...Typography.caption },
  choice: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceActive: {
    backgroundColor: BrandColors.greenLight,
    borderColor: BrandColors.green,
  },
  choiceText: { color: BrandColors.muted, ...Typography.label },
  choiceTextActive: { color: BrandColors.greenDark },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: BrandColors.greenDark },
  main: { flex: 1, backgroundColor: BrandColors.cream },
  scrollContent: {
    flexGrow: 1,
    backgroundColor: BrandColors.cream,
    paddingBottom: Spacing.xxl,
  },
  header: {
    backgroundColor: BrandColors.greenDark,
    borderBottomLeftRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
  },
  headerInner: {
    width: "100%",
    maxWidth: Layout.operationMaxWidth,
    alignSelf: "center",
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerCopy: { flex: 1, paddingRight: Spacing.sm },
  backButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OverlayColors.onDarkSoft,
    marginRight: Spacing.sm,
  },
  eyebrow: { color: BrandColors.gold, ...Typography.overline },
  title: { color: BrandColors.white, ...Typography.h1, marginTop: Spacing.xxs },
  subtitle: {
    color: BrandColors.greenMid,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  body: {
    width: "100%",
    maxWidth: Layout.operationMaxWidth,
    alignSelf: "center",
  },
  bodyFill: { flex: 1 },
  sectionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.xs,
  },
  sectionTitle: {
    flex: 1,
    minWidth: 0,
    color: BrandColors.text,
    ...Typography.h3,
  },
  pill: {
    alignSelf: "flex-start",
    borderRadius: Radius.round,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillText: { ...Typography.caption, fontWeight: "700" },
  pillGreen: { backgroundColor: BrandColors.greenLight },
  pillGreenText: { color: BrandColors.greenDark },
  pillGold: { backgroundColor: BrandColors.goldLight },
  pillGoldText: { color: BrandColors.warning },
  pillDanger: { backgroundColor: BrandColors.dangerLight },
  pillDangerText: { color: BrandColors.danger },
  pillNeutral: { backgroundColor: BrandColors.surfaceMuted },
  pillNeutralText: { color: BrandColors.muted },
  actionButton: {
    minHeight: ControlSize.large,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
  },
  actionButtonCompact: {
    minHeight: ControlSize.default,
    paddingHorizontal: Spacing.md,
  },
  buttonPrimary: { backgroundColor: BrandColors.green },
  buttonAccent: { backgroundColor: BrandColors.gold },
  buttonSecondary: {
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.green,
  },
  buttonGhost: { backgroundColor: BrandColors.greenLight },
  buttonDanger: { backgroundColor: BrandColors.danger },
  actionButtonDisabled: { opacity: Interaction.disabledOpacity },
  actionButtonText: { ...Typography.label },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
  footer: {
    backgroundColor: BrandColors.white,
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Elevation.dockUpward,
  },
});
