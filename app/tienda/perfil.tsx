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
  Elevation,
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

type SectionKey = "addresses" | "notifications" | "security" | "danger";

function initialsFromName(name: string | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "C";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("es-PE") ?? "")
    .join("");
}

export default function CustomerProfileScreen() {
  const { account, signOut, updatePassword } = useCustomerAuth();
  const [addresses, setAddresses] = useState<SavedCustomerAddress[]>([]);
  const [preferences, setPreferences] = useState<OnlinePreferences | null>(
    null,
  );
  const [loaded, setLoaded] = useState(false);
  const [openSection, setOpenSection] = useState<SectionKey | null>(null);
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

  const toggleSection = (key: SectionKey) =>
    setOpenSection((current) => (current === key ? null : key));

  return (
    <OnlineScreen
      title="Mi perfil"
      subtitle="Cuenta, direcciones y seguridad"
      showBottomNav
    >
      <View style={styles.profileHead}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitials}>
            {initialsFromName(account?.name)}
          </Text>
        </View>
        <Text maxFontSizeMultiplier={1.3} style={styles.name}>
          {account?.name}
        </Text>
        {account?.email ? <Text style={styles.meta}>{account.email}</Text> : null}
        {account?.phone ? <Text style={styles.meta}>{account.phone}</Text> : null}
      </View>

      <View style={styles.menu}>
        <MenuRow
          icon="map-marker-outline"
          label="Mis direcciones"
          meta={`${addresses.length} ${addresses.length === 1 ? "guardada" : "guardadas"}`}
          open={openSection === "addresses"}
          onPress={() => toggleSection("addresses")}
        />
        {openSection === "addresses" ? (
          <View style={styles.expanded}>
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
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowAddress((current) => !current)}
              style={({ pressed }) => [
                styles.linkButton,
                pressed && styles.pressed,
              ]}
            >
              <MaterialCommunityIcons
                name={showAddress ? "close" : "plus"}
                size={18}
                color={BrandColors.green}
              />
              <Text style={styles.link}>
                {showAddress ? "Cerrar formulario" : "Agregar dirección"}
              </Text>
            </Pressable>
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
        ) : null}

        <MenuRow
          icon="bell-outline"
          label="Notificaciones y privacidad"
          open={openSection === "notifications"}
          onPress={() => toggleSection("notifications")}
        />
        {openSection === "notifications" ? (
          <View style={styles.expanded}>
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
            ) : (
              <Text style={styles.meta}>Cargando preferencias…</Text>
            )}
          </View>
        ) : null}

        <MenuRow
          icon="lock-outline"
          label="Seguridad"
          meta="Cambiar contraseña"
          open={openSection === "security"}
          onPress={() => toggleSection("security")}
        />
        {openSection === "security" ? (
          <View style={styles.expanded}>
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
        ) : null}

        <MenuRow
          icon="storefront-outline"
          label="Compra para mi negocio"
          meta="Precios por volumen y cotizaciones"
          onPress={() => router.push("/negocio" as Href)}
        />
        <MenuRow
          icon="lifebuoy"
          label="Centro de ayuda"
          meta="Preguntas frecuentes y solicitudes"
          onPress={() => router.push("/tienda/ayuda" as Href)}
        />

        <MenuRow
          danger
          icon="logout"
          label="Cerrar sesión"
          onPress={() => void signOut().then(() => router.replace("/"))}
        />
        <MenuRow
          danger
          icon="alert-octagon"
          label="Eliminar mi cuenta"
          open={openSection === "danger"}
          onPress={() => toggleSection("danger")}
        />
        {openSection === "danger" ? (
          <View style={[styles.expanded, styles.expandedDanger]}>
            <Text style={styles.meta}>
              Anonimiza tus datos personales, desactiva todos tus accesos y
              solicita el borrado seguro de la identidad. Los comprobantes
              legales se conservan sin tus datos de contacto.
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
                      disabled:
                        deleteConfirmation !== "ELIMINAR" || isDeleting,
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
                <Text style={styles.deleteButtonText}>
                  Iniciar eliminación
                </Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </View>
    </OnlineScreen>
  );
}

function MenuRow({
  danger = false,
  icon,
  label,
  meta,
  open = false,
  onPress,
}: {
  danger?: boolean;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  meta?: string;
  open?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        open && styles.menuRowOpen,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.menuIcon, danger && styles.menuIconDanger]}>
        <MaterialCommunityIcons
          name={icon}
          size={20}
          color={danger ? BrandColors.danger : BrandColors.greenDark}
        />
      </View>
      <View style={styles.menuCopy}>
        <Text
          maxFontSizeMultiplier={1.3}
          style={[styles.menuLabel, danger && styles.menuLabelDanger]}
        >
          {label}
        </Text>
        {meta ? <Text style={styles.menuMeta}>{meta}</Text> : null}
      </View>
      <MaterialCommunityIcons
        name={open ? "chevron-down" : "chevron-right"}
        size={21}
        color={danger ? BrandColors.danger : BrandColors.muted}
      />
    </Pressable>
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
        maxFontSizeMultiplier={1.5}
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
      <Text maxFontSizeMultiplier={1.3} style={styles.toggleLabel}>
        {label}
      </Text>
      <View style={[styles.toggle, value && styles.toggleActive]}>
        <View style={[styles.knob, value && styles.knobActive]} />
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  profileHead: {
    alignItems: "center",
    gap: Spacing.xxs,
    paddingVertical: Spacing.md,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    borderWidth: 3,
    borderColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
    ...Elevation.ambientCard,
  },
  avatarInitials: { color: BrandColors.greenDark, ...Typography.h1 },
  name: { color: BrandColors.text, ...Typography.h3, marginTop: Spacing.xxs },
  meta: { color: BrandColors.muted, ...Typography.caption },
  menu: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    ...Elevation.ambientCard,
  },
  menuRow: {
    minHeight: ControlSize.large - 8,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
  },
  menuRowOpen: { borderTopColor: "transparent" },
  menuIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  menuIconDanger: { backgroundColor: BrandColors.dangerLight },
  menuCopy: { flex: 1 },
  menuLabel: { color: BrandColors.text, ...Typography.label },
  menuLabelDanger: { color: BrandColors.danger },
  menuMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: 2,
  },
  expanded: {
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    paddingTop: Spacing.sm,
  },
  expandedDanger: { backgroundColor: BrandColors.dangerLight },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  addressCopy: { flex: 1 },
  addressLabel: { color: BrandColors.text, ...Typography.label },
  linkButton: {
    minHeight: ControlSize.default,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xxs,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.green,
  },
  link: { color: BrandColors.greenDark, ...Typography.label },
  form: { gap: Spacing.xs },
  field: { gap: Spacing.xxs },
  fieldLabel: { color: BrandColors.text, ...Typography.label },
  input: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.lineStrong,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 13,
    includeFontPadding: false,
    textAlignVertical: "center",
    backgroundColor: BrandColors.white,
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
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: BrandColors.greenDark, ...Typography.label },
  disabled: { opacity: Interaction.disabledOpacity },
  deleteActions: { flexDirection: "row", gap: Spacing.xs },
  deleteOutline: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.danger,
    backgroundColor: BrandColors.white,
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
