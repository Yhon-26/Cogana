import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CUSTOMER_REFRESH_TOKEN_KEY = 'cogana.auth.customer.refresh';

export async function readCustomerRefreshToken() {
  if (Platform.OS === 'web' || !(await SecureStore.isAvailableAsync())) {
    return null;
  }
  return SecureStore.getItemAsync(CUSTOMER_REFRESH_TOKEN_KEY);
}

export async function saveCustomerRefreshToken(refreshToken: string) {
  if (Platform.OS === 'web') return;
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error('El almacenamiento seguro no está disponible.');
  }
  await SecureStore.setItemAsync(CUSTOMER_REFRESH_TOKEN_KEY, refreshToken, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function deleteCustomerRefreshToken() {
  if (Platform.OS === 'web' || !(await SecureStore.isAvailableAsync())) {
    return;
  }
  await SecureStore.deleteItemAsync(CUSTOMER_REFRESH_TOKEN_KEY);
}
