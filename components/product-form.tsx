import { useEffect, useState } from "react";
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  Switch,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import { PrimaryButton, sharedStyles } from "@/components/admin-ui";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";
import {
  BrandColors,
  ControlSize,
  Spacing,
  Typography,
} from "@/constants/theme";
import { parseDecimalToInteger } from "@/database/integer-calculations";
import type { ProductBaseUnit, ProductRecord } from "@/database/models";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";

export type ProductFormValue = {
  sku: string;
  name: string;
  category: string;
  baseUnit: ProductBaseUnit;
  pricingQuantity: number;
  priceCents: number;
  costCents: number;
  stockQuantity: number;
  minimumStockQuantity: number;
  isActive: boolean;
};

export function ProductForm({
  product,
  isSaving,
  onSubmit,
}: {
  product?: ProductRecord;
  isSaving: boolean;
  onSubmit: (value: ProductFormValue) => Promise<void>;
}) {
  const [sku, setSku] = useState(product?.sku ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [baseUnit, setBaseUnit] = useState<ProductBaseUnit>(
    product?.baseUnit ?? "gram",
  );
  const [pricingQuantity, setPricingQuantity] = useState(
    String(product?.pricingQuantity ?? 1000),
  );
  const [price, setPrice] = useState(
    product ? (product.priceCents / 100).toFixed(2) : "",
  );
  const [cost, setCost] = useState(
    product ? (product.costCents / 100).toFixed(2) : "",
  );
  const [stock, setStock] = useState(String(product?.stockQuantity ?? 0));
  const [minimumStock, setMinimumStock] = useState(
    String(product?.minimumStockQuantity ?? 0),
  );
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!product) return;
    setSku(product.sku);
    setName(product.name);
    setCategory(product.category);
    setBaseUnit(product.baseUnit);
    setPricingQuantity(String(product.pricingQuantity));
    setPrice((product.priceCents / 100).toFixed(2));
    setCost((product.costCents / 100).toFixed(2));
    setStock(String(product.stockQuantity));
    setMinimumStock(String(product.minimumStockQuantity));
    setIsActive(product.isActive);
  }, [product]);

  const submit = async () => {
    const parsedPricingQuantity = parseDecimalToInteger(pricingQuantity, 0);
    const priceCents = parseDecimalToInteger(price, 2);
    const costCents = parseDecimalToInteger(cost || "0", 2);
    const stockQuantity = parseDecimalToInteger(stock || "0", 0);
    const minimumStockQuantity = parseDecimalToInteger(minimumStock || "0", 0);
    if (
      parsedPricingQuantity === null ||
      parsedPricingQuantity < 1 ||
      priceCents === null ||
      costCents === null ||
      stockQuantity === null ||
      minimumStockQuantity === null
    ) {
      setError("Revisa los montos y cantidades. Usa enteros en unidades base.");
      return;
    }
    setError(null);
    try {
      await onSubmit({
        sku,
        name,
        category,
        baseUnit,
        pricingQuantity: parsedPricingQuantity,
        priceCents,
        costCents,
        stockQuantity,
        minimumStockQuantity,
        isActive,
      });
    } catch (caughtError) {
      setError(
        getOperatorErrorMessage(caughtError, "No se pudo guardar el producto."),
      );
    }
  };

  return (
    <View style={[sharedStyles.card, styles.form]}>
      <Field label="Código / SKU" onChangeText={setSku} value={sku} />
      <Field label="Nombre" onChangeText={setName} value={name} />
      <Field label="Categoría" onChangeText={setCategory} value={category} />
      <Text style={styles.label}>Unidad base</Text>
      <View
        accessibilityLabel="Unidad base"
        accessibilityRole="radiogroup"
        style={styles.choiceRow}
      >
        <Choice
          active={baseUnit === "gram"}
          label="Gramos"
          onPress={() => setBaseUnit("gram")}
        />
        <Choice
          active={baseUnit === "unit"}
          label="Unidades"
          onPress={() => setBaseUnit("unit")}
        />
      </View>
      <Field
        keyboardType="number-pad"
        label="Cantidad a la que aplica el precio"
        onChangeText={setPricingQuantity}
        value={pricingQuantity}
      />
      <View style={styles.twoColumns}>
        <Field
          containerStyle={styles.column}
          editable={!product}
          keyboardType="decimal-pad"
          label={product ? "Precio (editar en Precios)" : "Precio S/"}
          onChangeText={setPrice}
          value={price}
        />
        <Field
          containerStyle={styles.column}
          keyboardType="decimal-pad"
          label="Costo S/"
          onChangeText={setCost}
          value={cost}
        />
      </View>
      <View style={styles.twoColumns}>
        <Field
          containerStyle={styles.column}
          editable={!product}
          keyboardType="number-pad"
          label={product ? "Stock (usar movimientos)" : "Stock inicial"}
          onChangeText={setStock}
          value={stock}
        />
        <Field
          containerStyle={styles.column}
          keyboardType="number-pad"
          label="Stock mínimo"
          onChangeText={setMinimumStock}
          value={minimumStock}
        />
      </View>
      {product ? (
        <View style={styles.switchRow}>
          <Text style={styles.switchText}>
            {isActive ? "Producto activo" : "Producto inactivo"}
          </Text>
          <Switch
            accessibilityLabel="Estado del producto"
            ios_backgroundColor={BrandColors.lineStrong}
            onValueChange={setIsActive}
            thumbColor={BrandColors.white}
            trackColor={{
              false: BrandColors.lineStrong,
              true: BrandColors.green,
            }}
            value={isActive}
          />
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <PrimaryButton
        disabled={isSaving}
        icon="content-save-outline"
        label={isSaving ? "Guardando…" : "Guardar producto"}
        loading={isSaving}
        onPress={() => void submit()}
      />
    </View>
  );
}

function Choice({
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
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      hitSlop={4}
      onPress={onPress}
      style={[styles.choice, active && styles.choiceActive]}
    >
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  containerStyle,
  ...props
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={BrandColors.muted}
        style={[styles.input, props.editable === false && styles.inputDisabled]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.sm },
  field: { gap: Spacing.xxs },
  label: { ...sharedStyles.fieldLabel },
  input: { ...sharedStyles.input },
  inputDisabled: {
    backgroundColor: BrandColors.surfaceMuted,
    color: BrandColors.muted,
  },
  choiceRow: { flexDirection: "row", gap: Spacing.xs },
  choice: {
    ...sharedStyles.choice,
    flex: 1,
  },
  choiceActive: { ...sharedStyles.choiceActive },
  choiceText: { ...sharedStyles.choiceText },
  choiceTextActive: { ...sharedStyles.choiceTextActive },
  twoColumns: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  column: { flex: 1, flexBasis: 220, minWidth: 0 },
  switchRow: {
    minHeight: ControlSize.default,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  switchText: { flex: 1, color: BrandColors.text, ...Typography.label },
  error: { ...sharedStyles.errorText },
});
