import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { CommerceButton, ProductVisual } from "@/components/commerce-ui";
import { OnlineScreen } from "@/components/online-shell";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";
import {
  BrandColors,
  ControlSize,
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useCart } from "@/context/cart-context";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { getMyBusinessContext } from "@/online/business-api";
import type { BusinessPrice } from "@/online/business-contracts";
import type { OnlineCatalog } from "@/online/contracts";
import { getOnlineCatalog } from "@/online/store-api";

export default function BusinessCatalogScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const { addItem, itemCount, items } = useCart();
  const [catalog, setCatalog] = useState<OnlineCatalog | null>(null);
  const [prices, setPrices] = useState<BusinessPrice[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void Promise.all([getOnlineCatalog(), getMyBusinessContext()])
      .then(([nextCatalog, context]) => {
        setCatalog(nextCatalog);
        setPrices(
          context.prices.filter(
            (price) => price.businessAccountId === businessId,
          ),
        );
      })
      .catch((error) =>
        Alert.alert(
          "No se pudo cargar",
          getUserFacingErrorMessage(error, "Intenta nuevamente."),
        ),
      );
  }, [businessId]);

  const products = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-PE");
    return (catalog?.products ?? []).filter(
      (product) =>
        !normalized ||
        product.name.toLocaleLowerCase("es-PE").includes(normalized) ||
        product.category.toLocaleLowerCase("es-PE").includes(normalized),
    );
  }, [catalog, query]);

  return (
    <OnlineScreen
      title="Catálogo mayorista"
      subtitle="Compra por volumen o solicita cotización"
      cartHref={null}
      right={
        <Pressable
          accessibilityLabel={`Carrito mayorista con ${itemCount} productos`}
          accessibilityRole="button"
          onPress={() =>
            router.push(`/negocio/carrito?businessId=${businessId}` as Href)
          }
          style={({ pressed }) => [styles.cart, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons
            name="cart-variant"
            size={21}
            color={BrandColors.white}
          />
          {itemCount ? <Text style={styles.badge}>{itemCount}</Text> : null}
        </Pressable>
      }
      footer={
        itemCount ? (
          <View style={styles.footer}>
            <View>
              <Text style={styles.footerLabel}>Canasta mayorista</Text>
              <Text style={styles.footerCount}>{itemCount} productos</Text>
            </View>
            <CommerceButton
              compact
              icon="cart-arrow-right"
              label="Revisar canasta"
              onPress={() =>
                router.push(`/negocio/carrito?businessId=${businessId}` as Href)
              }
              style={styles.footerButton}
              tone="accent"
            />
          </View>
        ) : null
      }
    >
      <View style={styles.searchWrap}>
        <MaterialCommunityIcons
          name="magnify"
          size={20}
          color={BrandColors.muted}
        />
        <TextInput
          accessibilityLabel="Buscar producto o categoría"
          placeholder="Buscar producto o categoría"
          placeholderTextColor={BrandColors.muted}
          style={styles.search}
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <MaterialCommunityIcons
            name="sale-outline"
            size={25}
            color={BrandColors.goldDark}
          />
        </View>
        <View style={styles.fill}>
          <Text style={styles.heroTitle}>
            Precios que mejoran con tu volumen
          </Text>
          <Text style={styles.heroText}>
            Agrega productos y solicita una propuesta para tu negocio.
          </Text>
        </View>
      </View>
      {products.map((product) => {
        const agreed = prices
          .filter((price) => price.productId === product.id)
          .sort((a, b) => a.minimumQuantity - b.minimumQuantity);
        const step = product.baseUnit === "gram" ? 1000 : 1;
        const inCart = items.some((item) => item.product.id === product.id);
        return (
          <View key={product.id} style={styles.card}>
            <ProductVisual
              category={product.category}
              name={product.name}
              size={58}
            />
            <View style={styles.fill}>
              <Text style={styles.name}>{product.name}</Text>
              <Text style={styles.meta}>
                {product.category} · Stock {product.stockQuantity}
              </Text>
              <Text style={styles.price}>
                Lista S/ {(product.priceCents / 100).toFixed(2)}
              </Text>
              {agreed.map((price) => (
                <Text key={price.id} style={styles.agreed}>
                  Desde {price.minimumQuantity}: S/{" "}
                  {(price.priceCents / 100).toFixed(2)}
                </Text>
              ))}
            </View>
            <Pressable
              accessibilityLabel={
                inCart
                  ? `${product.name} en la canasta`
                  : `Agregar ${product.name}`
              }
              accessibilityRole="button"
              accessibilityState={{
                disabled: product.stockQuantity < step,
                selected: inCart,
              }}
              disabled={product.stockQuantity < step}
              onPress={() => {
                try {
                  addItem(product, step);
                } catch (error) {
                  Alert.alert(
                    "Cantidad no disponible",
                    getUserFacingErrorMessage(error, "Revisa el stock."),
                  );
                }
              }}
              style={({ pressed }) => [
                styles.add,
                inCart && styles.addActive,
                product.stockQuantity < step && styles.disabled,
                pressed && product.stockQuantity >= step && styles.pressed,
              ]}
            >
              <MaterialCommunityIcons
                name={inCart ? "check" : "plus"}
                size={21}
                color={BrandColors.white}
              />
            </Pressable>
          </View>
        );
      })}
    </OnlineScreen>
  );
}

const styles = StyleSheet.create({
  cart: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenDark,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    right: -3,
    top: -3,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.gold,
    color: BrandColors.ink,
    ...Typography.overline,
    letterSpacing: 0,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xxs,
  },
  searchWrap: {
    minHeight: 52,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: BrandColors.lineStrong,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  search: { flex: 1, color: BrandColors.text, ...Typography.body },
  hero: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.goldLight,
    padding: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { color: BrandColors.text, ...Typography.label },
  heroText: {
    color: BrandColors.warning,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    padding: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  fill: { flex: 1 },
  name: { color: BrandColors.text, ...Typography.body, fontWeight: "700" },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  price: {
    color: BrandColors.text,
    ...Typography.caption,
    fontWeight: "700",
    marginTop: Spacing.xxs,
  },
  agreed: {
    color: BrandColors.greenDark,
    ...Typography.label,
    marginTop: Spacing.xxs,
  },
  add: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  addActive: { backgroundColor: BrandColors.greenDark },
  footer: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  footerLabel: { color: BrandColors.muted, ...Typography.caption },
  footerCount: {
    color: BrandColors.text,
    ...Typography.label,
    marginTop: Spacing.xxs,
  },
  footerButton: { flex: 1 },
  disabled: { opacity: Interaction.disabledOpacity },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
