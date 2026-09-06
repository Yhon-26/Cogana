import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import { router, type Href, usePathname } from "expo-router";
import type { PropsWithChildren, ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  BrandColors,
  ControlSize,
  Elevation,
  Interaction,
  Layout,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useCart } from "@/context/cart-context";
import { useAdaptiveLayout } from "@/hooks/use-adaptive-layout";

export function OnlineScreen({
  title,
  subtitle,
  children,
  right,
  footer,
  showBottomNav = false,
  cartHref = "/tienda/carrito" as Href,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  right?: ReactNode;
  footer?: ReactNode;
  showBottomNav?: boolean;
  cartHref?: Href | null;
}>) {
  const canGoBack = router.canGoBack();
  const { gutter, isExpanded } = useAdaptiveLayout();
  const showRail = showBottomNav && isExpanded;
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={[styles.headerInner, { paddingHorizontal: gutter }]}>
          <Pressable
            accessibilityLabel={canGoBack ? "Volver" : "Mercado Cogana"}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canGoBack }}
            disabled={!canGoBack}
            hitSlop={8}
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.icon,
              !canGoBack && styles.brandIcon,
              pressed && canGoBack && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons
              name={canGoBack ? "chevron-left" : "sprout"}
              size={canGoBack ? 25 : 21}
              color={canGoBack ? BrandColors.greenDark : BrandColors.goldDark}
            />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>MERCADO COGANA</Text>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          <View style={styles.headerActions}>
            {cartHref ? <CartButton href={cartHref} /> : null}
            {right}
          </View>
        </View>
      </View>
      <KeyboardAvoidingView
        behavior="padding"
        style={[styles.main, showRail && styles.mainExpanded]}
      >
        {showRail ? (
          <SafeAreaView edges={["bottom"]} style={styles.railSafe}>
            <OnlineBottomNav expanded />
          </SafeAreaView>
        ) : null}
        <View style={styles.contentArea}>
          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingHorizontal: gutter },
              (Boolean(footer) || (showBottomNav && !showRail)) &&
                styles.contentWithDock,
            ]}
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          {footer ? (
            <SafeAreaView edges={["bottom"]} style={styles.footer}>
              <View style={[styles.footerInner, { paddingHorizontal: gutter }]}>
                {footer}
              </View>
            </SafeAreaView>
          ) : null}
          {showBottomNav && !showRail ? (
            <SafeAreaView edges={["bottom"]} style={styles.bottomSafe}>
              <OnlineBottomNav />
            </SafeAreaView>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function CartButton({
  href = "/tienda/carrito" as Href,
}: {
  href?: Href;
}) {
  const { itemCount } = useCart();
  return (
    <Pressable
      accessibilityLabel={`Carrito con ${itemCount} productos`}
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.cartIcon, pressed && styles.pressed]}
    >
      <MaterialCommunityIcons
        name="cart-outline"
        size={22}
        color={BrandColors.white}
      />
      {itemCount ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{itemCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function OnlineBottomNav({ expanded = false }: { expanded?: boolean }) {
  const pathname = usePathname();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.nav, expanded ? styles.navExpanded : styles.navFloating]}
    >
      <Nav
        expanded={expanded}
        icon="storefront-outline"
        label="Tienda"
        route="/tienda"
        selected={pathname === "/tienda"}
      />
      <Nav
        expanded={expanded}
        icon="receipt-text-outline"
        label="Pedidos"
        route="/tienda/pedidos"
        selected={pathname.startsWith("/tienda/pedidos")}
      />
      <Nav
        expanded={expanded}
        icon="account-outline"
        label="Perfil"
        route="/tienda/perfil"
        selected={pathname.startsWith("/tienda/perfil")}
      />
    </View>
  );
}

function Nav({
  expanded,
  icon,
  label,
  route,
  selected,
}: {
  expanded: boolean;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  route: string;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        router.navigate(route as Href);
      }}
      style={({ pressed }) => [
        styles.navItem,
        expanded ? styles.navItemExpanded : styles.navItemFloating,
        selected && (expanded ? styles.navItemSelected : styles.navItemActive),
        pressed && styles.pressed,
      ]}
    >
      <MaterialCommunityIcons
        name={icon}
        size={22}
        color={
          expanded
            ? selected
              ? BrandColors.greenDark
              : BrandColors.muted
            : selected
              ? BrandColors.ink
              : BrandColors.greenMid
        }
      />
      {expanded ? (
        <Text style={[styles.navText, selected && styles.navTextSelected]}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BrandColors.cream },
  header: {
    minHeight: 88,
    backgroundColor: BrandColors.cream,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.line,
  },
  headerInner: {
    width: "100%",
    maxWidth: Layout.commerceMaxWidth,
    minHeight: 88,
    alignSelf: "center",
    paddingVertical: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  headerCopy: { flex: 1 },
  headerActions: {
    flexDirection: "row",
    gap: Spacing.xs,
    alignItems: "center",
  },
  eyebrow: { color: BrandColors.green, ...Typography.overline },
  title: { color: BrandColors.text, ...Typography.h2, marginTop: Spacing.xxs },
  subtitle: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  icon: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
  },
  brandIcon: {
    backgroundColor: BrandColors.goldLight,
    borderColor: BrandColors.gold,
  },
  cartIcon: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.greenDark,
  },
  badge: {
    position: "absolute",
    right: -4,
    top: -4,
    minWidth: 20,
    height: 20,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.gold,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xxs,
  },
  badgeText: {
    color: BrandColors.ink,
    ...Typography.overline,
    letterSpacing: 0,
  },
  main: { flex: 1, backgroundColor: BrandColors.cream },
  mainExpanded: { flexDirection: "row" },
  contentArea: { flex: 1, minWidth: 0 },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: Layout.commerceMaxWidth,
    alignSelf: "center",
    backgroundColor: BrandColors.cream,
    paddingVertical: Spacing.md,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  contentWithDock: { paddingBottom: Spacing.lg },
  footer: {
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    ...Elevation.dockUpward,
  },
  footerInner: {
    width: "100%",
    maxWidth: Layout.commerceMaxWidth,
    alignSelf: "center",
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  bottomSafe: {
    backgroundColor: "transparent",
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xs,
  },
  nav: { flexDirection: "row" },
  navFloating: {
    alignSelf: "center",
    alignItems: "center",
    backgroundColor: BrandColors.ink,
    borderRadius: Radius.round,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xxs,
    gap: Spacing.xxs,
    ...Elevation.tabUpward,
  },
  railSafe: {
    width: Layout.navigationRailWidth,
    backgroundColor: BrandColors.white,
    borderRightWidth: 1,
    borderRightColor: BrandColors.line,
  },
  navExpanded: {
    flex: 1,
    width: Layout.navigationRailWidth,
    flexDirection: "column",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    paddingTop: Spacing.lg,
  },
  navItem: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xxs,
  },
  navItemFloating: {
    width: 48,
    height: 48,
    borderRadius: Radius.round,
  },
  navItemActive: { backgroundColor: BrandColors.gold },
  navItemExpanded: {
    flex: 0,
    width: "100%",
    minHeight: 68,
  },
  navItemSelected: { backgroundColor: BrandColors.greenLight },
  navText: {
    color: BrandColors.muted,
    ...Typography.overline,
    letterSpacing: 0,
  },
  navTextSelected: { color: BrandColors.greenDark },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
