import Constants from "expo-constants";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

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
import { useAppPreferences } from "@/context/app-preferences-context";
import { useLocalOperator } from "@/context/local-operator-context";
import {
  configureFiscalIntegration,
  getAdminSettings,
  saveStoreBranch,
  type AdminSettings,
  type StoreBranchInput,
  updateStoreSettings,
} from "@/online/admin-settings-api";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";

const empty: AdminSettings = {
  store: {
    legalName: "",
    taxId: "",
    address: "",
    phone: "",
    businessHours: "",
    receiptFooter: "",
  },
  fiscal: {
    provider: "none",
    environment: "disabled",
    invoiceSeries: "",
    receiptSeries: "",
    isEnabled: false,
    lastError: null,
  },
  stores: [],
};
const emptyBranch: StoreBranchInput = {
  code: "",
  name: "",
  address: "",
  timezone: "America/Lima",
  status: "active",
};
const branchStatusLabels: Record<StoreBranchInput["status"], string> = {
  active: "Activa",
  suspended: "Suspendida",
  archived: "Archivada",
};
const fiscalEnvironmentLabels: Record<
  AdminSettings["fiscal"]["environment"],
  string
> = {
  disabled: "Deshabilitado",
  demo: "Demostración",
  production: "Producción",
};

type SheetName = "store" | "branches" | "fiscal" | null;

export default function SettingsScreen() {
  const { preferences, updatePreferences } = useAppPreferences();
  const { selectedUser } = useLocalOperator();
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.round(height * 0.88);
  const [settings, setSettings] = useState(empty);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [branch, setBranch] = useState<StoreBranchInput>(emptyBranch);
  const [branchFormVisible, setBranchFormVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await getAdminSettings());
    } catch (caughtError) {
      Alert.alert(
        "Configuración central no disponible",
        getOperatorErrorMessage(
          caughtError,
          "No se pudo cargar la configuración. Intenta nuevamente.",
        ),
      );
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  const saveStore = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await updateStoreSettings(settings.store);
      setSheet(null);
      Alert.alert(
        "Tienda actualizada",
        "Los datos centrales fueron guardados.",
      );
    } catch (caughtError) {
      Alert.alert(
        "No se pudo guardar",
        getOperatorErrorMessage(
          caughtError,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };
  const saveFiscal = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const result = await configureFiscalIntegration(settings.fiscal);
      setSheet(null);
      Alert.alert(
        "Configuración fiscal guardada",
        result.requiresServerSecret
          ? "Falta configurar la credencial del proveedor únicamente en el backend."
          : "La integración permanece deshabilitada.",
      );
    } catch (caughtError) {
      Alert.alert(
        "No se pudo guardar",
        getOperatorErrorMessage(
          caughtError,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };
  const saveBranch = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const saved = await saveStoreBranch(branch);
      setBranch(emptyBranch);
      setBranchFormVisible(false);
      await load();
      Alert.alert(
        saved.created ? "Sucursal creada" : "Sucursal actualizada",
        saved.created
          ? "Ya puedes vincular operadores y aprovisionar sus dispositivos."
          : "Los datos centrales fueron guardados.",
      );
    } catch (caughtError) {
      Alert.alert(
        "No se pudo guardar la sucursal",
        getOperatorErrorMessage(
          caughtError,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };
  const applyPreference = async (next: typeof preferences) => {
    try {
      await updatePreferences(next);
    } catch (caughtError) {
      Alert.alert(
        "No se pudo guardar la preferencia",
        getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
      );
    }
  };

  const navigationRows = [
    {
      icon: "storefront-outline",
      title: "Datos de tienda",
      subtitle: settings.store.legalName || "Razón social, RUC, horario y ticket",
      sheet: "store" as const,
    },
    {
      icon: "source-branch",
      title: "Sucursales",
      subtitle: `${settings.stores.length} visible${settings.stores.length === 1 ? "" : "s"} · código, dirección y estado`,
      sheet: "branches" as const,
    },
    {
      icon: "receipt-text-outline",
      title: "Facturación SUNAT",
      subtitle:
        settings.fiscal.environment === "disabled"
          ? "Integración deshabilitada"
          : `Proveedor ${settings.fiscal.provider} · ${fiscalEnvironmentLabels[settings.fiscal.environment]}`,
      sheet: "fiscal" as const,
    },
  ];

  return (
    <AdminScreen
      title="Configuración"
      subtitle="Tienda, sucursales y facturación"
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
              Activa tu perfil con PIN en la pestaña Más para cambiar la
              configuración.
            </Text>
          </View>
        </View>
      ) : null}

      <SectionTitle>Negocio</SectionTitle>
      <View style={[sharedStyles.card, styles.navCard]}>
        {navigationRows.map((row, index) => (
          <Pressable
            accessibilityLabel={`Abrir ${row.title}`}
            accessibilityRole="button"
            key={row.title}
            onPress={() => {
              setBranch(emptyBranch);
              setBranchFormVisible(false);
              setSheet(row.sheet);
            }}
            style={[
              styles.navRow,
              index > 0 && styles.borderTop,
            ]}
          >
            <View style={styles.navIcon}>
              <MaterialCommunityIcons
                name={row.icon as keyof typeof MaterialCommunityIcons.glyphMap}
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
                {row.title}
              </Text>
              <Text numberOfLines={1} style={styles.meta}>
                {row.subtitle}
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={18}
              color={BrandColors.muted}
            />
          </Pressable>
        ))}
      </View>

      <SectionTitle>Preferencias de la aplicación</SectionTitle>
      <View style={[sharedStyles.card, styles.card, styles.rowShadow]}>
        <Text style={styles.title}>Densidad visual</Text>
        <View style={styles.choices}>
          {(["comfortable", "compact"] as const).map((density) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: preferences.density === density }}
              key={density}
              onPress={() => void applyPreference({ ...preferences, density })}
              style={[
                styles.choice,
                preferences.density === density && styles.choiceActive,
              ]}
            >
              <Text style={styles.choiceText}>
                {density === "comfortable" ? "Cómoda" : "Compacta"}
              </Text>
            </Pressable>
          ))}
        </View>
        <PreferenceToggle
          label="Reducir movimiento"
          value={preferences.reduceMotion}
          onValueChange={(reduceMotion) =>
            void applyPreference({ ...preferences, reduceMotion })
          }
        />
        <PreferenceToggle
          label="Respuesta háptica"
          value={preferences.hapticsEnabled}
          onValueChange={(hapticsEnabled) =>
            void applyPreference({ ...preferences, hapticsEnabled })
          }
        />
        <View style={[styles.row, styles.noBorder]}>
          <View style={styles.fill}>
            <Text style={styles.title}>Idioma</Text>
            <Text style={styles.meta}>Español (Perú)</Text>
          </View>
          <Pill label={preferences.locale} tone="neutral" />
        </View>
        <Text style={styles.help}>
          Las preferencias son personales para cada operador de este
          dispositivo.
        </Text>
      </View>

      <View style={[sharedStyles.card, styles.card, styles.rowShadow]}>
        <Text style={styles.title}>Acerca de Cogana</Text>
        <Text style={styles.meta}>
          Versión {Constants.expoConfig?.version ?? "1.0.0"} · Expo SDK 54
        </Text>
        <Text style={styles.help}>
          POS conectado para Mercado Cogana · Santa Anita, Lima.
        </Text>
      </View>

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setSheet(null);
        }}
        placement="bottom"
        visible={sheet === "store"}
      >
        <SheetHeader
          title="Datos de tienda"
          subtitle="Se usan en comprobantes y la tienda online"
          onClose={() => setSheet(null)}
        />
        <ScrollView
          contentContainerStyle={styles.sheetBody}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          style={styles.sheetScroll}
        >
          <Field
            placeholder="Razón social"
            value={settings.store.legalName}
            onChangeText={(value) =>
              setSettings((current) => ({
                ...current,
                store: { ...current.store, legalName: value },
              }))
            }
          />
          <Field
            keyboardType="number-pad"
            placeholder="RUC"
            value={settings.store.taxId}
            onChangeText={(value) =>
              setSettings((current) => ({
                ...current,
                store: { ...current.store, taxId: value },
              }))
            }
          />
          <Field
            placeholder="Dirección"
            value={settings.store.address}
            onChangeText={(value) =>
              setSettings((current) => ({
                ...current,
                store: { ...current.store, address: value },
              }))
            }
          />
          <Field
            keyboardType="phone-pad"
            placeholder="Teléfono"
            value={settings.store.phone}
            onChangeText={(value) =>
              setSettings((current) => ({
                ...current,
                store: { ...current.store, phone: value },
              }))
            }
          />
          <Field
            placeholder="Horario"
            value={settings.store.businessHours}
            onChangeText={(value) =>
              setSettings((current) => ({
                ...current,
                store: { ...current.store, businessHours: value },
              }))
            }
          />
          <Field
            placeholder="Pie de comprobante"
            value={settings.store.receiptFooter}
            onChangeText={(value) =>
              setSettings((current) => ({
                ...current,
                store: { ...current.store, receiptFooter: value },
              }))
            }
          />
        </ScrollView>
        <ActionButton
          label="Guardar tienda"
          icon="content-save-outline"
          loading={isSaving}
          disabled={isSaving}
          onPress={() => void saveStore()}
        />
      </ModalSurface>

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setSheet(null);
        }}
        placement="bottom"
        visible={sheet === "branches"}
      >
        <SheetHeader
          title="Sucursales"
          subtitle="Toca una sucursal para editarla"
          onClose={() => setSheet(null)}
        />
        <ScrollView
          contentContainerStyle={styles.sheetBody}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          style={styles.sheetScroll}
        >
          {settings.stores.map((store) => (
            <Pressable
              accessibilityLabel={`Editar sucursal ${store.name}`}
              accessibilityRole="button"
              key={store.id}
              onPress={() => {
                setBranch({ ...store });
                setBranchFormVisible(true);
              }}
              style={styles.branchRow}
            >
              <View style={styles.fill}>
                <Text maxFontSizeMultiplier={1.3} style={styles.title}>
                  {store.name}
                </Text>
                <Text style={styles.meta}>
                  {store.code} · {store.address || "Sin dirección"}
                </Text>
              </View>
              <Pill
                label={branchStatusLabels[store.status]}
                tone={store.status === "active" ? "green" : "neutral"}
              />
              <MaterialCommunityIcons
                name="chevron-right"
                size={18}
                color={BrandColors.muted}
              />
            </Pressable>
          ))}
          {!settings.stores.length ? (
            <Text style={styles.help}>
              Aún no hay sucursales. Crea la primera con su código y zona
              horaria.
            </Text>
          ) : null}
          {branchFormVisible ? (
            <>
              <View style={styles.formDivider} />
              <Field
                autoCapitalize="characters"
                maxLength={32}
                placeholder="Código (ej. SANTA_ANITA_2)"
                value={branch.code}
                onChangeText={(code) =>
                  setBranch((current) => ({ ...current, code }))
                }
              />
              <Field
                placeholder="Nombre"
                value={branch.name}
                onChangeText={(name) =>
                  setBranch((current) => ({ ...current, name }))
                }
              />
              <Field
                placeholder="Dirección"
                value={branch.address ?? ""}
                onChangeText={(address) =>
                  setBranch((current) => ({ ...current, address }))
                }
              />
              <Field
                autoCapitalize="none"
                placeholder="Zona horaria"
                value={branch.timezone}
                onChangeText={(timezone) =>
                  setBranch((current) => ({ ...current, timezone }))
                }
              />
              <View style={styles.choices}>
                {(["active", "suspended", "archived"] as const).map(
                  (status) => (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: branch.status === status }}
                      key={status}
                      onPress={() =>
                        setBranch((current) => ({ ...current, status }))
                      }
                      style={[
                        styles.choice,
                        branch.status === status && styles.choiceActive,
                      ]}
                    >
                      <Text style={styles.choiceText}>
                        {branchStatusLabels[status]}
                      </Text>
                    </Pressable>
                  ),
                )}
              </View>
            </>
          ) : (
            <Pressable
              accessibilityLabel="Nueva sucursal"
              accessibilityRole="button"
              onPress={() => {
                setBranch(emptyBranch);
                setBranchFormVisible(true);
              }}
              style={styles.newBranchButton}
            >
              <MaterialCommunityIcons
                name="plus"
                size={19}
                color={BrandColors.greenDark}
              />
              <Text style={styles.newBranchText}>Nueva sucursal</Text>
            </Pressable>
          )}
        </ScrollView>
        {branchFormVisible ? (
          <View style={styles.sheetFooter}>
            <ActionButton
              compact
              disabled={isSaving}
              label="Cerrar formulario"
              onPress={() => {
                setBranch(emptyBranch);
                setBranchFormVisible(false);
              }}
              style={styles.footerButton}
              tone="ghost"
            />
            <ActionButton
              compact
              disabled={!branch.code.trim() || !branch.name.trim() || isSaving}
              label={branch.id ? "Actualizar" : "Crear sucursal"}
              loading={isSaving}
              onPress={() => void saveBranch()}
              style={styles.saveFooterButton}
            />
          </View>
        ) : null}
      </ModalSurface>

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setSheet(null);
        }}
        placement="bottom"
        visible={sheet === "fiscal"}
      >
        <SheetHeader
          title="Facturación electrónica"
          subtitle="SUNAT y proveedor de comprobantes"
          onClose={() => setSheet(null)}
        />
        <ScrollView
          contentContainerStyle={styles.sheetBody}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          style={styles.sheetScroll}
        >
          <Field
            placeholder="Proveedor (ej. nubefact)"
            value={settings.fiscal.provider}
            onChangeText={(value) =>
              setSettings((current) => ({
                ...current,
                fiscal: { ...current.fiscal, provider: value },
              }))
            }
          />
          <View style={styles.choices}>
            {(["disabled", "demo", "production"] as const).map((environment) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{
                  checked: settings.fiscal.environment === environment,
                }}
                key={environment}
                onPress={() =>
                  setSettings((current) => ({
                    ...current,
                    fiscal: {
                      ...current.fiscal,
                      environment,
                      isEnabled: environment !== "disabled",
                    },
                  }))
                }
                style={[
                  styles.choice,
                  settings.fiscal.environment === environment &&
                    styles.choiceActive,
                ]}
              >
                <Text style={styles.choiceText}>
                  {fiscalEnvironmentLabels[environment]}
                </Text>
              </Pressable>
            ))}
          </View>
          <Field
            placeholder="Serie facturas (F001)"
            value={settings.fiscal.invoiceSeries}
            onChangeText={(value) =>
              setSettings((current) => ({
                ...current,
                fiscal: { ...current.fiscal, invoiceSeries: value },
              }))
            }
          />
          <Field
            placeholder="Serie boletas (B001)"
            value={settings.fiscal.receiptSeries}
            onChangeText={(value) =>
              setSettings((current) => ({
                ...current,
                fiscal: { ...current.fiscal, receiptSeries: value },
              }))
            }
          />
          <Text style={styles.help}>
            Las credenciales SUNAT/proveedor nunca se ingresan aquí: se
            configuran como secreto del backend productivo.
          </Text>
        </ScrollView>
        <ActionButton
          label="Guardar configuración fiscal"
          icon="content-save-outline"
          loading={isSaving}
          disabled={isSaving}
          onPress={() => void saveFiscal()}
        />
      </ModalSurface>
    </AdminScreen>
  );
}

function SheetHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  return (
    <View style={styles.sheetHeader}>
      <View style={styles.sheetHeaderCopy}>
        <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
          {title}
        </Text>
        <Text style={styles.sheetMeta}>{subtitle}</Text>
      </View>
      <Pressable
        accessibilityLabel="Cerrar"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onClose}
        style={styles.sheetClose}
      >
        <MaterialCommunityIcons
          name="close"
          size={22}
          color={BrandColors.muted}
        />
      </Pressable>
    </View>
  );
}

function Field(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
      {...props}
      placeholderTextColor={BrandColors.muted}
      style={styles.input}
    />
  );
}

function PreferenceToggle({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.title, styles.fill]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        onValueChange={onValueChange}
        thumbColor={BrandColors.white}
        trackColor={{ false: BrandColors.line, true: BrandColors.green }}
        value={value}
      />
    </View>
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
  navCard: { paddingVertical: Spacing.xxs },
  navRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  navIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  borderTop: { borderTopWidth: 1, borderTopColor: BrandColors.line },
  rowShadow: { ...Elevation.ambientCard },
  fill: { flex: 1 },
  title: { color: BrandColors.text, ...Typography.label },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  help: { color: BrandColors.muted, ...Typography.caption },
  card: { gap: Spacing.sm },
  row: {
    minHeight: ControlSize.default,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.line,
  },
  noBorder: { borderBottomWidth: 0 },
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
    paddingHorizontal: Spacing.xxs,
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
  branchRow: {
    minHeight: ControlSize.default,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  formDivider: {
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    paddingTop: Spacing.xs,
  },
  newBranchButton: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.white,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  newBranchText: { color: BrandColors.greenDark, ...Typography.label },
  sheet: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  sheetScroll: { flexShrink: 1 },
  sheetBody: { gap: Spacing.sm, paddingBottom: Spacing.xs },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  sheetHeaderCopy: { flex: 1 },
  sheetTitle: { color: BrandColors.text, ...Typography.h3 },
  sheetMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  sheetClose: {
    width: ControlSize.compact,
    height: ControlSize.compact,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetFooter: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  footerButton: { flex: 1 },
  saveFooterButton: { flex: 1.6 },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
