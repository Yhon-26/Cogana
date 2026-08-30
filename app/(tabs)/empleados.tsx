import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
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
import { createId } from "@/database/ids";
import type { LocalUserRecord, LocalUserRole } from "@/database/models";
import { hashPin, isValidNewPinFormat } from "@/database/pin";
import {
  createLocalUser,
  listLocalUsers,
  updateLocalUser,
} from "@/database/repositories/local-user-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { useLocalDatabase } from "@/hooks/use-local-database";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";

const roleLabels: Record<LocalUserRole, string> = {
  administrator: "Administrador",
  seller: "Vendedor",
};

export default function EmployeesScreen() {
  const database = useLocalDatabase();
  const { selectedUser, reload } = useLocalOperator();
  const [users, setUsers] = useState<LocalUserRecord[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState<LocalUserRole>("seller");
  const [pin, setPin] = useState("");
  const load = useCallback(async () => {
    setUsers(await listLocalUsers(database, DEFAULT_STORE_ID));
  }, [database]);
  useFocusEffect(useCallback(() => void load(), [load]));
  const create = async () => {
    if (!selectedUser) return;
    try {
      if (!isValidNewPinFormat(pin))
        throw new Error("El PIN debe tener 6 a 8 dígitos.");
      await createLocalUser(database, {
        id: createId(),
        storeId: DEFAULT_STORE_ID,
        displayName: name,
        role,
        credentials: await hashPin(pin),
        actorUserId: selectedUser.id,
      });
      setName("");
      setPin("");
      await Promise.all([load(), reload()]);
    } catch (caughtError) {
      Alert.alert(
        "No se pudo crear",
        getOperatorErrorMessage(
          caughtError,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    }
  };
  const toggle = async (user: LocalUserRecord) => {
    if (!selectedUser) return;
    try {
      await updateLocalUser(database, {
        storeId: DEFAULT_STORE_ID,
        userId: user.id,
        displayName: user.displayName,
        role: user.role,
        isActive: !user.isActive,
        actorUserId: selectedUser.id,
      });
      await Promise.all([load(), reload()]);
    } catch (caughtError) {
      Alert.alert(
        "No se pudo actualizar",
        getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
      );
    }
  };
  return (
    <AdminScreen
      title="Empleados"
      subtitle="Perfiles del equipo, roles y acceso PIN"
    >
      <OperatorSelector />
      <SectionTitle action={<Pill label={`${users.length}`} tone="neutral" />}>
        Personal
      </SectionTitle>
      {users.map((user) => (
        <View key={user.id} style={[sharedStyles.card, styles.row]}>
          <View style={styles.fill}>
            <Text style={styles.title}>{user.displayName}</Text>
            <Text style={styles.meta}>
              {roleLabels[user.role]} ·{" "}
              {user.authUserId
                ? "Cuenta central vinculada"
                : "Vinculación pendiente"}
            </Text>
          </View>
          <Pressable
            accessibilityLabel={`${user.displayName}: ${user.isActive ? "activo" : "inactivo"}`}
            accessibilityRole="switch"
            accessibilityState={{ checked: user.isActive }}
            onPress={() => void toggle(user)}
            style={styles.statusControl}
          >
            <Pill
              label={user.isActive ? "Activo" : "Inactivo"}
              tone={user.isActive ? "green" : "neutral"}
            />
          </Pressable>
        </View>
      ))}
      {selectedUser?.role === "administrator" ? (
        <>
          <SectionTitle>Alta de empleado</SectionTitle>
          <View style={[sharedStyles.card, styles.form]}>
            <TextInput
              accessibilityLabel="Nombre completo"
              placeholder="Nombre completo"
              placeholderTextColor={BrandColors.muted}
              style={styles.input}
              value={name}
              onChangeText={setName}
            />
            <View style={styles.choices}>
              {(["seller", "administrator"] as const).map((value) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: role === value }}
                  key={value}
                  onPress={() => setRole(value)}
                  style={[styles.choice, role === value && styles.choiceActive]}
                >
                  <Text style={styles.choiceText}>
                    {value === "seller"
                      ? "Vendedor / reparto"
                      : "Administrador"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              accessibilityLabel="PIN del nuevo empleado"
              secureTextEntry
              keyboardType="number-pad"
              maxLength={8}
              placeholder="PIN de 6 a 8 dígitos"
              placeholderTextColor={BrandColors.muted}
              style={styles.input}
              value={pin}
              onChangeText={setPin}
            />
            <Text style={styles.help}>
              Para sincronizar, el empleado deberá vincular después su cuenta
              individual de Supabase.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: !name.trim() || !isValidNewPinFormat(pin),
              }}
              disabled={!name.trim() || !isValidNewPinFormat(pin)}
              onPress={() => void create()}
              style={[
                styles.primary,
                (!name.trim() || !isValidNewPinFormat(pin)) && styles.disabled,
              ]}
            >
              <Text style={styles.primaryText}>Crear empleado</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </AdminScreen>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  fill: { flex: 1 },
  title: { color: BrandColors.text, ...Typography.label },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  statusControl: { minHeight: ControlSize.default, justifyContent: "center" },
  form: { gap: Spacing.sm },
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
  choices: { flexDirection: "row", gap: Spacing.xs },
  choice: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xs,
  },
  choiceActive: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
  },
  choiceText: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
  },
  help: { color: BrandColors.muted, ...Typography.caption },
  primary: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  primaryText: { color: BrandColors.white, ...Typography.label },
  disabled: { opacity: Interaction.disabledOpacity },
});
