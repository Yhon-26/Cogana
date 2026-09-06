import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
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
  ComponentMetrics,
  ControlSize,
  Elevation,
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

function PriceSheet({
  product,
  onClose,
  onSave,
}: {
  product: ProductRecord;
  onClose: () => void;
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
      onClose();
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
    <>
      <View style={styles.sheetHeader}>
        <View style={styles.sheetHeaderCopy}>
          <Text
            maxFontSizeMultiplier={1.3}
            numberOfLines={2}
            style={styles.sheetTitle}
          >
            {product.name}
          </Text>
          <Text style={styles.sheetMeta}>
            {product.sku} · {product.category}
          </Text>
        </View>
        {changed ? <Pill label="Sin guardar" tone="gold" /> : null}
        <Pressable
          accessibilityLabel="Cerrar editor de precio"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onClose}
          style={styles.sheetClose}
        >
          <MaterialCommunityIcons
            name="close"
            size={22}
            color={BrandColors.muted}
          />
        </Pressable>
      </View>

      <Text style={styles.currentLabel}>
        PRECIO ACTUAL · {formatSoles(product.priceCents)} / {pricingUnit}
      </Text>

      <Text style={styles.inputLabel}>Nuevo precio por {pricingUnit}</Text>
      <View style={styles.editorRow}>
        <Pressable
          accessibilityLabel="Reducir precio en diez centavos"
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
        </View>
        <Pressable
          accessibilityLabel="Aumentar precio en diez centavos"
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

      <View style={styles.sheetFooter}>
        {changed ? (
          <ActionButton
            compact
            label="Restablecer"
            icon="restore"
            onPress={() => setValue((product.priceCents / 100).toFixed(2))}
            style={styles.resetButton}
            tone="ghost"
          />
        ) : null}
        <PrimaryButton
          label="Guardar precio"
          icon="content-save-outline"
          loading={isSaving}
          onPress={() => void save()}
          disabled={!changed || isSaving}
          style={styles.saveButton}
        />
      </View>
    </>
  );
}

export default function PricesScreen() {
  const { database, products, isLoading, error, refresh } = useLocalProducts();
  const { selectedUser, deviceId } = useLocalOperator();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [editing, setEditing] = useState<ProductRecord | null>(null);

  const categories = useMemo(
    () => Array.from(new Set(products.map((product) => product.category))),
    [products],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-PE");
    return products.filter(
      (product) =>
        (category === "all" || product.category === category) &&
        (!normalized ||
          `${product.name} ${product.sku}`
            .toLocaleLowerCase("es-PE")
            .includes(normalized)),
    );
  }, [category, products, query]);

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

  return (
    <AdminScreen
      title="Precios"
      subtitle="Modifica el precio base de cada producto"
    >
      <View style={styles.searchWrap}>
        <MaterialCommunityIcons
          name="magnify"
          size={21}
          color={BrandColors.muted}
        />
        <TextInput
          accessibilityLabel="Buscar producto o código"
          placeholder="Buscar producto o código"
          placeholderTextColor={BrandColors.muted}
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
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
              color={BrandColors.muted}
            />
          </Pressable>
        ) : null}
      </View>

      {categories.length > 1 ? (
        <ScrollView
          horizontal
          contentContainerStyle={styles.categoryList}
          showsHorizontalScrollIndicator={false}
        >
          {["all", ...categories].map((candidate) => (
            <Pressable
              accessibilityLabel={
                candidate === "all"
                  ? "Todas las categorías"
                  : `Categoría ${candidate}`
              }
              accessibilityRole="button"
              accessibilityState={{ selected: category === candidate }}
              key={candidate}
              onPress={() => setCategory(candidate)}
              style={[
                styles.categoryChip,
                category === candidate && styles.categoryChipActive,
              ]}
            >
              <Text
                style={[
                  styles.categoryText,
                  category === candidate && styles.categoryTextActive,
                ]}
              >
                {candidate === "all" ? "Todas" : candidate}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <SectionTitle
        action={<Pill label={`${filtered.length}`} tone="neutral" />}
      >
        Lista de precios
      </SectionTitle>

      {isLoading ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text style={styles.muted}>Cargando precios…</Text>
        </View>
      ) : error ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text accessibilityRole="alert" style={styles.errorText}>
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
      ) : filtered.length === 0 ? (
        <View style={[sharedStyles.card, styles.empty]}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons
              name="tag-outline"
              size={30}
              color={BrandColors.green}
            />
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
            {products.length === 0
              ? "Aún no hay productos"
              : "Sin resultados"}
          </Text>
          <Text style={styles.muted}>
            {products.length === 0
              ? "Agrega productos desde Más y aparecerán aquí para actualizar precios."
              : "Prueba con otro nombre, código o categoría."}
          </Text>
          {products.length === 0 ? (
            <PrimaryButton
              label="Ir al catálogo"
              icon="package-variant-closed"
              onPress={() => router.push("/catalogo-admin")}
            />
          ) : (
            <PrimaryButton
              label="Limpiar búsqueda"
              icon="magnify"
              onPress={() => {
                setQuery("");
                setCategory("all");
              }}
            />
          )}
        </View>
      ) : (
        <View style={styles.list}>
          {filtered.map((product) => (
            <Pressable
              accessibilityLabel={`Editar precio de ${product.name}, actual ${formatSoles(product.priceCents)}`}
              accessibilityRole="button"
              key={product.id}
              onPress={() => setEditing(product)}
              style={({ pressed }) => [
                sharedStyles.card,
                styles.row,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.rowIcon}>
                <MaterialCommunityIcons
                  name="tag-outline"
                  size={20}
                  color={BrandColors.green}
                />
              </View>
              <View style={styles.rowCopy}>
                <Text
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                  style={styles.rowName}
                >
                  {product.name}
                </Text>
                <Text numberOfLines={1} style={styles.rowMeta}>
                  {product.sku} · {product.category}
                </Text>
              </View>
              <Text
                maxFontSizeMultiplier={1.4}
                adjustsFontSizeToFit
                numberOfLines={1}
                style={styles.rowPrice}
              >
                {formatSoles(product.priceCents)}
              </Text>
              <MaterialCommunityIcons
                name="chevron-right"
                size={18}
                color={BrandColors.muted}
              />
            </Pressable>
          ))}
        </View>
      )}

      <ModalSurface
        animationType="slide"
        dialogStyle={styles.sheet}
        onClose={() => setEditing(null)}
        placement="bottom"
        visible={editing !== null}
      >
        {editing ? (
          <PriceSheet
            product={editing}
            onClose={() => setEditing(null)}
            onSave={(priceCents) => savePrice(editing.id, priceCents)}
          />
        ) : null}
      </ModalSurface>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
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
  categoryList: {
    flexDirection: "row",
    gap: Spacing.xs,
    paddingVertical: Spacing.xxs,
  },
  categoryChip: {
    minHeight: ControlSize.compact,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryChipActive: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
  },
  categoryText: { color: BrandColors.muted, ...Typography.caption },
  categoryTextActive: { color: BrandColors.greenDark, fontWeight: "700" },
  feedback: { gap: Spacing.sm },
  empty: {
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xxl,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { color: BrandColors.text, ...Typography.h3 },
  muted: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
  },
  errorText: {
    color: BrandColors.danger,
    ...Typography.caption,
  },
  list: { gap: Spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 64,
    ...Elevation.ambientCard,
  },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: { flex: 1 },
  rowName: { color: BrandColors.text, ...Typography.label },
  rowMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  rowPrice: {
    color: BrandColors.text,
    ...Typography.h3,
    flexShrink: 1,
  },
  sheet: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
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
  currentLabel: {
    color: BrandColors.greenDark,
    ...Typography.overline,
  },
  inputLabel: {
    color: BrandColors.muted,
    ...Typography.label,
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
    minHeight: ControlSize.large,
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
    minWidth: 0,
    color: BrandColors.text,
    ...Typography.h2,
    paddingVertical: 0,
    textAlign: "center",
  },
  sheetFooter: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  resetButton: { flex: 1 },
  saveButton: { flex: 1.6 },
});

// Nota: el empty state con cero productos conserva el flujo anterior de guía.
