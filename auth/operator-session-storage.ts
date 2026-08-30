import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY_PREFIX = 'coguana.auth.refresh.';

function keyFor(localUserId: string) {
  return `${KEY_PREFIX}${localUserId}`;
}

export async function readOperatorRefreshToken(localUserId: string) {
  const key = keyFor(localUserId);
  if (Platform.OS === 'web') {
    return null;
  }
  if (!(await SecureStore.isAvailableAsync())) return null;
  return SecureStore.getItemAsync(key);
}

export async function saveOperatorRefreshToken(
  localUserId: string,
  refreshToken: string
) {
  const key = keyFor(localUserId);
  if (Platform.OS === 'web') {
    throw new Error('El vínculo seguro de operadores requiere Android o iOS.');
  }
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error('El almacenamiento seguro no está disponible en este dispositivo.');
  }
  await SecureStore.setItemAsync(key, refreshToken, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function deleteOperatorRefreshToken(localUserId: string) {
  const key = keyFor(localUserId);
  if (Platform.OS === 'web') {
    return;
  }
  if (await SecureStore.isAvailableAsync()) {
    await SecureStore.deleteItemAsync(key);
  }
}
