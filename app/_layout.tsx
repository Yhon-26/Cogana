import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { SQLiteProvider } from "expo-sqlite";
import { Suspense, useEffect, useState } from "react";
import { AutoSyncCoordinator } from "@/components/auto-sync-coordinator";
import {
  DatabaseErrorBoundary,
  DatabaseLoadingScreen,
} from "@/components/database-boundary";
import { BrandColors } from "@/constants/theme";
import { AppPreferencesProvider } from "@/context/app-preferences-context";
import {
  CustomerAuthProvider,
  useCustomerAuth,
} from "@/context/customer-auth-context";
import { LocalOperatorProvider } from "@/context/local-operator-context";
import { SupabaseAuthProvider } from "@/context/supabase-auth-context";
import { DATABASE_NAME, initializeDatabase } from "@/database";
import { useAppStackScreenOptions } from "@/hooks/use-app-stack-screen-options";
import "react-native-reanimated";

// Tipografías corporativas: Outfit para títulos y precios, Plus Jakarta Sans
// para texto de lectura. Fijarlas evita que la fuente del sistema del teléfono
// (a veces manuscrita) contamine la identidad de la marca.
import {
  Outfit_700Bold,
  Outfit_800ExtraBold,
} from "@expo-google-fonts/outfit";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from "@expo-google-fonts/plus-jakarta-sans";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: BrandColors.green,
    background: BrandColors.cream,
    card: BrandColors.white,
    text: BrandColors.text,
    border: BrandColors.line,
  },
};

function RootNavigator() {
  const { state, account } = useCustomerAuth();
  const screenOptions = useAppStackScreenOptions();
  const hasCustomerSession = state === "authenticated" && account !== null;
  const [minSplashTimeElapsed, setMinSplashTimeElapsed] = useState(false);
  const [fontsLoaded] = useFonts({
    Outfit_700Bold,
    Outfit_800ExtraBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setMinSplashTimeElapsed(true);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  const isAppReady = state !== "loading" && minSplashTimeElapsed && fontsLoaded;

  useEffect(() => {
    if (isAppReady) {
      SplashScreen.hideAsync();
    }
  }, [isAppReady]);

  if (!isAppReady) {
    return <DatabaseLoadingScreen />;
  }

  return (
    <ThemeProvider value={navigationTheme}>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="index" />
        <Stack.Screen name="cliente" />
        <Stack.Screen name="(tabs)" />
        <Stack.Protected guard={hasCustomerSession}>
          <Stack.Screen name="tienda" />
          <Stack.Screen name="negocio" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <DatabaseErrorBoundary>
      <Suspense fallback={<DatabaseLoadingScreen />}>
        <SQLiteProvider
          databaseName={DATABASE_NAME}
          onInit={initializeDatabase}
          useSuspense
        >
          <SupabaseAuthProvider>
            <CustomerAuthProvider>
              <LocalOperatorProvider>
                <AppPreferencesProvider>
                  <AutoSyncCoordinator />
                  <RootNavigator />
                </AppPreferencesProvider>
              </LocalOperatorProvider>
            </CustomerAuthProvider>
          </SupabaseAuthProvider>
        </SQLiteProvider>
      </Suspense>
    </DatabaseErrorBoundary>
  );
}
