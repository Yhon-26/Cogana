import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense } from 'react';
import 'react-native-reanimated';

import { DatabaseErrorBoundary, DatabaseLoadingScreen } from '@/components/database-boundary';
import { BrandColors } from '@/constants/theme';
import { StoreProvider } from '@/context/store-context';
import { DATABASE_NAME, initializeDatabase } from '@/database';

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

export default function RootLayout() {
  return (
    <DatabaseErrorBoundary>
      <Suspense fallback={<DatabaseLoadingScreen />}>
        <SQLiteProvider
          databaseName={DATABASE_NAME}
          onInit={initializeDatabase}
          useSuspense>
          <StoreProvider>
            <ThemeProvider value={navigationTheme}>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
              </Stack>
              <StatusBar style="light" />
            </ThemeProvider>
          </StoreProvider>
        </SQLiteProvider>
      </Suspense>
    </DatabaseErrorBoundary>
  );
}
