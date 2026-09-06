import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import {
  ActionButton,
  AdminScreen,
  Pill,
  PrimaryButton,
  SectionTitle,
  sharedStyles,
} from "@/components/admin-ui";
import { ModalSurface } from "@/components/modal-surface";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";
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
import { parseDecimalToInteger } from "@/database/integer-calculations";
import type {
  PresentationType,
  PriceHistoryRecord,
  ProductPresentationRecord,
  ProductRecord,
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
import { formatDateTime } from "@/lib/format";
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
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.round(height * 0.88);
  const [productId, setProductId] = useState("");
  const [presentations, setPresentations] = useState<
    ProductPresentationRecord[]
  >([]);
  const [history, setHistory] = useState<PriceHistoryRecord[]>([]);
  const [sheet, setSheet] = useState<"categories" | "presentation" | null>(
    null,
  );
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
  const [isSaving, setIsSaving] = useState(false);
  const selectedProduct = products.find((product) => product.id === productId);
  const categories = useMemo(
    () =>
      [...new Set(products.map((product) => product.category))].sort((a, b) =>
        a.localeCompare(b, "es-PE"),
      ),
    [products],
  );
  const canManage = selectedUser?.role === "administrator";

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
    setSheet("presentation");
  };

  const savePresentation = async () => {
    if (!selectedUser || !selectedProduct || isSaving) return;
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
    setIsSaving(true);
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
      setSheet(null);
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
      setIsSaving(false);
    }
  };

  const togglePresentation = async (
    presentation: ProductPresentationRecord,
  ) => {
    if (!selectedUser || isSaving) return;
    setIsSaving(true);
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
    } finally {
      setIsSaving(false);
    }
  };

  const renameCategory = async () => {
    if (!selectedUser || !oldCategory || !newCategory.trim() || isSaving) return;
    const affected = products.filter(
      (product) => product.category === oldCategory,
    );
    setIsSaving(true);
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
      setSheet(null);
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
      setIsSaving(false);
    }
  };

  return (
    <AdminScreen
      title="Catálogo avanzado"
      subtitle="Categorías, presentaciones, conversiones e historial"
    >
      {!selectedUser ? (
        <View style={[sharedStyles.card, styles.operatorNotice]}>
          <MaterialCommunityIcons
            name="account-key-outline"
            size={22}
            color={BrandColors.warning}
          />
          <View style={styles.operatorNoticeCopy}>
            <Text style={styles.operatorNoticeTitle}>Falta tu operador</Text>
            <Text style={styles.operatorNoticeText}>
              Activa tu perfil con PIN en la pestaña Más para editar el
              catálogo.
            </Text>
          </View>
        </View>
      ) : null}

      {canManage ? (
        <Pressable
          accessibilityLabel="Renombrar categoría"
          accessibilityRole="button"
          onPress={() => {
            setOldCategory("");
            setNewCategory("");
            setSheet("categories");
          }}
          style={({ pressed }) => [
            sharedStyles.card,
            styles.categoryLink,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.rowIcon}>
            <MaterialCommunityIcons
              name="shape-outline"
              size={20}
              color={BrandColors.green}
            />
          </View>
          <View style={styles.fill}>
            <Text style={styles.title}>Renombrar categoría</Text>
            <Text numberOfLines={1} style={styles.meta}>
              {categories.length} categorías en el catálogo
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color={BrandColors.muted}
          />
        </Pressable>
      ) : null}

      <SectionTitle>Producto</SectionTitle>
      <ProductPicker
        products={products.filter((product) => product.isActive)}
        selectedId={productId}
        onSelect={(id) => {
          setProductId(id);
          resetForm();
        }}
      />

      {selectedProduct ? (
        <>
          <SectionTitle
            action={<Pill label={`${presentations.length}`} tone="neutral" />}
          >
            Presentaciones y conversiones
          </SectionTitle>
          {canManage ? (
            <PrimaryButton
              icon="plus"
              label={editing ? "Editar presentación" : "Nueva presentación"}
              onPress={() => {
                resetForm();
                setSheet("presentation");
              }}
            />
          ) : null}
          {presentations.length ? (
            <View style={styles.list}>
              {presentations.map((presentation) => (
                <View
                  key={presentation.id}
                  style={[sharedStyles.card, styles.row, styles.rowShadow]}
                >
                  <View style={styles.fill}>
                    <Text
                      maxFontSizeMultiplier={1.3}
                      numberOfLines={1}
                      style={styles.title}
                    >
                      {presentation.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.meta}>
                      {presentation.sku} · {presentation.quantityInBaseUnits}{" "}
                      base ·{" "}
                      {presentation.fixedPriceCents === null
                        ? "precio proporcional"
                        : money(presentation.fixedPriceCents)}
                    </Text>
                  </View>
                  {canManage ? (
                    <>
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
                    </>
                  ) : (
                    <Pill
                      label={presentation.isActive ? "Activa" : "Inactiva"}
                      tone={presentation.isActive ? "green" : "neutral"}
                    />
                  )}
                </View>
              ))}
            </View>
          ) : (
            <View style={[sharedStyles.card, styles.sectionEmpty]}>
              <MaterialCommunityIcons
                name="package-variant-closed"
                size={24}
                color={BrandColors.muted}
              />
              <Text style={styles.meta}>
                Este producto aún no tiene presentaciones registradas.
              </Text>
            </View>
          )}

          <SectionTitle>Historial de precios</SectionTitle>
          <View style={[sharedStyles.card, styles.card, styles.rowShadow]}>
            {history.map((event) => (
              <View key={event.id} style={styles.row}>
                <View style={styles.fill}>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    style={styles.title}
                  >
                    {money(event.previousPriceCents)} →{" "}
                    {money(event.newPriceCents)}
                  </Text>
                  <Text style={styles.meta}>
                    {event.reason} ·{" "}
                    {formatDateTime(new Date(event.createdAt))}
                  </Text>
                </View>
              </View>
            ))}
            {!history.length ? (
              <Text style={styles.meta}>Aún no hay cambios de precio.</Text>
            ) : null}
          </View>
        </>
      ) : (
        <View style={[sharedStyles.card, styles.sectionEmpty]}>
          <MaterialCommunityIcons
            name="cursor-pointer"
            size={24}
            color={BrandColors.muted}
          />
          <Text style={styles.meta}>
            Selecciona un producto para ver sus presentaciones e historial.
          </Text>
        </View>
      )}

      <ModalSurface
        dialogStyle={styles.dialog}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setSheet(null);
        }}
        visible={sheet === "categories"}
      >
        <View style={styles.dialogHeader}>
          <MaterialCommunityIcons
            name="shape-outline"
            size={24}
            color={BrandColors.greenDark}
          />
          <Text maxFontSizeMultiplier={1.3} style={styles.dialogTitle}>
            Renombrar categoría
          </Text>
        </View>
        <Text style={styles.dialogHint}>
          Elige la categoría actual e ingresa el nuevo nombre; se aplicará a
          todos sus productos.
        </Text>
        <View style={styles.chips}>
          {categories.map((category) => (
            <Pressable
              accessibilityLabel={`Categoría ${category}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: oldCategory === category }}
              key={category}
              onPress={() => setOldCategory(category)}
              style={[
                styles.choice,
                oldCategory === category && styles.choiceActive,
              ]}
            >
              <Text style={styles.choiceText}>{category}</Text>
            </Pressable>
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
        <View style={styles.dialogActions}>
          <ActionButton
            compact
            disabled={isSaving}
            label="Cancelar"
            onPress={() => setSheet(null)}
            style={styles.dialogButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={
              !canManage || !oldCategory || !newCategory.trim() || isSaving
            }
            label="Renombrar"
            loading={isSaving}
            onPress={() => void renameCategory()}
            style={styles.dialogButton}
          />
        </View>
      </ModalSurface>

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) {
            setSheet(null);
            resetForm();
          }
        }}
        placement="bottom"
        visible={sheet === "presentation"}
      >
        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderCopy}>
            <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
              {editing ? "Editar presentación" : "Nueva presentación"}
            </Text>
            <Text style={styles.sheetMeta}>
              {selectedProduct?.name ?? ""} · convierte a la unidad base
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Cerrar presentación"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              setSheet(null);
              resetForm();
            }}
            style={styles.sheetClose}
          >
            <MaterialCommunityIcons
              name="close"
              size={22}
              color={BrandColors.muted}
            />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.sheetBody}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          style={styles.sheetScroll}
        >
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
          <Text style={styles.fieldLabel}>TIPO</Text>
          <View style={styles.chips}>
            {(["unit", "package", "box", "sack"] as const).map((value) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: type === value }}
                key={value}
                onPress={() => setType(value)}
                style={[styles.choice, type === value && styles.choiceActive]}
              >
                <Text style={styles.choiceText}>
                  {presentationTypeLabels[value]}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Conversión a unidad base"
            keyboardType="number-pad"
            placeholder={`Conversión a ${selectedProduct?.baseUnit === "gram" ? "gramos" : "unidades"}`}
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
        </ScrollView>

        <View style={styles.sheetFooter}>
          {editing ? (
            <ActionButton
              compact
              label="Cancelar"
              onPress={() => {
                setSheet(null);
                resetForm();
              }}
              style={styles.footerButton}
              tone="ghost"
            />
          ) : null}
          <ActionButton
            compact
            disabled={
              !canManage || !sku.trim() || !name.trim() || isSaving
            }
            label={editing ? "Guardar cambios" : "Crear presentación"}
            loading={isSaving}
            onPress={() => void savePresentation()}
            style={styles.saveFooterButton}
          />
        </View>
      </ModalSurface>
    </AdminScreen>
  );
}

function ProductPicker({
  products,
  selectedId,
  onSelect,
}: {
  products: ProductRecord[];
  selectedId: string;
  onSelect: (productId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-PE");
    if (!normalized) return products;
    return products.filter((product) =>
      `${product.name} ${product.sku}`
        .toLocaleLowerCase("es-PE")
        .includes(normalized),
    );
  }, [products, query]);

  return (
    <View style={styles.picker}>
      <View style={styles.searchWrap}>
        <MaterialCommunityIcons
          name="magnify"
          size={21}
          color={BrandColors.muted}
        />
        <TextInput
          accessibilityLabel="Buscar producto"
          placeholder="Buscar producto o código"
          placeholderTextColor={BrandColors.muted}
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <ScrollView
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={styles.pickerList}
      >
        {filtered.length === 0 ? (
          <Text style={styles.pickerEmpty}>Sin productos para la búsqueda.</Text>
        ) : (
          filtered.map((product, index) => {
            const selected = product.id === selectedId;
            return (
              <Pressable
                accessibilityLabel={`Seleccionar ${product.name}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={product.id}
                onPress={() => onSelect(product.id)}
                style={[
                  styles.pickerRow,
                  index > 0 && styles.borderTop,
                  selected && styles.pickerRowSelected,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.pickerName,
                    selected && styles.pickerNameSelected,
                  ]}
                >
                  {product.name}
                </Text>
                <Text style={styles.pickerMeta}>
                  {product.baseUnit === "gram" ? "pesable" : "unidad"} ·{" "}
                  {product.category}
                </Text>
                {selected ? (
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={18}
                    color={BrandColors.greenDark}
                  />
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  operatorNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  operatorNoticeCopy: { flex: 1 },
  operatorNoticeTitle: { color: BrandColors.text, ...Typography.label },
  operatorNoticeText: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  categoryLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 64,
    ...Elevation.ambientCard,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  fill: { flex: 1 },
  title: { color: BrandColors.text, ...Typography.label },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  list: { gap: Spacing.sm },
  sectionEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    minHeight: 64,
  },
  rowShadow: { ...Elevation.ambientCard },
  linkButton: {
    minHeight: ControlSize.compact,
    justifyContent: "center",
    paddingHorizontal: Spacing.xxs,
  },
  link: { color: BrandColors.greenDark, ...Typography.label },
  picker: { gap: Spacing.xs },
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
  pickerList: {
    maxHeight: 260,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
  },
  pickerRow: {
    minHeight: ControlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  pickerRowSelected: { backgroundColor: BrandColors.greenLight },
  pickerName: { flex: 1, color: BrandColors.text, ...Typography.label },
  pickerNameSelected: { color: BrandColors.greenDark },
  pickerMeta: { color: BrandColors.muted, ...Typography.caption },
  pickerEmpty: {
    color: BrandColors.muted,
    ...Typography.caption,
    padding: Spacing.sm,
    textAlign: "center",
  },
  borderTop: { borderTopWidth: 1, borderTopColor: BrandColors.line },
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
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.body,
  },
  fieldLabel: {
    color: BrandColors.muted,
    ...Typography.overline,
  },
  sheet: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  sheetScroll: { flexShrink: 1 },
  sheetBody: { gap: Spacing.sm, paddingBottom: Spacing.xs },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  sheetHeaderCopy: { flex: 1 },
  sheetTitle: { color: BrandColors.text, ...Typography.h3 },
  sheetMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  sheetClose: {
    width: ControlSize.compact,
    height: ControlSize.compact,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetFooter: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  footerButton: { flex: 1 },
  saveFooterButton: { flex: 1.6 },
  dialog: {
    backgroundColor: BrandColors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  dialogHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  dialogTitle: { color: BrandColors.text, ...Typography.h3, flex: 1 },
  dialogHint: { color: BrandColors.muted, ...Typography.caption },
  dialogActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  dialogButton: { flex: 1 },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
