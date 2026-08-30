import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { router, Tabs, type Href, usePathname } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { canAccessOperatorRoute } from "@/auth/operator-route-access";
import {
  BrandColors,
  ComponentMetrics,
  ControlSize,
  Elevation,
  Interaction,
  Layout,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useLocalOperator } from "@/context/local-operator-context";
import {
  listRolePermissions,
  type RolePermission,
} from "@/database/repositories/personnel-operations-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { useLocalDatabase } from "@/hooks/use-local-database";
import { useAdaptiveLayout } from "@/hooks/use-adaptive-layout";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

function TabIcon({ name, color }: { name: IconName; color: string }) {
  return (
    <MaterialCommunityIcons
      name={name}
      size={Typography.h2.fontSize}
      color={color}
    />
  );
}

const primaryTabs: readonly {
  name: "panel" | "venta" | "inventario" | "pedidos" | "mas";
  label: string;
  icon: IconName;
}[] = [
  { name: "panel", label: "Inicio", icon: "view-dashboard-outline" },
  { name: "venta", label: "Venta", icon: "cart-plus" },
  { name: "inventario", label: "Inventario", icon: "warehouse" },
  { name: "pedidos", label: "Pedidos", icon: "clipboard-list-outline" },
  { name: "mas", label: "Más", icon: "dots-grid" },
];

const primaryTabNames: ReadonlySet<string> = new Set(
  primaryTabs.map((tab) => tab.name),
);

function OperatorTabBar({
  state,
  descriptors,
  navigation,
  expanded,
}: BottomTabBarProps & { expanded: boolean }) {
  const insets = useSafeAreaInsets();
  const activeRouteName = state.routes[state.index]?.name;

  return (
    <View
      style={[
        styles.tabBar,
        expanded && styles.tabRail,
        expanded
          ? {
              paddingTop: Math.max(insets.top, Spacing.lg),
              paddingBottom: Math.max(insets.bottom, Spacing.md),
              paddingLeft: Math.max(insets.left, Spacing.xs),
            }
          : { paddingBottom: Math.max(insets.bottom, Spacing.xxs) },
      ]}
    >
      {primaryTabs.map((tab) => {
        const route = state.routes.find(
          (candidate) => candidate.name === tab.name,
        );
        if (!route) return null;
        const isFocused =
          activeRouteName === tab.name ||
          (tab.name === "mas" && !primaryTabNames.has(activeRouteName ?? ""));
        const color = isFocused ? BrandColors.greenDark : BrandColors.muted;
        const options = descriptors[route.key]?.options;

        return (
          <Pressable
            key={route.key}
            accessibilityLabel={options?.tabBarAccessibilityLabel ?? tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: isFocused }}
            onLongPress={() =>
              navigation.emit({ type: "tabLongPress", target: route.key })
            }
            onPress={() => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            }}
            style={({ pressed }) => [
              styles.tabItem,
              expanded && styles.tabItemExpanded,
              isFocused && styles.tabItemActive,
              pressed && styles.tabItemPressed,
            ]}
          >
            <TabIcon name={tab.icon} color={color} />
            <Text style={[styles.tabLabel, { color }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  const { selectedUser } = useLocalOperator();
  const database = useLocalDatabase();
  const pathname = usePathname();
  const { isExpanded } = useAdaptiveLayout();
  const [permissions, setPermissions] = useState<RolePermission[] | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const blockedTitleRef = useRef<Text>(null);

  useEffect(() => {
    let active = true;
    setPermissionError(null);
    if (!selectedUser || selectedUser.role === "administrator") {
      setPermissions([]);
      return () => {
        active = false;
      };
    }
    setPermissions(null);
    void listRolePermissions(database, DEFAULT_STORE_ID)
      .then((value) => {
        if (active) setPermissions(value);
      })
      .catch((caughtError) => {
        if (!active) return;
        setPermissionError(
          getOperatorErrorMessage(
            caughtError,
            "No se pudieron validar los permisos. Intenta nuevamente.",
          ),
        );
      });
    return () => {
      active = false;
    };
  }, [database, selectedUser]);

  const permissionsReady =
    !selectedUser ||
    selectedUser.role === "administrator" ||
    permissions !== null;
  const routeAllowed =
    permissionsReady &&
    !permissionError &&
    canAccessOperatorRoute(selectedUser, pathname, permissions ?? []);

  const blocked = !routeAllowed && pathname !== "/panel";
  const verifiedDenied =
    permissionsReady &&
    !routeAllowed &&
    pathname !== "/panel" &&
    !permissionError;

  useEffect(() => {
    if (!blocked) return;
    const timer = setTimeout(() => {
      const node = findNodeHandle(blockedTitleRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 120);
    return () => clearTimeout(timer);
  }, [blocked, permissionError, verifiedDenied]);

  return (
    <View style={styles.root}>
      <View
        accessibilityElementsHidden={blocked}
        importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}
        style={styles.navigator}
      >
        <Tabs
          tabBar={(props) => (
            <OperatorTabBar {...props} expanded={isExpanded} />
          )}
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: BrandColors.cream },
            tabBarHideOnKeyboard: true,
            tabBarPosition: isExpanded ? "left" : "bottom",
          }}
        >
          <Tabs.Screen
            name="panel"
            options={{
              title: "Inicio",
              tabBarIcon: ({ color }) => (
                <TabIcon name="view-dashboard-outline" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="venta"
            options={{
              title: "Venta",
              tabBarIcon: ({ color }) => (
                <TabIcon name="cart-plus" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="inventario"
            options={{
              title: "Inventario",
              tabBarIcon: ({ color }) => (
                <TabIcon name="warehouse" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="pedidos"
            options={{
              title: "Pedidos",
              tabBarIcon: ({ color }) => (
                <TabIcon name="clipboard-list-outline" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="precios"
            options={{
              title: "Precios",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="tag-outline" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="mas"
            options={{
              title: "Más",
              tabBarIcon: ({ color }) => (
                <TabIcon name="dots-grid" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="proveedores"
            options={{
              title: "Proveedores",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="truck-outline" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="delivery-zones"
            options={{
              title: "Zonas delivery",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="map-marker-radius-outline" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="negocios"
            options={{
              title: "Negocios",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="storefront-outline" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="repartos"
            options={{
              title: "Repartos",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="moped-outline" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="reportes"
            options={{
              title: "Reportes",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="chart-box-outline" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="soporte"
            options={{
              title: "Soporte",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="lifebuoy" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="configuracion"
            options={{
              title: "Configuración",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="cog-outline" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="empleados"
            options={{
              title: "Empleados",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="account-group-outline" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="historial-ventas"
            options={{
              title: "Historial de ventas",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="receipt-text-clock-outline" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="compras"
            options={{
              title: "Compras",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="cart-arrow-down" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="scanner"
            options={{
              title: "Escáner",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="barcode-scan" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="catalogo-admin"
            options={{
              title: "Catálogo avanzado",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="shape-plus-outline" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="personal-avanzado"
            options={{
              title: "Personal avanzado",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="account-clock-outline" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="promociones"
            options={{
              title: "Promociones",
              href: null,
              tabBarIcon: ({ color }) => (
                <TabIcon name="sale-outline" color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="sincronizacion"
            options={{
              title: "Sincronización",
              href: null,
              tabBarIcon: ({ color }) => <TabIcon name="sync" color={color} />,
            }}
          />
        </Tabs>
      </View>
      {blocked ? (
        <SafeAreaView
          accessibilityRole="alert"
          accessibilityViewIsModal
          edges={["top", "right", "bottom", "left"]}
          style={styles.blockOverlay}
        >
          <View style={styles.blockCenter}>
            <Text
              ref={blockedTitleRef}
              accessibilityLiveRegion={
                permissionError ? "assertive" : "polite"
              }
              style={styles.blockTitle}
            >
              {permissionError
                ? "No se pudieron validar los permisos."
                : verifiedDenied
                  ? "Este módulo no está disponible"
                  : "Verificando acceso…"}
            </Text>
            {permissionError ? (
              <Text style={styles.blockDetail}>{permissionError}</Text>
            ) : verifiedDenied ? (
              <Text style={styles.blockDetail}>
                Tu rol no tiene permiso para abrir este módulo. Vuelve al
                inicio.
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace("/panel" as Href)}
              style={({ pressed }) => [
                styles.unlockHomeButton,
                pressed && styles.unlockHomePressed,
              ]}
            >
              <Text style={styles.unlockHomeText}>Ir al inicio</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  navigator: { flex: 1 },
  blockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BrandColors.cream,
    padding: Spacing.xl,
    zIndex: 20,
    elevation: 20,
  },
  blockCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  blockTitle: { color: BrandColors.text, ...Typography.h3 },
  blockDetail: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xs,
    textAlign: "center",
  },
  unlockCard: {
    width: "100%",
    maxWidth: Layout.dialogMaxWidth,
    alignSelf: "center",
    marginTop: ControlSize.default,
    gap: Spacing.xs,
  },
  unlockTitle: {
    color: BrandColors.text,
    ...Typography.h3,
    textAlign: "center",
  },
  unlockHint: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  unlockHomeButton: {
    alignSelf: "center",
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.xs,
  },
  unlockHomeText: { color: BrandColors.greenDark, ...Typography.label },
  unlockHomePressed: { opacity: Interaction.pressedOpacity },
  tabBar: {
    minHeight: ComponentMetrics.navigationItemHeight + Spacing.sm,
    paddingHorizontal: Spacing.xs,
    paddingTop: Spacing.xs,
    backgroundColor: BrandColors.white,
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    flexDirection: "row",
    ...Elevation.tabUpward,
  },
  tabRail: {
    width: Layout.navigationRailWidth,
    minHeight: 0,
    flexDirection: "column",
    gap: Spacing.xs,
    paddingRight: Spacing.xs,
    borderTopWidth: 0,
    borderRightWidth: 1,
    borderRightColor: BrandColors.line,
    ...(Platform.OS === "web"
      ? { boxShadow: "none" }
      : { elevation: 0, shadowOpacity: 0 }),
  },
  tabItem: {
    flex: 1,
    minHeight: ComponentMetrics.navigationItemHeight,
    borderRadius: ComponentMetrics.navigationItemRadius,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xxs,
  },
  tabItemExpanded: {
    flex: 0,
    width: "100%",
    minHeight: 68,
  },
  tabItemActive: { backgroundColor: BrandColors.greenLight },
  tabItemPressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
  tabLabel: {
    fontSize: Typography.overline.fontSize,
    lineHeight: Typography.overline.lineHeight,
    fontWeight: "700",
  },
});
