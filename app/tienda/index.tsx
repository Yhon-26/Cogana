import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  CommerceButton,
  ProductVisual,
  SkeletonBlock,
  TrustItem,
} from "@/components/commerce-ui";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";
import { OnlineScreen } from "@/components/online-shell";
import {
  BrandColors,
  ControlSize,
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useCart } from "@/context/cart-context";
import { useCustomerAuth } from "@/context/customer-auth-context";
import { useAdaptiveLayout } from "@/hooks/use-adaptive-layout";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import type {
  OnlineCatalog,
  OnlineOrder,
  OnlinePreferences,
  OnlineProduct,
} from "@/online/contracts";
import {
  getMyOnlineOrders,
  getMyOnlinePreferences,
  getOnlineCatalog,
  setFavoriteProduct,
} from "@/online/store-api";

export default function StoreHomeScreen() {
  const { account } = useCustomerAuth();
  const { addItem, items } = useCart();
  const { isMedium } = useAdaptiveLayout();
  const [catalog, setCatalog] = useState<OnlineCatalog | null>(null);
  const [preferences, setPreferences] = useState<OnlinePreferences | null>(
    null,
  );
  const [recentOrder, setRecentOrder] = useState<OnlineOrder | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [nextCatalog, nextPreferences] = await Promise.all([
        getOnlineCatalog(),
        getMyOnlinePreferences(),
      ]);
      setCatalog(nextCatalog);
      setPreferences(nextPreferences);
      setIsLoading(false);
      void getMyOnlineOrders()
        .then((orders) => {
          const delivered = orders.find(
            (order) => order.status === "delivered",
          );
          setRecentOrder(delivered ?? orders[0] ?? null);
        })
        .catch(() => {
          // La recompra es una mejora progresiva; el catálogo sigue disponible.
        });
    } catch (caughtError) {
      setError(
        getUserFacingErrorMessage(caughtError, "No se pudo cargar la tienda."),
      );
      setIsLoading(false);
    }
  }, []);

  const toggleFavorite = async (productId: string) => {
    const favorite = !(
      preferences?.favoriteProductIds.includes(productId) ?? false
    );
    try {
      await setFavoriteProduct(productId, favorite);
      setPreferences((current) =>
        current
          ? {
              ...current,
              favoriteProductIds: favorite
                ? [...current.favoriteProductIds, productId]
                : current.favoriteProductIds.filter((id) => id !== productId),
            }
          : current,
      );
    } catch (caughtError) {
      setError(
        getUserFacingErrorMessage(
          caughtError,
          "No se pudo guardar el favorito.",
        ),
      );
    }
  };

  const quickAdd = (product: OnlineProduct) => {
    const quantity = Math.min(product.pricingQuantity, product.stockQuantity);
    if (quantity <= 0) return;
    try {
      addItem(product, quantity);
    } catch (caughtError) {
      Alert.alert(
        "No se pudo agregar",
        getUserFacingErrorMessage(
          caughtError,
          "Revisa la cantidad disponible.",
        ),
      );
    }
  };

  const repeatOrder = (order: OnlineOrder) => {
    if (!catalog) return;
    let added = 0;
    let skipped = 0;
    for (const item of order.items) {
      const product = catalog.products.find(
        (candidate) => candidate.id === item.productId,
      );
      if (!product || product.stockQuantity <= 0) {
        skipped += 1;
        continue;
      }
      try {
        addItem(
          product,
          Math.min(item.requestedQuantity, product.stockQuantity),
        );
        added += 1;
      } catch {
        skipped += 1;
      }
    }
    if (!added) {
      Alert.alert(
        "Productos no disponibles",
        "Por ahora no podemos repetir esa compra.",
      );
      return;
    }
    if (skipped) {
      Alert.alert(
        "Canasta actualizada",
        `Agregamos ${added} productos. ${skipped} no estaban disponibles.`,
        [
          {
            text: "Revisar carrito",
            onPress: () => router.push("/tienda/carrito" as Href),
          },
        ],
      );
      return;
    }
    router.push("/tienda/carrito" as Href);
  };

  useFocusEffect(useCallback(() => void load(), [load]));

  const products = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-PE");
    const favorites = new Set(preferences?.favoriteProductIds ?? []);
    return (catalog?.products ?? [])
      .filter(
        (product) =>
          (!category || product.category === category) &&
          (!normalized ||
            `${product.name} ${product.sku} ${product.category}`
              .toLocaleLowerCase("es-PE")
              .includes(normalized)),
      )
      .sort(
        (left, right) =>
          Number(favorites.has(right.id)) - Number(favorites.has(left.id)),
      );
  }, [catalog, category, preferences?.favoriteProductIds, query]);

  const promotion = preferences?.promotions[0] ?? null;

  return (
    <OnlineScreen
      title={`Hola, ${account?.name.split(" ")[0] ?? "cliente"}`}
      subtitle="¿Qué necesitas hoy?"
      showBottomNav
    >
      {promotion ? (
        <View style={styles.promo}>
          <View style={styles.promoIcon}>
            <MaterialCommunityIcons
              name="ticket-percent-outline"
              size={25}
              color={BrandColors.goldDark}
            />
          </View>
          <View style={styles.promoCopy}>
            <Text style={styles.promoEyebrow}>BENEFICIO PARA TI</Text>
            <Text style={styles.promoTitle}>{promotion.title}</Text>
            <Text style={styles.promoText}>{promotion.description}</Text>
            {promotion.couponCode ? (
              <View style={styles.coupon}>
                <Text style={styles.couponText}>
                  Código {promotion.couponCode}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {recentOrder ? (
        <View style={styles.reorder}>
          <View style={styles.reorderIcon}>
            <MaterialCommunityIcons
              name="repeat"
              size={22}
              color={BrandColors.greenDark}
            />
          </View>
          <View style={styles.reorderCopy}>
            <Text style={styles.reorderEyebrow}>TU COMPRA DE SIEMPRE</Text>
            <Text style={styles.reorderTitle}>
              Repite {recentOrder.items.length} productos en un toque
            </Text>
            <Text style={styles.reorderMeta}>
              Último pedido · S/{" "}
              {(
                (recentOrder.finalTotalCents ??
                  recentOrder.estimatedTotalCents) / 100
              ).toFixed(2)}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Repetir última compra"
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => repeatOrder(recentOrder)}
            style={({ pressed }) => [
              styles.reorderButton,
              pressed && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons
              name="arrow-right"
              size={20}
              color={BrandColors.white}
            />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.search}>
        <MaterialCommunityIcons
          name="magnify"
          size={20}
          color={BrandColors.muted}
        />
        <TextInput
          accessibilityLabel="Buscar productos"
          onChangeText={setQuery}
          placeholder="Buscar arroz, aceite, limpieza…"
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
              size={20}
              color={BrandColors.mutedLight}
            />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        contentContainerStyle={styles.categories}
        showsHorizontalScrollIndicator={false}
      >
        <Chip
          active={!category}
          label="Todos"
          onPress={() => setCategory("")}
        />
        {(catalog?.categories ?? []).map((value) => (
          <Chip
            active={category === value}
            key={value}
            label={value}
            onPress={() => setCategory(value)}
          />
        ))}
      </ScrollView>

      {error ? (
        <Pressable
          accessibilityLabel={`${error}. Toca para reintentar`}
          accessibilityLiveRegion="polite"
          accessibilityRole="button"
          onPress={() => void load()}
          style={({ pressed }) => [styles.message, pressed && styles.pressed]}
        >
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.retry}>Toca para reintentar</Text>
        </Pressable>
      ) : null}

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionEyebrow}>
            {category ? category.toLocaleUpperCase("es-PE") : "DESPENSA"}
          </Text>
          <Text style={styles.sectionTitle}>
            {query ? "Resultados" : "Productos para ti"}
          </Text>
        </View>
        {catalog ? (
          <Text style={styles.productCount}>{products.length} disponibles</Text>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.grid}>
          {[0, 1, 2, 3].map((key) => (
            <View
              key={key}
              style={[styles.card, isMedium && styles.cardMedium]}
            >
              <SkeletonBlock height={82} />
              <SkeletonBlock height={18} style={styles.skeletonName} />
              <SkeletonBlock height={14} style={styles.skeletonPrice} />
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.grid}>
          {products.map((product) => {
            const favorite =
              preferences?.favoriteProductIds.includes(product.id) ?? false;
            const inCart = items.some((item) => item.product.id === product.id);
            const soldOut = product.stockQuantity <= 0;
            return (
              <View
                key={product.id}
                style={[styles.card, isMedium && styles.cardMedium]}
              >
                <View style={styles.cardTop}>
                  <ProductVisual
                    name={product.name}
                    category={product.category}
                    size={76}
                  />
                  <Pressable
                    accessibilityLabel={
                      favorite ? "Quitar de favoritos" : "Agregar a favoritos"
                    }
                    accessibilityRole="button"
                    accessibilityState={{ selected: favorite }}
                    hitSlop={7}
                    onPress={() => void toggleFavorite(product.id)}
                    style={({ pressed }) => [
                      styles.favorite,
                      pressed && styles.pressed,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={favorite ? "heart" : "heart-outline"}
                      size={21}
                      color={favorite ? BrandColors.danger : BrandColors.muted}
                    />
                  </Pressable>
                </View>
                <Pressable
                  accessibilityLabel={`Ver ${product.name}, S/ ${(product.priceCents / 100).toFixed(2)} por ${product.pricingQuantity} ${product.baseUnit === "gram" ? "gramos" : "unidades"}`}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push(`/tienda/producto/${product.id}` as Href)
                  }
                  style={({ pressed }) => [
                    styles.cardDetails,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.category}>{product.category}</Text>
                  <Text numberOfLines={2} style={styles.name}>
                    {product.name}
                  </Text>
                </Pressable>
                <View style={styles.priceRow}>
                  <View style={styles.priceCopy}>
                    <Text style={styles.price}>
                      S/ {(product.priceCents / 100).toFixed(2)}
                    </Text>
                    <Text style={styles.unit}>
                      por {product.pricingQuantity}{" "}
                      {product.baseUnit === "gram" ? "g" : "un."}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityLabel={
                      soldOut ? "Producto agotado" : `Agregar ${product.name}`
                    }
                    accessibilityRole="button"
                    accessibilityState={{ disabled: soldOut, selected: inCart }}
                    disabled={soldOut}
                    onPress={() => quickAdd(product)}
                    style={({ pressed }) => [
                      styles.addButton,
                      inCart && styles.addButtonActive,
                      soldOut && styles.disabled,
                      pressed && !soldOut && styles.pressed,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={inCart ? "check" : "plus"}
                      size={20}
                      color={BrandColors.white}
                    />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {catalog && products.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons
              name="magnify-close"
              size={30}
              color={BrandColors.green}
            />
          </View>
          <Text style={styles.emptyTitle}>No encontramos ese producto</Text>
          <Text style={styles.emptyText}>
            Prueba otra palabra o revisa todas las categorías.
          </Text>
          <CommerceButton
            compact
            label="Ver todo"
            onPress={() => {
              setQuery("");
              setCategory("");
            }}
            tone="ghost"
          />
        </View>
      ) : null}

      <View style={styles.trust}>
        <TrustItem icon="scale-balance">Peso verificado</TrustItem>
        <TrustItem icon="shield-check-outline">Compra protegida</TrustItem>
        <TrustItem icon="store-marker-outline">Recojo o delivery</TrustItem>
      </View>
    </OnlineScreen>
  );
}

function Chip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  promo: {
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.goldLight,
    padding: Spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: BrandColors.gold,
  },
  promoIcon: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  promoCopy: { flex: 1 },
  promoEyebrow: { color: BrandColors.goldDark, ...Typography.overline },
  promoTitle: {
    color: BrandColors.text,
    ...Typography.h3,
    marginTop: Spacing.xxs,
  },
  promoText: {
    color: BrandColors.warning,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  coupon: {
    alignSelf: "flex-start",
    marginTop: Spacing.xs,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xxs,
  },
  couponText: {
    color: BrandColors.goldDark,
    ...Typography.overline,
    letterSpacing: 0,
  },
  reorder: {
    minHeight: 98,
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.greenDark,
    padding: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  reorderIcon: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  reorderCopy: { flex: 1 },
  reorderEyebrow: { color: BrandColors.gold, ...Typography.overline },
  reorderTitle: {
    color: BrandColors.white,
    ...Typography.bodyLarge,
    fontWeight: "800",
    marginTop: Spacing.xxs,
  },
  reorderMeta: {
    color: BrandColors.greenMid,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  reorderButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    minHeight: 52,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.lineStrong,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  searchInput: { flex: 1, color: BrandColors.text, ...Typography.body },
  clearButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
  },
  categories: { gap: Spacing.xs, paddingRight: Spacing.md },
  chip: {
    minHeight: ControlSize.default,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.surfaceMuted,
    borderWidth: 1,
    borderColor: BrandColors.line,
    paddingHorizontal: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: BrandColors.greenDark },
  chipText: {
    color: BrandColors.muted,
    ...Typography.caption,
    fontWeight: "700",
  },
  chipTextActive: { color: BrandColors.white },
  message: {
    backgroundColor: BrandColors.dangerLight,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  error: { color: BrandColors.danger, ...Typography.caption },
  retry: {
    color: BrandColors.danger,
    ...Typography.label,
    marginTop: Spacing.xxs,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  sectionEyebrow: { color: BrandColors.green, ...Typography.overline },
  sectionTitle: {
    color: BrandColors.text,
    ...Typography.h2,
    marginTop: Spacing.xxs,
  },
  productCount: {
    color: BrandColors.muted,
    ...Typography.caption,
    paddingBottom: 3,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  card: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 148,
    minWidth: 148,
    minHeight: 244,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.sm,
  },
  cardMedium: { maxWidth: 216 },
  cardTop: {
    minHeight: 82,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cardDetails: { minHeight: ControlSize.default, justifyContent: "center" },
  favorite: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  category: {
    color: BrandColors.green,
    ...Typography.caption,
    fontWeight: "700",
    marginTop: Spacing.xs,
  },
  name: {
    color: BrandColors.text,
    ...Typography.body,
    fontWeight: "700",
    marginTop: Spacing.xxs,
    minHeight: 42,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  priceCopy: { flex: 1 },
  price: { color: BrandColors.greenDark, ...Typography.h3, fontWeight: "800" },
  unit: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  addButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonActive: { backgroundColor: BrandColors.greenDark },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
  disabled: { opacity: Interaction.disabledOpacity },
  skeletonName: { marginTop: Spacing.md, width: "84%" },
  skeletonPrice: { marginTop: Spacing.xs, width: "55%" },
  empty: {
    alignItems: "center",
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.xl,
    gap: Spacing.xs,
  },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xxs,
  },
  emptyTitle: {
    color: BrandColors.text,
    ...Typography.h3,
    textAlign: "center",
  },
  emptyText: {
    color: BrandColors.muted,
    ...Typography.body,
    textAlign: "center",
  },
  trust: {
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    paddingTop: Spacing.md,
    gap: Spacing.xs,
  },
});
