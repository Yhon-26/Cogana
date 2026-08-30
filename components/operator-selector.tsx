import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";

import { ActionButton, sharedStyles } from "@/components/admin-ui";
import { getSupabaseAuthErrorMessage } from "@/auth/customer-auth-error";
import { ModalSurface } from "@/components/modal-surface";
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
import { useSupabaseAuth } from "@/context/supabase-auth-context";
import { isValidNewPinFormat, isValidPinFormat } from "@/database/pin";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";

export function OperatorSelector() {
  const {
    users,
    selectedUser,
    requestSelectUser,
    pendingUser,
    cancelPending,
    verifyPendingPin,
    createPendingPin,
    isLoading,
    isUnlocking,
    error,
    unlockError,
    reload,
  } = useLocalOperator();
  const {
    state: authState,
    message: authMessage,
    isConfigured,
    linkOperator,
    provisionFirstOperator,
  } = useSupabaseAuth();
  const [pinInput, setPinInput] = useState("");
  const [linkVisible, setLinkVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [provisionEmail, setProvisionEmail] = useState("");
  const [provisionPassword, setProvisionPassword] = useState("");
  const [provisionPin, setProvisionPin] = useState("");
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  if (isLoading) {
    return <Text style={styles.feedback}>Cargando perfiles del equipo…</Text>;
  }
  if (error) {
    return (
      <Text accessibilityRole="alert" style={styles.error}>
        {getOperatorErrorMessage(
          error,
          "No se pudieron cargar los perfiles. Intenta nuevamente.",
        )}
      </Text>
    );
  }

  const handleProvision = async () => {
    if (isProvisioning) return;
    setIsProvisioning(true);
    setProvisionError(null);
    try {
      await provisionFirstOperator({
        storeId: DEFAULT_STORE_ID,
        email: provisionEmail,
        password: provisionPassword,
        pin: provisionPin,
      });
      await reload();
      setProvisionEmail("");
      setProvisionPassword("");
      setProvisionPin("");
    } catch (caughtError) {
      setProvisionError(getSupabaseAuthErrorMessage(caughtError));
    } finally {
      setIsProvisioning(false);
    }
  };

  if (users.length === 0) {
    const canProvision =
      isConfigured &&
      Boolean(provisionEmail.trim()) &&
      Boolean(provisionPassword) &&
      isValidNewPinFormat(provisionPin);
    return (
      <View style={[styles.container, styles.provisioningCard]}>
        <View style={styles.dialogHeader}>
          <MaterialCommunityIcons
            name="shield-account-outline"
            size={26}
            color={BrandColors.greenDark}
          />
          <Text style={styles.dialogTitle}>Aprovisionar dispositivo</Text>
        </View>
        <Text style={styles.dialogHint}>
          Inicia sesión con una cuenta owner o administradora activa de
          Supabase. El primer perfil del dispositivo se creará desde esa
          membresía.
        </Text>
        {!isConfigured ? (
          <Text accessibilityRole="alert" style={styles.dialogError}>
            Configura primero la URL y la clave pública de Supabase.
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel="Correo del administrador"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setProvisionEmail}
          placeholder="administrador@coguana.pe"
          placeholderTextColor={BrandColors.muted}
          style={styles.authInput}
          value={provisionEmail}
        />
        <TextInput
          accessibilityLabel="Contraseña del administrador"
          autoCapitalize="none"
          autoComplete="current-password"
          onChangeText={setProvisionPassword}
          placeholder="Contraseña Supabase"
          placeholderTextColor={BrandColors.muted}
          secureTextEntry
          style={styles.authInput}
          value={provisionPassword}
        />
        <TextInput
          accessibilityLabel="Nuevo PIN del administrador"
          keyboardType="numeric"
          maxLength={8}
          onChangeText={setProvisionPin}
          placeholder="PIN de 6 a 8 dígitos"
          placeholderTextColor={BrandColors.muted}
          secureTextEntry
          style={styles.authInput}
          value={provisionPin}
        />
        {provisionError ? (
          <Text accessibilityRole="alert" style={styles.dialogError}>
            {provisionError}
          </Text>
        ) : null}
        <ActionButton
          disabled={!canProvision || isProvisioning}
          label={
            isProvisioning ? "Verificando…" : "Aprovisionar de forma segura"
          }
          loading={isProvisioning}
          onPress={() => void handleProvision()}
        />
      </View>
    );
  }

  const closeDialog = () => {
    setPinInput("");
    cancelPending();
  };

  const handleSubmit = async () => {
    const pin = pinInput.trim();
    const valid = pendingUser?.hasPin
      ? isValidPinFormat(pin)
      : isValidNewPinFormat(pin);
    if (!valid) return;
    const ok = pendingUser?.hasPin
      ? await verifyPendingPin(pin)
      : await createPendingPin(pin);
    if (ok) {
      setPinInput("");
      Keyboard.dismiss();
    }
  };

  const requiresCreate = Boolean(pendingUser && !pendingUser.hasPin);
  const authLabels = {
    unconfigured: "Supabase no configurado",
    local_only: "Cuenta central pendiente",
    connecting: "Conectando con Supabase…",
    authenticated: "Sesión Supabase activa",
    offline: "Sin conexión · reconecta para continuar",
    error: "Vínculo Supabase requiere atención",
  } as const;

  const closeLinkDialog = () => {
    if (isLinking) return;
    setLinkVisible(false);
    setEmail("");
    setPassword("");
    setLinkError(null);
  };

  const handleLink = async () => {
    if (!selectedUser || isLinking) return;
    setIsLinking(true);
    setLinkError(null);
    try {
      await linkOperator(selectedUser, { email, password });
      await reload();
      setLinkVisible(false);
      setEmail("");
      setPassword("");
    } catch (caughtError) {
      setLinkError(getSupabaseAuthErrorMessage(caughtError));
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.usersRow}>
        {users.map((user) => {
          const selected = user.id === selectedUser?.id;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={user.id}
              onPress={() => requestSelectUser(user.id)}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.optionTop}>
                <Text style={[styles.name, selected && styles.nameSelected]}>
                  {user.displayName}
                </Text>
                {selected ? (
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={18}
                    color={BrandColors.greenDark}
                  />
                ) : null}
              </View>
              <Text style={[styles.role, selected && styles.roleSelected]}>
                {user.role === "administrator" ? "Administrador" : "Vendedor"}
              </Text>
              <Text
                style={[styles.pinState, selected && styles.pinStateSelected]}
              >
                {user.hasPin ? "PIN configurado" : "Sin PIN · primer acceso"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.notice}>
        {selectedUser
          ? "Operador activo. Cambia de usuario para continuar."
          : "Selecciona un operador e ingresa su PIN para operar."}
      </Text>
      <View
        accessibilityLiveRegion={authState === "error" ? "assertive" : "polite"}
        style={styles.authRow}
      >
        <MaterialCommunityIcons
          name={
            authState === "authenticated"
              ? "cloud-check-outline"
              : "cloud-off-outline"
          }
          size={16}
          color={
            authState === "authenticated"
              ? BrandColors.green
              : BrandColors.warning
          }
        />
        <View style={styles.authCopy}>
          <Text style={styles.authState}>{authLabels[authState]}</Text>
          {authMessage ? (
            <Text style={styles.authMessage}>{authMessage}</Text>
          ) : null}
        </View>
        {selectedUser && isConfigured && authState !== "authenticated" ? (
          <ActionButton
            compact
            label={selectedUser.authUserId ? "Renovar" : "Vincular"}
            onPress={() => {
              setLinkError(null);
              setLinkVisible(true);
            }}
          />
        ) : null}
      </View>

      <ModalSurface
        dialogStyle={styles.dialog}
        dismissOnBackdrop={!isUnlocking}
        onClose={() => {
          if (!isUnlocking) closeDialog();
        }}
        visible={Boolean(pendingUser)}
      >
        <View style={styles.dialogHeader}>
          <MaterialCommunityIcons
            name={requiresCreate ? "shield-key-outline" : "lock-outline"}
            size={26}
            color={BrandColors.greenDark}
          />
          <Text style={styles.dialogTitle}>
            {requiresCreate ? "Crea tu PIN" : "Ingresa tu PIN"}
          </Text>
        </View>
        <Text style={styles.dialogSubtitle}>
          {pendingUser?.displayName} ·{" "}
          {pendingUser?.role === "administrator" ? "Administrador" : "Vendedor"}
        </Text>
        <Text style={styles.dialogHint}>
          {requiresCreate
            ? "Define un PIN de 6 a 8 dígitos. Se usará para identificarte en este dispositivo."
            : "Ingresa el PIN configurado en este dispositivo."}
        </Text>
        <View style={styles.modalField}>
          <Text style={styles.fieldLabel}>PIN del operador</Text>
          <TextInput
            autoFocus
            accessibilityLabel="PIN del operador"
            keyboardType="numeric"
            maxLength={8}
            onChangeText={setPinInput}
            placeholder="••••"
            placeholderTextColor={BrandColors.muted}
            secureTextEntry
            style={styles.pinInput}
            value={pinInput}
          />
        </View>
        {unlockError ? (
          <Text accessibilityRole="alert" style={styles.dialogError}>
            {getOperatorErrorMessage(
              unlockError,
              "No se pudo validar el PIN. Intenta nuevamente.",
            )}
          </Text>
        ) : null}
        <View style={styles.dialogActions}>
          <ActionButton
            compact
            disabled={isUnlocking}
            label="Cancelar"
            onPress={closeDialog}
            style={styles.dialogButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={
              !(requiresCreate
                ? isValidNewPinFormat(pinInput.trim())
                : isValidPinFormat(pinInput.trim())) || isUnlocking
            }
            label={
              isUnlocking
                ? "Verificando…"
                : requiresCreate
                  ? "Crear PIN"
                  : "Desbloquear"
            }
            loading={isUnlocking}
            onPress={() => void handleSubmit()}
            style={styles.dialogButton}
          />
        </View>
      </ModalSurface>

      <ModalSurface
        dialogStyle={styles.dialog}
        dismissOnBackdrop={!isLinking}
        onClose={() => {
          if (!isLinking) closeLinkDialog();
        }}
        visible={linkVisible}
      >
        <View style={styles.dialogHeader}>
          <MaterialCommunityIcons
            name="account-key-outline"
            size={26}
            color={BrandColors.greenDark}
          />
          <Text style={styles.dialogTitle}>Vincular Supabase</Text>
        </View>
        <Text style={styles.dialogSubtitle}>{selectedUser?.displayName}</Text>
        <Text style={styles.dialogHint}>
          Usa la cuenta individual asignada a este operador. La contraseña no se
          guarda; solo el token renovable se conserva en SecureStore.
        </Text>
        <View style={styles.modalField}>
          <Text style={styles.fieldLabel}>Correo del operador</Text>
          <TextInput
            accessibilityLabel="Correo del operador"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="operador@coguana.pe"
            placeholderTextColor={BrandColors.muted}
            style={styles.authInput}
            value={email}
          />
        </View>
        <View style={styles.modalField}>
          <Text style={styles.fieldLabel}>Contraseña</Text>
          <TextInput
            accessibilityLabel="Contraseña del operador"
            autoCapitalize="none"
            autoComplete="current-password"
            onChangeText={setPassword}
            placeholder="Contraseña Supabase"
            placeholderTextColor={BrandColors.muted}
            secureTextEntry
            style={styles.authInput}
            value={password}
          />
        </View>
        {linkError ? (
          <Text accessibilityRole="alert" style={styles.dialogError}>
            {linkError}
          </Text>
        ) : null}
        <View style={styles.dialogActions}>
          <ActionButton
            compact
            disabled={isLinking}
            label="Cancelar"
            onPress={closeLinkDialog}
            style={styles.dialogButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={!email.trim() || !password || isLinking}
            label={isLinking ? "Vinculando…" : "Vincular cuenta"}
            loading={isLinking}
            onPress={() => void handleLink()}
            style={styles.dialogButton}
          />
        </View>
      </ModalSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.xs },
  provisioningCard: {
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  usersRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  option: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    minWidth: 190,
    minHeight: 72,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: ComponentMetrics.inputRadius,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  optionSelected: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
  },
  optionTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  name: { color: BrandColors.text, ...Typography.label },
  nameSelected: { color: BrandColors.greenDark },
  role: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  roleSelected: { color: BrandColors.greenDark },
  pinState: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  pinStateSelected: { color: BrandColors.muted },
  notice: { color: BrandColors.muted, ...Typography.caption },
  authRow: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.surfaceMuted,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  authCopy: { flex: 1 },
  authState: {
    color: BrandColors.text,
    ...Typography.caption,
    fontWeight: "700",
  },
  authMessage: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  feedback: { color: BrandColors.muted, ...Typography.body },
  error: { color: BrandColors.danger, ...Typography.body },
  dialog: {
    backgroundColor: BrandColors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  dialogHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  dialogTitle: { color: BrandColors.text, ...Typography.h3 },
  dialogSubtitle: { color: BrandColors.greenDark, ...Typography.label },
  dialogHint: { color: BrandColors.muted, ...Typography.body },
  modalField: { gap: Spacing.xxs },
  fieldLabel: { color: BrandColors.text, ...Typography.label },
  pinInput: {
    minHeight: ControlSize.large,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    ...Typography.h2,
    letterSpacing: Spacing.xs,
    paddingHorizontal: Spacing.md,
    textAlign: "center",
  },
  authInput: { ...sharedStyles.input },
  dialogError: { ...sharedStyles.errorText },
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
