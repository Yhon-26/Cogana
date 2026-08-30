import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  CommerceButton,
  ProductVisual,
  QuantityStepper,
  TrustItem,
} from "@/components/commerce-ui";
import { OnlineScreen } from "@/components/online-shell";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";
import {
  BrandColors,
  ComponentMetrics,
  ControlSize,
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useCart } from "@/context/cart-context";
import {
  calculateLineTotalCents,
  parseDecimalToInteger,
} from "@/database/integer-calculations";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import type { OnlineProduct } from "@/online/contracts";
import { getOnlineCatalog } from "@/online/store-api";

export default function OnlineProductDetailScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const { addItem } = useCart();
  const [product, setProduct] = useState<OnlineProduct | null>(null);
  const [quantity, setQuantity] = useState("");
  const [wasAdded, setWasAdded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const catalog = await getOnlineCatalog();
      const found =
        catalog.products.find((item) => item.id === productId) ?? null;
      setProduct(found);
      if (found) setQuantity(String(found.pricingQuantity));
      if (!found) setLoadError("Este producto ya no está disponible.");
    } catch (error) {
      setLoadError(
        getUserFacingErrorMessage(error, "No se pudo cargar el producto."),
      );
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const parsedQuantity = parseDecimalToInteger(quantity, 0);
  const subtotal = useMemo(() => {
    if (!product || parsedQuantity === null || parsedQuantity <= 0) return 0;
    return calculateLineTotalCents(
      parsedQuantity,
      product.priceCents,
      product.pricingQuantity,
    );
  }, [parsedQuantity, product]);

  const add = () => {
    if (!product || parsedQuantity === null || parsedQuantity <= 0) {
      Alert.alert("Cantidad inválida", "Ingresa una cantidad mayor que cero.");
      return;
    }
    try {
      addItem(product, parsedQuantity);
      setWasAdded(true);
    } catch (error) {
      Alert.alert(
        "No se pudo agregar",
        getUserFacingErrorMessage(error, "Revisa la cantidad disponible."),
      );
    }
  };

  if (!product) {
    return (
      <OnlineScreen title="Producto">
        <View style={styles.loadingCard}>
          <Text style={styles.muted}>{loadError ?? "Cargando detalle…"}</Text>
          {loadError ? (
            <CommerceButton label="Reintentar" onPress={() => void load()} />
          ) : null}
        </View>
      </OnlineScreen>
    );
  }

  const step = product.baseUnit === "gram" ? 100 : 1;
  const currentQuantity = parsedQuantity ?? 0;
  const stockRatio =
    product.minimumStockQuantity > 0
      ? product.stockQuantity / product.minimumStockQuantity
      : Number.POSITIVE_INFINITY;

  return (
    <OnlineScreen
      title={product.name}
      subtitle={product.category}
      footer={
        <View style={styles.footer}>
          <View>
            <Text style={styles.footerLabel}>Subtotal estimado</Text>
            <Text style={styles.footerTotal}>
              S/ {(subtotal / 100).toFixed(2)}
            </Text>
          </View>
          <CommerceButton
            compact
            disabled={parsedQuantity === null || parsedQuantity <= 0}
            icon={wasAdded ? "check" : "cart-plus"}
            label={wasAdded ? "Agregado" : "Agregar"}
            onPress={add}
            style={styles.footerButton}
            tone={wasAdded ? "secondary" : "primary"}
          />
        </View>
      }
    >
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.categoryPill}>
            <Text style={styles.categoryText}>{product.category}</Text>
          </View>
          <View
            style={[styles.stockPill, stockRatio <= 1 && styles.stockPillLow]}
          >
            <View
              style={[styles.stockDot, stockRatio <= 1 && styles.stockDotLow]}
            />
            <Text
              style={[styles.stockText, stockRatio <= 1 && styles.stockTextLow]}
            >
              {stockRatio <= 1 ? "Últimas unidades" : "Disponible hoy"}
            </Text>
          </View>
        </View>
        <ProductVisual
          name={product.name}
          category={product.category}
          size={118}
        />
      </View>

      <View style={styles.card}>
        <View style={styles.priceHeader}>
          <View>
            <Text style={styles.sku}>SKU {product.sku}</Text>
            <Text style={styles.price}>
              S/ {(product.priceCents / 100).toFixed(2)}
            </Text>
            <Text style={styles.unitPrice}>
              por {product.pricingQuantity}{" "}
              {product.baseUnit === "gram" ? "gramos" : "unidades"}
            </Text>
          </View>
          <View style={styles.stockBox}>
            <Text style={styles.stockNumber}>{product.stockQuantity}</Text>
            <Text style={styles.stockLabel}>
              {product.baseUnit === "gram"
                ? "g disponibles"
                : "un. disponibles"}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />
        <Text style={styles.label}>
          Elige la cantidad en{" "}
          {product.baseUnit === "gram" ? "gramos" : "unidades"}
        </Text>
        <View style={styles.quantityEditor}>
          <QuantityStepper
            decreaseDisabled={currentQuantity <= step}
            increaseDisabled={currentQuantity + step > product.stockQuantity}
            label={`Cantidad de ${product.name}`}
            onDecrease={() => {
              setWasAdded(false);
              setQuantity(String(Math.max(step, currentQuantity - step)));
            }}
            onIncrease={() => {
              setWasAdded(false);
              setQuantity(
                String(Math.min(product.stockQuantity, currentQuantity + step)),
              );
            }}
            value={`${currentQuantity || 0}${product.baseUnit === "gram" ? " g" : " un."}`}
          />
          <TextInput
            accessibilityLabel="Escribir cantidad exacta"
            keyboardType="number-pad"
            onChangeText={(value) => {
              setWasAdded(false);
              setQuantity(value);
            }}
            placeholder="Cantidad"
            placeholderTextColor={BrandColors.muted}
            selectTextOnFocus
            style={styles.input}
            value={quantity}
          />
        </View>

        <Text style={styles.quickLabel}>ATAJOS</Text>
        <View style={styles.quickRow}>
          <Quick
            label={`${product.pricingQuantity}${product.baseUnit === "gram" ? " g" : " un."}`}
            onPress={() => {
              setWasAdded(false);
              setQuantity(String(product.pricingQuantity));
            }}
          />
          {product.presentations.slice(0, 2).map((presentation) => (
            <Quick
              key={presentation.id}
              label={presentation.name}
              onPress={() => {
                setWasAdded(false);
                setQuantity(String(presentation.quantityInBaseUnits));
              }}
            />
          ))}
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Subtotal estimado</Text>
          <Text style={styles.total}>S/ {(subtotal / 100).toFixed(2)}</Text>
        </View>
      </View>

      <View style={styles.note}>
        <MaterialCommunityIcons
          name="scale"
          size={20}
          color={BrandColors.warning}
        />
        <View style={styles.noteCopy}>
          <Text style={styles.noteTitle}>Cobro justo por peso</Text>
          <Text style={styles.noteText}>
            Los productos por peso se cobran según la cantidad final preparada.
          </Text>
        </View>
      </View>

      <View style={styles.trust}>
        <TrustItem icon="shield-check-outline">Compra protegida</TrustItem>
        <TrustItem icon="package-check">Preparación cuidadosa</TrustItem>
        <TrustItem icon="swap-horizontal">
          Sustituciones bajo tu control
        </TrustItem>
      </View>
    </OnlineScreen>
  );
}

function Quick({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.quick, pressed && styles.pressed]}
    >
      <Text style={styles.quickText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loadingCard: {
    minHeight: 180,
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: {
    minHeight: 220,
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.sand,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.md,
  },
  heroTop: {
    position: "absolute",
    left: Spacing.md,
    right: Spacing.md,
    top: Spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  categoryPill: {
    borderRadius: Radius.round,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  categoryText: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
  },
  stockPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  stockPillLow: { backgroundColor: BrandColors.goldLight },
  stockDot: {
    width: 7,
    height: 7,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.success,
  },
  stockDotLow: { backgroundColor: BrandColors.goldDark },
  stockText: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
  },
  stockTextLow: { color: BrandColors.goldDark },
  card: {
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  priceHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  sku: { color: BrandColors.muted, ...Typography.overline },
  price: {
    color: BrandColors.greenDark,
    ...Typography.h1,
    marginTop: Spacing.xxs,
  },
  unitPrice: { color: BrandColors.muted, ...Typography.caption },
  stockBox: { alignItems: "flex-end", paddingBottom: 2 },
  stockNumber: { color: BrandColors.text, ...Typography.h3 },
  stockLabel: { color: BrandColors.muted, ...Typography.caption },
  divider: {
    height: 1,
    backgroundColor: BrandColors.line,
    marginVertical: Spacing.xxs,
  },
  muted: { color: BrandColors.muted, ...Typography.body },
  label: { color: BrandColors.text, ...Typography.label },
  quantityEditor: { gap: Spacing.xs },
  input: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.lineStrong,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.bodyLarge,
    fontWeight: "700",
  },
  quickLabel: {
    color: BrandColors.muted,
    ...Typography.overline,
    marginTop: Spacing.xxs,
  },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  quick: {
    minHeight: ControlSize.default,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.surfaceMuted,
    paddingHorizontal: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  quickText: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.xxs,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    padding: Spacing.sm,
  },
  totalLabel: { color: BrandColors.muted, ...Typography.caption },
  total: { color: BrandColors.greenDark, ...Typography.h3 },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
    borderRadius: Radius.lg,
    padding: Spacing.sm,
    backgroundColor: BrandColors.goldLight,
  },
  noteCopy: { flex: 1 },
  noteTitle: { color: BrandColors.warning, ...Typography.label },
  noteText: {
    color: BrandColors.warning,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  trust: {
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    paddingTop: Spacing.md,
    gap: Spacing.xs,
  },
  footer: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  footerLabel: { color: BrandColors.muted, ...Typography.caption },
  footerTotal: { color: BrandColors.text, ...Typography.h2 },
  footerButton: { flex: 1 },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
