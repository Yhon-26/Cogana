function assertSafeNonNegativeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} debe ser un entero seguro no negativo.`);
  }
}

export function roundIntegerRatio(
  left: number,
  right: number,
  denominator: number
) {
  assertSafeNonNegativeInteger(left, 'El primer valor');
  assertSafeNonNegativeInteger(right, 'El segundo valor');

  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error('El divisor debe ser un entero seguro mayor que cero.');
  }

  const numerator = BigInt(left) * BigInt(right);
  const divisor = BigInt(denominator);
  // Regla comercial: redondeo "mitad hacia arriba" usando solo enteros.
  const rounded = (numerator + divisor / 2n) / divisor;
  const result = Number(rounded);

  if (!Number.isSafeInteger(result)) {
    throw new Error('El resultado excede el rango entero seguro.');
  }

  return result;
}

export function calculateLineTotalCents(
  quantity: number,
  priceCents: number,
  pricingQuantity: number
) {
  const total = roundIntegerRatio(quantity, priceCents, pricingQuantity);
  if (total <= 0) {
    throw new Error('La cantidad seleccionada debe producir un total mayor que cero.');
  }
  return total;
}

export function calculateQuantityForAmountCents(
  amountCents: number,
  priceCents: number,
  pricingQuantity: number
) {
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) {
    throw new Error('El producto debe tener un precio entero mayor que cero.');
  }

  const quantity = roundIntegerRatio(amountCents, pricingQuantity, priceCents);
  if (quantity <= 0) {
    throw new Error('El monto indicado no alcanza una unidad base del producto.');
  }
  return quantity;
}

export function parseDecimalToInteger(value: string, decimalPlaces: number) {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d*)?$/.test(normalized)) return null;

  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimalPlaces) return null;

  const paddedFraction = fraction.padEnd(decimalPlaces, '0');
  const scale = 10 ** decimalPlaces;
  const result = Number(whole) * scale + Number(paddedFraction || '0');

  return Number.isSafeInteger(result) ? result : null;
}
