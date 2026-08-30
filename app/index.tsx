import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { type ComponentProps, useEffect, useState, useRef } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandLogo } from "@/components/brand-logo";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";

import {
  BrandColors,
  ComponentMetrics,
  ControlSize,
  Interaction,
  Layout,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useCustomerAuth } from "@/context/customer-auth-context";
import { useSupabaseAuth } from "@/context/supabase-auth-context";
import { useLocalOperator } from "@/context/local-operator-context";
import { useAdaptiveLayout } from "@/hooks/use-adaptive-layout";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { getSupabaseClient } from "@/auth/supabase-client";

type Mode = "sign_in" | "sign_up";

export default function RootLoginScreen() {
  const { fontScale, gutter, isMedium, width } = useAdaptiveLayout();
  const {
    state,
    account,
    verificationEmail,
    message,
    isConfigured,
    signIn: customerSignIn,
    signUp,
    continueToSignIn,
  } = useCustomerAuth();
  const { provisionFirstOperator, linkOperator } = useSupabaseAuth();
  const { users, reload: reloadLocalOperator } = useLocalOperator();
  const [mode, setMode] = useState<Mode>("sign_in");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isBusy = isSubmitting || state === "authenticating" || state === "loading";
  const termsBlocked = mode === "sign_up" && !acceptedTerms;
  const submitDisabled = isBusy || !isConfigured || termsBlocked;
  const useSplitLayout =
    isMedium && width >= Layout.commerceMaxWidth && fontScale < 1.3;

  useEffect(() => {
    if (state === "authenticated" && account) {
      router.replace("/tienda" as Href);
    }
  }, [account, state]);

  const submit = async () => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      if (mode === "sign_in") {
        const client = getSupabaseClient();
        if (!client) throw new Error("Supabase no está configurado.");
        
        const { data, error } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (!data.session || !data.user) {
          throw new Error("Supabase no devolvió una sesión válida.");
        }

        const { data: operatorData } = await client
          .rpc("get_my_operator_context", { p_store_id: DEFAULT_STORE_ID })
          .single();

        const role = operatorData?.store_role;
        const isOperator = role === "owner" || role === "admin" || role === "seller";

        if (isOperator) {
          // Find if we already have a local user linked to this Supabase account
          let targetUser = users.find(u => u.authUserId === data.user.id);
          
          if (!targetUser) {
            // If not found, see if we can link an unlinked administrator (e.g. the Demo Admin)
            targetUser = users.find(u => u.role === "administrator" && !u.authUserId);
          }

          if (!targetUser) {
            // No available local user to link, so we must provision a new one
            await provisionFirstOperator({
              storeId: DEFAULT_STORE_ID,
              email,
              password,
              pin: "000000",
            });
          } else {
            // Link or just re-authenticate the existing local user
            await linkOperator(targetUser, { email, password });
          }
          await reloadLocalOperator();
          router.replace("/panel" as Href);
        } else {
          await customerSignIn(email, password);
        }
      } else {
        await signUp({ name, phone, email, password, acceptedTerms });
      }
    } catch (error: any) {
      setSubmitError(error.message || String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (state === "verification_required") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.topBar, { paddingHorizontal: gutter }]}>
          <BrandLogo mode="icon" size={32} />
        </View>
        <ScrollView
          contentContainerStyle={styles.verificationScroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.centered, { paddingHorizontal: gutter }]}>
            <View style={styles.mailIcon}>
              <MaterialCommunityIcons
                name="email-check-outline"
                size={42}
                color={BrandColors.greenDark}
              />
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              Revisa tu correo
            </Text>
            <Text style={styles.centerText}>
              Enviamos un enlace de verificación a {verificationEmail}. Confirma
              tu cuenta y luego inicia sesión.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMode("sign_in");
                continueToSignIn();
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>Ir a iniciar sesión</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={[styles.topBar, { paddingHorizontal: gutter, justifyContent: 'center' }]}>
        <BrandLogo mode="icon" size={42} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.accessLayout,
            useSplitLayout && styles.accessLayoutSplit,
          ]}
        >
          <View style={[styles.intro, useSplitLayout && styles.introSplit]}>
            <Text style={styles.eyebrow}>TU CUENTA</Text>
            <Text accessibilityRole="header" style={styles.title}>
              {mode === "sign_in" ? "Qué gusto verte." : "Crea tu cuenta."}
            </Text>
            <Text style={styles.subtitle}>
              {mode === "sign_in"
                ? "Consulta tus pedidos, direcciones y compras frecuentes."
                : "Tus datos se usarán para preparar y entregar tus pedidos."}
            </Text>
          </View>

          <View
            style={[
              styles.accountPanel,
              useSplitLayout && styles.accountPanelSplit,
            ]}
          >
            <View
              style={[styles.modeRow, useSplitLayout && styles.modeRowSplit]}
            >
              <ModeButton
                active={mode === "sign_in"}
                label="Iniciar sesión"
                onPress={() => setMode("sign_in")}
              />
              <ModeButton
                active={mode === "sign_up"}
                label="Registrarme"
                onPress={() => setMode("sign_up")}
              />
            </View>

            <View style={styles.form}>
              {mode === "sign_up" ? (
                <>
                  <CustomerInput
                    autoCapitalize="words"
                    label="Nombre completo"
                    onChangeText={setName}
                    placeholder="Nombres y apellidos"
                    value={name}
                  />
                  <CustomerInput
                    keyboardType="phone-pad"
                    label="Teléfono"
                    onChangeText={setPhone}
                    placeholder="999 999 999"
                    value={phone}
                  />
                </>
              ) : null}
              <CustomerInput
                autoCapitalize="none"
                keyboardType="email-address"
                label="Correo"
                onChangeText={setEmail}
                placeholder="nombre@correo.com"
                value={email}
              />
              <CustomerInput
                autoCapitalize="none"
                label="Contraseña"
                onChangeText={setPassword}
                placeholder="Mínimo 8 caracteres"
                secureTextEntry
                value={password}
              />
              {mode === "sign_in" ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => router.push("/cliente/recuperar" as Href)}
                  style={styles.textLink}
                >
                  <Text style={styles.recoveryLink}>Olvidé mi contraseña</Text>
                </Pressable>
              ) : null}

              {mode === "sign_up" ? (
                <>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: acceptedTerms }}
                    onPress={() => setAcceptedTerms((current) => !current)}
                    style={styles.consentRow}
                  >
                    <MaterialCommunityIcons
                      name={
                        acceptedTerms
                          ? "checkbox-marked"
                          : "checkbox-blank-outline"
                      }
                      size={24}
                      color={
                        acceptedTerms ? BrandColors.green : BrandColors.muted
                      }
                    />
                    <Text style={styles.consentText}>
                      Acepto los términos de servicio y la política de
                      privacidad.
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => router.push("/cliente/terminos" as Href)}
                    style={styles.textLink}
                  >
                    <Text style={styles.termsLink}>
                      Leer términos y privacidad
                    </Text>
                  </Pressable>
                </>
              ) : null}

              {!isConfigured ? (
                <View style={styles.warning}>
                  <MaterialCommunityIcons
                    name="cloud-off-outline"
                    size={18}
                    color={BrandColors.warning}
                  />
                  <Text style={styles.warningText}>
                    Configura las variables públicas de Supabase para habilitar
                    cuentas.
                  </Text>
                </View>
              ) : termsBlocked ? (
                <Text
                  accessibilityLiveRegion="polite"
                  accessibilityRole="alert"
                  style={styles.errorText}
                >
                  Acepta los términos y la política de privacidad para
                  continuar.
                </Text>
              ) : submitError || message ? (
                <Text
                  accessibilityLiveRegion="polite"
                  accessibilityRole="alert"
                  style={styles.errorText}
                >
                  {submitError || message}
                </Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: submitDisabled, busy: isBusy }}
                disabled={submitDisabled}
                onPress={() => void submit()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  submitDisabled && styles.disabled,
                  pressed && !submitDisabled && styles.pressed,
                ]}
              >
                {isBusy ? (
                  <LoadingLeaves color={BrandColors.white} />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {mode === "sign_in" ? "Entrar" : "Crear cuenta"}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function ModeButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeButton,
        active && styles.modeButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.modeText, active && styles.modeTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function CustomerInput({
  label,
  ...props
}: ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        {...props}
        placeholderTextColor={BrandColors.muted}
        style={styles.input}
      />
    </View>
  );
}

function LoadingLeaves({ color }: { color: string }) {
  const leaf1 = useRef(new Animated.Value(0)).current;
  const leaf2 = useRef(new Animated.Value(0)).current;
  const leaf3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let isMounted = true;
    const startAnim = (anim: Animated.Value, delay: number) => {
      setTimeout(() => {
        if (!isMounted) return;
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, {
              toValue: 1,
              duration: 750,
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0,
              duration: 750,
              useNativeDriver: true,
            }),
          ])
        ).start();
      }, delay);
    };

    startAnim(leaf1, 0);
    startAnim(leaf2, 300);
    startAnim(leaf3, 600);

    return () => {
      isMounted = false;
    };
  }, [leaf1, leaf2, leaf3]);

  const getStyle = (anim: Animated.Value) => ({
    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.1] }) }],
  });

  return (
    <View style={styles.leavesRow}>
      <Animated.View style={getStyle(leaf1)}>
        <MaterialCommunityIcons name="leaf" size={20} color={color} />
      </Animated.View>
      <Animated.View style={getStyle(leaf2)}>
        <MaterialCommunityIcons name="leaf" size={20} color={color} />
      </Animated.View>
      <Animated.View style={getStyle(leaf3)}>
        <MaterialCommunityIcons name="leaf" size={20} color={color} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: BrandColors.cream },
  topBar: {
    minHeight: 82,
    width: "100%",
    maxWidth: Layout.commerceMaxWidth,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: Layout.commerceMaxWidth,
    alignSelf: "center",
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  accessLayout: { flexGrow: 1 },
  accessLayoutSplit: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xl,
  },
  intro: { minWidth: 0, marginBottom: Spacing.xl },
  introSplit: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 260,
    marginBottom: 0,
  },
  eyebrow: {
    color: BrandColors.green,
    ...Typography.overline,
  },
  title: {
    color: BrandColors.text,
    ...Typography.h1,
    marginTop: Spacing.xs,
  },
  subtitle: {
    color: BrandColors.muted,
    ...Typography.body,
    marginTop: Spacing.xs,
  },
  modeRow: {
    flexDirection: "row",
    backgroundColor: BrandColors.surfaceMuted,
    borderRadius: Radius.md,
    padding: Spacing.xxs,
  },
  modeRowSplit: { marginTop: 0 },
  modeButton: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  modeButtonActive: { backgroundColor: BrandColors.white },
  modeText: { color: BrandColors.muted, ...Typography.label },
  modeTextActive: { color: BrandColors.greenDark },
  accountPanel: { minWidth: 0 },
  accountPanelSplit: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 340,
    minWidth: 320,
    alignSelf: "center",
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    padding: Spacing.lg,
  },
  form: { gap: Spacing.sm, marginTop: Spacing.lg },
  field: { gap: Spacing.xs },
  label: { color: BrandColors.text, ...Typography.label },
  input: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    ...Typography.body,
    paddingHorizontal: Spacing.sm,
  },
  consentRow: {
    minHeight: ControlSize.default,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  consentText: {
    flex: 1,
    color: BrandColors.muted,
    ...Typography.caption,
  },
  primaryButton: {
    minHeight: ControlSize.large,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.green,
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.xs,
  },
  primaryButtonText: { color: BrandColors.white, ...Typography.label },
  disabled: { opacity: Interaction.disabledOpacity },
  warning: {
    borderRadius: Radius.md,
    backgroundColor: BrandColors.goldLight,
    padding: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  warningText: { flex: 1, color: BrandColors.warning, ...Typography.caption },
  errorText: { color: BrandColors.danger, ...Typography.caption },
  textLink: { minHeight: ControlSize.default, justifyContent: "center" },
  recoveryLink: {
    color: BrandColors.greenDark,
    ...Typography.label,
    textAlign: "right",
  },
  termsLink: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
    marginLeft: Spacing.xxl,
  },
  verificationScroll: { flexGrow: 1, paddingBottom: Spacing.xxl },
  centered: {
    flex: 1,
    width: "100%",
    maxWidth: Layout.dialogMaxWidth,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.xxl,
    gap: Spacing.sm,
  },
  mailIcon: {
    width: 76,
    height: 76,
    borderRadius: Radius.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.greenLight,
    marginBottom: Spacing.xs,
  },
  centerText: {
    color: BrandColors.muted,
    ...Typography.body,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  leavesRow: {
    flexDirection: "row",
    gap: Spacing.xxs,
    justifyContent: "center",
    alignItems: "center",
  },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
  staffAccessContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    alignSelf: "center",
    padding: Spacing.md,
    marginTop: Spacing.xxl,
  },
  staffAccessText: {
    color: BrandColors.mutedLight,
    ...Typography.caption,
  },
});
