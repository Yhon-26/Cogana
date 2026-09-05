import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { type ComponentProps, useEffect, useState, useRef } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandLogo } from "@/components/brand-logo";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";

import {
  BrandColors,
  ComponentMetrics,
  ControlSize,
  Elevation,
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
    signOut: customerSignOut,
  } = useCustomerAuth();
  const { provisionFirstOperator, linkOperator } = useSupabaseAuth();
  const { users, selectedUser, reload: reloadLocalOperator } = useLocalOperator();
  const [mode, setMode] = useState<Mode>("sign_in");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Al arrancar con una sesión guardada se muestran las tarjetas de sesión
  // activa en lugar de entrar automáticamente, para permitir cambiar de cuenta.
  const suppressAutoEntryRef = useRef(true);

  const isBusy = isSubmitting || state === "authenticating" || state === "loading";
  const termsBlocked = mode === "sign_up" && !acceptedTerms;
  const submitDisabled = isBusy || !isConfigured || termsBlocked;
  const useSplitLayout =
    isMedium && width >= Layout.commerceMaxWidth && fontScale < 1.3;
  const hasCustomerSession = state === "authenticated" && account !== null;
  const hasOperatorSession = selectedUser !== null && users.length > 0;

  useEffect(() => {
    if (suppressAutoEntryRef.current) return;
    if (hasCustomerSession) {
      router.replace("/tienda" as Href);
    }
  }, [hasCustomerSession]);

  const continueCustomerSession = () => {
    suppressAutoEntryRef.current = false;
    router.replace("/tienda" as Href);
  };

  const switchToAnotherAccount = async () => {
    setSubmitError(null);
    setMode("sign_in");
    await customerSignOut();
  };

  const submit = async () => {
    setSubmitError(null);
    setIsSubmitting(true);
    // Ingreso activo desde el formulario: el efecto de sesión decide la ruta.
    suppressAutoEntryRef.current = false;
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

        // Las cuentas se dirigen según su tipo de registro: las creadas desde
        // la app son clientes y van a la tienda; las de dueño/personal se
        // registran en Supabase y van al panel operativo.
        const metadata = data.user.user_metadata as
          | Record<string, unknown>
          | null;
        const accountType =
          typeof metadata?.account_type === "string"
            ? metadata.account_type
            : null;

        if (accountType === "customer") {
          await customerSignIn(email, password);
          return;
        }

        const { data: operatorData, error: operatorError } = await client
          .rpc("get_my_operator_context", { p_store_id: DEFAULT_STORE_ID })
          .single();

        const role = (
          operatorData as { store_role?: string } | null
        )?.store_role;
        const isOperator =
          !operatorError && (role === "owner" || role === "admin");

        if (!isOperator) {
          throw new Error(
            "Esta cuenta no tiene acceso como personal de la tienda ni está registrada como cliente."
          );
        }

        // Find if we already have a local user linked to this Supabase account
        let targetUser = users.find(u => u.authUserId === data.user.id);

        if (!targetUser) {
          // If not found, see if we can link an unlinked administrator (e.g. the Demo Admin)
          targetUser = users.find(u => u.role === "administrator" && !u.authUserId);
        }

        if (!targetUser) {
          // Provision without PIN; el PIN se crea explícitamente después
          // desde el selector de operadores.
          await provisionFirstOperator({
            storeId: DEFAULT_STORE_ID,
            email,
            password,
          });
        } else {
          // Link or just re-authenticate the existing local user
          await linkOperator(targetUser, { email, password });
        }
        await reloadLocalOperator();
        router.replace("/panel" as Href);
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
      <KeyboardAvoidingView
        behavior="padding"
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.accessLayout,
              useSplitLayout && styles.accessLayoutSplit,
            ]}
          >
          {hasCustomerSession || hasOperatorSession ? (
            <View style={styles.sessionStack}>
              {hasOperatorSession ? (
                <View style={styles.sessionCard}>
                  <View style={[styles.sessionIcon, styles.sessionIconStaff]}>
                    <MaterialCommunityIcons
                      name="storefront"
                      size={22}
                      color={BrandColors.greenDark}
                    />
                  </View>
                  <View style={styles.sessionInfo}>
                    <Text style={styles.sessionEyebrow}>SESIÓN DE TIENDA</Text>
                    <Text numberOfLines={1} style={styles.sessionName}>
                      {selectedUser?.displayName ?? "Operador"}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.replace("/panel" as Href)}
                    style={({ pressed }) => [
                      styles.sessionAction,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.sessionActionText}>Entrar al panel</Text>
                  </Pressable>
                </View>
              ) : null}
              {hasCustomerSession && account ? (
                <View style={styles.sessionCard}>
                  <View style={styles.sessionIcon}>
                    <MaterialCommunityIcons
                      name="account-circle-outline"
                      size={22}
                      color={BrandColors.greenDark}
                    />
                  </View>
                  <View style={styles.sessionInfo}>
                    <Text style={styles.sessionEyebrow}>SESIÓN ACTIVA</Text>
                    <Text numberOfLines={1} style={styles.sessionName}>
                      {account.name}
                    </Text>
                  </View>
                  <View style={styles.sessionActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={continueCustomerSession}
                      style={({ pressed }) => [
                        styles.sessionAction,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.sessionActionText}>
                        Ir a la tienda
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void switchToAnotherAccount()}
                      style={({ pressed }) => [
                        styles.sessionSecondary,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.sessionSecondaryText}>
                        Usar otra cuenta
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}
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
                    autoComplete="name"
                    icon="account-outline"
                    label="Nombre completo"
                    onChangeText={setName}
                    placeholder="Nombres y apellidos"
                    value={name}
                  />
                  <CustomerInput
                    autoComplete="tel"
                    icon="phone-outline"
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
                autoComplete="email"
                icon="email-outline"
                keyboardType="email-address"
                label="Correo"
                onChangeText={setEmail}
                placeholder="nombre@correo.com"
                value={email}
              />
              <CustomerInput
                autoCapitalize="none"
                autoComplete={mode === "sign_up" ? "new-password" : "password"}
                icon="lock-outline"
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
      </KeyboardAvoidingView>
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
  icon,
  label,
  secureTextEntry = false,
  onFocus,
  onBlur,
  ...props
}: ComponentProps<typeof TextInput> & {
  icon: ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
}) {
  const [isFieldFocused, setIsFieldFocused] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <View
        style={[styles.inputWrap, isFieldFocused && styles.inputWrapFocused]}
      >
        <MaterialCommunityIcons
          name={icon}
          size={20}
          color={isFieldFocused ? BrandColors.green : BrandColors.mutedLight}
        />
        <TextInput
          {...props}
          accessibilityLabel={label}
          maxFontSizeMultiplier={1.5}
          secureTextEntry={secureTextEntry && !isPasswordVisible}
          style={styles.input}
          onBlur={(event) => {
            setIsFieldFocused(false);
            onBlur?.(event);
          }}
          onFocus={(event) => {
            setIsFieldFocused(true);
            onFocus?.(event);
          }}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityLabel={
              isPasswordVisible
                ? "Ocultar contraseña"
                : "Mostrar contraseña"
            }
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => setIsPasswordVisible((current) => !current)}
            style={({ pressed }) => [styles.eyeButton, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons
              name={isPasswordVisible ? "eye-off-outline" : "eye-outline"}
              size={22}
              color={BrandColors.muted}
            />
          </Pressable>
        ) : null}
      </View>
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
  flex: { flex: 1 },
  topBar: {
    minHeight: 56,
    width: "100%",
    maxWidth: Layout.commerceMaxWidth,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: Layout.commerceMaxWidth,
    alignSelf: "center",
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  accessLayout: { flexGrow: 1 },
  sessionStack: { gap: Spacing.sm, marginBottom: Spacing.xl },
  sessionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    padding: Spacing.md,
    ...Elevation.ambientCard,
  },
  sessionIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.greenLight,
  },
  sessionIconStaff: { backgroundColor: BrandColors.goldLight },
  sessionInfo: { flex: 1, minWidth: 0 },
  sessionEyebrow: { color: BrandColors.muted, ...Typography.overline },
  sessionName: {
    color: BrandColors.text,
    ...Typography.label,
    marginTop: 2,
  },
  sessionActions: { alignItems: "flex-end", gap: Spacing.xxs },
  sessionAction: {
    minHeight: ControlSize.compact,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.green,
    paddingHorizontal: Spacing.md,
  },
  sessionActionText: { color: BrandColors.white, ...Typography.label },
  sessionSecondary: {
    minHeight: ControlSize.compact,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.greenLight,
    paddingHorizontal: Spacing.md,
  },
  sessionSecondaryText: { color: BrandColors.greenDark, ...Typography.label },
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
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm + 2,
  },
  inputWrapFocused: {
    borderColor: BrandColors.green,
    ...Elevation.ambientCard,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: BrandColors.text,
    ...Typography.body,
    paddingVertical: 13,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  eyeButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -Spacing.xxs,
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
    ...Elevation.ambientCard,
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
