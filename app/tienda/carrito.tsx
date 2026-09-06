import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  CommerceButton,
  ProductVisual,
  QuantityStepper,
  TrustItem,
} from "@/components/commerce-ui";
import { OnlineScreen } from "@/components/online-shell";
import {
  BrandColors,
  ControlSize,
  Elevation,
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useCart } from "@/context/cart-context";
import { calculateLineTotalCents } from "@/database/integer-calculations";
import type { SubstitutionPolicy } from "@/database/models";

const policies: { value: SubstitutionPolicy; label: string }[] = [
  { value: "contact", label: "Consultarme" },
  { value: "allow", label: "Aceptar similar" },
  { value: "remove", label: "Retirar si falta" },
];

export default function CartScreen() {
  const {
    items,
    subtotalCents,
    setQuantity,
    setSubstitutionPolicy,
    removeItem,
  } = useCart();
  return (
    <OnlineScreen
      title="Tu carrito"
      subtitle={
        items.length
          ? `${items.length} productos listos para revisar`
          : "Empieza tu compra"
      }
      footer={
        items.length ? (
          <View style={styles.footer}>
            <View>
              <Text style={styles.footerLabel}>Subtotal</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.footerTotal}>
                S/ {(subtotalCents / 100).toFixed(2)}
              </Text>
            </View>
            <CommerceButton
              compact
              icon="arrow-right"
              label="Continuar"
              onPress={() => router.push("/tienda/checkout" as Href)}
              style={styles.footerButton}
              tone="accent"
            />
          </View>
        ) : null
      }
    >
      {items.length ? (
        <View style={styles.progress}>
          <View style={[styles.progressStep, styles.progressStepActive]}>
            <Text style={styles.progressNumberActive}>1</Text>
          </View>
          <View style={styles.progressLine} />
          <View style={styles.progressStep}>
            <Text style={styles.progressNumber}>2</Text>
          </View>
          <View style={styles.progressLine} />
          <View style={styles.progressStep}>
            <Text style={styles.progressNumber}>3</Text>
          </View>
          <Text style={styles.progressLabel}>Revisa tu canasta</Text>
        </View>
      ) : null}

      {items.map((item) => {
        const step = item.product.baseUnit === "gram" ? 100 : 1;
        const lineTotal = calculateLineTotalCents(
          item.quantity,
          item.product.priceCents,
          item.product.pricingQuantity,
        );
        return (
          <View key={item.product.id} style={styles.card}>
            <View style={styles.top}>
              <ProductVisual
                category={item.product.category}
                name={item.product.name}
                size={56}
              />
              <View style={styles.copy}>
                <Text maxFontSizeMultiplier={1.4} style={styles.name}>
                  {item.product.name}
                </Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.meta}>
                  S/ {(item.product.priceCents / 100).toFixed(2)} por{" "}
                  {item.product.pricingQuantity}{" "}
                  {item.product.baseUnit === "gram" ? "g" : "un."}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={`Quitar ${item.product.name}`}
                accessibilityRole="button"
                hitSlop={7}
                onPress={() => removeItem(item.product.id)}
                style={styles.remove}
              >
                <MaterialCommunityIcons
                  name="trash-can-outline"
                  size={19}
                  color={BrandColors.danger}
                />
              </Pressable>
            </View>
            <View style={styles.quantityRow}>
              <QuantityStepper
                increaseDisabled={
                  item.quantity + step > item.product.stockQuantity
                }
                label={`Cantidad de ${item.product.name}`}
                onDecrease={() =>
                  setQuantity(item.product.id, item.quantity - step)
                }
                onIncrease={() =>
                  setQuantity(item.product.id, item.quantity + step)
                }
                value={`${item.quantity} ${item.product.baseUnit === "gram" ? "g" : "un."}`}
              />
              <View style={styles.lineTotalCopy}>
                <Text style={styles.lineTotalLabel}>Subtotal</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.lineTotal}>
                  S/ {(lineTotal / 100).toFixed(2)}
                </Text>
              </View>
            </View>
            <Text style={styles.policyTitle}>SI ESTE PRODUCTO SE AGOTA</Text>
            <View style={styles.policies}>
              {policies.map((policy) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: item.substitutionPolicy === policy.value,
                  }}
                  key={policy.value}
                  onPress={() =>
                    setSubstitutionPolicy(item.product.id, policy.value)
                  }
                  style={({ pressed }) => [
                    styles.policy,
                    item.substitutionPolicy === policy.value &&
                      styles.policyActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    maxFontSizeMultiplier={1.3}
                    style={[
                      styles.policyText,
                      item.substitutionPolicy === policy.value &&
                        styles.policyTextActive,
                    ]}
                  >
                    {policy.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
      {items.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons
              name="basket-outline"
              size={36}
              color={BrandColors.green}
            />
          </View>
          <Text style={styles.emptyTitle}>Tu canasta está esperando</Text>
          <Text style={styles.emptyText}>
            Agrega tus productos de siempre y vuelve cuando quieras: guardaremos
            tu carrito.
          </Text>
          <CommerceButton
            icon="storefront-outline"
            label="Explorar productos"
            onPress={() => router.replace("/tienda" as Href)}
            style={styles.emptyButton}
          />
        </View>
      ) : (
        <View style={styles.info}>
          <MaterialCommunityIcons
            name="information-outline"
            size={21}
            color={BrandColors.greenDark}
          />
          <Text style={styles.infoText}>
            El delivery y el total por productos pesados se confirman antes de
            cobrar.
          </Text>
        </View>
      )}

      {items.length ? (
        <View style={styles.trust}>
          <TrustItem icon="content-save-outline">Carrito guardado</TrustItem>
          <TrustItem icon="shield-check-outline">Compra protegida</TrustItem>
          <TrustItem icon="scale-balance">Peso verificado</TrustItem>
        </View>
      ) : null}
    </OnlineScreen>
  );
}

const styles = StyleSheet.create({
  progress: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm,
  },
  progressStep: {
    width: 26,
    height: 26,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  progressStepActive: { backgroundColor: BrandColors.greenDark },
  progressNumber: {
    color: BrandColors.muted,
    ...Typography.caption,
    fontWeight: "700",
  },
  progressNumberActive: {
    color: BrandColors.white,
    ...Typography.overline,
    letterSpacing: 0,
  },
  progressLine: {
    width: 18,
    height: 1,
    backgroundColor: BrandColors.lineStrong,
  },
  progressLabel: {
    color: BrandColors.greenDark,
    ...Typography.label,
    marginLeft: Spacing.sm,
  },
  card: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Elevation.ambientCard,
  },
  top: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  copy: { flex: 1 },
  name: {
    color: BrandColors.text,
    ...Typography.bodyLarge,
    fontWeight: "700",
  },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  remove: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.dangerLight,
    alignItems: "center",
    justifyContent: "center",
  },
  quantityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  lineTotalCopy: { alignItems: "flex-end", flexShrink: 1 },
  lineTotalLabel: { color: BrandColors.muted, ...Typography.caption },
  lineTotal: { color: BrandColors.text, ...Typography.h3, fontWeight: "800" },
  policyTitle: { color: BrandColors.muted, ...Typography.overline },
  policies: { flexDirection: "row", gap: Spacing.xs },
  policy: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.surfaceMuted,
    paddingHorizontal: Spacing.xxs,
    alignItems: "center",
    justifyContent: "center",
  },
  policyActive: { backgroundColor: BrandColors.greenDark },
  policyText: {
    color: BrandColors.muted,
    ...Typography.caption,
    fontWeight: "700",
    textAlign: "center",
  },
  policyTextActive: { color: BrandColors.white },
  empty: {
    alignItems: "center",
    gap: Spacing.sm,
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.xl,
  },
  emptyIcon: {
    width: 76,
    height: 76,
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    color: BrandColors.text,
    ...Typography.h2,
    textAlign: "center",
  },
  emptyText: {
    color: BrandColors.muted,
    ...Typography.body,
    textAlign: "center",
  },
  emptyButton: { alignSelf: "stretch", marginTop: Spacing.xxs },
  info: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.greenLight,
    padding: Spacing.sm,
  },
  infoText: { flex: 1, color: BrandColors.greenDark, ...Typography.caption },
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
