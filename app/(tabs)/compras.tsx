import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState, type ComponentProps } from "react";
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
import { parseDecimalToInteger } from "@/database/integer-calculations";
import type { ProductRecord } from "@/database/models";
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
          size={19}
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
          <Text style={styles.pickerEmpty}>
            Sin productos para la búsqueda.
          </Text>
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
                  {product.stockQuantity}
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

export default function ProcurementScreen() {
  const { selectedUser, deviceId } = useLocalOperator();
  const { database, products } = useLocalProducts();
  const { suppliers } = useLocalSuppliers();
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.round(height * 0.88);
  const [mode, setMode] = useState<ViewMode>("orders");
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([]);
  const [lots, setLots] = useState<InventoryLotSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const [createVisible, setCreateVisible] = useState(false);
  const [orderSupplierId, setOrderSupplierId] = useState("");
  const [orderProductId, setOrderProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [expectedAt, setExpectedAt] = useState("");

  const [receiving, setReceiving] = useState<PurchaseOrderSummary | null>(null);
  const [receiveQuantities, setReceiveQuantities] = useState<
    Record<string, string>
  >({});
  const [lotCode, setLotCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const [countVisible, setCountVisible] = useState(false);
  const [countProductId, setCountProductId] = useState("");
  const [counted, setCounted] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [nextOrders, nextLots] = await Promise.all([
        listPurchaseOrders(database, DEFAULT_STORE_ID),
        listInventoryLots(database, DEFAULT_STORE_ID),
      ]);
      setOrders(nextOrders);
      setLots(nextLots);
      setLoadError(null);
    } catch (caughtError) {
      setLoadError(
        getOperatorErrorMessage(
          caughtError,
          "No se pudieron cargar las compras.",
        ),
      );
    } finally {
      setIsLoading(false);
    }
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
    (product) => product.id === orderProductId,
  );
  const countProduct = activeProducts.find(
    (product) => product.id === countProductId,
  );
  const canManage = selectedUser?.role === "administrator";

  const filteredOrders = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-PE");
    if (!normalized) return orders;
    return orders.filter((order) =>
      `${order.orderNumber} ${order.supplierName}`
        .toLocaleLowerCase("es-PE")
        .includes(normalized),
    );
  }, [orders, query]);

  const filteredLots = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-PE");
    if (!normalized) return lots;
    return lots.filter((lot) =>
      `${lot.productName} ${lot.lotCode} ${lot.supplierName}`
        .toLocaleLowerCase("es-PE")
        .includes(normalized),
    );
  }, [lots, query]);

  const closeCreate = () => {
    setCreateVisible(false);
    setOrderSupplierId("");
    setOrderProductId("");
    setQuantity("");
    setUnitCost("");
    setExpectedAt("");
  };

  const createOrder = async () => {
    if (!selectedUser || !canManage || saving) return;
    const quantityValue = Number(quantity);
    const costCents = parseDecimalToInteger(unitCost, 2);
    if (
      !orderSupplierId ||
      !orderProductId ||
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
        supplierId: orderSupplierId,
        expectedAt: expectedAt.trim() || null,
        items: [
          {
            productId: orderProductId,
            quantity: quantityValue,
            unitCostCents: costCents,
          },
        ],
        actorUserId: selectedUser.id,
        deviceId,
      });
      closeCreate();
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

  const openReceiving = (order: PurchaseOrderSummary) => {
    setReceiving(order);
    setLotCode("");
    setExpiresAt("");
    setReceiveQuantities({});
  };

  const receive = async () => {
    if (!receiving || !selectedUser || saving) return;
    const order = receiving;
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
      setReceiving(null);
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
    if (!selectedUser || !canManage || !countProduct || saving) return;
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
        counted: [{ productId: countProduct.id, quantity: value }],
        notes: "Conteo desde aplicación",
        actorUserId: selectedUser.id,
        deviceId,
      });
      setCountProductId("");
      setCounted("");
      setCountVisible(false);
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

  const statusMeta = (status: PurchaseOrderSummary["status"]) =>
    status === "received"
      ? { label: "Recibida", tone: "green" as const }
      : status === "partially_received"
        ? { label: "Parcial", tone: "neutral" as const }
        : { label: "Pendiente", tone: "gold" as const };

  return (
    <AdminScreen
      title="Compras y lotes"
      subtitle="Abastecimiento, lotes y control físico"
      right={
        mode === "orders" && canManage ? (
          <Pressable
            accessibilityLabel="Nueva orden de compra"
            accessibilityRole="button"
            style={styles.addHeader}
            onPress={() => setCreateVisible(true)}
          >
            <MaterialCommunityIcons
              name="plus"
              size={23}
              color={BrandColors.white}
            />
          </Pressable>
        ) : null
      }
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
              Activa tu perfil con PIN en la pestaña Más para operar compras.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.tabs}>
        {(
          [
            ["orders", "Órdenes", "cart-outline"],
            ["lots", "Lotes", "barcode-scan"],
            ["count", "Conteo", "clipboard-check-outline"],
          ] as const
        ).map(([value, label, icon]) => (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === value }}
            key={value}
            onPress={() => setMode(value)}
            style={[styles.tab, mode === value && styles.tabActive]}
          >
            <MaterialCommunityIcons
              name={icon}
              size={17}
              color={mode === value ? BrandColors.white : BrandColors.muted}
            />
            <Text
              style={[styles.tabText, mode === value && styles.tabTextActive]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode !== "count" ? (
        <View style={styles.searchWrap}>
          <MaterialCommunityIcons
            name="magnify"
            size={21}
            color={BrandColors.muted}
          />
          <TextInput
            accessibilityLabel={
              mode === "orders"
                ? "Buscar orden o proveedor"
                : "Buscar lote, producto o proveedor"
            }
            placeholder={
              mode === "orders"
                ? "Buscar orden o proveedor"
                : "Buscar lote, producto o proveedor"
            }
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
      ) : null}

      {isLoading ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text style={styles.muted}>Cargando compras…</Text>
        </View>
      ) : loadError ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {loadError}
          </Text>
          <PrimaryButton label="Reintentar" onPress={() => void refresh()} />
        </View>
      ) : mode === "orders" ? (
        <>
          <SectionTitle
            action={<Pill label={`${filteredOrders.length}`} tone="neutral" />}
          >
            Órdenes
          </SectionTitle>
          {filteredOrders.length === 0 ? (
            <View style={[sharedStyles.card, styles.empty]}>
              <View style={styles.emptyIcon}>
                <MaterialCommunityIcons
                  name="cart-arrow-down"
                  size={30}
                  color={BrandColors.green}
                />
              </View>
              <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
                {orders.length === 0
                  ? "Aún no hay órdenes de compra"
                  : "Sin resultados"}
              </Text>
              <Text style={styles.muted}>
                {orders.length === 0
                  ? "Registra la mercadería que pidas a tus proveedores."
                  : "Prueba con otro número de orden o proveedor."}
              </Text>
              {orders.length === 0 && canManage ? (
                <PrimaryButton
                  label="Nueva orden"
                  icon="plus"
                  onPress={() => setCreateVisible(true)}
                />
              ) : null}
            </View>
          ) : (
            <View style={styles.list}>
              {filteredOrders.map((order) => {
                const status = statusMeta(order.status);
                const pendingCount = order.items.filter(
                  (item) => item.receivedQuantity < item.orderedQuantity,
                ).length;
                return (
                  <Pressable
                    accessibilityLabel={`Abrir orden ${order.orderNumber} de ${order.supplierName}`}
                    accessibilityRole="button"
                    key={order.id}
                    onPress={() => openReceiving(order)}
                    style={({ pressed }) => [
                      sharedStyles.card,
                      styles.orderRow,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.orderCopy}>
                      <View style={styles.orderTop}>
                        <Text
                          maxFontSizeMultiplier={1.3}
                          adjustsFontSizeToFit
                          numberOfLines={1}
                          style={styles.orderNumber}
                        >
                          {order.orderNumber}
                        </Text>
                        <Pill label={status.label} tone={status.tone} />
                      </View>
                      <Text
                        maxFontSizeMultiplier={1.3}
                        numberOfLines={1}
                        style={styles.orderSupplier}
                      >
                        {order.supplierName}
                      </Text>
                      <Text numberOfLines={1} style={styles.meta}>
                        {pendingCount > 0
                          ? `Faltan ${pendingCount} producto${pendingCount === 1 ? "" : "s"}`
                          : "Recepción completa"}
                      </Text>
                    </View>
                    <Text
                      maxFontSizeMultiplier={1.4}
                      adjustsFontSizeToFit
                      numberOfLines={1}
                      style={styles.orderTotal}
                    >
                      {money(order.totalCents)}
                    </Text>
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={18}
                      color={BrandColors.muted}
                    />
                  </Pressable>
                );
              })}
            </View>
          )}
        </>
      ) : mode === "lots" ? (
        <>
          <SectionTitle
            action={<Pill label={`${filteredLots.length}`} tone="neutral" />}
          >
            Trazabilidad
          </SectionTitle>
          {filteredLots.length === 0 ? (
            <View style={[sharedStyles.card, styles.empty]}>
              <View style={styles.emptyIcon}>
                <MaterialCommunityIcons
                  name="barcode-scan"
                  size={30}
                  color={BrandColors.green}
                />
              </View>
              <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
                {lots.length === 0 ? "Aún no hay lotes" : "Sin resultados"}
              </Text>
              <Text style={styles.muted}>
                {lots.length === 0
                  ? "Cada recepción de mercadería registrará su lote aquí."
                  : "Prueba con otro producto, código o proveedor."}
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {filteredLots.map((lot) => (
                <View
                  key={lot.id}
                  style={[sharedStyles.card, styles.lotRow, styles.rowShadow]}
                >
                  <View style={styles.rowIcon}>
                    <MaterialCommunityIcons
                      name="barcode-scan"
                      size={20}
                      color={BrandColors.green}
                    />
                  </View>
                  <View style={styles.orderCopy}>
                    <Text
                      maxFontSizeMultiplier={1.3}
                      numberOfLines={1}
                      style={styles.lotProduct}
                    >
                      {lot.productName}
                    </Text>
                    <Text numberOfLines={1} style={styles.meta}>
                      Lote {lot.lotCode || "sin código"} · {lot.supplierName}
                    </Text>
                    <Text numberOfLines={1} style={styles.meta}>
                      Saldo {lot.remainingQuantity} · vence{" "}
                      {lot.expiresAt ?? "sin fecha"}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      ) : (
        <View style={[sharedStyles.card, styles.countIntro]}>
          <MaterialCommunityIcons
            name="clipboard-check-outline"
            size={22}
            color={BrandColors.greenDark}
          />
          <View style={styles.operatorNoticeCopy}>
            <Text style={styles.operatorNoticeTitle}>Conteo físico</Text>
            <Text style={styles.operatorNoticeText}>
              Reemplaza el stock registrado por lo contado y documenta la
              diferencia. Requiere administrador.
            </Text>
          </View>
        </View>
      )}

      {mode === "count" && canManage && !isLoading && !loadError ? (
        <PrimaryButton
          icon="clipboard-check-outline"
          label="Iniciar conteo"
          onPress={() => {
            setCountProductId("");
            setCounted("");
            setCountVisible(true);
          }}
        />
      ) : null}

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        onClose={closeCreate}
        placement="bottom"
        visible={createVisible}
      >
        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderCopy}>
            <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
              Nueva orden de compra
            </Text>
            <Text style={styles.sheetMeta}>
              Queda pendiente de recepción con su lote.
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Cerrar nueva orden"
            accessibilityRole="button"
            hitSlop={8}
            onPress={closeCreate}
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
          <Text style={styles.fieldLabel}>PROVEEDOR</Text>
          {activeSuppliers.length ? (
            <View style={styles.choices}>
              {activeSuppliers.map((supplier) => (
                <Choice
                  key={supplier.id}
                  active={orderSupplierId === supplier.id}
                  label={supplier.name}
                  onPress={() => setOrderSupplierId(supplier.id)}
                />
              ))}
            </View>
          ) : (
            <Text accessibilityRole="alert" style={styles.errorText}>
              Primero registra un proveedor activo en Proveedores.
            </Text>
          )}

          <Text style={styles.fieldLabel}>PRODUCTO</Text>
          <ProductPicker
            products={activeProducts}
            selectedId={orderProductId}
            onSelect={setOrderProductId}
          />

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
        </ScrollView>

        <PrimaryButton
          icon="cart-arrow-down"
          label="Crear orden"
          loading={saving}
          disabled={!canManage || saving}
          onPress={() => void createOrder()}
        />
      </ModalSurface>

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        onClose={() => setReceiving(null)}
        placement="bottom"
        visible={receiving !== null}
      >
        {receiving ? (
          <>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
                  {receiving.orderNumber}
                </Text>
                <Text style={styles.sheetMeta}>
                  {receiving.supplierName} · {money(receiving.totalCents)}
                </Text>
              </View>
              <Pill
                label={statusMeta(receiving.status).label}
                tone={statusMeta(receiving.status).tone}
              />
              <Pressable
                accessibilityLabel="Cerrar recepción"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setReceiving(null)}
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
              <View style={[sharedStyles.card, styles.itemsCard]}>
                {receiving.items.map((item, index) => {
                  const pending =
                    item.orderedQuantity - item.receivedQuantity;
                  return (
                    <View
                      key={item.id}
                      style={[styles.receiveItem, index > 0 && styles.borderTop]}
                    >
                      <View style={styles.itemDot} />
                      <View style={styles.receiveCopy}>
                        <Text numberOfLines={2} style={styles.receiveName}>
                          {item.productName}
                        </Text>
                        <Text style={styles.meta}>
                          Recibido {item.receivedQuantity} de{" "}
                          {item.orderedQuantity} base ·{" "}
                          {money(item.lineTotalCents)}
                        </Text>
                        {pending > 0 && receiving.status !== "cancelled" ? (
                          <Field
                            accessibilityLabel={`Cantidad a recibir de ${item.productName}`}
                            keyboardType="number-pad"
                            placeholder={`A recibir (todo: ${pending})`}
                            style={styles.receiveQtyInput}
                            value={
                              receiveQuantities[`${receiving.id}:${item.id}`] ??
                              ""
                            }
                            onChangeText={(value) =>
                              setReceiveQuantities((previous) => ({
                                ...previous,
                                [`${receiving.id}:${item.id}`]: value,
                              }))
                            }
                          />
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>

              {receiving.status !== "received" &&
              receiving.status !== "cancelled" ? (
                <>
                  <Text style={styles.fieldLabel}>
                    LOTE (OPCIONAL, APLICA A ESTA RECEPCIÓN)
                  </Text>
                  <Field
                    placeholder="Código de lote"
                    value={lotCode}
                    onChangeText={setLotCode}
                  />
                  <Field
                    placeholder="Vencimiento AAAA-MM-DD (opcional)"
                    value={expiresAt}
                    onChangeText={setExpiresAt}
                  />
                </>
              ) : null}
            </ScrollView>

            {receiving.status === "ordered" ||
            receiving.status === "partially_received" ? (
              <PrimaryButton
                icon="package-down"
                label="Recibir cantidades"
                loading={saving}
                disabled={saving}
                onPress={() => void receive()}
              />
            ) : null}
          </>
        ) : null}
      </ModalSurface>

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        onClose={() => setCountVisible(false)}
        placement="bottom"
        visible={countVisible}
      >
        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderCopy}>
            <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
              Conteo físico
            </Text>
            <Text style={styles.sheetMeta}>
              El conteo reemplaza el stock registrado y queda auditado.
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Cerrar conteo"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setCountVisible(false)}
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
          <Text style={styles.fieldLabel}>PRODUCTO</Text>
          <ProductPicker
            products={activeProducts}
            selectedId={countProductId}
            onSelect={setCountProductId}
          />
          <Field
            keyboardType="number-pad"
            placeholder="Cantidad contada en unidad base"
            value={counted}
            onChangeText={setCounted}
          />
        </ScrollView>

        <PrimaryButton
          icon="clipboard-check-outline"
          label="Aplicar conteo"
          loading={saving}
          disabled={!canManage || !countProduct || saving}
          onPress={() => void saveCount()}
        />
      </ModalSurface>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  addHeader: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.green,
  },
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
  tabs: { flexDirection: "row", gap: Spacing.xs },
  tab: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xxs,
    backgroundColor: BrandColors.white,
  },
  tabActive: {
    backgroundColor: BrandColors.greenDark,
    borderColor: BrandColors.greenDark,
  },
  tabText: { color: BrandColors.muted, ...Typography.label },
  tabTextActive: { color: BrandColors.white },
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
  feedback: { gap: Spacing.sm },
  errorText: { color: BrandColors.danger, ...Typography.caption },
  muted: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
  },
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
  list: { gap: Spacing.sm },
  orderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 72,
    ...Elevation.ambientCard,
  },
  orderCopy: { flex: 1 },
  orderTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  orderNumber: {
    flexShrink: 1,
    color: BrandColors.greenDark,
    ...Typography.label,
  },
  orderSupplier: {
    color: BrandColors.text,
    ...Typography.label,
    marginTop: Spacing.xxs,
  },
  orderTotal: {
    color: BrandColors.text,
    ...Typography.h3,
    flexShrink: 1,
  },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  lotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 68,
  },
  rowShadow: { ...Elevation.ambientCard },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  lotProduct: { color: BrandColors.text, ...Typography.label },
  countIntro: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
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
  fieldLabel: {
    color: BrandColors.muted,
    ...Typography.overline,
  },
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
  picker: { gap: Spacing.xs },
  pickerList: {
    maxHeight: 240,
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
  itemsCard: { paddingVertical: Spacing.xxs },
  receiveItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  itemDot: {
    width: 5,
    height: 5,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.green,
    marginTop: Spacing.xs + 1,
  },
  receiveCopy: { flex: 1, gap: Spacing.xs },
  receiveName: { color: BrandColors.text, ...Typography.label },
  receiveQtyInput: {
    minHeight: ControlSize.compact,
    width: 150,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.caption,
  },
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
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
