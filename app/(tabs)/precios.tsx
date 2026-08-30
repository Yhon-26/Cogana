import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  AdminScreen,
  Pill,
  PrimaryButton,
  SectionTitle,
  sharedStyles,
} from "@/components/admin-ui";
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
import { useLocalOperator } from "@/context/local-operator-context";
import type { ProductRecord } from "@/database/models";
import { updateProductPrice } from "@/database/repositories/price-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { useLocalProducts } from "@/hooks/use-local-products";
import { formatSoles } from "@/lib/money";
import { formatPricingUnit } from "@/lib/units";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";

function PriceEditor({
  product,
  onSave,
}: {
  product: ProductRecord;
  onSave: (priceCents: number) => Promise<void>;
}) {
  const [value, setValue] = useState((product.priceCents / 100).toFixed(2));
  const [isSaving, setIsSaving] = useState(false);
  const parsedValue = Number(value.replace(",", "."));
  const parsedCents = Math.round(parsedValue * 100);
  const valid =
    Number.isFinite(parsedValue) &&
    parsedValue > 0 &&
    Number.isSafeInteger(parsedCents);
  const changed = valid && parsedCents !== product.priceCents;
  const pricingUnit = formatPricingUnit(product);

  const adjust = (difference: number) => {
    const current = valid ? parsedValue : product.priceCents / 100;
    setValue(Math.max(0.1, current + difference).toFixed(2));
  };

  const save = async () => {
    if (!valid || !changed || isSaving) return;

    setIsSaving(true);
    try {
      await onSave(parsedCents);
      setValue((parsedCents / 100).toFixed(2));
      Alert.alert(
        "Precio actualizado",
        `${product.name}\nNuevo precio: ${formatSoles(parsedCents)} por ${pricingUnit}`,
      );
    } catch (caughtError) {
      Alert.alert(
        "No se pudo actualizar",
        getOperatorErrorMessage(
          caughtError,
          "No se pudo actualizar el precio.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[sharedStyles.card, styles.priceCard]}>
      <View style={styles.productHeader}>
        <View style={styles.productIcon}>
          <MaterialCommunityIcons
            name="barley"
            size={23}
            color={BrandColors.green}
          />
        </View>
        <View style={styles.productCopy}>
          <Text style={styles.productName}>{product.name}</Text>
          <Text style={styles.productMeta}>
            {product.sku} · {product.category}
          </Text>
        </View>
        {changed ? <Pill label="Sin guardar" tone="gold" /> : null}
      </View>

      <Text style={styles.inputLabel}>Precio de venta por {pricingUnit}</Text>
      <View style={styles.editorRow}>
        <Pressable
          accessibilityLabel="Reducir precio"
          accessibilityRole="button"
          hitSlop={Spacing.xxs}
          onPress={() => adjust(-0.1)}
          style={styles.stepButton}
        >
          <MaterialCommunityIcons
            name="minus"
            size={21}
            color={BrandColors.greenDark}
          />
        </Pressable>
        <View style={[styles.inputWrap, !valid && styles.inputInvalid]}>
          <Text style={styles.currency}>S/</Text>
          <TextInput
            accessibilityLabel={`Precio de venta de ${product.name} por ${pricingUnit}`}
            keyboardType="decimal-pad"
            onChangeText={setValue}
            selectTextOnFocus
            style={styles.priceInput}
            value={value}
          />
          <Text style={styles.unit}>/ {pricingUnit}</Text>
        </View>
        <Pressable
          accessibilityLabel="Aumentar precio"
          accessibilityRole="button"
          hitSlop={Spacing.xxs}
          onPress={() => adjust(0.1)}
          style={styles.stepButton}
        >
          <MaterialCommunityIcons
            name="plus"
            size={21}
            color={BrandColors.greenDark}
          />
        </Pressable>
      </View>
      {!valid ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          Ingresa un precio mayor que cero.
        </Text>
      ) : null}
      <Pressable
        accessibilityLabel={`Guardar precio de ${product.name}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: !changed || isSaving, busy: isSaving }}
        disabled={!changed || isSaving}
        onPress={() => void save()}
        style={({ pressed }) => [
          styles.saveButton,
          (!changed || isSaving) && styles.saveButtonDisabled,
          pressed && changed && !isSaving && styles.pressed,
        ]}
      >
        <MaterialCommunityIcons
          name="content-save-outline"
          size={18}
          color={
            changed && !isSaving ? BrandColors.white : BrandColors.mutedLight
          }
        />
        <Text
          style={[
            styles.saveText,
            (!changed || isSaving) && styles.saveTextDisabled,
          ]}
        >
          {isSaving ? "Guardando…" : "Guardar precio"}
        </Text>
      </Pressable>
    </View>
  );
}

export default function PricesScreen() {
  const { database, products, isLoading, error, refresh } = useLocalProducts();
  const { selectedUser, deviceId } = useLocalOperator();

  const savePrice = async (productId: string, priceCents: number) => {
    if (!selectedUser || !deviceId) {
      throw new Error(
        "Selecciona un usuario local antes de actualizar precios.",
      );
    }
    await updateProductPrice(database, {
      storeId: DEFAULT_STORE_ID,
      productId,
      newPriceCents: priceCents,
      actorUserId: selectedUser.id,
      deviceId,
    });
    await refresh(false);
  };

  if (isLoading) {
    return (
      <AdminScreen
        title="Actualización de precios"
        subtitle="Modifica el precio base de cada producto"
      >
        <View style={[sharedStyles.card, styles.feedbackCard]}>
          <Text style={styles.feedbackTitle}>Cargando precios…</Text>
          <Text style={styles.feedbackText}>
            Consultando el catálogo disponible.
          </Text>
        </View>
      </AdminScreen>
    );
  }

  if (error) {
    return (
      <AdminScreen
        title="Actualización de precios"
        subtitle="Modifica el precio base de cada producto"
      >
        <View style={[sharedStyles.card, styles.feedbackCard]}>
          <Text style={styles.feedbackTitle}>
            No se pudieron cargar los precios
          </Text>
          <Text accessibilityRole="alert" style={styles.feedbackText}>
            {getOperatorErrorMessage(
              error,
              "No se pudieron cargar los precios.",
            )}
          </Text>
          <PrimaryButton
            label="Intentar nuevamente"
            onPress={() => void refresh()}
          />
        </View>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen
      title="Actualización de precios"
      subtitle="Modifica el precio base de cada producto"
    >
      <View style={[sharedStyles.card, styles.infoCard]}>
        <View style={styles.infoIcon}>
          <MaterialCommunityIcons
            name="information-outline"
            size={21}
            color={BrandColors.warning}
          />
        </View>
        <Text style={styles.infoText}>
          Los cambios conservan su historial y se confirman de forma segura en
          la base central.
        </Text>
      </View>

      <SectionTitle
        action={
          <Text style={styles.productCount}>{products.length} productos</Text>
        }
      >
        Lista de precios
      </SectionTitle>
      <View style={styles.list}>
        {products.map((product) => (
          <PriceEditor
            key={product.id}
            product={product}
            onSave={(priceCents) => savePrice(product.id, priceCents)}
          />
        ))}
      </View>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  feedbackCard: { gap: Spacing.sm, padding: Spacing.lg },
  feedbackTitle: { color: BrandColors.text, ...Typography.h3 },
  feedbackText: { color: BrandColors.muted, ...Typography.caption },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: BrandColors.goldLight,
    borderColor: BrandColors.goldDark,
    padding: Spacing.md,
  },
  infoIcon: {
    width: ControlSize.compact,
    height: ControlSize.compact,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.goldLight,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
  },
  infoText: { flex: 1, color: BrandColors.warning, ...Typography.caption },
  productCount: { color: BrandColors.muted, ...Typography.label },
  list: { gap: Spacing.sm },
  priceCard: { padding: Spacing.md },
  productHeader: { flexDirection: "row", alignItems: "center" },
  productIcon: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  productCopy: { flex: 1, marginHorizontal: Spacing.sm },
  productName: { color: BrandColors.text, ...Typography.label },
  productMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  inputLabel: {
    color: BrandColors.muted,
    ...Typography.label,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  editorRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  stepButton: {
    width: ControlSize.compact,
    height: ControlSize.compact,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: BrandColors.lineStrong,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  inputWrap: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1.5,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
  },
  inputInvalid: { borderColor: BrandColors.danger },
  currency: {
    color: BrandColors.muted,
    ...Typography.label,
    marginRight: Spacing.xs,
  },
  priceInput: {
    flex: 1,
    color: BrandColors.text,
    ...Typography.h3,
    paddingVertical: 0,
  },
  unit: { color: BrandColors.muted, ...Typography.label },
  errorText: {
    color: BrandColors.danger,
    ...Typography.caption,
    marginTop: Spacing.xs,
  },
  saveButton: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  saveButtonDisabled: { backgroundColor: BrandColors.surfaceMuted },
  saveText: { color: BrandColors.white, ...Typography.label },
  saveTextDisabled: { color: BrandColors.mutedLight },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
