import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
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
  const [userId, setUserId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [notes, setNotes] = useState("");

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
    if (!selectedUser) return;
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
      await load();
    } catch (error) {
      Alert.alert(
        "No se pudo programar",
        getOperatorErrorMessage(
          error,
          "Revisa las fechas e intenta nuevamente.",
        ),
      );
    }
  };
  const clock = async (action: "in" | "out") => {
    if (!selectedUser) return;
    const targetUserId =
      selectedUser.role === "administrator" && userId
        ? userId
        : selectedUser.id;
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
    }
  };

  return (
    <AdminScreen
      title="Personal avanzado"
      subtitle="Permisos, turnos y asistencia"
    >
      <OperatorSelector />
      {selectedUser?.role === "administrator" ? (
        <>
          <SectionTitle>Permisos del rol vendedor</SectionTitle>
          <View style={[sharedStyles.card, styles.card]}>
            {modules.map((module) => {
              const permission = permissionFor(module);
              const canView = permission?.canView ?? true;
              const canManage = permission?.canManage ?? false;
              return (
                <View key={module} style={styles.row}>
                  <Text style={[styles.title, styles.fill]}>
                    {moduleLabels[module]}
                  </Text>
                  <Toggle
                    label="Ver"
                    active={canView}
                    onPress={() => void togglePermission(module, "view")}
                  />
                  <Toggle
                    label="Gestionar"
                    active={canManage}
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
          <SectionTitle>Programar turno</SectionTitle>
          <View style={[sharedStyles.card, styles.card]}>
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
              placeholder="Notas"
              placeholderTextColor={BrandColors.muted}
              style={styles.input}
              value={notes}
              onChangeText={setNotes}
            />
            <PrimaryButton
              disabled={!userId || !startsAt || !endsAt}
              icon="calendar-clock-outline"
              label="Programar turno"
              onPress={() => void schedule()}
            />
          </View>
        </>
      ) : null}
      <SectionTitle>Marcar asistencia</SectionTitle>
      <View style={[sharedStyles.card, styles.card]}>
        {selectedUser?.role === "administrator" ? (
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
            onPress={() => void clock("in")}
            style={styles.fill}
          />
          <PrimaryButton
            icon="logout"
            label="Salida"
            onPress={() => void clock("out")}
            style={styles.fill}
          />
        </View>
      </View>
      <SectionTitle action={<Pill label={`${shifts.length}`} tone="neutral" />}>
        Turnos
      </SectionTitle>
      {shifts.map((shift) => (
        <View key={shift.id} style={[sharedStyles.card, styles.row]}>
          <View style={styles.fill}>
            <Text style={styles.title}>{shift.userName}</Text>
            <Text style={styles.meta}>
              {new Date(shift.startsAt).toLocaleString("es-PE")} →{" "}
              {new Date(shift.endsAt).toLocaleString("es-PE")}
            </Text>
          </View>
          <Pill label={shiftStatusLabels[shift.status]} tone="neutral" />
        </View>
      ))}
      <SectionTitle
        action={<Pill label={`${attendance.length}`} tone="neutral" />}
      >
        Asistencia
      </SectionTitle>
      {attendance.map((entry) => (
        <View key={entry.id} style={[sharedStyles.card, styles.row]}>
          <View style={styles.fill}>
            <Text style={styles.title}>{entry.userName}</Text>
            <Text style={styles.meta}>
              Entrada {new Date(entry.checkedInAt).toLocaleString("es-PE")} ·{" "}
              {entry.checkedOutAt
                ? `Salida ${new Date(entry.checkedOutAt).toLocaleString("es-PE")}`
                : "Jornada abierta"}
            </Text>
          </View>
          <Pill
            label={entry.checkedOutAt ? "Completa" : "Activa"}
            tone={entry.checkedOutAt ? "neutral" : "green"}
          />
        </View>
      ))}
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
  card: { gap: Spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
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
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.body,
  },
  actions: { flexDirection: "row", gap: Spacing.xs },
});
