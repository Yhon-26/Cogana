import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  ActionButton,
  AdminScreen,
  Pill,
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

function initialsOf(name: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("");
  return letters ? letters.toUpperCase() : "?";
}

export default function EmployeesScreen() {
  const database = useLocalDatabase();
  const { selectedUser, reload } = useLocalOperator();
  const [users, setUsers] = useState<LocalUserRecord[]>([]);
  const [formVisible, setFormVisible] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<LocalUserRole>("seller");
  const [pin, setPin] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const canManage = selectedUser?.role === "administrator";

  const load = useCallback(async () => {
    setUsers(await listLocalUsers(database, DEFAULT_STORE_ID));
  }, [database]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const create = async () => {
    if (!selectedUser || isSaving) return;
    setIsSaving(true);
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
      setFormVisible(false);
      await Promise.all([load(), reload()]);
      Alert.alert(
        "Empleado creado",
        "Ya puede identificarse en este dispositivo con su PIN.",
      );
    } catch (caughtError) {
      Alert.alert(
        "No se pudo crear",
        getOperatorErrorMessage(
          caughtError,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const toggle = async (user: LocalUserRecord) => {
    if (!selectedUser || isSaving) return;
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
      right={
        canManage ? (
          <Pressable
            accessibilityLabel="Nuevo empleado"
            accessibilityRole="button"
            style={styles.addHeader}
            onPress={() => {
              setName("");
              setRole("seller");
              setPin("");
              setFormVisible(true);
            }}
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
              Activa tu perfil con PIN en la pestaña Más para gestionar
              empleados.
            </Text>
          </View>
        </View>
      ) : null}

      <SectionTitle action={<Pill label={`${users.length}`} tone="neutral" />}>
        Personal
      </SectionTitle>
      <View style={styles.list}>
        {users.map((user) => (
          <View
            key={user.id}
            style={[sharedStyles.card, styles.row, styles.rowShadow]}
          >
            <View style={styles.avatar}>
              <Text maxFontSizeMultiplier={1.2} style={styles.avatarText}>
                {initialsOf(user.displayName)}
              </Text>
            </View>
            <View style={styles.fill}>
              <Text
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                style={styles.title}
              >
                {user.displayName}
              </Text>
              <Text style={styles.meta}>
                {roleLabels[user.role]} ·{" "}
                {user.authUserId
                  ? "Cuenta central vinculada"
                  : "Vinculación pendiente"}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={`${user.displayName}: ${user.isActive ? "activo, tocar para desactivar" : "inactivo, tocar para activar"}`}
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
      </View>

      {canManage && !users.length ? (
        <View style={[sharedStyles.card, styles.sectionEmpty]}>
          <MaterialCommunityIcons
            name="account-plus-outline"
            size={24}
            color={BrandColors.muted}
          />
          <Text style={styles.help}>
            Crea los perfiles de tu equipo; cada uno se desbloquea con su PIN en
            este dispositivo.
          </Text>
        </View>
      ) : null}

      <ModalSurface
        dialogStyle={styles.dialog}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setFormVisible(false);
        }}
        visible={formVisible}
      >
        <View style={styles.dialogHeader}>
          <MaterialCommunityIcons
            name="account-plus-outline"
            size={24}
            color={BrandColors.greenDark}
          />
          <Text maxFontSizeMultiplier={1.3} style={styles.dialogTitle}>
            Alta de empleado
          </Text>
        </View>
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
                {value === "seller" ? "Vendedor / reparto" : "Administrador"}
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
        <View style={styles.dialogActions}>
          <ActionButton
            compact
            disabled={isSaving}
            label="Cancelar"
            onPress={() => setFormVisible(false)}
            style={styles.dialogButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={!name.trim() || !isValidNewPinFormat(pin) || isSaving}
            label="Crear empleado"
            loading={isSaving}
            onPress={() => void create()}
            style={styles.dialogButton}
          />
        </View>
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
  list: { gap: Spacing.sm },
  rowShadow: { ...Elevation.ambientCard },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 64,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: BrandColors.greenDark,
    ...Typography.label,
    fontWeight: "700",
  },
  fill: { flex: 1 },
  title: { color: BrandColors.text, ...Typography.label },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  statusControl: { minHeight: ControlSize.default, justifyContent: "center" },
  sectionEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  help: { color: BrandColors.muted, ...Typography.caption },
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
  dialog: {
    backgroundColor: BrandColors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  dialogHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  dialogTitle: { color: BrandColors.text, ...Typography.h3, flex: 1 },
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
