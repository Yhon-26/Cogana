import { MaterialCommunityIcons } from "@expo/vector-icons";
import { File, Paths } from "expo-file-system";
import { useFocusEffect } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";

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
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useLocalOperator } from "@/context/local-operator-context";
import {
  reviewCashDifference,
  type CashDifferenceDecision,
} from "@/database/repositories/cash-difference-repository";
import {
  getReportDashboard,
  type CashDifferenceReport,
  type ReportDashboard,
} from "@/database/repositories/report-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { formatSoles as money } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";
import { useLocalDatabase } from "@/hooks/use-local-database";

type ViewName = "sales" | "inventory" | "customers" | "cash" | "audit";
const paymentMethodLabels: Record<string, string> = {
  cash: "Efectivo",
  yape: "Yape",
  plin: "Plin",
  card: "Tarjeta",
};

function formatPaymentMethod(value: string) {
  return paymentMethodLabels[value] ?? "Otro medio";
}

export default function ReportsScreen() {
  const database = useLocalDatabase();
  const { selectedUser, deviceId } = useLocalOperator();
  const [report, setReport] = useState<ReportDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<ViewName>("sales");
  const [auditCount, setAuditCount] = useState(20);
  const [reviewTarget, setReviewTarget] = useState<CashDifferenceReport | null>(
    null,
  );
  const [reviewDecision, setReviewDecision] =
    useState<CashDifferenceDecision>("approved");
  const [reviewJustification, setReviewJustification] = useState("");
  const [isSavingReview, setIsSavingReview] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setReport(await getReportDashboard(database, DEFAULT_STORE_ID));
      setLoadError(null);
    } catch (caughtError) {
      setLoadError(
        getOperatorErrorMessage(
          caughtError,
          "No se pudieron calcular los indicadores.",
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }, [database]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const shareCsv = async () => {
    if (!report) return;
    const rows = [
      "seccion,concepto,valor",
      `ventas,total,${report.sales.totalCents}`,
      `ventas,operaciones,${report.sales.saleCount}`,
      `ventas,ticket_promedio,${report.sales.averageTicketCents}`,
      `ventas,margen_estimado,${report.sales.estimatedMarginCents}`,
      ...report.products.map(
        (product) =>
          `productos,"${product.productName.replaceAll('"', '""')}",${product.salesCents}`,
      ),
      ...report.payments.map(
        (payment) => `pagos,${payment.method},${payment.totalCents}`,
      ),
      `inventario,valorizacion_costo,${report.inventory.stockValueCents}`,
    ];
    const csv = `\uFEFF${rows.join("\n")}`;
    const file = new File(
      Paths.cache,
      `cogana-reporte-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    file.create({ overwrite: true });
    file.write(csv);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        dialogTitle: "Exportar reporte Cogana",
        mimeType: "text/csv",
        UTI: "public.comma-separated-values-text",
      });
      return;
    }
    await Share.share({ title: "Reporte Cogana CSV", message: csv });
  };

  const saveCashReview = async () => {
    if (!reviewTarget || !selectedUser || isSavingReview) return;
    setIsSavingReview(true);
    try {
      await reviewCashDifference(database, {
        storeId: DEFAULT_STORE_ID,
        cashSessionId: reviewTarget.sessionId,
        actorUserId: selectedUser.id,
        deviceId,
        decision: reviewDecision,
        justification: reviewJustification,
      });
      setReviewTarget(null);
      setReviewJustification("");
      await load();
    } catch (caughtError) {
      Alert.alert(
        "No se pudo guardar la revisión",
        getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
      );
    } finally {
      setIsSavingReview(false);
    }
  };

  const sectionEmpty = (message: string) => (
    <View style={[sharedStyles.card, styles.sectionEmpty]}>
      <MaterialCommunityIcons
        name="chart-box-outline"
        size={24}
        color={BrandColors.muted}
      />
      <Text style={styles.muted}>{message}</Text>
    </View>
  );

  return (
    <AdminScreen
      title="Reportes"
      subtitle="Ventas, caja, inventario, clientes y auditoría"
      right={
        <Pressable
          accessibilityLabel="Exportar reporte CSV"
          accessibilityRole="button"
          onPress={() => void shareCsv()}
          style={styles.export}
        >
          <Text style={styles.exportText}>CSV</Text>
        </Pressable>
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
              Activa tu perfil con PIN en la pestaña Más para revisar diferencias
              de caja.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.tabs}>
        {(
          [
            ["sales", "Ventas"],
            ["inventory", "Inventario"],
            ["customers", "Clientes"],
            ["cash", "Caja"],
            ["audit", "Auditoría"],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: view === value }}
            key={value}
            onPress={() => setView(value)}
            style={[styles.tab, view === value && styles.tabActive]}
          >
            <Text style={styles.tabText}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text style={styles.muted}>Calculando indicadores…</Text>
        </View>
      ) : loadError ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {loadError}
          </Text>
          <PrimaryButton label="Reintentar" onPress={() => void load()} />
        </View>
      ) : report && view === "sales" ? (
        <>
          <View style={styles.metrics}>
            <Metric label="Ventas" value={money(report.sales.totalCents)} />
            <Metric
              label="Ticket prom."
              value={money(report.sales.averageTicketCents)}
            />
            <Metric
              label="Margen est."
              value={money(report.sales.estimatedMarginCents)}
            />
          </View>
          <SectionTitle
            action={<Pill label={`${report.sales.saleCount}`} tone="neutral" />}
          >
            Productos vendidos
          </SectionTitle>
          <View style={[sharedStyles.card, styles.list]}>
            {report.products.length ? (
              report.products.map((product) => (
                <Row
                  key={product.productId}
                  title={product.productName}
                  subtitle={`${product.quantity} ${product.baseUnit === "gram" ? "g" : "un."} · margen ${money(product.marginCents)}`}
                  value={money(product.salesCents)}
                />
              ))
            ) : (
              <Text style={styles.muted}>Aún no hay ventas en el periodo.</Text>
            )}
          </View>
          <SectionTitle>Medios de pago</SectionTitle>
          <View style={[sharedStyles.card, styles.list]}>
            {report.payments.length ? (
              report.payments.map((payment) => (
                <Row
                  key={payment.method}
                  title={formatPaymentMethod(payment.method)}
                  subtitle={`${payment.paymentCount} pagos`}
                  value={money(payment.totalCents)}
                />
              ))
            ) : (
              <Text style={styles.muted}>Aún no hay pagos registrados.</Text>
            )}
          </View>
        </>
      ) : report && view === "inventory" ? (
        <>
          <View style={styles.metrics}>
            <Metric
              label="Productos"
              value={String(report.inventory.productCount)}
            />
            <Metric
              label="Stock bajo"
              value={String(report.inventory.lowStockCount)}
            />
            <Metric
              label="Valor costo"
              value={money(report.inventory.stockValueCents)}
            />
          </View>
          <View style={[sharedStyles.card, styles.list]}>
            <Row
              title="Valor potencial de venta"
              subtitle="Stock activo a precio vigente"
              value={money(report.inventory.retailValueCents)}
            />
            <Row
              title="Utilidad potencial"
              subtitle="Diferencia sin gastos operativos"
              value={money(
                report.inventory.retailValueCents -
                  report.inventory.stockValueCents,
              )}
            />
          </View>
        </>
      ) : report && view === "customers" ? (
        <View style={[sharedStyles.card, styles.list]}>
          {report.customers.length ? (
            report.customers.map((customer) => (
              <Row
                key={customer.customerId}
                title={customer.customerName}
                subtitle={`${customer.phone} · ${customer.orderCount} pedidos`}
                value={money(customer.totalCents)}
              />
            ))
          ) : (
            <Text style={styles.muted}>
              Aún no hay clientes con pedidos registrados.
            </Text>
          )}
        </View>
      ) : report && view === "cash" ? (
        <View style={[sharedStyles.card, styles.list]}>
          {report.cashDifferences.map((session) => (
            <Pressable
              accessibilityLabel={`Revisar diferencia de caja de ${session.responsibleName}`}
              accessibilityRole="button"
              accessibilityState={{
                disabled:
                  !session.differenceCents ||
                  selectedUser?.role !== "administrator",
              }}
              disabled={
                !session.differenceCents ||
                selectedUser?.role !== "administrator"
              }
              key={session.sessionId}
              onPress={() => {
                setReviewTarget(session);
                setReviewDecision(session.reviewDecision ?? "approved");
                setReviewJustification(session.reviewJustification ?? "");
              }}
              style={styles.row}
            >
              <View style={styles.fill}>
                <Text maxFontSizeMultiplier={1.3} style={styles.rowTitle}>
                  {session.responsibleName}
                </Text>
                <Text style={styles.muted}>
                  {formatDateTime(new Date(session.closedAt))} ·{" "}
                  {session.reviewDecision === "approved"
                    ? "Aprobada"
                    : session.reviewDecision === "requires_action"
                      ? "Observada"
                      : session.differenceCents
                        ? "Pendiente de revisión"
                        : "Sin diferencia"}
                </Text>
              </View>
              <Text
                maxFontSizeMultiplier={1.4}
                style={[
                  styles.value,
                  session.differenceCents !== 0 && styles.danger,
                ]}
              >
                {session.differenceCents >= 0 ? "+" : ""}
                {money(session.differenceCents)}
              </Text>
              {session.differenceCents &&
              selectedUser?.role === "administrator" ? (
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={18}
                  color={BrandColors.muted}
                />
              ) : null}
            </Pressable>
          ))}
          {!report.cashDifferences.length
            ? sectionEmpty("Aún no hay cierres de caja.")
            : null}
        </View>
      ) : report && view === "audit" ? (
        <View style={[sharedStyles.card, styles.list]}>
          {report.audit.length ? (
            <>
              {report.audit.slice(0, auditCount).map((event) => (
                <Row
                  key={`${event.eventType}-${event.id}`}
                  title={event.description}
                  subtitle={`${event.actorName} · ${formatDateTime(new Date(event.createdAt))}`}
                />
              ))}
              {report.audit.length > auditCount ? (
                <Pressable
                  accessibilityLabel="Mostrar más eventos de auditoría"
                  accessibilityRole="button"
                  onPress={() => setAuditCount((current) => current + 20)}
                  style={styles.showMore}
                >
                  <Text style={styles.showMoreText}>
                    Mostrar más eventos ({report.audit.length - auditCount}{" "}
                    restantes)
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Text style={styles.muted}>Aún no hay eventos de auditoría.</Text>
          )}
        </View>
      ) : null}

      <ModalSurface
        dialogStyle={styles.dialog}
        dismissOnBackdrop={!isSavingReview}
        onClose={() => {
          if (!isSavingReview) setReviewTarget(null);
        }}
        visible={reviewTarget !== null}
      >
        <View style={styles.dialogHeader}>
          <MaterialCommunityIcons
            name="cash-check"
            size={24}
            color={BrandColors.greenDark}
          />
          <Text maxFontSizeMultiplier={1.3} style={styles.dialogTitle}>
            Revisar diferencia de caja
          </Text>
        </View>
        <Text style={styles.muted}>
          {reviewTarget?.responsibleName} ·{" "}
          {reviewTarget ? money(reviewTarget.differenceCents) : ""}
        </Text>
        <View
          accessibilityLabel="Decisión de revisión"
          accessibilityRole="radiogroup"
          style={styles.decisionRow}
        >
          {(
            [
              ["approved", "Aprobar"],
              ["requires_action", "Observar"],
            ] as const
          ).map(([decision, label]) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: reviewDecision === decision }}
              key={decision}
              onPress={() => setReviewDecision(decision)}
              style={[
                styles.decision,
                reviewDecision === decision && styles.decisionActive,
              ]}
            >
              <Text style={styles.decisionText}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          accessibilityLabel="Justificación de la revisión"
          multiline
          onChangeText={setReviewJustification}
          placeholder="Justificación obligatoria"
          placeholderTextColor={BrandColors.muted}
          style={styles.reviewInput}
          value={reviewJustification}
        />
        <View style={styles.dialogActions}>
          <ActionButton
            compact
            disabled={isSavingReview}
            label="Cancelar"
            onPress={() => setReviewTarget(null)}
            style={styles.dialogButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={!reviewJustification.trim() || isSavingReview}
            label={isSavingReview ? "Guardando…" : "Guardar revisión"}
            loading={isSavingReview}
            onPress={() => void saveCashReview()}
            style={styles.dialogButton}
          />
        </View>
      </ModalSurface>
    </AdminScreen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text
        maxFontSizeMultiplier={1.4}
        adjustsFontSizeToFit
        numberOfLines={1}
        style={styles.metricValue}
      >
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Row({
  title,
  subtitle,
  value,
  danger,
}: {
  title: string;
  subtitle: string;
  value?: string;
  danger?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.fill}>
        <Text maxFontSizeMultiplier={1.3} style={styles.rowTitle}>
          {title}
        </Text>
        <Text style={styles.muted}>{subtitle}</Text>
      </View>
      {value ? (
        <Text
          maxFontSizeMultiplier={1.4}
          adjustsFontSizeToFit
          numberOfLines={1}
          style={[styles.value, danger && styles.danger]}
        >
          {value}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  export: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  exportText: { color: BrandColors.white, ...Typography.label },
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
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  tab: {
    minHeight: ControlSize.compact,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    paddingHorizontal: Spacing.sm,
    justifyContent: "center",
  },
  tabActive: {
    backgroundColor: BrandColors.greenLight,
    borderColor: BrandColors.green,
  },
  tabText: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
  },
  feedback: { gap: Spacing.sm },
  errorText: { color: BrandColors.danger, ...Typography.caption },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  metric: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    minWidth: 140,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.sm,
    ...Elevation.ambientCard,
  },
  metricValue: { color: BrandColors.text, ...Typography.h3 },
  metricLabel: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  list: { paddingVertical: Spacing.xxs },
  showMore: {
    minHeight: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.sm,
  },
  showMoreText: { color: BrandColors.greenDark, ...Typography.label },
  sectionEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  row: {
    minHeight: ControlSize.large,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.line,
    paddingVertical: Spacing.xs,
  },
  fill: { flex: 1 },
  rowTitle: { color: BrandColors.text, ...Typography.label },
  muted: { color: BrandColors.muted, ...Typography.caption },
  value: { color: BrandColors.greenDark, ...Typography.label },
  danger: { color: BrandColors.danger },
  dialog: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  dialogHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  dialogTitle: { color: BrandColors.text, ...Typography.h3, flex: 1 },
  decisionRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  decision: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 140,
    minWidth: 120,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  decisionActive: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
  },
  decisionText: { color: BrandColors.greenDark, ...Typography.label },
  reviewInput: {
    minHeight: ControlSize.default + Spacing.xxxl,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    padding: Spacing.sm,
    textAlignVertical: "top",
    ...Typography.body,
  },
  dialogActions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  dialogButton: { flexGrow: 1, flexShrink: 1, flexBasis: 140, minWidth: 120 },
});
