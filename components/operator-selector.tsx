import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";

import { ActionButton, sharedStyles } from "@/components/admin-ui";
import { getSupabaseAuthErrorMessage } from "@/auth/customer-auth-error";
import { ModalSurface } from "@/components/modal-surface";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";
import {
  BrandColors,
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

function initialsOf(name: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("");
  return letters ? letters.toUpperCase() : "?";
}

function roleLabelOf(role: "administrator" | "seller") {
  return role === "administrator" ? "Administrador" : "Vendedor";
}

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
  const [pickerVisible, setPickerVisible] = useState(false);
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

  const authLabels = {
    unconfigured: "Supabase no configurado",
    local_only: "Cuenta central pendiente",
    connecting: "Conectando con Supabase…",
    authenticated: "Sesión Supabase activa",
    offline: "Sin conexión · reconecta para continuar",
    error: "Vínculo Supabase requiere atención",
  } as const;

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
      <View style={[styles.card, styles.provisioningCard]}>
        <View style={styles.dialogHeader}>
          <MaterialCommunityIcons
            name="shield-account-outline"
            size={24}
            color={BrandColors.greenDark}
          />
          <Text maxFontSizeMultiplier={1.3} style={styles.dialogTitle}>
            Aprovisionar dispositivo
          </Text>
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
          placeholder="administrador@cogana.pe"
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

  const openPicker = () => {
    setLinkError(null);
    setPickerVisible(true);
  };

  return (
    <>
      <View style={[styles.card, styles.bar]}>
        {selectedUser ? (
          <>
            <View style={styles.avatar}>
              <Text maxFontSizeMultiplier={1.2} style={styles.avatarText}>
                {initialsOf(selectedUser.displayName)}
              </Text>
            </View>
            <View style={styles.barCopy}>
              <Text
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                style={styles.barName}
              >
                {selectedUser.displayName}
              </Text>
              <Text numberOfLines={1} style={styles.barMeta}>
                {roleLabelOf(selectedUser.role)} ·{" "}
                {selectedUser.hasPin ? "PIN configurado" : "Sin PIN"}
              </Text>
            </View>
            <MaterialCommunityIcons
              name={
                authState === "authenticated"
                  ? "cloud-check-outline"
                  : "cloud-off-outline"
              }
              size={17}
              color={
                authState === "authenticated"
                  ? BrandColors.green
                  : BrandColors.warning
              }
            />
            <ActionButton
              compact
              label="Cambiar"
              onPress={openPicker}
              style={styles.barButton}
              tone="ghost"
            />
          </>
        ) : (
          <>
            <View style={styles.avatarMuted}>
              <MaterialCommunityIcons
                name="account-key-outline"
                size={20}
                color={BrandColors.warning}
              />
            </View>
            <View style={styles.barCopy}>
              <Text maxFontSizeMultiplier={1.3} style={styles.barName}>
                Ningún operador activo
              </Text>
              <Text numberOfLines={1} style={styles.barMeta}>
                Identifícate con tu PIN para operar.
              </Text>
            </View>
            <ActionButton
              compact
              label="Identificarme"
              onPress={openPicker}
              style={styles.barButton}
            />
          </>
        )}
      </View>

      <ModalSurface
        dialogStyle={styles.dialog}
        onClose={() => setPickerVisible(false)}
        visible={pickerVisible}
      >
        <View style={styles.dialogHeader}>
          <MaterialCommunityIcons
            name="shield-account-outline"
            size={24}
            color={BrandColors.greenDark}
          />
          <Text maxFontSizeMultiplier={1.3} style={styles.dialogTitle}>
            Operadores del dispositivo
          </Text>
        </View>
        <Text style={styles.dialogHint}>
          Toca tu perfil e ingresa el PIN configurado en este dispositivo.
        </Text>
        <View style={styles.pickerList}>
          {users.map((user, index) => {
            const selected = user.id === selectedUser?.id;
            return (
              <Pressable
                accessibilityLabel={`${user.displayName}, ${roleLabelOf(user.role)}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={user.id}
                onPress={() => {
                  setPickerVisible(false);
                  requestSelectUser(user.id);
                }}
                style={({ pressed }) => [
                  styles.pickerRow,
                  index > 0 && styles.borderTop,
                  pressed && styles.pressed,
                ]}
              >
                <View
                  style={[
                    styles.avatarSmall,
                    selected && styles.avatarSmallActive,
                  ]}
                >
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={[
                      styles.avatarSmallText,
                      selected && styles.avatarSmallTextActive,
                    ]}
                  >
                    {initialsOf(user.displayName)}
                  </Text>
                </View>
                <View style={styles.pickerCopy}>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    style={styles.pickerName}
                  >
                    {user.displayName}
                  </Text>
                  <Text style={styles.pickerMeta}>
                    {roleLabelOf(user.role)} ·{" "}
                    {user.hasPin ? "PIN configurado" : "Sin PIN · primer acceso"}
                  </Text>
                </View>
                {selected ? (
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={19}
                    color={BrandColors.greenDark}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
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
                setPickerVisible(false);
                setLinkError(null);
                setLinkVisible(true);
              }}
            />
          ) : null}
        </View>
      </ModalSurface>

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
            size={24}
            color={BrandColors.greenDark}
          />
          <Text maxFontSizeMultiplier={1.3} style={styles.dialogTitle}>
            {requiresCreate ? "Crea tu PIN" : "Ingresa tu PIN"}
          </Text>
        </View>
        <Text style={styles.dialogSubtitle}>
          {pendingUser?.displayName} ·{" "}
          {pendingUser ? roleLabelOf(pendingUser.role) : ""}
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
            size={24}
            color={BrandColors.greenDark}
          />
          <Text maxFontSizeMultiplier={1.3} style={styles.dialogTitle}>
            Vincular Supabase
          </Text>
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
            placeholder="operador@cogana.pe"
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
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    ...sharedStyles.shadow,
  },
  bar: {
    minHeight: ControlSize.default,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
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
  avatarMuted: {
    width: 40,
    height: 40,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.goldLight,
    alignItems: "center",
    justifyContent: "center",
  },
  barCopy: { flex: 1 },
  barName: { color: BrandColors.text, ...Typography.label },
  barMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  barButton: { flexGrow: 0 },
  provisioningCard: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  pickerList: { gap: Spacing.xxs },
  pickerRow: {
    minHeight: ControlSize.default,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  pickerCopy: { flex: 1 },
  pickerName: { color: BrandColors.text, ...Typography.label },
  pickerMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  avatarSmall: {
    width: 36,
    height: 36,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSmallActive: { backgroundColor: BrandColors.greenLight },
  avatarSmallText: {
    color: BrandColors.muted,
    ...Typography.caption,
    fontWeight: "700",
  },
  avatarSmallTextActive: { color: BrandColors.greenDark },
  borderTop: { borderTopWidth: 1, borderTopColor: BrandColors.line },
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
  dialogTitle: { color: BrandColors.text, ...Typography.h3, flex: 1 },
  dialogSubtitle: { color: BrandColors.greenDark, ...Typography.label },
  dialogHint: { color: BrandColors.muted, ...Typography.caption },
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
