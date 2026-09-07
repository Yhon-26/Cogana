import { StatusBar } from "expo-status-bar";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Google from "expo-auth-session/providers/google";
import { router, type Href } from "expo-router";
import { memo, type ComponentProps, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
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
type SignInMethod = "password" | "phone";

export default function RootLoginScreen() {
  const { fontScale } = useAdaptiveLayout();
  const {
    state,
    account,
    verificationEmail,
    message,
    isConfigured,
    signIn: customerSignIn,
    signUp,
    signInWithOtpPhone,
    verifyPhoneOtp,
    signInWithIdToken,
    continueToSignIn,
    signOut: customerSignOut,
  } = useCustomerAuth();
  const { provisionFirstOperator, linkOperator } = useSupabaseAuth();
  const { users, selectedUser, reload: reloadLocalOperator } = useLocalOperator();
  const [mode, setMode] = useState<Mode>("sign_in");
  const [method, setMethod] = useState<SignInMethod>("password");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Al arrancar con una sesión guardada se muestra el chip de sesión activa
  // en lugar de entrar automáticamente, para permitir cambiar de cuenta.
  const suppressAutoEntryRef = useRef(true);
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [biometryReady, setBiometryReady] = useState(false);

  const hasCustomerSession = state === "authenticated" && account !== null;
  const hasOperatorSession = selectedUser !== null && users.length > 0;
  const isBusy =
    isSubmitting || state === "authenticating" || state === "loading";
  const termsBlocked = mode === "sign_up" && !acceptedTerms;
  const submitDisabled = isBusy || !isConfigured || termsBlocked;

  // Google Sign-In: los client IDs llegan por variables EXPO_PUBLIC_*. El
  // nonce se firma en SHA-256 para Google y viaja en claro a Supabase.
  const googleWebClientId =
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined;
  const googleIosClientId =
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || undefined;
  const googleAndroidClientId =
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || undefined;
  const googleNonce = useMemo(() => Crypto.randomUUID(), []);
  const [googleNonceHash, setGoogleNonceHash] = useState("");
  useEffect(() => {
    void Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      googleNonce
    ).then(setGoogleNonceHash);
  }, [googleNonce]);
  const [googleRequest, googleResponse, promptAsync] =
    Google.useIdTokenAuthRequest({
      clientId: googleWebClientId,
      iosClientId: googleIosClientId,
      androidClientId: googleAndroidClientId,
      extraParams: googleNonceHash ? { nonce: googleNonceHash } : undefined,
    });

  useEffect(() => {
    if (googleResponse?.type !== "success") return;
    const idToken = googleResponse.params?.id_token;
    if (!idToken) return;
    void (async () => {
      try {
        await signInWithIdToken("google", idToken, googleNonce);
        router.replace("/tienda" as Href);
      } catch (caughtError) {
        Alert.alert(
          "No se pudo entrar con Google",
          caughtError instanceof Error
            ? caughtError.message
            : "Intenta nuevamente.",
        );
      }
    })();
  }, [googleNonce, googleResponse, signInWithIdToken]);

  useEffect(() => {
    void (async () => {
      try {
        const [hasHardware, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        setBiometryReady(hasHardware && enrolled);
      } catch {
        setBiometryReady(false);
      }
    })();
  }, []);

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

  const continueOperatorSession = () => {
    suppressAutoEntryRef.current = false;
    router.replace("/panel" as Href);
  };

  const switchToAnotherAccount = async () => {
    setSubmitError(null);
    setMode("sign_in");
    await customerSignOut();
  };

  const handleBiometry = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Entra a tu cuenta de Cogana",
        cancelLabel: "Usar contraseña",
      });
      if (result.success) continueCustomerSession();
    } catch {
      // El usuario canceló o la biometría falló: queda el flujo por correo.
    }
  };

  const normalizeOtpPhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (!digits) return "";
    return value.trim().startsWith("+") ? `+${digits}` : `+51${digits}`;
  };

  const sendOtp = async () => {
    setSubmitError(null);
    if (!otpPhone.replace(/\D/g, "")) {
      setSubmitError("Ingresa tu número de celular.");
      return;
    }
    setIsSubmitting(true);
    try {
      await signInWithOtpPhone(normalizeOtpPhone(otpPhone));
      setOtpSent(true);
      setOtpCode("");
    } catch (caughtError) {
      setSubmitError(
        caughtError instanceof Error
          ? caughtError.message
          : "No se pudo enviar el código.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyOtp = async () => {
    setSubmitError(null);
    if (!otpCode.trim()) {
      setSubmitError("Ingresa el código que te enviamos por SMS.");
      return;
    }
    setIsSubmitting(true);
    try {
      await verifyPhoneOtp(normalizeOtpPhone(otpPhone), otpCode.trim());
      suppressAutoEntryRef.current = false;
      router.replace("/tienda" as Href);
    } catch (caughtError) {
      setSubmitError(
        caughtError instanceof Error
          ? caughtError.message
          : "No se pudo verificar el código.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApplePress = async () => {
    setSubmitError(null);
    try {
      const nonce = Crypto.randomUUID();
      const nonceHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        nonce,
      );
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: nonceHash,
      });
      if (!credential.identityToken) {
        throw new Error("Apple no devolvió un token de identidad.");
      }
      await signInWithIdToken("apple", credential.identityToken, nonce);
      suppressAutoEntryRef.current = false;
      router.replace("/tienda" as Href);
    } catch (caughtError) {
      if (
        caughtError &&
        typeof caughtError === "object" &&
        "code" in caughtError &&
        caughtError.code === "ERR_CANCELED"
      ) {
        return;
      }
      setSubmitError(
        caughtError instanceof Error
          ? caughtError.message
          : "No se pudo entrar con Apple.",
      );
    }
  };

  const handleGooglePress = () => {
    setSubmitError(null);
    if (!googleWebClientId && !googleIosClientId && !googleAndroidClientId) {
      Alert.alert(
        "Google aún no está configurado",
        "Habilita el proveedor Google en Supabase y define EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID en el archivo .env.",
      );
      return;
    }
    void promptAsync();
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
        <View style={styles.topBar}>
          <BrandLogo mode="icon" size={32} />
        </View>
        <ScrollView
          contentContainerStyle={styles.verificationScroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.centered}>
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
              <Text style={styles.primaryButtonText}>
                Ir a iniciar sesión
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const resumeName = hasCustomerSession
    ? (account?.name ?? "cliente")
    : (selectedUser?.displayName ?? "operador");

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <StatusBar />
      <DecorativeLeaves />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {hasCustomerSession || hasOperatorSession ? (
            <View style={styles.resumeRow}>
              <Pressable
                accessibilityLabel={
                  hasCustomerSession
                    ? `Continuar como ${resumeName}`
                    : `Volver al panel de ${resumeName}`
                }
                accessibilityRole="button"
                onPress={
                  hasCustomerSession
                    ? continueCustomerSession
                    : continueOperatorSession
                }
                style={({ pressed }) => [
                  styles.resumeChip,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.resumeAvatar}>
                  <MaterialCommunityIcons
                    name={
                      hasCustomerSession
                        ? "account-outline"
                        : "storefront-outline"
                    }
                    size={18}
                    color={BrandColors.greenDark}
                  />
                </View>
                <Text numberOfLines={1} style={styles.resumeText}>
                  Continuar como {resumeName}
                </Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={18}
                  color={BrandColors.greenDark}
                />
              </Pressable>
              {hasCustomerSession ? (
                <Pressable
                  accessibilityLabel="Usar otra cuenta"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => void switchToAnotherAccount()}
                  style={({ pressed }) => [
                    styles.resumeChange,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.resumeChangeText}>Cambiar</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.card, fontScale > 1.3 && styles.cardWide]}>
            <View style={styles.brandMark}>
              <MaterialCommunityIcons
                name="sprout"
                size={30}
                color={BrandColors.green}
              />
            </View>
            <Text maxFontSizeMultiplier={1.3} style={styles.cardTitle}>
              {mode === "sign_in"
                ? method === "phone"
                  ? "Entrar con celular"
                  : "Bienvenido"
                : "Crea tu cuenta"}
            </Text>
            <Text style={styles.cardSubtitle}>
              {mode === "sign_up"
                ? "Tus datos se usan para preparar y entregar tus pedidos."
                : method === "phone"
                  ? "Te enviaremos un código por SMS para verificar tu número."
                  : "Ingresa a tu cuenta para ver tus pedidos."}
            </Text>

            {mode === "sign_in" && method === "phone" ? (
              <>
                {otpSent ? (
                  <>
                    <Text style={styles.otpHint}>
                      Código enviado por SMS al {normalizeOtpPhone(otpPhone)}
                    </Text>
                    <View style={styles.field}>
                      <Text style={styles.label}>Código de verificación</Text>
                      <View style={styles.inputWrap}>
                        <MaterialCommunityIcons
                          name="shield-key-outline"
                          size={20}
                          color={BrandColors.mutedLight}
                        />
                        <TextInput
                          accessibilityLabel="Código de verificación"
                          keyboardType="number-pad"
                          maxLength={6}
                          placeholder="123456"
                          placeholderTextColor={BrandColors.muted}
                          style={styles.input}
                          value={otpCode}
                          onChangeText={(value) =>
                            setOtpCode(value.replace(/\D/g, ""))
                          }
                        />
                      </View>
                    </View>
                    {submitError ? (
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
                      accessibilityState={{ disabled: isBusy }}
                      disabled={isBusy}
                      onPress={() => void verifyOtp()}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        isBusy && styles.disabled,
                        pressed && !isBusy && styles.pressed,
                      ]}
                    >
                      {isBusy ? (
                        <LoadingLeaves color={BrandColors.white} />
                      ) : (
                        <Text style={styles.primaryButtonText}>
                          Verificar y entrar
                        </Text>
                      )}
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setOtpSent(false);
                        setOtpCode("");
                        setSubmitError(null);
                      }}
                      style={styles.inlineLink}
                    >
                      <Text style={styles.inlineLinkText}>
                        Cambiar el número
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <View style={styles.field}>
                      <Text style={styles.label}>Celular</Text>
                      <View style={styles.inputWrap}>
                        <Text style={styles.phonePrefix}>+51</Text>
                        <View style={styles.phoneDivider} />
                        <TextInput
                          accessibilityLabel="Número de celular"
                          autoComplete="tel"
                          keyboardType="phone-pad"
                          maxLength={9}
                          placeholder="999 999 999"
                          placeholderTextColor={BrandColors.muted}
                          style={styles.input}
                          value={otpPhone}
                          onChangeText={(value) =>
                            setOtpPhone(value.replace(/[^\d\s]/g, ""))
                          }
                        />
                      </View>
                    </View>
                    {submitError ? (
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
                      accessibilityState={{ disabled: isBusy }}
                      disabled={isBusy}
                      onPress={() => void sendOtp()}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        isBusy && styles.disabled,
                        pressed && !isBusy && styles.pressed,
                      ]}
                    >
                      {isBusy ? (
                        <LoadingLeaves color={BrandColors.white} />
                      ) : (
                        <Text style={styles.primaryButtonText}>
                          Enviar código por SMS
                        </Text>
                      )}
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setMethod("password");
                        setSubmitError(null);
                      }}
                      style={styles.inlineLink}
                    >
                      <Text style={styles.inlineLinkText}>
                        Usar correo y contraseña
                      </Text>
                    </Pressable>
                  </>
                )}
              </>
            ) : (
              <>
                {mode === "sign_up" ? (
                  <>
                    <CustomerInput
                      key="name"
                      autoCapitalize="words"
                      autoComplete="name"
                      icon="account-outline"
                      label="Nombre completo"
                      onChangeText={setName}
                      placeholder="Nombres y apellidos"
                      value={name}
                    />
                    <CustomerInput
                      key="phone"
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
                  key="email"
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
                  key="password"
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
                    style={styles.recoveryRow}
                  >
                    <Text style={styles.recoveryLink}>
                      Olvidé mi contraseña
                    </Text>
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
                        size={22}
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
                      style={styles.inlineLink}
                    >
                      <Text style={styles.inlineLinkText}>
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
                      Configura las variables públicas de Supabase para
                      habilitar cuentas.
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
                  accessibilityState={{
                    disabled: submitDisabled,
                    busy: isBusy,
                  }}
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
              </>
            )}

            {mode === "sign_in" ? (
              <>
                {biometryReady && hasCustomerSession ? (
                  <Pressable
                    accessibilityLabel="Entrar con huella o Face ID"
                    accessibilityRole="button"
                    onPress={() => void handleBiometry()}
                    style={({ pressed }) => [
                      styles.biometryButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="fingerprint"
                      size={20}
                      color={BrandColors.greenDark}
                    />
                    <Text style={styles.biometryText}>
                      Usar huella o Face ID
                    </Text>
                  </Pressable>
                ) : null}

                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>o continúa con</Text>
                  <View style={styles.dividerLine} />
                </View>

                <View style={styles.socialRow}>
                  <SocialButton
                    accessibilityLabel="Entrar con Google"
                    icon="google"
                    onPress={handleGooglePress}
                    active={googleRequest !== null}
                  />
                  {Platform.OS === "ios" ? (
                    <SocialButton
                      accessibilityLabel="Entrar con Apple"
                      icon="apple"
                      onPress={() => void handleApplePress()}
                      active={false}
                    />
                  ) : null}
                  <SocialButton
                    accessibilityLabel="Entrar con código por SMS"
                    icon="message-text-outline"
                    onPress={() => {
                      setMethod(
                        method === "phone" ? "password" : "phone",
                      );
                      setSubmitError(null);
                    }}
                    active={method === "phone"}
                  />
                </View>

                <Pressable
                  accessibilityRole="button"
                  onPress={() => setMode("sign_up")}
                  style={styles.modeFooter}
                >
                  <Text style={styles.modeFooterText}>
                    ¿No tienes cuenta?{" "}
                    <Text style={styles.modeFooterLink}>Regístrate</Text>
                  </Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setMode("sign_in");
                  setSubmitError(null);
                }}
                style={styles.modeFooter}
              >
                <Text style={styles.modeFooterText}>
                  ¿Ya tienes cuenta?{" "}
                  <Text style={styles.modeFooterLink}>Inicia sesión</Text>
                </Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DecorativeLeaves() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    >
      <MaterialCommunityIcons
        name="leaf"
        size={96}
        color={BrandColors.green}
        style={styles.leafTopLeft}
      />
      <MaterialCommunityIcons
        name="leaf"
        size={64}
        color={BrandColors.green}
        style={styles.leafTopRight}
      />
      <MaterialCommunityIcons
        name="leaf"
        size={110}
        color={BrandColors.green}
        style={styles.leafBottomLeft}
      />
      <MaterialCommunityIcons
        name="leaf"
        size={72}
        color={BrandColors.green}
        style={styles.leafBottomRight}
      />
    </View>
  );
}

const SocialButton = memo(function SocialButton({
  icon,
  onPress,
  accessibilityLabel,
  active,
}: {
  icon: ComponentProps<typeof MaterialCommunityIcons>["name"];
  onPress: () => void;
  accessibilityLabel: string;
  active: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.socialButton,
        active && styles.socialButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={24} color={BrandColors.ink} />
    </Pressable>
  );
});

function LoadingLeaves({ color }: { color: string }) {
  const leaf1 = useRef(new Animated.Value(0)).current;
  const leaf2 = useRef(new Animated.Value(0)).current;
  const leaf3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const loops: Animated.CompositeAnimation[] = [];
    const startAnim = (anim: Animated.Value, delay: number) => {
      timers.push(
        setTimeout(() => {
          const loop = Animated.loop(
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
          );
          loops.push(loop);
          loop.start();
        }, delay)
      );
    };

    startAnim(leaf1, 0);
    startAnim(leaf2, 300);
    startAnim(leaf3, 600);

    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((loop) => loop.stop());
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: BrandColors.greenDark,
  },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  leafTopLeft: {
    position: "absolute",
    top: -18,
    left: -14,
    opacity: 0.16,
    transform: [{ rotate: "35deg" }],
  },
  leafTopRight: {
    position: "absolute",
    top: 40,
    right: -10,
    opacity: 0.13,
    transform: [{ rotate: "-30deg" }],
  },
  leafBottomLeft: {
    position: "absolute",
    bottom: -24,
    left: -18,
    opacity: 0.14,
    transform: [{ rotate: "-25deg" }],
  },
  leafBottomRight: {
    position: "absolute",
    bottom: 30,
    right: -16,
    opacity: 0.18,
    transform: [{ rotate: "30deg" }],
  },
  resumeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  resumeChip: {
    flex: 1,
    minHeight: ControlSize.compact,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    backgroundColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  resumeAvatar: {
    width: 30,
    height: 30,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  resumeText: {
    flex: 1,
    color: BrandColors.white,
    ...Typography.caption,
  },
  resumeChange: {
    minHeight: ControlSize.compact,
    justifyContent: "center",
    paddingHorizontal: Spacing.xs,
  },
  resumeChangeText: {
    color: BrandColors.gold,
    ...Typography.caption,
    fontWeight: "700",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    borderRadius: 28,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
    ...Elevation.ambientCard,
  },
  cardWide: { maxWidth: 480 },
  brandMark: {
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xxs,
  },
  cardTitle: {
    color: BrandColors.text,
    ...Typography.h2,
    textAlign: "center",
  },
  cardSubtitle: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  field: { gap: Spacing.xxs },
  label: { color: BrandColors.text, ...Typography.label },
  inputWrap: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  inputWrapFocused: { borderColor: BrandColors.green },
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
    width: ControlSize.compact,
    height: ControlSize.compact,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -Spacing.xxs,
  },
  phonePrefix: {
    color: BrandColors.greenDark,
    ...Typography.body,
    fontWeight: "700",
  },
  phoneDivider: {
    width: 1,
    height: 22,
    backgroundColor: BrandColors.line,
  },
  recoveryRow: {
    alignSelf: "flex-end",
    marginTop: -Spacing.xxs,
  },
  recoveryLink: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
  },
  consentText: {
    flex: 1,
    color: BrandColors.muted,
    ...Typography.caption,
  },
  warning: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.goldLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  warningText: {
    flex: 1,
    color: BrandColors.warning,
    ...Typography.caption,
  },
  errorText: {
    color: BrandColors.danger,
    ...Typography.caption,
    textAlign: "center",
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.xxs,
    ...Elevation.ambientCard,
  },
  primaryButtonText: {
    color: BrandColors.white,
    ...Typography.label,
  },
  inlineLink: {
    alignSelf: "center",
    paddingVertical: Spacing.xxs,
  },
  inlineLinkText: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
  },
  otpHint: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
  },
  biometryButton: {
    minHeight: ControlSize.default,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  biometryText: {
    color: BrandColors.greenDark,
    ...Typography.label,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: BrandColors.line,
  },
  dividerText: {
    color: BrandColors.muted,
    ...Typography.caption,
  },
  socialRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  socialButton: {
    width: 56,
    height: 56,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
    ...Elevation.ambientCard,
  },
  socialButtonActive: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
  },
  modeFooter: {
    alignItems: "center",
    paddingVertical: Spacing.xxs,
  },
  modeFooterText: {
    color: BrandColors.muted,
    ...Typography.caption,
  },
  modeFooterLink: {
    color: BrandColors.greenDark,
    fontWeight: "700",
  },
  leavesRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
  topBar: {
    alignItems: "center",
    paddingTop: Spacing.lg,
  },
  verificationScroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: Spacing.xl,
  },
  centered: {
    alignItems: "center",
    gap: Spacing.sm,
  },
  mailIcon: {
    width: 72,
    height: 72,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xxs,
  },
  title: {
    color: BrandColors.text,
    ...Typography.h2,
    textAlign: "center",
  },
  centerText: {
    color: BrandColors.muted,
    ...Typography.body,
    textAlign: "center",
  },
  disabled: { opacity: Interaction.disabledOpacity },
});
