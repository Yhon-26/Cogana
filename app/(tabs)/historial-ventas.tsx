import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
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
  ComponentMetrics,
  ControlSize,
  Elevation,
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useLocalOperator } from "@/context/local-operator-context";
import { voidSale } from "@/database/repositories/sales-corrections-repository";
import {
  createPartialSaleReturn,
  listSaleReturns,
  type SaleReturnRecord,
} from "@/database/repositories/sales-return-repository";
import type { ConfirmedSaleResult } from "@/database/repositories/sales-repository";
import {
  getSaleHistoryDetail,
  listSalesHistory,
  type SaleHistorySummary,
} from "@/database/repositories/sales-history-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { formatSoles as money } from "@/lib/money";
import { formatDateShort, formatDateTime } from "@/lib/format";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";
import { useLocalDatabase } from "@/hooks/use-local-database";

const paymentMethodLabels = {
  cash: "Efectivo",
  yape: "Yape",
  plin: "Plin",
  card: "Tarjeta",
} as const;

export default function SalesHistoryScreen() {
  const database = useLocalDatabase();
  const { users, selectedUser, deviceId } = useLocalOperator();
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.round(height * 0.88);
  const [sales, setSales] = useState<SaleHistorySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<ConfirmedSaleResult | null>(null);
  const [returns, setReturns] = useState<SaleReturnRecord[]>([]);
  const [voidVisible, setVoidVisible] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [returnMethod, setReturnMethod] = useState<
    "cash" | "yape" | "plin" | "card"
  >("cash");
  const [returnReason, setReturnReason] = useState("");
  const [returnQuantities, setReturnQuantities] = useState<
    Record<string, string>
  >({});

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setSales(await listSalesHistory(database, DEFAULT_STORE_ID));
    } catch (caughtError) {
      setLoadError(
        getOperatorErrorMessage(
          caughtError,
          "No se pudieron cargar las ventas.",
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }, [database]);
  useFocusEffect(useCallback(() => void load(), [load]));
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-PE");
    return sales.filter((sale) =>
      `${sale.receiptNumber} ${sale.actorDisplayName} ${sale.itemNames}`
        .toLocaleLowerCase("es-PE")
        .includes(normalized),
    );
  }, [query, sales]);

  const open = async (saleId: string) => {
    try {
      const [nextDetail, nextReturns] = await Promise.all([
        getSaleHistoryDetail(database, DEFAULT_STORE_ID, saleId),
        listSaleReturns(database, DEFAULT_STORE_ID, saleId),
      ]);
      setDetail(nextDetail);
      setReturns(nextReturns);
      setReturnQuantities({});
      setReturnReason("");
      setReturnMethod("cash");
    } catch (caughtError) {
      Alert.alert(
        "No se pudo abrir",
        getOperatorErrorMessage(caughtError, "No se pudo abrir la venta."),
      );
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setVoidReason("");
  };

  const cancel = async () => {
    if (!detail || !selectedUser || isSaving) return;
    setIsSaving(true);
    try {
      await voidSale(database, {
        storeId: DEFAULT_STORE_ID,
        saleId: detail.sale.id,
        reason: voidReason,
        actorUserId: selectedUser.id,
        deviceId,
      });
      setDetail(null);
      setVoidVisible(false);
      setVoidReason("");
      await load();
    } catch (error) {
      Alert.alert(
        "No se pudo anular",
        getOperatorErrorMessage(
          error,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const createReturn = async () => {
    if (!detail || !selectedUser || isSaving) return;
    const items = Object.entries(returnQuantities)
      .map(([saleItemId, raw]) => ({ saleItemId, quantity: Number(raw) }))
      .filter(
        (item) => Number.isSafeInteger(item.quantity) && item.quantity > 0,
      );
    if (!items.length || !returnReason.trim()) return;
    setIsSaving(true);
    try {
      await createPartialSaleReturn(database, {
        storeId: DEFAULT_STORE_ID,
        saleId: detail.sale.id,
        items,
        refundMethod: returnMethod,
        reason: returnReason,
        actorUserId: selectedUser.id,
        deviceId,
      });
      setReturnReason("");
      setReturnQuantities({});
      await open(detail.sale.id);
      await load();
      Alert.alert(
        "Devolución registrada",
        "El stock y el reembolso quedaron auditados.",
      );
    } catch (error) {
      Alert.alert(
        "No se pudo devolver",
        getOperatorErrorMessage(
          error,
          "Revisa las cantidades e intenta nuevamente.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const returnSelected = useMemo(
    () =>
      Object.values(returnQuantities).some((value) => Number(value) > 0) &&
      Boolean(returnReason.trim()),
    [returnQuantities, returnReason],
  );
  const canVoid =
    detail?.sale.status === "confirmed" && selectedUser?.role === "administrator" && !returns.length;

  return (
    <AdminScreen
      title="Historial de ventas"
      subtitle="Búsqueda, detalle, anulaciones y devoluciones"
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
              Activa tu perfil con PIN en la pestaña Más para anular o devolver.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.searchWrap}>
        <MaterialCommunityIcons
          name="magnify"
          size={21}
          color={BrandColors.muted}
        />
        <TextInput
          accessibilityLabel="Buscar por código, operador o producto"
          placeholder="Código, operador o producto"
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

      <SectionTitle
        action={<Pill label={`${visible.length}`} tone="neutral" />}
      >
        Operaciones
      </SectionTitle>

      {isLoading ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text style={styles.muted}>Cargando ventas…</Text>
        </View>
      ) : loadError ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text accessibilityRole="alert" style={styles.error}>
            {loadError}
          </Text>
          <PrimaryButton label="Reintentar" onPress={() => void load()} />
        </View>
      ) : visible.length === 0 ? (
        <View style={[sharedStyles.card, styles.empty]}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons
              name="receipt-text-outline"
              size={30}
              color={BrandColors.green}
            />
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
            {sales.length === 0
              ? "Aún no hay ventas registradas"
              : "Sin resultados"}
          </Text>
          <Text style={styles.muted}>
            {sales.length === 0
              ? "Cada venta cobrada quedará aquí con su recibo, operador y pagos."
              : "Revisa el código de recibo, el operador o el producto buscado."}
          </Text>
          {sales.length === 0 ? (
            <PrimaryButton
              label="Nueva venta"
              icon="cash-register"
              onPress={() => router.push("/venta")}
            />
          ) : (
            <PrimaryButton
              label="Limpiar búsqueda"
              icon="magnify"
              onPress={() => setQuery("")}
            />
          )}
        </View>
      ) : (
        <View style={styles.saleList}>
          {visible.map((sale) => (
            <Pressable
              accessibilityLabel={`Abrir venta ${sale.receiptNumber}`}
              accessibilityRole="button"
              key={sale.id}
              onPress={() => void open(sale.id)}
              style={({ pressed }) => [
                sharedStyles.card,
                styles.saleCard,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.saleTop}>
                <Text
                  maxFontSizeMultiplier={1.3}
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  style={styles.receipt}
                >
                  {sale.receiptNumber}
                </Text>
                {sale.status === "voided" ? (
                  <Pill label="Anulada" tone="danger" />
                ) : null}
              </View>
              <Text
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                style={styles.items}
              >
                {sale.itemNames}
              </Text>
              <View style={styles.totalRow}>
                <Text numberOfLines={1} style={styles.meta}>
                  {sale.actorDisplayName} · {sale.paymentMethods}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.4}
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  style={[
                    styles.total,
                    sale.status === "voided" && styles.totalVoided,
                  ]}
                >
                  {money(sale.totalCents)}
                </Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={18}
                  color={BrandColors.muted}
                />
              </View>
              <Text style={styles.meta}>
                {formatDateShort(new Date(sale.createdAt))}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        onClose={closeDetail}
        placement="bottom"
        visible={detail !== null}
      >
        {detail ? (
          <>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
                  {detail.sale.receiptNumber}
                </Text>
                <Text style={styles.sheetDate}>
                  {formatDateShort(new Date(detail.sale.createdAt))}
                </Text>
              </View>
              <Pill
                label={detail.sale.status === "voided" ? "Anulada" : "Confirmada"}
                tone={detail.sale.status === "voided" ? "danger" : "green"}
              />
              <Pressable
                accessibilityLabel="Cerrar detalle de la venta"
                accessibilityRole="button"
                hitSlop={8}
                onPress={closeDetail}
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
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={styles.sheetScroll}
            >
              <View style={[sharedStyles.card, styles.summaryCard]}>
                <View style={styles.summaryRow}>
                  <MaterialCommunityIcons
                    name="account-outline"
                    size={16}
                    color={BrandColors.muted}
                  />
                  <Text style={styles.summaryText}>
                    {users.find((user) => user.id === detail.sale.actorUserId)
                      ?.displayName ?? "Operador del turno"}
                  </Text>
                </View>
                {detail.payments.map((payment) => (
                  <View key={payment.id} style={styles.summaryRow}>
                    <MaterialCommunityIcons
                      name="cash-multiple"
                      size={16}
                      color={BrandColors.muted}
                    />
                    <Text style={styles.summaryText}>
                      {paymentMethodLabels[payment.method]}:{" "}
                      {money(payment.amountCents)}
                      {payment.reference ? ` · ${payment.reference}` : ""}
                    </Text>
                  </View>
                ))}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>TOTAL</Text>
                  <Text
                    maxFontSizeMultiplier={1.4}
                    adjustsFontSizeToFit
                    numberOfLines={1}
                    style={styles.sheetTotal}
                  >
                    {money(detail.sale.totalCents)}
                  </Text>
                </View>
              </View>

              <Text style={styles.sheetSectionLabel}>
                PRODUCTOS ({detail.items.length})
              </Text>
              <View style={[sharedStyles.card, styles.itemsCard]}>
                {detail.items.map((item, index) => {
                  const returned = returns
                    .flatMap((record) => record.items)
                    .filter(
                      (returnedItem) => returnedItem.saleItemId === item.id,
                    )
                    .reduce(
                      (sum, returnedItem) => sum + returnedItem.quantity,
                      0,
                    );
                  const returnEligible =
                    selectedUser?.role === "administrator" &&
                    detail.sale.status === "confirmed" &&
                    returned < item.quantity;
                  return (
                    <View
                      key={item.id}
                      style={[styles.itemRow, index > 0 && styles.borderTop]}
                    >
                      <View style={styles.itemDot} />
                      <View style={styles.itemCopy}>
                        <Text numberOfLines={2} style={styles.itemName}>
                          {item.productNameSnapshot}
                        </Text>
                        <Text style={styles.itemMeta}>
                          {item.quantity}{" "}
                          {item.baseUnitSnapshot === "gram" ? "g" : "un."}
                          {returned > 0 ? ` · Devuelto: ${returned}` : ""}
                        </Text>
                        {returnEligible ? (
                          <TextInput
                            accessibilityLabel={`Cantidad a devolver de ${item.productNameSnapshot}`}
                            keyboardType="number-pad"
                            placeholder={`A devolver (máx. ${item.quantity - returned})`}
                            placeholderTextColor={BrandColors.muted}
                            style={styles.returnInput}
                            value={returnQuantities[item.id] ?? ""}
                            onChangeText={(value) =>
                              setReturnQuantities((current) => ({
                                ...current,
                                [item.id]: value,
                              }))
                            }
                          />
                        ) : null}
                      </View>
                      <Text style={styles.itemTotal}>
                        {money(item.lineTotalCents)}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {selectedUser?.role === "administrator" &&
              detail.sale.status === "confirmed" ? (
                <>
                  <Text style={styles.sheetSectionLabel}>
                    DEVOLUCIÓN PARCIAL
                  </Text>
                  <View style={[sharedStyles.card, styles.returnCard]}>
                    <View style={styles.methodRow}>
                      {(["cash", "yape", "plin", "card"] as const).map(
                        (method) => (
                          <Pressable
                            accessibilityLabel={`Reembolso en ${paymentMethodLabels[method]}`}
                            accessibilityRole="radio"
                            accessibilityState={{
                              checked: returnMethod === method,
                            }}
                            key={method}
                            onPress={() => setReturnMethod(method)}
                            style={[
                              styles.method,
                              returnMethod === method && styles.methodActive,
                            ]}
                          >
                            <Text style={styles.methodText}>
                              {paymentMethodLabels[method]}
                            </Text>
                          </Pressable>
                        ),
                      )}
                    </View>
                    <TextInput
                      accessibilityLabel="Motivo de devolución"
                      placeholder="Motivo de devolución"
                      placeholderTextColor={BrandColors.muted}
                      style={styles.input}
                      value={returnReason}
                      onChangeText={setReturnReason}
                    />
                  </View>
                </>
              ) : null}

              {returns.map((record) => (
                <View key={record.id} style={styles.returnSummary}>
                  <Text style={styles.returnTitle}>
                    Devolución {money(record.totalCents)} ·{" "}
                    {paymentMethodLabels[record.refundMethod]}
                  </Text>
                  <Text style={styles.returnMeta}>
                    {record.reason} ·{" "}
                    {formatDateTime(new Date(record.createdAt))}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.sheetFooter}>
              {selectedUser?.role === "administrator" &&
              detail.sale.status === "confirmed" ? (
                <PrimaryButton
                  label="Registrar devolución"
                  icon="undo-variant"
                  loading={isSaving}
                  onPress={() => void createReturn()}
                  disabled={isSaving || !returnSelected}
                />
              ) : null}
              {canVoid ? (
                <Pressable
                  accessibilityLabel="Anular toda la venta"
                  accessibilityRole="button"
                  onPress={() => {
                    setVoidReason("");
                    setVoidVisible(true);
                  }}
                  style={styles.cancelLink}
                >
                  <MaterialCommunityIcons
                    name="close-circle-outline"
                    size={18}
                    color={BrandColors.danger}
                  />
                  <Text style={styles.cancelLinkText}>
                    Anular venta y restaurar stock
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}
      </ModalSurface>

      <ModalSurface
        dialogStyle={styles.dialog}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setVoidVisible(false);
        }}
        visible={voidVisible && detail !== null}
      >
        <View style={styles.dialogHeader}>
          <MaterialCommunityIcons
            name="close-circle-outline"
            size={24}
            color={BrandColors.danger}
          />
          <Text maxFontSizeMultiplier={1.3} style={styles.dialogTitle}>
            Anular {detail?.sale.receiptNumber ?? ""}
          </Text>
        </View>
        <Text style={styles.dialogHint}>
          La venta quedará anulada, el stock se restaurará y el cambio será
          definitivo en el historial.
        </Text>
        <TextInput
          accessibilityLabel="Motivo de anulación total"
          autoFocus
          placeholder="Ej. venta registrada por error"
          placeholderTextColor={BrandColors.muted}
          style={styles.input}
          value={voidReason}
          onChangeText={setVoidReason}
        />
        <View style={styles.dialogActions}>
          <ActionButton
            compact
            disabled={isSaving}
            label="Volver"
            onPress={() => setVoidVisible(false)}
            style={styles.dialogButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={!voidReason.trim() || isSaving}
            label="Anular venta"
            loading={isSaving}
            onPress={() => void cancel()}
            style={styles.dialogButton}
            tone="danger"
          />
        </View>
      </ModalSurface>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
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
  error: { color: BrandColors.danger, ...Typography.caption },
  saleList: { gap: Spacing.sm },
  saleCard: {
    gap: Spacing.xxs,
    ...Elevation.ambientCard,
  },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
  saleTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  receipt: {
    flexShrink: 1,
    color: BrandColors.greenDark,
    ...Typography.label,
  },
  items: {
    color: BrandColors.text,
    ...Typography.label,
  },
  meta: {
    flexShrink: 1,
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  total: { color: BrandColors.text, ...Typography.h3, flexShrink: 1 },
  totalVoided: {
    color: BrandColors.muted,
    textDecorationLine: "line-through",
  },
  input: {
    minHeight: ControlSize.default,
    borderWidth: 1.5,
    borderColor: BrandColors.line,
    borderRadius: ComponentMetrics.inputRadius,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.body,
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
  sheetDate: {
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
  sheetSectionLabel: {
    color: BrandColors.muted,
    ...Typography.overline,
    marginTop: Spacing.xxs,
  },
  sheetTotal: {
    color: BrandColors.greenDark,
    ...Typography.h2,
    flexShrink: 1,
  },
  sheetFooter: { gap: Spacing.xxs },
  summaryCard: { gap: Spacing.xs },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  summaryText: {
    flex: 1,
    color: BrandColors.muted,
    ...Typography.caption,
  },
  totalLabel: {
    color: BrandColors.greenDark,
    ...Typography.overline,
  },
  itemsCard: { paddingVertical: Spacing.xxs },
  itemRow: {
    paddingVertical: Spacing.sm,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
  },
  itemDot: {
    width: 5,
    height: 5,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.green,
    marginTop: Spacing.xs + 1,
  },
  itemCopy: { flex: 1 },
  itemName: { color: BrandColors.text, ...Typography.label },
  itemMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  returnInput: {
    width: 130,
    minHeight: ControlSize.compact,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: Radius.sm,
    color: BrandColors.text,
    ...Typography.caption,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    marginTop: Spacing.xs,
  },
  itemTotal: { color: BrandColors.text, ...Typography.label },
  borderTop: { borderTopWidth: 1, borderTopColor: BrandColors.line },
  returnCard: { gap: Spacing.sm },
  methodRow: { flexDirection: "row", gap: Spacing.xs },
  method: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.xxs,
    alignItems: "center",
    justifyContent: "center",
  },
  methodActive: {
    backgroundColor: BrandColors.greenLight,
    borderColor: BrandColors.green,
  },
  methodText: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
  },
  returnSummary: {
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.goldLight,
    padding: Spacing.sm,
  },
  returnTitle: { color: BrandColors.text, ...Typography.label },
  returnMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  cancelLink: {
    minHeight: ControlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  cancelLinkText: { color: BrandColors.danger, ...Typography.label },
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
  disabled: { opacity: Interaction.disabledOpacity },
});
