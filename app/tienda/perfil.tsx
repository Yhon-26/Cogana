import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { OnlineScreen } from "@/components/online-shell";
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
import { useCustomerAuth } from "@/context/customer-auth-context";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import type {
  OnlinePreferences,
  SavedCustomerAddress,
} from "@/online/contracts";
import {
  deleteMyAccount,
  getMyAddresses,
  getMyOnlinePreferences,
  saveMyAddress,
  updateMyOnlinePreferences,
} from "@/online/store-api";

export default function CustomerProfileScreen() {
  const { account, signOut, updatePassword } = useCustomerAuth();
  const [addresses, setAddresses] = useState<SavedCustomerAddress[]>([]);
  const [preferences, setPreferences] = useState<OnlinePreferences | null>(
    null,
  );
  const [loaded, setLoaded] = useState(false);
  const [showAddress, setShowAddress] = useState(false);
  const [label, setLabel] = useState("Casa");
  const [address, setAddress] = useState("");
  const [district, setDistrict] = useState("");
  const [instructions, setInstructions] = useState("");
  const [password, setPassword] = useState("");
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const loadAddresses = useCallback(async () => {
    if (!account) return;
    try {
      const [nextAddresses, nextPreferences] = await Promise.all([
        getMyAddresses(account.id),
        getMyOnlinePreferences(),
      ]);
      setAddresses(nextAddresses);
      setPreferences(nextPreferences);
      setLoaded(true);
    } catch (error) {
      Alert.alert(
        "No se cargaron las direcciones",
        getUserFacingErrorMessage(error, "Intenta nuevamente."),
      );
    }
  }, [account]);
  useEffect(() => {
    if (!loaded && account) void loadAddresses();
  }, [account, loadAddresses, loaded]);

  const saveAddress = async () => {
    if (!account || !address.trim() || !district.trim()) {
      Alert.alert(
        "Datos incompletos",
        "Dirección y distrito son obligatorios.",
      );
      return;
    }
    try {
      await saveMyAddress(account.id, {
        label,
        address,
        district,
        instructions,
      });
      setShowAddress(false);
      setAddress("");
      setDistrict("");
      setInstructions("");
      await loadAddresses();
    } catch (error) {
      Alert.alert(
        "No se pudo guardar",
        getUserFacingErrorMessage(
          error,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    }
  };

  const changePassword = async () => {
    try {
      await updatePassword(password);
      setPassword("");
      Alert.alert(
        "Contraseña actualizada",
        "Tu nueva contraseña ya está activa.",
      );
    } catch (error) {
      Alert.alert(
        "No se pudo actualizar",
        getUserFacingErrorMessage(error, "Intenta nuevamente."),
      );
    }
  };

  const savePreferences = async (next: {
    orderNotifications: boolean;
    promotionNotifications: boolean;
    marketingConsent: boolean;
  }) => {
    try {
      setPreferences(await updateMyOnlinePreferences(next));
    } catch (error) {
      Alert.alert(
        "No se guardaron las preferencias",
        getUserFacingErrorMessage(error, "Intenta nuevamente."),
      );
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirmation !== "ELIMINAR" || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteMyAccount(deleteConfirmation);
      await signOut();
      router.replace("/");
    } catch (error) {
      Alert.alert(
        "No se pudo eliminar la cuenta",
        getUserFacingErrorMessage(error, "Intenta nuevamente."),
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <OnlineScreen
      title="Mi perfil"
      subtitle="Cuenta, direcciones y seguridad"
      showBottomNav
    >
      <View style={styles.card}>
        <View style={styles.avatar}>
          <MaterialCommunityIcons
            name="account"
            size={34}
            color={BrandColors.greenDark}
          />
        </View>
        <Text style={styles.name}>{account?.name}</Text>
        <Text style={styles.meta}>{account?.phone}</Text>
        <Text style={styles.meta}>{account?.email}</Text>
      </View>
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Direcciones guardadas</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowAddress((current) => !current)}
            style={styles.linkButton}
          >
            <Text style={styles.link}>
              {showAddress ? "Cerrar" : "Agregar"}
            </Text>
          </Pressable>
        </View>
        {addresses.map((item) => (
          <View key={item.id} style={styles.addressRow}>
            <MaterialCommunityIcons
              name="map-marker-outline"
              size={20}
              color={BrandColors.green}
            />
            <View style={styles.addressCopy}>
              <Text style={styles.addressLabel}>{item.label}</Text>
              <Text style={styles.meta}>
                {item.address} · {item.district}
              </Text>
            </View>
          </View>
        ))}
        {showAddress ? (
          <View style={styles.form}>
            <Field label="Etiqueta" value={label} onChangeText={setLabel} />
            <Field
              label="Dirección"
              value={address}
              onChangeText={setAddress}
            />
            <Field
              label="Distrito"
              value={district}
              onChangeText={setDistrict}
            />
            <Field
              label="Referencia"
              value={instructions}
              onChangeText={setInstructions}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => void saveAddress()}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.buttonText}>Guardar dirección</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Notificaciones y privacidad</Text>
        {preferences ? (
          <>
            <Toggle
              label="Estados de mis pedidos"
              value={preferences.orderNotifications}
              onChange={(value) =>
                void savePreferences({
                  ...preferences,
                  orderNotifications: value,
                })
              }
            />
            <Toggle
              label="Promociones"
              value={preferences.promotionNotifications}
              onChange={(value) =>
                void savePreferences({
                  ...preferences,
                  promotionNotifications: value,
                })
              }
            />
            <Toggle
              label="Consentimiento de marketing"
              value={preferences.marketingConsent}
              onChange={(value) =>
                void savePreferences({
                  ...preferences,
                  marketingConsent: value,
                })
              }
            />
          </>
        ) : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Seguridad</Text>
        <Field
          label="Nueva contraseña"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: password.length < 8 }}
          disabled={password.length < 8}
          onPress={() => void changePassword()}
          style={({ pressed }) => [
            styles.secondaryButton,
            password.length < 8 && styles.disabled,
            pressed && password.length >= 8 && styles.pressed,
          ]}
        >
          <Text style={styles.secondaryText}>
            {password.length < 8 && password.length > 0
              ? "Minimo 8 caracteres"
              : "Cambiar contraseña"}
          </Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/negocio" as Href)}
        style={({ pressed }) => [styles.business, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons
          name="storefront-outline"
          size={22}
          color={BrandColors.greenDark}
        />
        <View style={styles.addressCopy}>
          <Text style={styles.title}>Compra para mi negocio</Text>
          <Text style={styles.meta}>
            Restaurantes, precios por volumen y cotizaciones.
          </Text>
        </View>
        <MaterialCommunityIcons
          name="chevron-right"
          size={21}
          color={BrandColors.greenDark}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/tienda/ayuda" as Href)}
        style={({ pressed }) => [styles.business, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons
          name="lifebuoy"
          size={22}
          color={BrandColors.greenDark}
        />
        <View style={styles.addressCopy}>
          <Text style={styles.title}>Centro de ayuda</Text>
          <Text style={styles.meta}>
            Preguntas frecuentes y mis solicitudes.
          </Text>
        </View>
        <MaterialCommunityIcons
          name="chevron-right"
          size={21}
          color={BrandColors.greenDark}
        />
      </Pressable>
      <View style={[styles.card, styles.dangerCard]}>
        <Text style={styles.title}>Eliminar mi cuenta</Text>
        <Text style={styles.meta}>
          Anonimiza tus datos personales, desactiva todos tus accesos y solicita
          el borrado seguro de la identidad. Los comprobantes legales se
          conservan sin tus datos de contacto.
        </Text>
        {showDeleteAccount ? (
          <>
            <Field
              autoCapitalize="characters"
              label='Escribe "ELIMINAR"'
              value={deleteConfirmation}
              onChangeText={setDeleteConfirmation}
            />
            <View style={styles.deleteActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setShowDeleteAccount(false);
                  setDeleteConfirmation("");
                }}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.secondaryText}>Cancelar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  busy: isDeleting,
                  disabled: deleteConfirmation !== "ELIMINAR" || isDeleting,
                }}
                disabled={deleteConfirmation !== "ELIMINAR" || isDeleting}
                onPress={() => void deleteAccount()}
                style={({ pressed }) => [
                  styles.deleteButton,
                  (deleteConfirmation !== "ELIMINAR" || isDeleting) &&
                    styles.disabled,
                  pressed &&
                    deleteConfirmation === "ELIMINAR" &&
                    !isDeleting &&
                    styles.pressed,
                ]}
              >
                <Text style={styles.deleteConfirmText}>
                  {isDeleting ? "Eliminando…" : "Eliminar definitivamente"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowDeleteAccount(true)}
            style={({ pressed }) => [
              styles.deleteOutline,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.deleteButtonText}>Iniciar eliminación</Text>
          </Pressable>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => void signOut().then(() => router.replace("/"))}
        style={({ pressed }) => [styles.logout, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons
          name="logout"
          size={19}
          color={BrandColors.danger}
        />
        <Text style={styles.logoutText}>Cerrar sesión</Text>
      </Pressable>
    </OnlineScreen>
  );
}

function Field({
  label,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        {...props}
        placeholderTextColor={BrandColors.muted}
        style={styles.input}
      />
    </View>
  );
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
    >
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.toggle, value && styles.toggleActive]}>
        <View style={[styles.knob, value && styles.knobActive]} />
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  avatar: {
    width: 62,
    height: 62,
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { color: BrandColors.text, ...Typography.h3 },
  meta: { color: BrandColors.muted, ...Typography.caption },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: BrandColors.text, ...Typography.label },
  linkButton: {
    minWidth: ControlSize.default,
    minHeight: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
  },
  link: { color: BrandColors.green, ...Typography.label },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    paddingTop: Spacing.xs,
  },
  addressCopy: { flex: 1 },
  addressLabel: { color: BrandColors.text, ...Typography.label },
  form: { gap: Spacing.xs, marginTop: Spacing.xxs },
  field: { gap: Spacing.xxs },
  fieldLabel: { color: BrandColors.text, ...Typography.label },
  input: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.lineStrong,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.body,
  },
  button: {
    minHeight: ControlSize.large,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: BrandColors.white, ...Typography.label },
  secondaryButton: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: BrandColors.greenDark, ...Typography.label },
  disabled: { opacity: Interaction.disabledOpacity },
  business: {
    minHeight: 68,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.greenLight,
    borderWidth: 1,
    borderColor: BrandColors.green,
    padding: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  logout: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.dangerLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  logoutText: { color: BrandColors.danger, ...Typography.label },
  dangerCard: { borderColor: BrandColors.danger },
  deleteActions: { flexDirection: "row", gap: Spacing.xs },
  deleteOutline: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButton: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xs,
  },
  deleteButtonText: { color: BrandColors.danger, ...Typography.label },
  deleteConfirmText: { color: BrandColors.white, ...Typography.label },
  toggleRow: {
    minHeight: ControlSize.default,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleLabel: { color: BrandColors.text, ...Typography.label },
  toggle: {
    width: 42,
    height: 24,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.lineStrong,
    padding: Spacing.xxs,
  },
  toggleActive: { backgroundColor: BrandColors.green },
  knob: {
    width: 18,
    height: 18,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.white,
  },
  knobActive: { alignSelf: "flex-end" },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
