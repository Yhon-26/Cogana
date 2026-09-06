import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  AdminScreen,
  PrimaryButton,
  SectionTitle,
  sharedStyles,
} from "@/components/admin-ui";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";
import {
  BrandColors,
  ControlSize,
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useLocalOperator } from "@/context/local-operator-context";
import type { ProductRecord } from "@/database/models";
import { formatSoles } from "@/lib/money";
import { formatPricingUnit } from "@/lib/units";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";
import { useLocalProducts } from "@/hooks/use-local-products";

function formatStock(product: ProductRecord, quantity: number) {
  return product.baseUnit === "gram"
    ? `${(quantity / 1000).toFixed(2)} kg`
    : `${quantity} un.`;
}

export default function InventoryScreen() {
  const { products, isLoading, error, refresh } = useLocalProducts();
  const { selectedUser } = useLocalOperator();
  const [query, setQuery] = useState("");
  const lowStock = products.filter(
    (product) => product.stockQuantity <= product.minimumStockQuantity,
  ).length;
  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-PE");
    if (!normalized) return products;
    return products.filter((product) =>
      `${product.name} ${product.sku} ${product.category}`
        .toLocaleLowerCase("es-PE")
        .includes(normalized),
    );
  }, [products, query]);

  if (isLoading) {
    return (
      <AdminScreen
        title="Inventario"
        subtitle="Consulta existencias y productos por reponer"
      >
        <View style={[sharedStyles.card, styles.stateCard]}>
          <ActivityIndicator
            accessibilityLabel="Cargando inventario"
            color={BrandColors.green}
            size="small"
          />
          <Text accessibilityLiveRegion="polite" style={styles.feedbackTitle}>
            Cargando inventario…
          </Text>
          <Text style={styles.feedbackText}>
            Consultando productos, precios y existencias disponibles.
          </Text>
        </View>
      </AdminScreen>
    );
  }

  if (error) {
    return (
      <AdminScreen
        title="Inventario"
        subtitle="Consulta existencias y productos por reponer"
      >
        <View style={[sharedStyles.card, styles.stateCard]}>
          <MaterialCommunityIcons
            name="cloud-alert-outline"
            size={32}
            color={BrandColors.danger}
          />
          <Text style={styles.feedbackTitle}>
            No se pudo cargar el inventario
          </Text>
          <Text
            accessibilityLiveRegion="assertive"
            accessibilityRole="alert"
            style={styles.feedbackText}
          >
            {getOperatorErrorMessage(
              error,
              "No se pudo cargar el inventario. Intenta nuevamente.",
            )}
          </Text>
          <PrimaryButton
            icon="refresh"
            label="Intentar nuevamente"
            onPress={() => void refresh()}
            style={styles.stateAction}
          />
        </View>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen
      title="Inventario"
      subtitle="Consulta existencias y productos por reponer"
    >
      {selectedUser?.role === "administrator" ? (
        <PrimaryButton
          icon="plus"
          label="Crear producto"
          onPress={() => router.push("/inventario/nuevo" as Href)}
        />
      ) : null}
      <View style={styles.metricRow}>
        <View style={[sharedStyles.card, styles.metricCard]}>
          <Text style={styles.metricLabel}>PRODUCTOS ACTIVOS</Text>
          <Text style={styles.metricValue}>{products.length}</Text>
        </View>
        <View
          style={[sharedStyles.card, styles.metricCard, styles.alertMetric]}
        >
          <Text style={styles.alertLabel}>POR REPONER</Text>
          <Text style={styles.alertValue}>{lowStock}</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <MaterialCommunityIcons
          name="magnify"
          size={21}
          color={BrandColors.muted}
        />
        <TextInput
          accessibilityLabel="Buscar producto o código"
          onChangeText={setQuery}
          placeholder="Buscar producto o código"
          placeholderTextColor={BrandColors.muted}
          style={styles.searchInput}
          value={query}
        />
        {query ? (
          <Pressable
            accessibilityLabel="Limpiar búsqueda"
            accessibilityRole="button"
            onPress={() => setQuery("")}
            style={styles.clearButton}
          >
            <MaterialCommunityIcons
              name="close-circle"
              size={19}
              color={BrandColors.mutedLight}
            />
          </Pressable>
        ) : null}
      </View>

      <SectionTitle
        action={
          <Text style={styles.resultCount}>
            {filteredProducts.length} productos
          </Text>
        }
      >
        Existencias
      </SectionTitle>
      <View style={styles.list}>
        {filteredProducts.length === 0 ? (
          <View style={[sharedStyles.card, styles.emptyCard]}>
            <View style={styles.emptyIcon}>
              <MaterialCommunityIcons
                name={query.trim() ? "magnify-close" : "package-variant-closed"}
                size={30}
                color={BrandColors.greenDark}
              />
            </View>
            <Text accessibilityLiveRegion="polite" style={styles.emptyTitle}>
              {query.trim()
                ? "No encontramos coincidencias"
                : "Aún no hay productos"}
            </Text>
            <Text style={styles.emptyText}>
              {query.trim()
                ? "Prueba con otro nombre, SKU o categoría."
                : selectedUser?.role === "administrator"
                  ? "Crea el primer producto para empezar a controlar sus existencias."
                  : "Un administrador debe registrar el primer producto."}
            </Text>
            {query.trim() ? (
              <PrimaryButton
                icon="filter-remove-outline"
                label="Limpiar búsqueda"
                onPress={() => setQuery("")}
                style={styles.stateAction}
              />
            ) : selectedUser?.role === "administrator" ? (
              <PrimaryButton
                icon="plus"
                label="Crear primer producto"
                onPress={() => router.push("/inventario/nuevo" as Href)}
                style={styles.stateAction}
              />
            ) : null}
          </View>
        ) : (
          filteredProducts.map((product) => {
            const low = product.stockQuantity <= product.minimumStockQuantity;
            return (
              <Pressable
                accessibilityLabel={`Abrir ${product.name}, existencia ${formatStock(product, product.stockQuantity)}`}
                accessibilityRole="button"
                key={product.id}
                onPress={() => router.push(`/inventario/${product.id}` as Href)}
                style={({ pressed }) => [
                  sharedStyles.card,
                  styles.productCard,
                  pressed && styles.pressed,
                ]}
              >
                <View
                  style={[styles.iconWrap, low && styles.iconWrapLow]}
                >
                  <MaterialCommunityIcons
                    name="barley"
                    size={21}
                    color={low ? BrandColors.warning : BrandColors.green}
                  />
                </View>
                <View style={styles.productCopy}>
                  <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.productName}>
                    {product.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.productMeta}>
                    {product.sku} · {product.category}
                  </Text>
                </View>
                <View style={styles.stockCopy}>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    style={[styles.stockValue, low && styles.stockValueLow]}
                  >
                    {formatStock(product, product.stockQuantity)}
                  </Text>
                  <Text numberOfLines={1} style={styles.priceValue}>
                    {formatSoles(product.priceCents)} /{" "}
                    {formatPricingUnit(product)}
                  </Text>
                </View>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={19}
                  color={BrandColors.mutedLight}
                />
              </Pressable>
            );
          })
        )}
      </View>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  stateCard: {
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.xl,
  },
  stateAction: { alignSelf: "stretch", marginTop: Spacing.xs },
  feedbackTitle: { color: BrandColors.text, ...Typography.h3 },
  feedbackText: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
  },
  metricRow: { flexDirection: "row", gap: Spacing.sm },
  metricCard: { flex: 1, padding: Spacing.md },
  alertMetric: {
    backgroundColor: BrandColors.goldLight,
    borderColor: BrandColors.goldDark,
  },
  metricLabel: { color: BrandColors.muted, ...Typography.overline },
  alertLabel: { color: BrandColors.warning, ...Typography.overline },
  metricValue: {
    color: BrandColors.text,
    ...Typography.h2,
    marginTop: Spacing.xs,
  },
  alertValue: {
    color: BrandColors.warning,
    ...Typography.h2,
    marginTop: Spacing.xs,
  },
  searchWrap: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: Spacing.md,
    gap: Spacing.xs,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: BrandColors.text,
    ...Typography.body,
    paddingVertical: 13,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  clearButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
  },
  resultCount: { color: BrandColors.muted, ...Typography.label },
  list: { gap: Spacing.sm },
  emptyCard: { alignItems: "center", gap: Spacing.xs, padding: Spacing.xl },
  emptyIcon: {
    width: ControlSize.large,
    height: ControlSize.large,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    color: BrandColors.text,
    ...Typography.h3,
    textAlign: "center",
  },
  emptyText: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
  },
  productCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.sm,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.greenLight,
  },
  iconWrapLow: { backgroundColor: BrandColors.goldLight },
  productCopy: {
    flex: 1,
    minWidth: 0,
  },
  productName: { color: BrandColors.text, ...Typography.label },
  productMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: 2,
  },
  stockCopy: { alignItems: "flex-end", flexShrink: 0 },
  stockValue: {
    color: BrandColors.text,
    ...Typography.label,
    fontWeight: "800",
  },
  stockValueLow: { color: BrandColors.warning },
  priceValue: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: 2,
  },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
