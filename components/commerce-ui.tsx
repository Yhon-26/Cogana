import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { PropsWithChildren } from "react";
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import {
  BrandColors,
  ControlSize,
  Interaction,
  ProductPalette,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const visuals: {
  terms: string[];
  icon: IconName;
  background: string;
  foreground: string;
}[] = [
  {
    terms: ["arroz", "cereal", "grano", "harina", "menestra", "azúcar"],
    icon: "barley",
    background: ProductPalette.grain.background,
    foreground: ProductPalette.grain.foreground,
  },
  {
    terms: ["bebida", "agua", "gaseosa", "jugo", "leche"],
    icon: "bottle-soda-outline",
    background: ProductPalette.beverage.background,
    foreground: ProductPalette.beverage.foreground,
  },
  {
    terms: ["limpieza", "detergente", "jabón", "higiene"],
    icon: "spray-bottle",
    background: ProductPalette.home.background,
    foreground: ProductPalette.home.foreground,
  },
  {
    terms: ["pan", "galleta", "snack", "dulce"],
    icon: "baguette",
    background: ProductPalette.bakery.background,
    foreground: ProductPalette.bakery.foreground,
  },
  {
    terms: ["conserva", "enlatado", "salsa", "aceite"],
    icon: "food-variant",
    background: ProductPalette.pantry.background,
    foreground: ProductPalette.pantry.foreground,
  },
];

function getProductVisual(name: string, category = "") {
  const searchable = `${name} ${category}`.toLocaleLowerCase("es-PE");
  return (
    visuals.find((visual) =>
      visual.terms.some((term) => searchable.includes(term)),
    ) ?? {
      icon: "package-variant-closed" as IconName,
      background: BrandColors.greenLight,
      foreground: BrandColors.green,
    }
  );
}

export function ProductVisual({
  name,
  category,
  size = 64,
}: {
  name: string;
  category?: string;
  size?: number | "100%";
}) {
  const visual = getProductVisual(name, category);
  const iconSize =
    typeof size === "number" ? Math.round(size * 0.42) : Math.round(76 * 0.42);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.productVisual,
        {
          width: size,
          height: size,
          borderRadius: Radius.sm,
        },
      ]}
    >
      <MaterialCommunityIcons
        name={visual.icon}
        size={iconSize}
        color={BrandColors.mutedLight}
      />
    </View>
  );
}

export function CommerceButton({
  label,
  icon,
  onPress,
  disabled = false,
  loading = false,
  tone = "primary",
  compact = false,
  style,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: "primary" | "accent" | "secondary" | "ghost";
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  const containerTone = {
    primary: styles.buttonPrimary,
    accent: styles.buttonAccent,
    secondary: styles.buttonSecondary,
    ghost: styles.buttonGhost,
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
        styles.button,
        compact && styles.buttonCompact,
        containerTone,
        style,
        isDisabled && styles.disabled,
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
      <Text style={[styles.buttonLabel, { color: contentColor }]}>{label}</Text>
    </Pressable>
  );
}

export function QuantityStepper({
  value,
  label,
  onDecrease,
  onIncrease,
  decreaseDisabled = false,
  increaseDisabled = false,
}: {
  value: string;
  label?: string;
  onDecrease: () => void;
  onIncrease: () => void;
  decreaseDisabled?: boolean;
  increaseDisabled?: boolean;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityLabel={label ? `Disminuir ${label}` : "Disminuir cantidad"}
        accessibilityRole="button"
        accessibilityState={{ disabled: decreaseDisabled }}
        disabled={decreaseDisabled}
        hitSlop={4}
        onPress={onDecrease}
        style={({ pressed }) => [
          styles.stepperButton,
          decreaseDisabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <MaterialCommunityIcons
          name="minus"
          size={19}
          color={BrandColors.greenDark}
        />
      </Pressable>
      <Text
        accessibilityLabel={label ? `${label}: ${value}` : value}
        style={styles.stepperValue}
      >
        {value}
      </Text>
      <Pressable
        accessibilityLabel={label ? `Aumentar ${label}` : "Aumentar cantidad"}
        accessibilityRole="button"
        accessibilityState={{ disabled: increaseDisabled }}
        disabled={increaseDisabled}
        hitSlop={4}
        onPress={onIncrease}
        style={({ pressed }) => [
          styles.stepperButton,
          increaseDisabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <MaterialCommunityIcons
          name="plus"
          size={19}
          color={BrandColors.greenDark}
        />
      </Pressable>
    </View>
  );
}

export function TrustItem({
  icon,
  children,
}: PropsWithChildren<{ icon: IconName }>) {
  return (
    <View style={styles.trustItem}>
      <MaterialCommunityIcons name={icon} size={17} color={BrandColors.green} />
      <Text style={styles.trustText}>{children}</Text>
    </View>
  );
}

export function SkeletonBlock({
  height,
  style,
}: {
  height: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.skeleton, { height }, style]} />;
}

const styles = StyleSheet.create({
  productVisual: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  visualAccent: {
    position: "absolute",
    right: -3,
    top: -3,
    borderRadius: Radius.round,
    opacity: 0.16,
  },
  button: {
    minHeight: ControlSize.large,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
  },
  buttonCompact: {
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
  buttonLabel: { ...Typography.label },
  disabled: { opacity: Interaction.disabledOpacity },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
  stepper: {
    minHeight: ControlSize.default,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.surfaceMuted,
    padding: Spacing.xxs,
  },
  stepperButton: {
    width: ControlSize.compact,
    height: ControlSize.compact,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    minWidth: 58,
    color: BrandColors.text,
    ...Typography.label,
    textAlign: "center",
  },
  trustItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  trustText: { color: BrandColors.muted, ...Typography.caption },
  skeleton: {
    borderRadius: Radius.md,
    backgroundColor: BrandColors.line,
    overflow: "hidden",
  },
});
