import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addCartItem,
  calculateCartSubtotal,
  updateCartQuantity,
  updateCartSubstitution,
} from '../online/cart';
import type { OnlineProduct } from '../online/contracts';

const product: OnlineProduct = {
  id: 'product-1',
  sku: 'ARR-1',
  name: 'Arroz',
  category: 'Arroces',
  baseUnit: 'gram',
  pricingQuantity: 1000,
  priceCents: 525,
  stockQuantity: 5000,
  minimumStockQuantity: 500,
  presentations: [],
};

test('carrito suma cantidades base y redondea el subtotal con enteros', () => {
  const first = addCartItem([], product, 250);
  const second = addCartItem(first, product, 250);
  assert.equal(second[0].quantity, 500);
  assert.equal(calculateCartSubtotal(second), 263);
});

test('carrito elimina en cero y conserva política de sustitución', () => {
  const items = updateCartSubstitution(
    addCartItem([], product, 1000),
    product.id,
    'remove'
  );
  assert.equal(items[0].substitutionPolicy, 'remove');
  assert.deepEqual(updateCartQuantity(items, product.id, 0), []);
});

test('carrito rechaza cantidades que superan stock', () => {
  assert.throws(() => addCartItem([], product, 5001), /supera el stock/);
  const items = addCartItem([], product, 1000);
  assert.throws(
    () => updateCartQuantity(items, product.id, 6000),
    /supera el stock/
  );
});
