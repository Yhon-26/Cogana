import { router, type Href } from "expo-router";
import { type ComponentProps, useState } from "react";
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
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { registerBusinessAccount } from "@/online/business-api";

export default function BusinessRegistrationScreen() {
  const [type, setType] = useState<"restaurant" | "wholesale">("restaurant");
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const taxIdDigits = taxId.replace(/\D/g, "");
  const taxIdError =
    taxId.length > 0 && taxIdDigits.length !== 11
      ? "El RUC debe tener 11 dígitos."
      : null;
  const submitDisabled =
    saving ||
    !legalName.trim() ||
    taxIdDigits.length !== 11 ||
    !contactName.trim() ||
    !contactPhone.trim();

  const submit = async () => {
    if (saving) return;
    setSubmitError(null);
    setSaving(true);
    try {
      await registerBusinessAccount({
        legalName,
        tradeName,
        taxId: taxIdDigits,
        businessType: type,
        contactName,
        contactPhone,
        contactEmail,
      });
      Alert.alert(
        "Solicitud enviada",
        "Revisaremos los datos y mostraremos aquí las condiciones aprobadas.",
      );
      router.replace("/negocio" as Href);
    } catch (caughtError) {
      setSubmitError(
        getUserFacingErrorMessage(
          caughtError,
          "No pudimos enviar la solicitud. Revisa los datos e intenta nuevamente.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnlineScreen
      title="Registrar negocio"
      subtitle="Restaurante o compra mayorista"
      cartHref={null}
    >
      <View style={styles.card}>
        <Text style={styles.label}>TIPO DE NEGOCIO</Text>
        <Text style={styles.fieldHelper}>
          Elige la opción que mejor describe tu compra habitual.
        </Text>
        <View
          accessibilityLabel="Tipo de negocio"
          accessibilityRole="radiogroup"
          style={styles.row}
        >
          {(["restaurant", "wholesale"] as const).map((candidate) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: type === candidate }}
              key={candidate}
              onPress={() => setType(candidate)}
              style={({ pressed }) => [
                styles.choice,
                type === candidate && styles.choiceActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.choiceText}>
                {candidate === "restaurant" ? "Restaurante" : "Mayorista"}
              </Text>
            </Pressable>
          ))}
        </View>
        <BusinessField
          helper="Escríbela como figura en SUNAT."
          label="Razón social"
          onChangeText={setLegalName}
          placeholder="Ej. Bodega Santa Anita S.A.C."
          required
          value={legalName}
        />
        <BusinessField
          helper="El nombre que reconocen tus clientes."
          label="Nombre comercial"
          onChangeText={setTradeName}
          optional
          placeholder="Ej. Bodega La Cosecha"
          value={tradeName}
        />
        <BusinessField
          error={taxIdError}
          helper="Ingresa los 11 dígitos, sin espacios."
          keyboardType="number-pad"
          label="RUC"
          maxLength={11}
          onChangeText={setTaxId}
          placeholder="20123456789"
          required
          value={taxId}
        />
        <BusinessField
          helper="Persona con quien coordinaremos la solicitud."
          label="Persona de contacto"
          onChangeText={setContactName}
          placeholder="Nombre y apellido"
          required
          value={contactName}
        />
        <BusinessField
          autoComplete="tel"
          helper="Usaremos este número para coordinar precios y entrega."
          keyboardType="phone-pad"
          label="Teléfono"
          onChangeText={setContactPhone}
          placeholder="999 999 999"
          required
          textContentType="telephoneNumber"
          value={contactPhone}
        />
        <BusinessField
          autoCapitalize="none"
          autoComplete="email"
          helper="Recibirás aquí las comunicaciones comerciales."
          keyboardType="email-address"
          label="Correo"
          onChangeText={setContactEmail}
          optional
          placeholder="nombre@empresa.com"
          textContentType="emailAddress"
          value={contactEmail}
        />
        {submitError ? (
          <Text
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            style={styles.formError}
          >
            {submitError}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: saving, disabled: submitDisabled }}
          disabled={submitDisabled}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.primary,
            submitDisabled && styles.disabled,
            pressed && !submitDisabled && styles.pressed,
          ]}
        >
          <Text style={styles.primaryText}>
            {saving ? "Enviando…" : "Enviar solicitud"}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.help}>
        La aprobación, línea de crédito y precios por volumen son definidos por
        la tienda. No se aprueba crédito automáticamente.
      </Text>
    </OnlineScreen>
  );
}

function BusinessField({
  error,
  helper,
  label,
  optional = false,
  required = false,
  ...props
}: ComponentProps<typeof TextInput> & {
  error?: string | null;
  helper: string;
  label: string;
  optional?: boolean;
  required?: boolean;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldRequirement}>
          {optional ? "Opcional" : required ? "Obligatorio" : ""}
        </Text>
      </View>
      <TextInput
        {...props}
        accessibilityHint={error ?? helper}
        accessibilityLabel={label}
        placeholderTextColor={BrandColors.muted}
        style={[styles.input, error && styles.inputError]}
      />
      <Text
        accessibilityLiveRegion={error ? "polite" : undefined}
        accessibilityRole={error ? "alert" : undefined}
        style={error ? styles.fieldError : styles.fieldHelper}
      >
        {error ?? helper}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  label: { color: BrandColors.muted, ...Typography.overline },
  row: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  choice: {
    flex: 1,
    flexBasis: 160,
    minWidth: 0,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceActive: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
  },
  choiceText: { color: BrandColors.greenDark, ...Typography.label },
  field: { gap: Spacing.xxs },
  fieldHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  fieldLabel: { color: BrandColors.text, ...Typography.label },
  fieldRequirement: { color: BrandColors.muted, ...Typography.caption },
  fieldHelper: { color: BrandColors.muted, ...Typography.caption },
  fieldError: { color: BrandColors.danger, ...Typography.caption },
  input: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm,
    color: BrandColors.text,
    ...Typography.body,
  },
  inputError: { borderColor: BrandColors.danger },
  formError: {
    color: BrandColors.danger,
    ...Typography.caption,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.dangerLight,
    padding: Spacing.sm,
  },
  primary: {
    minHeight: ControlSize.large,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: BrandColors.white, ...Typography.label },
  help: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
  },
  disabled: { opacity: Interaction.disabledOpacity },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
