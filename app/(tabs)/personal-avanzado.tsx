import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

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
import {
  checkAttendance,
  listAttendance,
  listRolePermissions,
  listWorkShifts,
  scheduleWorkShift,
  setRolePermission,
  type AttendanceEntry,
  type RolePermission,
  type WorkShift,
} from "@/database/repositories/personnel-operations-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { useLocalDatabase } from "@/hooks/use-local-database";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";
import { formatDateShort } from "@/lib/format";

const modules = [
  "venta",
  "inventario",
  "pedidos",
  "compras",
  "repartos",
  "reportes",
  "configuracion",
] as const;
const moduleLabels: Record<(typeof modules)[number], string> = {
  venta: "Venta",
  inventario: "Inventario",
  pedidos: "Pedidos",
  compras: "Compras",
  repartos: "Repartos",
  reportes: "Reportes",
  configuracion: "Configuración",
};
const shiftStatusLabels: Record<WorkShift["status"], string> = {
  scheduled: "Programado",
  completed: "Completado",
  cancelled: "Cancelado",
};

export default function AdvancedPersonnelScreen() {
  const database = useLocalDatabase();
  const { users, selectedUser, deviceId } = useLocalOperator();
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [shifts, setShifts] = useState<WorkShift[]>([]);
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [shiftVisible, setShiftVisible] = useState(false);
  const [userId, setUserId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const canManage = selectedUser?.role === "administrator";

  const load = useCallback(async () => {
    const [nextPermissions, nextShifts, nextAttendance] = await Promise.all([
      listRolePermissions(database, DEFAULT_STORE_ID),
      listWorkShifts(database, DEFAULT_STORE_ID),
      listAttendance(database, DEFAULT_STORE_ID),
    ]);
    setPermissions(nextPermissions);
    setShifts(nextShifts);
    setAttendance(nextAttendance);
  }, [database]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const permissionFor = (module: string) =>
    permissions.find(
      (permission) =>
        permission.role === "seller" && permission.module === module,
    );

  const togglePermission = async (module: string, field: "view" | "manage") => {
    if (!selectedUser) return;
    const current = permissionFor(module);
    const nextView = field === "view" ? !(current?.canView ?? true) : true;
    const nextManage =
      field === "manage"
        ? !(current?.canManage ?? false)
        : nextView
          ? (current?.canManage ?? false)
          : false;
    try {
      await setRolePermission(database, {
        storeId: DEFAULT_STORE_ID,
        role: "seller",
        module,
        canView: nextView,
        canManage: nextManage,
        actorUserId: selectedUser.id,
        deviceId,
      });
      await load();
    } catch (error) {
      Alert.alert(
        "No se pudo guardar",
        getOperatorErrorMessage(error, "Intenta nuevamente."),
      );
    }
  };

  const schedule = async () => {
    if (!selectedUser || isSaving) return;
    setIsSaving(true);
    try {
      await scheduleWorkShift(database, {
        storeId: DEFAULT_STORE_ID,
        userId,
        startsAt,
        endsAt,
        notes,
        actorUserId: selectedUser.id,
        deviceId,
      });
      setStartsAt("");
      setEndsAt("");
      setNotes("");
      setShiftVisible(false);
      await load();
      Alert.alert("Turno programado", "Quedó registrado para el empleado.");
    } catch (error) {
      Alert.alert(
        "No se pudo programar",
        getOperatorErrorMessage(
          error,
          "Revisa las fechas e intenta nuevamente.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const clock = async (action: "in" | "out") => {
    if (!selectedUser || isSaving) return;
    const targetUserId =
      selectedUser.role === "administrator" && userId
        ? userId
        : selectedUser.id;
    setIsSaving(true);
    try {
      await checkAttendance(database, {
        storeId: DEFAULT_STORE_ID,
        userId: targetUserId,
        action,
        notes,
        actorUserId: selectedUser.id,
        deviceId,
      });
      setNotes("");
      await load();
    } catch (error) {
      Alert.alert(
        "No se pudo registrar",
        getOperatorErrorMessage(error, "Intenta nuevamente."),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminScreen
      title="Personal avanzado"
      subtitle="Permisos, turnos y asistencia"
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
              Activa tu perfil con PIN en la pestaña Más para registrar tu
              asistencia.
            </Text>
          </View>
        </View>
      ) : null}

      {canManage ? (
        <>
          <SectionTitle>Permisos del rol vendedor</SectionTitle>
          <View style={[sharedStyles.card, styles.card, styles.rowShadow]}>
            {modules.map((module) => {
              const permission = permissionFor(module);
              const canView = permission?.canView ?? true;
              const canManageModule = permission?.canManage ?? false;
              return (
                <View key={module} style={styles.permissionRow}>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    style={[styles.title, styles.fill]}
                  >
                    {moduleLabels[module]}
                  </Text>
                  <Toggle
                    label="Ver"
                    active={canView}
                    onPress={() => void togglePermission(module, "view")}
                  />
                  <Toggle
                    label="Gestionar"
                    active={canManageModule}
                    onPress={() => void togglePermission(module, "manage")}
                  />
                </View>
              );
            })}
            <Text style={styles.meta}>
              Los permisos personalizados pueden restringir módulos; las
              acciones sensibles conservan además la validación de administrador
              en repositorios y RLS.
            </Text>
          </View>

          <View style={[sharedStyles.card, styles.operatorNotice, styles.rowShadow]}>
            <MaterialCommunityIcons
              name="calendar-clock"
              size={22}
              color={BrandColors.green}
            />
            <View style={styles.operatorNoticeCopy}>
              <Text style={styles.operatorNoticeTitle}>Turnos programados</Text>
              <Text style={styles.operatorNoticeText}>
                Define horarios de trabajo por empleado.
              </Text>
            </View>
            <ActionButton
              compact
              label="Programar"
              icon="plus"
              onPress={() => {
                setUserId("");
                setStartsAt("");
                setEndsAt("");
                setNotes("");
                setShiftVisible(true);
              }}
            />
          </View>
        </>
      ) : null}

      <SectionTitle>Marcar asistencia</SectionTitle>
      <View style={[sharedStyles.card, styles.card, styles.rowShadow]}>
        {canManage ? (
          <View style={styles.chips}>
            {users.map((user) => (
              <Toggle
                key={user.id}
                label={user.displayName}
                active={userId === user.id}
                onPress={() => setUserId(user.id)}
              />
            ))}
          </View>
        ) : null}
        <View style={styles.actions}>
          <PrimaryButton
            icon="login"
            label="Entrada"
            loading={isSaving}
            onPress={() => void clock("in")}
            style={styles.fill}
          />
          <PrimaryButton
            icon="logout"
            label="Salida"
            loading={isSaving}
            onPress={() => void clock("out")}
            style={styles.fill}
          />
        </View>
      </View>

      <SectionTitle action={<Pill label={`${shifts.length}`} tone="neutral" />}>
        Turnos
      </SectionTitle>
      {shifts.length ? (
        <View style={styles.list}>
          {shifts.map((shift) => (
            <View
              key={shift.id}
              style={[sharedStyles.card, styles.row, styles.rowShadow]}
            >
              <View style={styles.rowIcon}>
                <MaterialCommunityIcons
                  name="clock-outline"
                  size={20}
                  color={BrandColors.green}
                />
              </View>
              <View style={styles.fill}>
                <Text
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                  style={styles.title}
                >
                  {shift.userName}
                </Text>
                <Text numberOfLines={1} style={styles.meta}>
                  {formatDateShort(new Date(shift.startsAt))}{" "}
                  →{" "}
                  {formatDateShort(new Date(shift.endsAt))}
                </Text>
              </View>
              <Pill
                label={shiftStatusLabels[shift.status]}
                tone={
                  shift.status === "completed"
                    ? "green"
                    : shift.status === "cancelled"
                      ? "danger"
                      : "gold"
                }
              />
            </View>
          ))}
        </View>
      ) : (
        <View style={[sharedStyles.card, styles.sectionEmpty, styles.rowShadow]}>
          <MaterialCommunityIcons
            name="calendar-blank"
            size={24}
            color={BrandColors.muted}
          />
          <Text style={styles.meta}>Aún no hay turnos programados.</Text>
        </View>
      )}

      <SectionTitle
        action={<Pill label={`${attendance.length}`} tone="neutral" />}
      >
        Asistencia
      </SectionTitle>
      {attendance.length ? (
        <View style={styles.list}>
          {attendance.map((entry) => (
            <View
              key={entry.id}
              style={[sharedStyles.card, styles.row, styles.rowShadow]}
            >
              <View
                style={[
                  styles.rowIcon,
                  !entry.checkedOutAt && styles.rowIconActive,
                ]}
              >
                <MaterialCommunityIcons
                  name={entry.checkedOutAt ? "check" : "account-clock-outline"}
                  size={20}
                  color={
                    entry.checkedOutAt ? BrandColors.muted : BrandColors.green
                  }
                />
              </View>
              <View style={styles.fill}>
                <Text
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                  style={styles.title}
                >
                  {entry.userName}
                </Text>
                <Text numberOfLines={2} style={styles.meta}>
                  Entrada{" "}
                  {formatDateShort(new Date(entry.checkedInAt))}
                  {entry.checkedOutAt
                    ? ` · Salida ${formatDateShort(new Date(entry.checkedOutAt))}`
                    : " · Jornada abierta"}
                </Text>
              </View>
              <Pill
                label={entry.checkedOutAt ? "Completa" : "Activa"}
                tone={entry.checkedOutAt ? "neutral" : "green"}
              />
            </View>
          ))}
        </View>
      ) : (
        <View style={[sharedStyles.card, styles.sectionEmpty, styles.rowShadow]}>
          <MaterialCommunityIcons
            name="account-clock-outline"
            size={24}
            color={BrandColors.muted}
          />
          <Text style={styles.meta}>Aún no hay marcaciones de asistencia.</Text>
        </View>
      )}

      <ModalSurface
        dialogStyle={styles.dialog}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setShiftVisible(false);
        }}
        visible={shiftVisible}
      >
        <View style={styles.dialogHeader}>
          <MaterialCommunityIcons
            name="calendar-clock"
            size={24}
            color={BrandColors.greenDark}
          />
          <Text maxFontSizeMultiplier={1.3} style={styles.dialogTitle}>
            Programar turno
          </Text>
        </View>
        <Text style={styles.fieldLabel}>EMPLEADO</Text>
        <View style={styles.chips}>
          {users.map((user) => (
            <Toggle
              key={user.id}
              label={user.displayName}
              active={userId === user.id}
              onPress={() => setUserId(user.id)}
            />
          ))}
        </View>
        <TextInput
          accessibilityLabel="Inicio del turno"
          placeholder="Inicio ISO, ej. 2026-08-01T09:00:00-05:00"
          placeholderTextColor={BrandColors.muted}
          style={styles.input}
          value={startsAt}
          onChangeText={setStartsAt}
        />
        <TextInput
          accessibilityLabel="Fin del turno"
          placeholder="Fin ISO, ej. 2026-08-01T18:00:00-05:00"
          placeholderTextColor={BrandColors.muted}
          style={styles.input}
          value={endsAt}
          onChangeText={setEndsAt}
        />
        <TextInput
          accessibilityLabel="Notas del turno"
          placeholder="Notas (opcional)"
          placeholderTextColor={BrandColors.muted}
          style={styles.input}
          value={notes}
          onChangeText={setNotes}
        />
        <View style={styles.dialogActions}>
          <ActionButton
            compact
            disabled={isSaving}
            label="Cancelar"
            onPress={() => setShiftVisible(false)}
            style={styles.dialogButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={!userId || !startsAt || !endsAt || isSaving}
            label="Programar"
            loading={isSaving}
            onPress={() => void schedule()}
            style={styles.dialogButton}
          />
        </View>
      </ModalSurface>
    </AdminScreen>
  );
}

function Toggle({
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
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={[styles.toggle, active && styles.toggleActive]}
    >
      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
        {label}
      </Text>
    </Pressable>
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
  card: { gap: Spacing.sm },
  rowShadow: { ...Elevation.ambientCard },
  permissionRow: {
    minHeight: ControlSize.default,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xxs,
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
    gap: Spacing.sm,
    minHeight: 64,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  rowIconActive: { backgroundColor: BrandColors.greenLight },
  fill: { flex: 1 },
  title: {
    color: BrandColors.text,
    ...Typography.label,
    textTransform: "capitalize",
  },
  meta: { color: BrandColors.muted, ...Typography.caption },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  toggle: {
    minHeight: ControlSize.default,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm,
    justifyContent: "center",
  },
  toggleActive: {
    backgroundColor: BrandColors.greenLight,
    borderColor: BrandColors.green,
  },
  toggleText: {
    color: BrandColors.muted,
    ...Typography.caption,
    fontWeight: "700",
  },
  toggleTextActive: { color: BrandColors.greenDark },
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
  actions: { flexDirection: "row", gap: Spacing.xs },
  dialog: {
    backgroundColor: BrandColors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  dialogHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  dialogTitle: { color: BrandColors.text, ...Typography.h3, flex: 1 },
  fieldLabel: {
    color: BrandColors.muted,
    ...Typography.overline,
  },
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
