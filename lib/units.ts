import type { ProductBaseUnit, ProductRecord } from '@/database/models';

export function formatPricingUnit(product: ProductRecord): string {
  if (product.baseUnit === 'gram' && product.pricingQuantity === 1000) return 'kg';
  if (product.baseUnit === 'gram') return `${product.pricingQuantity} g`;
  if (product.pricingQuantity === 1) return 'unidad';
  return `${product.pricingQuantity} un.`;
}

export function formatQuantity(baseUnit: ProductBaseUnit, quantity: number, withFraction = false): string {
  if (baseUnit === 'gram') {
    return withFraction ? `${(quantity / 1000).toFixed(3)} kg` : `${quantity} g`;
  }
  return `${quantity} un.`;
}
