import * as Crypto from 'expo-crypto';

export const PIN_ALGORITHM_ID = 'cogana-pin-pbkdf2-sha256-100000-v3';
export const LEGACY_PIN_ALGORITHM_ID = 'cogana-pin-iter-sha256-10000-v1';
export const V2_PIN_ALGORITHM_ID = 'cogana-pin-pbkdf2-sha256-10000-v2';

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 32;
const NEW_PIN_PATTERN = /^\d{6,8}$/;
const EXISTING_PIN_PATTERN = /^\d{4,8}$/;
const SHA256_BLOCK_BYTES = 64;

export type PinCredentials = {
  pinHash: string;
  pinSalt: string;
  pinAlgorithm: string;
};

export function isValidPinFormat(pin: string): boolean {
  return EXISTING_PIN_PATTERN.test(pin);
}

export function isValidNewPinFormat(pin: string): boolean {
  return NEW_PIN_PATTERN.test(pin);
}

export function assertValidNewPinFormat(pin: string): void {
  if (!isValidNewPinFormat(pin)) {
    throw new Error('El PIN debe tener entre 6 y 8 digitos numericos.');
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error('La sal del PIN no tiene un formato valido.');
  }
  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  const input = new Uint8Array(value.length);
  input.set(value);
  return new Uint8Array(
    await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, input)
  );
}

async function hmacSha256(key: Uint8Array, value: Uint8Array): Promise<Uint8Array> {
  const normalizedKey =
    key.length > SHA256_BLOCK_BYTES ? await sha256(key) : key;
  const keyBlock = new Uint8Array(SHA256_BLOCK_BYTES);
  keyBlock.set(normalizedKey);
  const outer = new Uint8Array(SHA256_BLOCK_BYTES);
  const inner = new Uint8Array(SHA256_BLOCK_BYTES);
  for (let index = 0; index < SHA256_BLOCK_BYTES; index += 1) {
    outer[index] = keyBlock[index] ^ 0x5c;
    inner[index] = keyBlock[index] ^ 0x36;
  }
  const innerDigest = await sha256(concatBytes(inner, value));
  return sha256(concatBytes(outer, innerDigest));
}

async function derivePbkdf2(pin: string, saltHex: string): Promise<string> {
  const password = encodeUtf8(pin);
  const salt = hexToBytes(saltHex);
  const blockIndex = new Uint8Array([0, 0, 0, 1]);
  let previous = await hmacSha256(password, concatBytes(salt, blockIndex));
  const derived = previous.slice();
  for (let iteration = 1; iteration < ITERATIONS; iteration += 1) {
    previous = await hmacSha256(password, previous);
    for (let index = 0; index < DERIVED_KEY_BYTES; index += 1) {
      derived[index] ^= previous[index];
    }
  }
  return bytesToHex(derived);
}

async function deriveLegacyHash(pin: string, saltHex: string): Promise<string> {
  let value = `${saltHex}:${pin}`;
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    value = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      value,
      { encoding: Crypto.CryptoEncoding.HEX }
    );
  }
  return value;
}

async function derivePbkdf2Legacy(pin: string, saltHex: string): Promise<string> {
  const password = encodeUtf8(pin);
  const salt = hexToBytes(saltHex);
  const blockIndex = new Uint8Array([0, 0, 0, 1]);
  const LEGACY_ITERATIONS = 10_000;
  let previous = await hmacSha256(password, concatBytes(salt, blockIndex));
  const derived = previous.slice();
  for (let iteration = 1; iteration < LEGACY_ITERATIONS; iteration += 1) {
    previous = await hmacSha256(password, previous);
    for (let index = 0; index < DERIVED_KEY_BYTES; index += 1) {
      derived[index] ^= previous[index];
    }
  }
  return bytesToHex(derived);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

export async function hashPin(pin: string): Promise<PinCredentials> {
  assertValidNewPinFormat(pin);
  const salt = await Crypto.getRandomBytesAsync(SALT_BYTES);
  const saltHex = bytesToHex(salt);
  const pinHash = await derivePbkdf2(pin, saltHex);
  return { pinHash, pinSalt: saltHex, pinAlgorithm: PIN_ALGORITHM_ID };
}

export async function verifyPin(
  pin: string,
  credentials: { pinHash: string; pinSalt: string; pinAlgorithm: string }
): Promise<boolean> {
  if (!isValidPinFormat(pin)) return false;
  const candidate =
    credentials.pinAlgorithm === PIN_ALGORITHM_ID
      ? await derivePbkdf2(pin, credentials.pinSalt)
      : credentials.pinAlgorithm === LEGACY_PIN_ALGORITHM_ID
        ? await deriveLegacyHash(pin, credentials.pinSalt)
        : credentials.pinAlgorithm === V2_PIN_ALGORITHM_ID
          ? await derivePbkdf2Legacy(pin, credentials.pinSalt)
          : null;
  if (candidate === null) {
    throw new Error(`Algoritmo de PIN no soportado: ${credentials.pinAlgorithm}`);
  }
  return constantTimeEqual(candidate, credentials.pinHash);
}
