import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  AdminScreen,
  Pill,
  SectionTitle,
  sharedStyles,
} from "@/components/admin-ui";
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
import { useSupabaseAuth } from "@/context/supabase-auth-context";
import type { LocalSyncStateRecord, SyncOutboxRecord } from "@/database/models";
import {
  listOutboxForActor,
  retryOutboxOperation,
} from "@/database/repositories/sync-outbox-repository";
import { getLocalSyncState } from "@/database/repositories/sync-state-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { useLocalDatabase } from "@/hooks/use-local-database";
import { useSync } from "@/hooks/use-sync";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";

const authStateLabels: Record<
  ReturnType<typeof useSupabaseAuth>["state"],
  string
> = {
  unconfigured: "No configurada",
  local_only: "Vinculación pendiente",
  connecting: "Conectando",
  authenticated: "Autenticada",
  offline: "Sin conexión",
  error: "Con error",
};
const syncStatusLabels: Record<SyncOutboxRecord["status"], string> = {
  pending: "Pendiente",
  syncing: "Sincronizando",
  synced: "Sincronizada",
  error: "Con error",
};
const operationTypeLabels: Record<string, string> = {
  "attendance.checked_in": "Entrada de asistencia registrada",
  "attendance.checked_out": "Salida de asistencia registrada",
  "cash_difference.reviewed": "Diferencia de caja revisada",
  "cash_movement.income": "Ingreso de caja registrado",
  "cash_movement.outflow": "Salida de caja registrada",
  "cash_session.closed": "Sesión de caja cerrada",
  "cash_session.opened": "Sesión de caja abierta",
  "delivery.assigned": "Reparto asignado",
  "delivery.confirmed": "Entrega confirmada",
  "delivery.evidence_attached": "Evidencia de entrega adjuntada",
  "delivery.started": "Ruta de reparto iniciada",
  "delivery_zone.created": "Zona de reparto creada",
  "inventory_movement.created": "Movimiento de inventario creado",
  "order.created": "Pedido creado",
  "order.incident_created": "Incidencia de pedido creada",
  "order.payment_status_changed": "Estado de pago actualizado",
  "order.planning_updated": "Planificación de pedido actualizada",
  "order.status_changed": "Estado de pedido actualizado",
  "order.substitution_proposed": "Sustitución de producto propuesta",
  "physical_count.completed": "Conteo físico completado",
  "product.created": "Producto creado",
  "product.price_updated": "Precio de producto actualizado",
  "product.updated": "Producto actualizado",
  "product_presentation.created": "Presentación de producto creada",
  "product_presentation.updated": "Presentación de producto actualizada",
  "purchase_order.created": "Orden de compra creada",
  "purchase_order.received": "Orden de compra recibida",
  "role_permission.updated": "Permiso de rol actualizado",
  "sale.confirmed": "Venta confirmada",
  "sale.returned": "Devolución de venta registrada",
  "sale.voided": "Venta anulada",
  "supplier.activated": "Proveedor activado",
  "supplier.created": "Proveedor creado",
  "supplier.deactivated": "Proveedor desactivado",
  "supplier.updated": "Proveedor actualizado",
  "work_shift.scheduled": "Turno de trabajo programado",
};

function formatOperationType(value: string) {
  return operationTypeLabels[value] ?? "Operación pendiente de confirmar";
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("es-PE") : "Sin registro";
}

export default function SyncDiagnosticsScreen() {
  const database = useLocalDatabase();
  const { selectedUser, deviceId } = useLocalOperator();
  const { getAccessToken, state: authState } = useSupabaseAuth();
  const [state, setState] = useState<LocalSyncStateRecord | null>(null);
  const [operations, setOperations] = useState<SyncOutboxRecord[]>([]);
  const { isSyncing, syncNow } = useSync({
    storeId: DEFAULT_STORE_ID,
    deviceId,
    actorUserId: selectedUser?.id ?? "",
    getAccessToken,
  });
  const load = useCallback(async () => {
    if (!selectedUser || !deviceId) return;
    const [nextState, nextOperations] = await Promise.all([
      getLocalSyncState(database, DEFAULT_STORE_ID, deviceId),
      listOutboxForActor(database, DEFAULT_STORE_ID, selectedUser.id),
    ]);
    setState(nextState);
    setOperations(nextOperations);
  }, [database, deviceId, selectedUser]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const run = async () => {
    try {
      const result = await syncNow();
      await load();
      Alert.alert(
        "Sincronización completada",
        `${result.pushed} enviadas · ${result.pulled} recibidas`,
      );
    } catch (caughtError) {
      await load();
      Alert.alert(
        "No se pudo sincronizar",
        getOperatorErrorMessage(caughtError, "Revisa la conexión."),
      );
    }
  };
  const retry = async (id: string) => {
    await retryOutboxOperation(database, id);
    await load();
  };

  const errors = operations.filter((operation) => operation.status === "error");
  const deviceRows: { icon: string; label: string; value: string }[] = [
    {
      icon: "cloud-check-outline",
      label: "Sesión central",
      value: authStateLabels[authState],
    },
    { icon: "clock-outline", label: "Último éxito", value: formatDate(state?.lastSuccessAt) },
    { icon: "upload-outline", label: "Último push", value: formatDate(state?.lastPushAt) },
    { icon: "download-outline", label: "Último pull", value: formatDate(state?.lastPullAt) },
  ];

  return (
    <AdminScreen
      title="Sincronización"
      subtitle="Pendientes, errores y cursor del dispositivo"
      right={
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            busy: isSyncing,
            disabled: isSyncing || authState !== "authenticated",
          }}
          disabled={isSyncing || authState !== "authenticated"}
          onPress={() => void run()}
          style={[
            styles.sync,
            (isSyncing || authState !== "authenticated") && styles.disabled,
          ]}
        >
          <MaterialCommunityIcons
            name="sync"
            size={20}
            color={BrandColors.white}
          />
          <Text style={styles.syncText}>
            {isSyncing ? "Enviando…" : "Sincronizar"}
          </Text>
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
              Activa tu perfil con PIN en la pestaña Más para sincronizar.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.metrics}>
        <Metric label="Pendientes" value={String(operations.length)} />
        <Metric
          label="Errores"
          value={String(errors.length)}
          danger={errors.length > 0}
        />
        <Metric label="Cursor" value={String(state?.lastPullCursor ?? 0)} />
      </View>

      <View style={[sharedStyles.card, styles.card, styles.rowShadow]}>
        <Text style={styles.title}>Estado del dispositivo</Text>
        {deviceRows.map((row) => (
          <View key={row.label} style={styles.summaryRow}>
            <MaterialCommunityIcons
              name={row.icon as keyof typeof MaterialCommunityIcons.glyphMap}
              size={16}
              color={BrandColors.muted}
            />
            <Text style={styles.summaryLabel}>{row.label}</Text>
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={styles.summaryValue}
            >
              {row.value}
            </Text>
          </View>
        ))}
        {state?.lastError ? (
          <Text
            accessibilityLiveRegion="assertive"
            accessibilityRole="alert"
            style={styles.error}
          >
            {state.lastError}
          </Text>
        ) : null}
      </View>

      {operations.length ? (
        <View style={[sharedStyles.card, styles.warning]}>
          <MaterialCommunityIcons
            name="alert-outline"
            size={22}
            color={BrandColors.warning}
          />
          <Text style={styles.warningText}>
            No cierres sesión, borres datos ni desinstales la app hasta
            sincronizar estas operaciones.
          </Text>
        </View>
      ) : null}

      <SectionTitle
        action={
          <Pill
            label={`${operations.length}`}
            tone={errors.length ? "danger" : "neutral"}
          />
        }
      >
        Cola local
      </SectionTitle>
      {operations.length ? (
        <View style={styles.list}>
          {operations.map((operation) => (
            <View
              key={operation.id}
              style={[sharedStyles.card, styles.operation, styles.rowShadow]}
            >
              <View style={styles.operationTop}>
                <View style={styles.fill}>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    style={styles.title}
                  >
                    {formatOperationType(operation.operationType)}
                  </Text>
                  <Text style={styles.meta}>
                    {new Date(operation.createdAt).toLocaleString("es-PE")} ·
                    intento {operation.attempts}
                  </Text>
                </View>
                <Pill
                  label={syncStatusLabels[operation.status]}
                  tone={operation.status === "error" ? "danger" : "neutral"}
                />
              </View>
              {operation.lastError ? (
                <Text
                  accessibilityLiveRegion="assertive"
                  accessibilityRole="alert"
                  style={styles.error}
                >
                  {operation.lastError}
                </Text>
              ) : null}
              {operation.status === "error" ? (
                <Pressable
                  accessibilityLabel={`Reintentar ${operation.operationType}`}
                  accessibilityRole="button"
                  onPress={() => void retry(operation.id)}
                  style={({ pressed }) => [
                    styles.retry,
                    pressed && styles.pressed,
                  ]}
                >
                  <MaterialCommunityIcons
                    name="refresh"
                    size={17}
                    color={BrandColors.danger}
                  />
                  <Text style={styles.retryText}>Marcar para reintento</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <View style={[sharedStyles.card, styles.empty, styles.rowShadow]}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons
              name="check-circle-outline"
              size={28}
              color={BrandColors.green}
            />
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.title}>
            No hay operaciones pendientes
          </Text>
          <Text style={styles.meta}>Todo quedó confirmado en la base central.</Text>
        </View>
      )}
    </AdminScreen>
  );
}

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Text
        maxFontSizeMultiplier={1.4}
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[styles.metricValue, danger && styles.error]}
      >
        {value}
      </Text>
      <Text style={styles.meta}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sync: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  syncText: { color: BrandColors.white, ...Typography.label },
  disabled: { opacity: Interaction.disabledOpacity },
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
  metrics: { flexDirection: "row", gap: Spacing.xs },
  metric: {
    flex: 1,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.sm,
    ...Elevation.ambientCard,
  },
  metricValue: { color: BrandColors.text, ...Typography.h3 },
  card: { gap: Spacing.xs },
  rowShadow: { ...Elevation.ambientCard },
  title: { color: BrandColors.text, ...Typography.label },
  meta: { color: BrandColors.muted, ...Typography.caption },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  summaryLabel: {
    color: BrandColors.muted,
    ...Typography.caption,
    flexShrink: 0,
  },
  summaryValue: {
    flex: 1,
    color: BrandColors.text,
    ...Typography.caption,
    textAlign: "right",
  },
  error: { color: BrandColors.danger, ...Typography.caption },
  warning: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderColor: BrandColors.warning,
    backgroundColor: BrandColors.goldLight,
  },
  warningText: {
    flex: 1,
    color: BrandColors.warning,
    ...Typography.caption,
    fontWeight: "700",
  },
  list: { gap: Spacing.sm },
  operation: { gap: Spacing.xs },
  operationTop: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  fill: { flex: 1 },
  retry: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.dangerLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  retryText: { color: BrandColors.danger, ...Typography.label },
  empty: { alignItems: "center", gap: Spacing.xs, paddingVertical: Spacing.xl },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
