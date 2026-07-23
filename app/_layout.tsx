import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { BrandColors } from '@/constants/theme';
import { StoreProvider } from '@/context/store-context';

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
    <StoreProvider>
      <ThemeProvider value={navigationTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
        <StatusBar style="light" />
      </ThemeProvider>
    </StoreProvider>
  );
}
