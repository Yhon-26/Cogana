import Constants from "expo-constants";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";

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
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useAppPreferences } from "@/context/app-preferences-context";
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

export default function SettingsScreen() {
  const { preferences, updatePreferences } = useAppPreferences();
  const [settings, setSettings] = useState(empty);
  const [branch, setBranch] = useState<StoreBranchInput>(emptyBranch);
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
    try {
      await updateStoreSettings(settings.store);
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
    }
  };
  const saveFiscal = async () => {
    try {
      const result = await configureFiscalIntegration(settings.fiscal);
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
    }
  };
  const saveBranch = async () => {
    try {
      const saved = await saveStoreBranch(branch);
      setBranch(emptyBranch);
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
  return (
    <AdminScreen
      title="Configuración"
      subtitle="Tienda, sucursales y facturación"
    >
      <OperatorSelector />
      <SectionTitle>Datos de tienda</SectionTitle>
      <View style={[sharedStyles.card, styles.card]}>
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
        <Pressable
          accessibilityRole="button"
          onPress={() => void saveStore()}
          style={styles.primary}
        >
          <Text style={styles.primaryText}>Guardar tienda</Text>
        </Pressable>
      </View>
      <SectionTitle
        action={<Pill label={`${settings.stores.length}`} tone="neutral" />}
      >
        Sucursales visibles
      </SectionTitle>
      <View style={[sharedStyles.card, styles.card]}>
        {settings.stores.map((store) => (
          <Pressable
            accessibilityLabel={`Editar sucursal ${store.name}`}
            accessibilityRole="button"
            key={store.id}
            onPress={() => setBranch({ ...store })}
            style={styles.row}
          >
            <View style={styles.fill}>
              <Text style={styles.title}>{store.name}</Text>
              <Text style={styles.meta}>
                {store.code} · {store.address || "Sin dirección"}
              </Text>
            </View>
            <Pill label={branchStatusLabels[store.status]} tone="neutral" />
          </Pressable>
        ))}
        <Text style={styles.help}>
          Toca una sucursal para editarla. La selección operativa requiere
          aprovisionar y preparar sus datos antes de cambiar el dispositivo.
        </Text>
      </View>
      <SectionTitle>
        {branch.id ? "Editar sucursal" : "Nueva sucursal"}
      </SectionTitle>
      <View style={[sharedStyles.card, styles.card]}>
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
          {(["active", "suspended", "archived"] as const).map((status) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: branch.status === status }}
              key={status}
              onPress={() => setBranch((current) => ({ ...current, status }))}
              style={[
                styles.choice,
                branch.status === status && styles.choiceActive,
              ]}
            >
              <Text style={styles.choiceText}>
                {branchStatusLabels[status]}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => void saveBranch()}
          style={styles.primary}
        >
          <Text style={styles.primaryText}>
            {branch.id ? "Actualizar sucursal" : "Crear sucursal"}
          </Text>
        </Pressable>
        {branch.id ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setBranch(emptyBranch)}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Cancelar edición</Text>
          </Pressable>
        ) : null}
      </View>
      <SectionTitle>Facturación electrónica / SUNAT</SectionTitle>
      <View style={[sharedStyles.card, styles.card]}>
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
          Las credenciales SUNAT/proveedor nunca se ingresan aquí: se configuran
          como secreto del backend productivo.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void saveFiscal()}
          style={styles.primary}
        >
          <Text style={styles.primaryText}>Guardar configuración fiscal</Text>
        </Pressable>
      </View>
      <SectionTitle>Preferencias de la aplicación</SectionTitle>
      <View style={[sharedStyles.card, styles.card]}>
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
        <View style={styles.row}>
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
      <View style={[sharedStyles.card, styles.card]}>
        <Text style={styles.title}>Acerca de Cogana</Text>
        <Text style={styles.meta}>
          Versión {Constants.expoConfig?.version ?? "1.0.0"} · Expo SDK 54
        </Text>
        <Text style={styles.help}>
          POS conectado para Mercado Cogana · Santa Anita, Lima.
        </Text>
      </View>
    </AdminScreen>
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
  card: { gap: Spacing.sm },
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
  primary: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  primaryText: { color: BrandColors.white, ...Typography.label },
  secondary: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  secondaryText: { color: BrandColors.greenDark, ...Typography.label },
  row: {
    minHeight: ControlSize.default,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.line,
  },
  fill: { flex: 1 },
  title: { color: BrandColors.text, ...Typography.label },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  help: { color: BrandColors.muted, ...Typography.caption },
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
});
