import Storage from 'expo-sqlite/kv-store';

import { createId } from '@/database/ids';
import type {
  CartItem,
  CreateOnlineOrderInput,
  OnlineCheckoutAttempt,
} from '@/online/contracts';

const CART_KEY = 'coguana.online.cart.v1';
const CHECKOUT_ATTEMPT_KEY = 'coguana.online.checkout-attempt.v1';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<CartItem>;
  return (
    !!item.product &&
    typeof item.product === 'object' &&
    typeof item.product.id === 'string' &&
    typeof item.product.sku === 'string' &&
    typeof item.product.name === 'string' &&
    typeof item.product.category === 'string' &&
    (item.product.baseUnit === 'gram' || item.product.baseUnit === 'unit') &&
    isSafePositiveInteger(item.product.pricingQuantity) &&
    typeof item.product.priceCents === 'number' &&
    Number.isSafeInteger(item.product.priceCents) &&
    item.product.priceCents >= 0 &&
    typeof item.product.stockQuantity === 'number' &&
    Number.isSafeInteger(item.product.stockQuantity) &&
    item.product.stockQuantity >= 0 &&
    Array.isArray(item.product.presentations) &&
    isSafePositiveInteger(item.quantity) &&
    item.quantity <= item.product.stockQuantity &&
    ['allow', 'contact', 'remove'].includes(item.substitutionPolicy ?? '')
  );
}

export async function readPersistedCart() {
  try {
    const stored = await Storage.getItem(CART_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed) || !parsed.every(isCartItem)) return [];
    const productIds = parsed.map((item) => item.product.id);
    return new Set(productIds).size === productIds.length ? parsed : [];
  } catch {
    return [];
  }
}

export async function persistCart(items: CartItem[]) {
  await Storage.setItem(CART_KEY, JSON.stringify(items));
}

export function checkoutFingerprint(input: CreateOnlineOrderInput) {
  return JSON.stringify({
    fulfillmentType: input.fulfillmentType,
    deliveryZoneId: input.deliveryZoneId,
    address: input.address
      ? {
          label: input.address.label.trim(),
          address: input.address.address.trim(),
          district: input.address.district.trim(),
          instructions: input.address.instructions.trim(),
        }
      : null,
    items: input.items
      .map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        substitutionPolicy: item.substitutionPolicy,
      }))
      .sort((left, right) => left.productId.localeCompare(right.productId)),
    paymentMethod: input.paymentMethod,
    paymentReference: input.paymentReference?.trim() || null,
    notes: input.notes.trim(),
  });
}

function isCheckoutAttempt(value: unknown): value is OnlineCheckoutAttempt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const attempt = value as Partial<OnlineCheckoutAttempt>;
  return (
    typeof attempt.fingerprint === 'string' &&
    UUID_PATTERN.test(attempt.orderId ?? '') &&
    UUID_PATTERN.test(attempt.operationId ?? '') &&
    UUID_PATTERN.test(attempt.addressId ?? '') &&
    !!attempt.itemIds &&
    typeof attempt.itemIds === 'object' &&
    !Array.isArray(attempt.itemIds) &&
    Object.values(attempt.itemIds).every(
      (id) => typeof id === 'string' && UUID_PATTERN.test(id)
    )
  );
}

export async function getOrCreateCheckoutAttempt(
  input: CreateOnlineOrderInput
): Promise<OnlineCheckoutAttempt> {
  const fingerprint = checkoutFingerprint(input);
  try {
    const stored = await Storage.getItem(CHECKOUT_ATTEMPT_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as unknown;
      if (
        isCheckoutAttempt(parsed) &&
        parsed.fingerprint === fingerprint &&
        input.items.every((item) => typeof parsed.itemIds[item.product.id] === 'string')
      ) {
        return parsed;
      }
    }
  } catch {
    // Una entrada dañada se reemplaza con un intento nuevo.
  }

  const attempt: OnlineCheckoutAttempt = {
    fingerprint,
    orderId: createId(),
    operationId: createId(),
    addressId: createId(),
    itemIds: Object.fromEntries(
      input.items.map((item) => [item.product.id, createId()])
    ),
  };
  await Storage.setItem(CHECKOUT_ATTEMPT_KEY, JSON.stringify(attempt));
  return attempt;
}

export async function clearCheckoutAttempt() {
  await Storage.removeItem(CHECKOUT_ATTEMPT_KEY);
}
