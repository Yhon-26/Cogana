export type ProductBaseUnit = 'gram' | 'unit';

export type ProductRecord = {
  id: string;
  storeId: string;
  sku: string;
  name: string;
  category: string;
  baseUnit: ProductBaseUnit;
  pricingQuantity: number;
  priceCents: number;
  costCents: number;
  stockQuantity: number;
  minimumStockQuantity: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type InventoryMovementType =
  | 'opening'
  | 'purchase'
  | 'sale'
  | 'adjustment'
  | 'waste'
  | 'return';

export type InventoryMovementRecord = {
  id: string;
  storeId: string;
  productId: string;
  type: InventoryMovementType;
  quantityDelta: number;
  reason: string;
  referenceId: string | null;
  actorUserId: string | null;
  deviceId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type PresentationType = 'unit' | 'package' | 'box' | 'sack';

export type ProductPresentationRecord = {
  id: string;
  storeId: string;
  productId: string;
  sku: string;
  name: string;
  type: PresentationType;
  quantityInBaseUnits: number;
  fixedPriceCents: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type PriceHistoryRecord = {
  id: string;
  storeId: string;
  productId: string;
  previousPriceCents: number;
  newPriceCents: number;
  reason: string;
  actorUserId: string | null;
  deviceId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error';

export type SyncOutboxRecord = {
  id: string;
  storeId: string;
  operationId: string;
  entityType: string;
  entityId: string;
  operationType: string;
  payloadJson: string;
  status: SyncStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};
