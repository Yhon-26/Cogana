import { calculateLineTotalCents } from '../database/integer-calculations';
import type { SubstitutionPolicy } from '../database/models';
import type { CartItem, OnlineProduct } from './contracts';

export function addCartItem(
  items: CartItem[],
  product: OnlineProduct,
  quantity: number
) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('La cantidad debe ser un entero mayor que cero.');
  }
  const existing = items.find((item) => item.product.id === product.id);
  const nextQuantity = (existing?.quantity ?? 0) + quantity;
  if (nextQuantity > product.stockQuantity) {
    throw new Error('La cantidad supera el stock disponible.');
  }
  if (!existing) {
    return [...items, { product, quantity, substitutionPolicy: 'contact' as const }];
  }
  return items.map((item) =>
    item.product.id === product.id ? { ...item, quantity: nextQuantity } : item
  );
}

export function updateCartQuantity(
  items: CartItem[],
  productId: string,
  quantity: number
) {
  if (!Number.isSafeInteger(quantity)) {
    throw new Error('La cantidad debe ser un entero.');
  }
  const target = items.find((item) => item.product.id === productId);
  if (target && quantity > target.product.stockQuantity) {
    throw new Error('La cantidad supera el stock disponible.');
  }
  return items
    .map((item) => (item.product.id === productId ? { ...item, quantity } : item))
    .filter((item) => item.quantity > 0);
}

export function updateCartSubstitution(
  items: CartItem[],
  productId: string,
  substitutionPolicy: SubstitutionPolicy
) {
  return items.map((item) =>
    item.product.id === productId ? { ...item, substitutionPolicy } : item
  );
}

export function calculateCartSubtotal(items: CartItem[]) {
  return items.reduce(
    (sum, item) =>
      sum +
      calculateLineTotalCents(
        item.quantity,
        item.product.priceCents,
        item.product.pricingQuantity
      ),
    0
  );
}
