import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  AdminScreen,
  Pill,
  PrimaryButton,
  SectionTitle,
  sharedStyles,
} from "@/components/admin-ui";
import { OperatorSelector } from "@/components/operator-selector";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";
import {
  BrandColors,
  ComponentMetrics,
  ControlSize,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useLocalOperator } from "@/context/local-operator-context";
import { parseDecimalToInteger } from "@/database/integer-calculations";
import type {
  PresentationType,
  PriceHistoryRecord,
  ProductPresentationRecord,
} from "@/database/models";
import {
  createProductPresentation,
  listAllProductPresentations,
  updateProductPresentation,
} from "@/database/repositories/presentation-repository";
import { listPriceHistory } from "@/database/repositories/price-repository";
import { updateProduct } from "@/database/repositories/product-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { formatSoles as money } from "@/lib/money";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";
import { useLocalProducts } from "@/hooks/use-local-products";

const presentationTypeLabels: Record<PresentationType, string> = {
  unit: "Unidad",
  package: "Paquete",
  box: "Caja",
  sack: "Saco",
};

export default function CatalogAdminScreen() {
  const { selectedUser, deviceId } = useLocalOperator();
  const { database, products, refresh: refreshProducts } = useLocalProducts();
  const [productId, setProductId] = useState("");
  const [presentations, setPresentations] = useState<
    ProductPresentationRecord[]
  >([]);
  const [history, setHistory] = useState<PriceHistoryRecord[]>([]);
  const [editing, setEditing] = useState<ProductPresentationRecord | null>(
    null,
  );
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<PresentationType>("package");
  const [conversion, setConversion] = useState("");
  const [fixedPrice, setFixedPrice] = useState("");
  const [oldCategory, setOldCategory] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedProduct = products.find((product) => product.id === productId);
  const categories = useMemo(
    () =>
      [...new Set(products.map((product) => product.category))].sort((a, b) =>
        a.localeCompare(b, "es-PE"),
      ),
    [products],
  );

  const refreshDetail = useCallback(async () => {
    if (!productId) {
      setPresentations([]);
      setHistory([]);
      return;
    }
    const [nextPresentations, nextHistory] = await Promise.all([
      listAllProductPresentations(database, DEFAULT_STORE_ID, productId),
      listPriceHistory(database, DEFAULT_STORE_ID, productId),
    ]);
    setPresentations(nextPresentations);
    setHistory(nextHistory);
  }, [database, productId]);
  useFocusEffect(useCallback(() => void refreshDetail(), [refreshDetail]));

  const resetForm = () => {
    setEditing(null);
    setSku("");
    setName("");
    setType("package");
    setConversion("");
    setFixedPrice("");
  };
  const startEdit = (presentation: ProductPresentationRecord) => {
    setEditing(presentation);
    setSku(presentation.sku);
    setName(presentation.name);
    setType(presentation.type);
    setConversion(String(presentation.quantityInBaseUnits));
    setFixedPrice(
      presentation.fixedPriceCents === null
        ? ""
        : (presentation.fixedPriceCents / 100).toFixed(2),
    );
  };
  const savePresentation = async () => {
    if (!selectedUser || !selectedProduct || saving) return;
    const quantityInBaseUnits = Number(conversion);
    const fixedPriceCents = fixedPrice.trim()
      ? parseDecimalToInteger(fixedPrice, 2)
      : null;
    if (
      !Number.isSafeInteger(quantityInBaseUnits) ||
      quantityInBaseUnits <= 0 ||
      (fixedPriceCents === null && fixedPrice.trim())
    ) {
      Alert.alert(
        "Conversión inválida",
        "Usa una cantidad base entera y un precio válido.",
      );
      return;
    }
    setSaving(true);
    try {
      const common = {
        storeId: DEFAULT_STORE_ID,
        productId: selectedProduct.id,
        sku,
        name,
        type,
        quantityInBaseUnits,
        fixedPriceCents,
        actorUserId: selectedUser.id,
        deviceId,
      };
      if (editing) {
        await updateProductPresentation(database, {
          ...common,
          presentationId: editing.id,
          expectedVersion: editing.version,
          isActive: editing.isActive,
        });
      } else {
        await createProductPresentation(database, common);
      }
      resetForm();
      await refreshDetail();
    } catch (error) {
      Alert.alert(
        "No se pudo guardar",
        getOperatorErrorMessage(
          error,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };
  const togglePresentation = async (
    presentation: ProductPresentationRecord,
  ) => {
    if (!selectedUser) return;
    try {
      await updateProductPresentation(database, {
        storeId: DEFAULT_STORE_ID,
        productId: presentation.productId,
        presentationId: presentation.id,
        expectedVersion: presentation.version,
        sku: presentation.sku,
        name: presentation.name,
        type: presentation.type,
        quantityInBaseUnits: presentation.quantityInBaseUnits,
        fixedPriceCents: presentation.fixedPriceCents,
        isActive: !presentation.isActive,
        actorUserId: selectedUser.id,
        deviceId,
      });
      await refreshDetail();
    } catch (error) {
      Alert.alert(
        "No se pudo actualizar",
        getOperatorErrorMessage(error, "Intenta nuevamente."),
      );
    }
  };
  const renameCategory = async () => {
    if (!selectedUser || !oldCategory || !newCategory.trim() || saving) return;
    const affected = products.filter(
      (product) => product.category === oldCategory,
    );
    setSaving(true);
    try {
      for (const product of affected) {
        await updateProduct(database, {
          storeId: DEFAULT_STORE_ID,
          productId: product.id,
          expectedVersion: product.version,
          sku: product.sku,
          name: product.name,
          category: newCategory,
          baseUnit: product.baseUnit,
          pricingQuantity: product.pricingQuantity,
          priceCents: product.priceCents,
          costCents: product.costCents,
          minimumStockQuantity: product.minimumStockQuantity,
          isActive: product.isActive,
          actorUserId: selectedUser.id,
          deviceId,
        });
      }
      setOldCategory("");
      setNewCategory("");
      await refreshProducts(false);
      Alert.alert(
        "Categoría renombrada",
        `${affected.length} productos quedaron actualizados.`,
      );
    } catch (error) {
      Alert.alert(
        "No se pudo renombrar",
        getOperatorErrorMessage(
          error,
          "Recarga el catálogo e intenta nuevamente.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminScreen
      title="Catálogo avanzado"
      subtitle="Categorías, presentaciones, conversiones e historial"
    >
      <OperatorSelector />
      <SectionTitle>Categorías</SectionTitle>
      <View style={[sharedStyles.card, styles.card]}>
        <View style={styles.chips}>
          {categories.map((category) => (
            <Choice
              key={category}
              label={category}
              active={oldCategory === category}
              onPress={() => setOldCategory(category)}
            />
          ))}
        </View>
        <TextInput
          accessibilityLabel="Nuevo nombre de la categoría"
          placeholder="Nuevo nombre de la categoría"
          placeholderTextColor={BrandColors.muted}
          value={newCategory}
          onChangeText={setNewCategory}
          style={styles.input}
        />
        <PrimaryButton
          disabled={
            selectedUser?.role !== "administrator" ||
            !oldCategory ||
            !newCategory.trim() ||
            saving
          }
          icon="shape-outline"
          label="Renombrar en productos"
          onPress={() => void renameCategory()}
        />
      </View>

      <SectionTitle>Producto</SectionTitle>
      <View style={styles.chips}>
        {products.map((product) => (
          <Choice
            key={product.id}
            label={product.name}
            active={productId === product.id}
            onPress={() => {
              setProductId(product.id);
              resetForm();
            }}
          />
        ))}
      </View>
      {selectedProduct ? (
        <>
          <SectionTitle
            action={<Pill label={`${presentations.length}`} tone="neutral" />}
          >
            Presentaciones y conversiones
          </SectionTitle>
          <View style={[sharedStyles.card, styles.card]}>
            <TextInput
              accessibilityLabel="SKU de presentación"
              placeholder="SKU de presentación"
              placeholderTextColor={BrandColors.muted}
              value={sku}
              onChangeText={setSku}
              style={styles.input}
            />
            <TextInput
              accessibilityLabel="Nombre de la presentación"
              placeholder="Nombre (ej. Saco 25 kg)"
              placeholderTextColor={BrandColors.muted}
              value={name}
              onChangeText={setName}
              style={styles.input}
            />
            <View style={styles.chips}>
              {(["unit", "package", "box", "sack"] as const).map((value) => (
                <Choice
                  key={value}
                  label={presentationTypeLabels[value]}
                  active={type === value}
                  onPress={() => setType(value)}
                />
              ))}
            </View>
            <TextInput
              accessibilityLabel="Conversión a unidad base"
              keyboardType="number-pad"
              placeholder={`Conversión a ${selectedProduct.baseUnit === "gram" ? "gramos" : "unidades"}`}
              placeholderTextColor={BrandColors.muted}
              value={conversion}
              onChangeText={setConversion}
              style={styles.input}
            />
            <TextInput
              accessibilityLabel="Precio fijo de la presentación"
              keyboardType="decimal-pad"
              placeholder="Precio fijo S/ (vacío = proporcional)"
              placeholderTextColor={BrandColors.muted}
              value={fixedPrice}
              onChangeText={setFixedPrice}
              style={styles.input}
            />
            <View style={styles.actions}>
              {editing ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={resetForm}
                  style={styles.secondary}
                >
                  <Text style={styles.secondaryText}>Cancelar</Text>
                </Pressable>
              ) : null}
              <PrimaryButton
                disabled={
                  selectedUser?.role !== "administrator" ||
                  !sku.trim() ||
                  !name.trim() ||
                  saving
                }
                icon="content-save-outline"
                label={editing ? "Guardar cambios" : "Crear presentación"}
                onPress={() => void savePresentation()}
                style={styles.fill}
              />
            </View>
          </View>
          {presentations.map((presentation) => (
            <View key={presentation.id} style={[sharedStyles.card, styles.row]}>
              <View style={styles.fill}>
                <Text style={styles.title}>{presentation.name}</Text>
                <Text style={styles.meta}>
                  {presentation.sku} · {presentation.quantityInBaseUnits} base ·{" "}
                  {presentation.fixedPriceCents === null
                    ? "precio proporcional"
                    : money(presentation.fixedPriceCents)}
                </Text>
              </View>
              <Pill
                label={presentation.isActive ? "Activa" : "Inactiva"}
                tone={presentation.isActive ? "green" : "neutral"}
              />
              <Pressable
                accessibilityLabel={`Editar ${presentation.name}`}
                accessibilityRole="button"
                onPress={() => startEdit(presentation)}
                style={styles.linkButton}
              >
                <Text style={styles.link}>Editar</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`${presentation.isActive ? "Pausar" : "Activar"} ${presentation.name}`}
                accessibilityRole="switch"
                accessibilityState={{ checked: presentation.isActive }}
                onPress={() => void togglePresentation(presentation)}
                style={styles.linkButton}
              >
                <Text style={styles.link}>
                  {presentation.isActive ? "Pausar" : "Activar"}
                </Text>
              </Pressable>
            </View>
          ))}
          <SectionTitle>Historial de precios</SectionTitle>
          <View style={[sharedStyles.card, styles.card]}>
            {history.map((event) => (
              <View key={event.id} style={styles.row}>
                <View style={styles.fill}>
                  <Text style={styles.title}>
                    {money(event.previousPriceCents)} →{" "}
                    {money(event.newPriceCents)}
                  </Text>
                  <Text style={styles.meta}>
                    {event.reason} ·{" "}
                    {new Date(event.createdAt).toLocaleString("es-PE")}
                  </Text>
                </View>
              </View>
            ))}
            {!history.length ? (
              <Text style={styles.meta}>Aún no hay cambios de precio.</Text>
            ) : null}
          </View>
        </>
      ) : null}
    </AdminScreen>
  );
}

function Choice({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={[styles.choice, active && styles.choiceActive]}
    >
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  choice: {
    minHeight: ControlSize.default,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm,
    justifyContent: "center",
  },
  choiceActive: {
    backgroundColor: BrandColors.greenLight,
    borderColor: BrandColors.green,
  },
  choiceText: {
    color: BrandColors.muted,
    ...Typography.caption,
    fontWeight: "700",
  },
  choiceTextActive: { color: BrandColors.greenDark },
  input: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.body,
  },
  actions: { flexDirection: "row", gap: Spacing.xs, alignItems: "center" },
  secondary: {
    minHeight: ControlSize.default,
    paddingHorizontal: Spacing.md,
    justifyContent: "center",
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
  },
  secondaryText: { color: BrandColors.greenDark, ...Typography.label },
  fill: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  title: { color: BrandColors.text, ...Typography.label },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  linkButton: {
    minHeight: ControlSize.default,
    justifyContent: "center",
    paddingHorizontal: Spacing.xs,
  },
  link: { color: BrandColors.greenDark, ...Typography.label },
});
