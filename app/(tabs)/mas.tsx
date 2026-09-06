import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AdminScreen, sharedStyles } from "@/components/admin-ui";
import { OperatorSelector } from "@/components/operator-selector";
import {
  BrandColors,
  ControlSize,
  Elevation,
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useLocalOperator } from "@/context/local-operator-context";
import { useAdaptiveLayout } from "@/hooks/use-adaptive-layout";
import {
  DEFAULT_SELLER_MODULES,
  operatorModuleFromPath,
} from "@/auth/operator-route-access";

const modules = [
  ["Precios", "tag-outline", "/precios"],
  ["Historial de ventas", "receipt-text-clock-outline", "/historial-ventas"],
  ["Proveedores", "truck-outline", "/proveedores"],
  ["Compras y lotes", "cart-arrow-down", "/compras"],
  ["Catálogo avanzado", "shape-plus-outline", "/catalogo-admin"],
  ["Promociones", "sale-outline", "/promociones"],
  ["Zonas delivery", "map-marker-radius-outline", "/delivery-zones"],
  ["Repartos", "moped-outline", "/repartos"],
  ["Negocios", "storefront-outline", "/negocios"],
  ["Empleados", "account-group-outline", "/empleados"],
  ["Personal avanzado", "account-clock-outline", "/personal-avanzado"],
  ["Reportes", "chart-box-outline", "/reportes"],
  ["Sincronización", "sync", "/sincronizacion"],
  ["Soporte", "lifebuoy", "/soporte"],
  ["Configuración", "cog-outline", "/configuracion"],
  ["Escáner", "barcode-scan", "/scanner"],
] as const;

export default function MoreScreen() {
  const { isMedium } = useAdaptiveLayout();
  const { selectedUser } = useLocalOperator();
  const visibleModules =
    selectedUser?.role === "administrator"
      ? modules
      : modules.filter(([, , route]) =>
          DEFAULT_SELLER_MODULES.has(operatorModuleFromPath(route)),
        );
  return (
    <AdminScreen title="Más" subtitle="Administración, diagnóstico y expansión">
      {/* El selector de operadores vive aquí: con un solo perfil (dueño) es
          invisible y con vendedores muestra la barra de cambio con PIN. */}
      <OperatorSelector />
      <View style={styles.grid}>
        {visibleModules.map(([title, icon, route]) => (
          <Pressable
            accessibilityLabel={`Abrir ${title}`}
            accessibilityRole="button"
            key={route}
            onPress={() => router.push(route as Href)}
            style={({ pressed }) => [
              sharedStyles.card,
              styles.card,
              isMedium && styles.cardMedium,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.icon}>
              <MaterialCommunityIcons
                name={icon}
                size={22}
                color={BrandColors.green}
              />
            </View>
            <Text maxFontSizeMultiplier={1.3} style={styles.title}>
              {title}
            </Text>
          </Pressable>
        ))}
      </View>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  card: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    minWidth: 190,
    minHeight: ControlSize.default * 2 + Spacing.xs,
    justifyContent: "space-between",
    gap: Spacing.sm,
    padding: Spacing.md,
    ...Elevation.ambientCard,
  },
  cardMedium: { maxWidth: 252 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: BrandColors.text,
    ...Typography.label,
    minWidth: 0,
    flexShrink: 1,
  },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
