import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  AdminScreen,
  Pill,
  SectionTitle,
  sharedStyles,
} from "@/components/admin-ui";
import { OperatorSelector } from "@/components/operator-selector";
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
  const { selectedUser, deviceId } = useLocalOperator();
  const [sales, setSales] = useState<SaleHistorySummary[]>([]);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<ConfirmedSaleResult | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [returnMethod, setReturnMethod] = useState<
    "cash" | "yape" | "plin" | "card"
  >("cash");
  const [returnQuantities, setReturnQuantities] = useState<
    Record<string, string>
  >({});
  const [returns, setReturns] = useState<SaleReturnRecord[]>([]);

  const load = useCallback(async () => {
    setSales(await listSalesHistory(database, DEFAULT_STORE_ID));
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
    const [nextDetail, nextReturns] = await Promise.all([
      getSaleHistoryDetail(database, DEFAULT_STORE_ID, saleId),
      listSaleReturns(database, DEFAULT_STORE_ID, saleId),
    ]);
    setDetail(nextDetail);
    setReturns(nextReturns);
    setReturnQuantities({});
  };
  const cancel = async () => {
    if (!detail || !selectedUser) return;
    try {
      await voidSale(database, {
        storeId: DEFAULT_STORE_ID,
        saleId: detail.sale.id,
        reason: voidReason,
        actorUserId: selectedUser.id,
        deviceId,
      });
      setDetail(null);
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
    }
  };
  const createReturn = async () => {
    if (!detail || !selectedUser) return;
    const items = Object.entries(returnQuantities)
      .map(([saleItemId, raw]) => ({ saleItemId, quantity: Number(raw) }))
      .filter(
        (item) => Number.isSafeInteger(item.quantity) && item.quantity > 0,
      );
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
    }
  };

  return (
    <AdminScreen
      title="Historial de ventas"
      subtitle="Búsqueda, detalle, anulaciones y devoluciones"
    >
      <OperatorSelector />
      <TextInput
        accessibilityLabel="Buscar por código, operador o producto"
        placeholder="Código, operador o producto"
        placeholderTextColor={BrandColors.muted}
        style={styles.input}
        value={query}
        onChangeText={setQuery}
      />
      <SectionTitle
        action={<Pill label={`${visible.length}`} tone="neutral" />}
      >
        Operaciones
      </SectionTitle>
      {visible.map((sale) => (
        <Pressable
          accessibilityLabel={`Abrir venta ${sale.receiptNumber}`}
          accessibilityRole="button"
          key={sale.id}
          onPress={() => void open(sale.id)}
          style={[sharedStyles.card, styles.row]}
        >
          <View style={styles.fill}>
            <Text style={styles.title}>{sale.receiptNumber}</Text>
            <Text style={styles.meta}>
              {sale.actorDisplayName} · {sale.paymentMethods} ·{" "}
              {new Date(sale.createdAt).toLocaleString("es-PE")}
            </Text>
            <Text style={styles.meta}>{sale.itemNames}</Text>
          </View>
          <View>
            <Text style={styles.total}>{money(sale.totalCents)}</Text>
            {sale.status === "voided" ? (
              <Pill label="Anulada" tone="danger" />
            ) : null}
          </View>
        </Pressable>
      ))}
      {detail ? (
        <View style={[sharedStyles.card, styles.detail]}>
          <View style={styles.row}>
            <View style={styles.fill}>
              <Text style={styles.title}>{detail.sale.receiptNumber}</Text>
              <Text style={styles.meta}>
                {new Date(detail.sale.createdAt).toLocaleString("es-PE")}
              </Text>
            </View>
            <Text style={styles.total}>{money(detail.sale.totalCents)}</Text>
          </View>
          {detail.items.map((item) => {
            const returned = returns
              .flatMap((record) => record.items)
              .filter((returnedItem) => returnedItem.saleItemId === item.id)
              .reduce((sum, returnedItem) => sum + returnedItem.quantity, 0);
            return (
              <View key={item.id} style={styles.returnItem}>
                <View style={styles.row}>
                  <Text style={[styles.title, styles.fill]}>
                    {item.productNameSnapshot} · {item.quantity}{" "}
                    {item.baseUnitSnapshot === "gram" ? "g" : "un."}
                  </Text>
                  <Text style={styles.meta}>{money(item.lineTotalCents)}</Text>
                </View>
                {selectedUser?.role === "administrator" &&
                returned < item.quantity ? (
                  <TextInput
                    accessibilityLabel={`Cantidad a devolver de ${item.productNameSnapshot}`}
                    keyboardType="number-pad"
                    placeholder={`A devolver (máx. ${item.quantity - returned})`}
                    placeholderTextColor={BrandColors.muted}
                    style={styles.input}
                    value={returnQuantities[item.id] ?? ""}
                    onChangeText={(value) =>
                      setReturnQuantities((current) => ({
                        ...current,
                        [item.id]: value,
                      }))
                    }
                  />
                ) : returned > 0 ? (
                  <Text style={styles.meta}>Devuelto: {returned}</Text>
                ) : null}
              </View>
            );
          })}
          {detail.payments.map((payment) => (
            <Text key={payment.id} style={styles.meta}>
              {paymentMethodLabels[payment.method]}:{" "}
              {money(payment.amountCents)}
              {payment.reference ? ` · ${payment.reference}` : ""}
            </Text>
          ))}
          {selectedUser?.role === "administrator" &&
          detail.sale.status === "confirmed" ? (
            <>
              <SectionTitle>Devolución parcial</SectionTitle>
              <View style={styles.methods}>
                {(["cash", "yape", "plin", "card"] as const).map((method) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: returnMethod === method }}
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
                ))}
              </View>
              <TextInput
                accessibilityLabel="Motivo de devolución"
                placeholder="Motivo de devolución"
                placeholderTextColor={BrandColors.muted}
                style={styles.input}
                value={returnReason}
                onChangeText={setReturnReason}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled:
                    !returnReason.trim() ||
                    !Object.values(returnQuantities).some(
                      (value) => Number(value) > 0,
                    ),
                }}
                disabled={
                  !returnReason.trim() ||
                  !Object.values(returnQuantities).some(
                    (value) => Number(value) > 0,
                  )
                }
                onPress={() => void createReturn()}
                style={[
                  styles.returnButton,
                  (!returnReason.trim() ||
                    !Object.values(returnQuantities).some(
                      (value) => Number(value) > 0,
                    )) &&
                    styles.disabled,
                ]}
              >
                <Text style={styles.returnText}>
                  Registrar devolución seleccionada
                </Text>
              </Pressable>
              {!returns.length ? (
                <>
                  <TextInput
                    accessibilityLabel="Motivo de anulación total"
                    placeholder="Motivo de anulación total"
                    placeholderTextColor={BrandColors.muted}
                    style={styles.input}
                    value={voidReason}
                    onChangeText={setVoidReason}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !voidReason.trim() }}
                    disabled={!voidReason.trim()}
                    onPress={() => void cancel()}
                    style={[
                      styles.danger,
                      !voidReason.trim() && styles.disabled,
                    ]}
                  >
                    <Text style={styles.dangerText}>
                      Anular toda la venta y restaurar stock
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </>
          ) : null}
          {returns.map((record) => (
            <View key={record.id} style={styles.returnSummary}>
              <Text style={styles.title}>
                Devolución {money(record.totalCents)} ·{" "}
                {paymentMethodLabels[record.refundMethod]}
              </Text>
              <Text style={styles.meta}>
                {record.reason} ·{" "}
                {new Date(record.createdAt).toLocaleString("es-PE")}
              </Text>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => setDetail(null)}
            style={styles.closeButton}
          >
            <Text style={styles.link}>Cerrar detalle</Text>
          </Pressable>
        </View>
      ) : null}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
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
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  fill: { flex: 1 },
  title: { color: BrandColors.text, ...Typography.label },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  total: {
    color: BrandColors.text,
    ...Typography.h3,
    textAlign: "right",
    marginBottom: Spacing.xxs,
  },
  detail: { gap: Spacing.sm },
  returnItem: { gap: Spacing.xs },
  methods: { flexDirection: "row", gap: Spacing.xs },
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
  returnButton: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  returnText: { color: BrandColors.greenDark, ...Typography.label },
  returnSummary: {
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.goldLight,
    padding: Spacing.sm,
  },
  danger: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.dangerLight,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  dangerText: { color: BrandColors.danger, ...Typography.label },
  closeButton: {
    minHeight: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
  },
  link: {
    color: BrandColors.greenDark,
    ...Typography.label,
    textAlign: "center",
  },
  disabled: { opacity: Interaction.disabledOpacity },
});
