import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState, type ComponentProps } from "react";
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
import {
  createPurchaseOrder,
  listInventoryLots,
  listPurchaseOrders,
  performPhysicalCount,
  receivePurchaseOrder,
  type InventoryLotSummary,
  type PurchaseOrderSummary,
} from "@/database/repositories/procurement-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { formatSoles as money } from "@/lib/money";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";
import { useLocalProducts } from "@/hooks/use-local-products";
import { useLocalSuppliers } from "@/hooks/use-local-suppliers";

type ViewMode = "orders" | "lots" | "count";

export default function ProcurementScreen() {
  const { selectedUser, deviceId } = useLocalOperator();
  const { database, products } = useLocalProducts();
  const { suppliers } = useLocalSuppliers();
  const [mode, setMode] = useState<ViewMode>("orders");
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([]);
  const [lots, setLots] = useState<InventoryLotSummary[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [receiveQuantities, setReceiveQuantities] = useState<
    Record<string, string>
  >({});
  const [counted, setCounted] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const [nextOrders, nextLots] = await Promise.all([
      listPurchaseOrders(database, DEFAULT_STORE_ID),
      listInventoryLots(database, DEFAULT_STORE_ID),
    ]);
    setOrders(nextOrders);
    setLots(nextLots);
  }, [database]);
  useFocusEffect(useCallback(() => void refresh(), [refresh]));

  const activeProducts = useMemo(
    () => products.filter((product) => product.isActive),
    [products],
  );
  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.isActive),
    [suppliers],
  );
  const selectedProduct = activeProducts.find(
    (product) => product.id === productId,
  );
  const canManage = selectedUser?.role === "administrator";

  const createOrder = async () => {
    if (!selectedUser || !canManage || saving) return;
    const quantityValue = Number(quantity);
    const costCents = parseDecimalToInteger(unitCost, 2);
    if (
      !supplierId ||
      !productId ||
      !Number.isSafeInteger(quantityValue) ||
      quantityValue <= 0 ||
      costCents === null
    ) {
      Alert.alert(
        "Datos incompletos",
        "Selecciona proveedor y producto e ingresa cantidad base y costo válidos.",
      );
      return;
    }
    setSaving(true);
    try {
      await createPurchaseOrder(database, {
        storeId: DEFAULT_STORE_ID,
        supplierId,
        expectedAt: expectedAt.trim() || null,
        items: [
          { productId, quantity: quantityValue, unitCostCents: costCents },
        ],
        actorUserId: selectedUser.id,
        deviceId,
      });
      setQuantity("");
      setUnitCost("");
      setExpectedAt("");
      await refresh();
      Alert.alert(
        "Orden creada",
        "Quedó pendiente de recepción y sincronización.",
      );
    } catch (error) {
      Alert.alert(
        "No se pudo crear",
        getOperatorErrorMessage(
          error,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const receive = async (order: PurchaseOrderSummary) => {
    if (!selectedUser || saving) return;
    const pendingItems = order.items.filter(
      (item) => item.receivedQuantity < item.orderedQuantity,
    );
    const entries = pendingItems
      .map((item, index) => {
        const pending = item.orderedQuantity - item.receivedQuantity;
        const raw = receiveQuantities[`${order.id}:${item.id}`]?.trim();
        const quantity = raw ? Number(raw) : pending;
        if (
          !Number.isSafeInteger(quantity) ||
          quantity <= 0 ||
          quantity > pending
        )
          return null;
        return [
          item.id,
          {
            quantity,
            lotCode: lotCode.trim()
              ? `${lotCode.trim()}${pendingItems.length > 1 ? `-${index + 1}` : ""}`
              : "",
            expiresAt: expiresAt.trim() || null,
          },
        ] as const;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (entries.length !== pendingItems.length) {
      Alert.alert(
        "Cantidad inválida",
        "Revisa las cantidades a recibir: no pueden superar lo pendiente.",
      );
      return;
    }
    setSaving(true);
    try {
      const result = await receivePurchaseOrder(database, {
        storeId: DEFAULT_STORE_ID,
        purchaseOrderId: order.id,
        items: Object.fromEntries(entries),
        actorUserId: selectedUser.id,
        deviceId,
      });
      setLotCode("");
      setExpiresAt("");
      setReceiveQuantities((previous) => {
        const next = { ...previous };
        for (const item of pendingItems) delete next[`${order.id}:${item.id}`];
        return next;
      });
      await refresh();
      Alert.alert(
        result.fullyReceived
          ? "Mercadería recibida"
          : "Recepción parcial registrada",
        result.fullyReceived
          ? "El stock y los lotes fueron actualizados."
          : "Se sumó lo recibido. La orden queda pendiente del resto.",
      );
    } catch (error) {
      Alert.alert(
        "No se pudo recibir",
        getOperatorErrorMessage(error, "Revisa la orden e intenta nuevamente."),
      );
    } finally {
      setSaving(false);
    }
  };

  const saveCount = async () => {
    if (!selectedUser || !canManage || !selectedProduct || saving) return;
    const value = Number(counted);
    if (!Number.isSafeInteger(value) || value < 0) {
      Alert.alert(
        "Cantidad inválida",
        "Ingresa gramos o unidades enteras en la unidad base.",
      );
      return;
    }
    setSaving(true);
    try {
      await performPhysicalCount(database, {
        storeId: DEFAULT_STORE_ID,
        counted: [{ productId: selectedProduct.id, quantity: value }],
        notes: "Conteo desde aplicación",
        actorUserId: selectedUser.id,
        deviceId,
      });
      setCounted("");
      Alert.alert(
        "Conteo aplicado",
        "La diferencia quedó auditada y pendiente de sincronización.",
      );
    } catch (error) {
      Alert.alert(
        "No se pudo contar",
        getOperatorErrorMessage(
          error,
          "Revisa la cantidad e intenta nuevamente.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminScreen
      title="Compras y lotes"
      subtitle="Abastecimiento, lotes y control físico"
    >
      <OperatorSelector />
      <View style={styles.tabs}>
        {(
          [
            ["orders", "Órdenes"],
            ["lots", "Lotes"],
            ["count", "Conteo"],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === value }}
            key={value}
            onPress={() => setMode(value)}
            style={[styles.tab, mode === value && styles.tabActive]}
          >
            <Text
              style={[styles.tabText, mode === value && styles.tabTextActive]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode === "orders" ? (
        <>
          <SectionTitle>Nueva orden</SectionTitle>
          <View style={[sharedStyles.card, styles.card]}>
            {!canManage ? (
              <Text accessibilityRole="alert" style={styles.warning}>
                Solo un administrador crea órdenes de compra.
              </Text>
            ) : null}
            <Text style={styles.label}>Proveedor</Text>
            <View style={styles.choices}>
              {activeSuppliers.map((supplier) => (
                <Choice
                  key={supplier.id}
                  active={supplierId === supplier.id}
                  label={supplier.name}
                  onPress={() => setSupplierId(supplier.id)}
                />
              ))}
            </View>
            <Text style={styles.label}>Producto</Text>
            <View style={styles.choices}>
              {activeProducts.map((product) => (
                <Choice
                  key={product.id}
                  active={productId === product.id}
                  label={product.name}
                  onPress={() => setProductId(product.id)}
                />
              ))}
            </View>
            <Field
              keyboardType="number-pad"
              placeholder={`Cantidad base (${selectedProduct?.baseUnit === "gram" ? "gramos" : "unidades"})`}
              value={quantity}
              onChangeText={setQuantity}
            />
            <Field
              keyboardType="decimal-pad"
              placeholder="Costo por cantidad de precio (S/)"
              value={unitCost}
              onChangeText={setUnitCost}
            />
            <Field
              placeholder="Fecha esperada (AAAA-MM-DD, opcional)"
              value={expectedAt}
              onChangeText={setExpectedAt}
            />
            <PrimaryButton
              disabled={!canManage || saving}
              icon="cart-arrow-down"
              label={saving ? "Guardando…" : "Crear orden"}
              onPress={() => void createOrder()}
            />
          </View>
          <SectionTitle
            action={<Pill label={`${orders.length}`} tone="neutral" />}
          >
            Órdenes
          </SectionTitle>
          <Field
            placeholder="Código de lote para la próxima recepción (opcional)"
            value={lotCode}
            onChangeText={setLotCode}
          />
          <Field
            placeholder="Vencimiento AAAA-MM-DD (opcional)"
            value={expiresAt}
            onChangeText={setExpiresAt}
          />
          {orders.map((order) => (
            <View key={order.id} style={[sharedStyles.card, styles.card]}>
              <View style={styles.row}>
                <View style={styles.fill}>
                  <Text style={styles.title}>{order.orderNumber}</Text>
                  <Text style={styles.meta}>
                    {order.supplierName} · {money(order.totalCents)}
                  </Text>
                </View>
                <Pill
                  label={
                    order.status === "received"
                      ? "Recibida"
                      : order.status === "partially_received"
                        ? "Parcial"
                        : "Pendiente"
                  }
                  tone={
                    order.status === "received"
                      ? "green"
                      : order.status === "partially_received"
                        ? "neutral"
                        : "gold"
                  }
                />
              </View>
              {order.items.map((item) => {
                const pending = item.orderedQuantity - item.receivedQuantity;
                return (
                  <View key={item.id} style={styles.row}>
                    <Text style={[styles.item, styles.fill]}>
                      {item.productName} · {item.receivedQuantity}/
                      {item.orderedQuantity} base · {money(item.lineTotalCents)}
                    </Text>
                    {pending > 0 && order.status !== "cancelled" ? (
                      <Field
                        accessibilityLabel={`Cantidad a recibir de ${item.productName}`}
                        keyboardType="number-pad"
                        placeholder={`Todo (${pending})`}
                        style={styles.receiveQtyInput}
                        value={
                          receiveQuantities[`${order.id}:${item.id}`] ?? ""
                        }
                        onChangeText={(value) =>
                          setReceiveQuantities((previous) => ({
                            ...previous,
                            [`${order.id}:${item.id}`]: value,
                          }))
                        }
                      />
                    ) : null}
                  </View>
                );
              })}
              {order.status === "ordered" ||
              order.status === "partially_received" ? (
                <PrimaryButton
                  disabled={saving}
                  icon="package-down"
                  label="Recibir cantidades"
                  onPress={() => void receive(order)}
                />
              ) : null}
            </View>
          ))}
        </>
      ) : null}

      {mode === "lots" ? (
        <>
          <SectionTitle
            action={<Pill label={`${lots.length}`} tone="neutral" />}
          >
            Trazabilidad
          </SectionTitle>
          {lots.length === 0 ? (
            <Empty text="Aún no hay lotes registrados." />
          ) : (
            lots.map((lot) => (
              <View key={lot.id} style={[sharedStyles.card, styles.row]}>
                <MaterialCommunityIcons
                  name="barcode-scan"
                  size={25}
                  color={BrandColors.greenDark}
                />
                <View style={styles.fill}>
                  <Text style={styles.title}>{lot.productName}</Text>
                  <Text style={styles.meta}>
                    Lote {lot.lotCode} · {lot.supplierName}
                  </Text>
                  <Text style={styles.meta}>
                    Saldo {lot.remainingQuantity} · vence{" "}
                    {lot.expiresAt ?? "sin fecha"}
                  </Text>
                </View>
              </View>
            ))
          )}
        </>
      ) : null}

      {mode === "count" ? (
        <>
          <SectionTitle>Conteo físico</SectionTitle>
          <View style={[sharedStyles.card, styles.card]}>
            <Text style={styles.warning}>
              El conteo reemplaza el stock registrado y documenta la diferencia.
              Requiere administrador.
            </Text>
            <View style={styles.choices}>
              {activeProducts.map((product) => (
                <Choice
                  key={product.id}
                  active={productId === product.id}
                  label={`${product.name} (${product.stockQuantity})`}
                  onPress={() => setProductId(product.id)}
                />
              ))}
            </View>
            <Field
              keyboardType="number-pad"
              placeholder="Cantidad contada en unidad base"
              value={counted}
              onChangeText={setCounted}
            />
            <PrimaryButton
              disabled={!canManage || !selectedProduct || saving}
              icon="clipboard-check-outline"
              label="Aplicar conteo"
              onPress={() => void saveCount()}
            />
          </View>
        </>
      ) : null}
    </AdminScreen>
  );
}

function Field({
  accessibilityLabel,
  placeholder,
  style,
  ...props
}: ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      {...props}
      accessibilityLabel={accessibilityLabel ?? placeholder}
      placeholder={placeholder}
      placeholderTextColor={BrandColors.muted}
      style={[styles.input, style]}
    />
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
      accessibilityLabel={label}
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

function Empty({ text }: { text: string }) {
  return (
    <View style={[sharedStyles.card, styles.empty]}>
      <MaterialCommunityIcons
        name="package-variant"
        size={32}
        color={BrandColors.muted}
      />
      <Text style={styles.meta}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: Spacing.xs },
  tab: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.white,
  },
  tabActive: {
    backgroundColor: BrandColors.greenDark,
    borderColor: BrandColors.greenDark,
  },
  tabText: { color: BrandColors.muted, ...Typography.label },
  tabTextActive: { color: BrandColors.white },
  card: { gap: Spacing.sm },
  label: { color: BrandColors.muted, ...Typography.label },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  choice: {
    minHeight: ControlSize.default,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: Radius.round,
    paddingHorizontal: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.white,
  },
  choiceActive: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
  },
  choiceText: { color: BrandColors.muted, ...Typography.label },
  choiceTextActive: { color: BrandColors.greenDark, ...Typography.label },
  input: {
    minHeight: ControlSize.default,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: ComponentMetrics.inputRadius,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.body,
  },
  warning: { color: BrandColors.warning, ...Typography.caption },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  fill: { flex: 1 },
  title: { color: BrandColors.text, ...Typography.label },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  item: { color: BrandColors.text, ...Typography.caption },
  receiveQtyInput: {
    minHeight: ControlSize.default,
    width: 96,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: ComponentMetrics.inputRadius,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.caption,
  },
  empty: { alignItems: "center", gap: Spacing.xs, paddingVertical: Spacing.xl },
});
