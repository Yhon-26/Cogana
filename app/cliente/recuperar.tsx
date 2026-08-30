import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CommerceButton } from "@/components/commerce-ui";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";
import { getCustomerAuthErrorMessage } from "@/auth/customer-auth-error";
import {
  BrandColors,
  ComponentMetrics,
  ControlSize,
  Layout,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useCustomerAuth } from "@/context/customer-auth-context";

export default function RecoverCustomerAccessScreen() {
  const { sendPasswordReset } = useCustomerAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submit = async () => {
    setSubmitError(null);
    setBusy(true);
    try {
      await sendPasswordReset(email, Linking.createURL("/"));
      Alert.alert(
        "Revisa tu correo",
        "Si existe una cuenta, recibirás el enlace para recuperar el acceso.",
      );
      router.back();
    } catch (error) {
      setSubmitError(getCustomerAuthErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>SEGURIDAD</Text>
        <Text style={styles.title}>Recupera tu acceso</Text>
        <Text style={styles.text}>
          Te enviaremos un enlace seguro al correo registrado.
        </Text>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Correo electrónico</Text>
          <TextInput
            accessibilityHint="Usa el correo con el que creaste tu cuenta."
            accessibilityLabel="Correo electrónico"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={(value) => {
              setEmail(value);
              setSubmitError(null);
            }}
            placeholder="nombre@correo.com"
            placeholderTextColor={BrandColors.muted}
            style={[styles.input, submitError && styles.inputError]}
            textContentType="emailAddress"
            value={email}
          />
          <Text
            accessibilityLiveRegion={submitError ? "polite" : undefined}
            accessibilityRole={submitError ? "alert" : undefined}
            style={submitError ? styles.fieldError : styles.fieldHelper}
          >
            {submitError ?? "Usa el correo con el que creaste tu cuenta."}
          </Text>
        </View>
        <CommerceButton
          disabled={busy}
          label={busy ? "Enviando…" : "Enviar enlace"}
          loading={busy}
          onPress={() => void submit()}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.back}>Volver</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BrandColors.ink,
    justifyContent: "center",
    padding: Spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: Layout.dialogMaxWidth,
    alignSelf: "center",
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.cream,
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  eyebrow: { color: BrandColors.green, ...Typography.overline },
  title: { color: BrandColors.text, ...Typography.h1 },
  text: { color: BrandColors.muted, ...Typography.body },
  field: { gap: Spacing.xxs, marginTop: Spacing.xxs },
  fieldLabel: { color: BrandColors.text, ...Typography.label },
  fieldHelper: { color: BrandColors.muted, ...Typography.caption },
  fieldError: { color: BrandColors.danger, ...Typography.caption },
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
  inputError: { borderColor: BrandColors.danger },
  backButton: {
    minHeight: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
  },
  back: { color: BrandColors.muted, ...Typography.label, textAlign: "center" },
});
