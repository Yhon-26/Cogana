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

export type SupplierRecord = {
  id: string;
  storeId: string;
  name: string;
  taxId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type DeliveryZoneRecord = {
  id: string;
  storeId: string;
  name: string;
  district: string;
  feeCents: number;
  minimumOrderCents: number;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  scheduleText: string;
  restrictions: string | null;
  isActive: boolean;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CustomerType = 'retail' | 'restaurant';
export type CustomerStatus = 'active' | 'inactive';

export type CustomerRecord = {
  id: string;
  storeId: string;
  authUserId: string | null;
  type: CustomerType;
  name: string;
  phone: string;
  email: string | null;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CustomerAddressRecord = {
  id: string;
  storeId: string;
  customerId: string;
  label: string;
  address: string;
  district: string;
  instructions: string | null;
  deliveryZoneId: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type OrderSource = 'phone' | 'whatsapp' | 'online';
export type FulfillmentType = 'pickup' | 'delivery';
export type OrderStatus =
  | 'received'
  | 'confirmed'
  | 'preparing'
  | 'weight_review'
  | 'ready'
  | 'out_for_delivery'
  | 'ready_for_pickup'
  | 'delivered'
  | 'cancelled';
export type OrderPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type PaymentMethod = 'cash' | 'yape' | 'plin' | 'card';
export type SubstitutionPolicy = 'allow' | 'contact' | 'remove';

export type OrderRecord = {
  id: string;
  storeId: string;
  operationId: string;
  orderNumber: string;
  customerId: string;
  source: OrderSource;
  fulfillmentType: FulfillmentType;
  addressId: string | null;
  deliveryZoneId: string | null;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  paymentMethod: PaymentMethod;
  paymentReference: string | null;
  paymentVerifiedAt: string | null;
  paymentVerifiedByUserId: string | null;
  estimatedSubtotalCents: number;
  deliveryFeeCents: number;
  estimatedTotalCents: number;
  finalSubtotalCents: number | null;
  finalTotalCents: number | null;
  notes: string | null;
  scheduledFor: string | null;
  assignedUserId: string | null;
  actorUserId: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type OrderIncidentType =
  | 'missing_item'
  | 'address'
  | 'payment'
  | 'quality'
  | 'delivery'
  | 'other';

export type OrderIncidentRecord = {
  id: string;
  storeId: string;
  orderId: string;
  type: OrderIncidentType;
  description: string;
  status: 'open' | 'resolved';
  resolution: string | null;
  actorUserId: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type OrderSubstitutionRecord = {
  id: string;
  storeId: string;
  orderId: string;
  orderItemId: string;
  replacementProductId: string;
  replacementProductName: string;
  status: 'proposed' | 'accepted' | 'rejected';
  notes: string | null;
  actorUserId: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type OrderItemRecord = {
  id: string;
  storeId: string;
  orderId: string;
  productId: string;
  productNameSnapshot: string;
  baseUnitSnapshot: ProductBaseUnit;
  requestedQuantity: number;
  preparedQuantity: number | null;
  priceCentsSnapshot: number;
  pricingQuantitySnapshot: number;
  estimatedCents: number;
  finalCents: number | null;
  substitutionPolicy: SubstitutionPolicy;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type OrderStatusHistoryRecord = {
  id: string;
  storeId: string;
  orderId: string;
  operationId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  reason: string;
  actorUserId: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type OrderPaymentHistoryRecord = {
  id: string;
  storeId: string;
  orderId: string;
  operationId: string;
  fromStatus: OrderPaymentStatus;
  toStatus: OrderPaymentStatus;
  paymentMethod: PaymentMethod;
  paymentReference: string | null;
  reason: string;
  actorUserId: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type OrderSummaryRecord = OrderRecord & {
  customerName: string;
  customerPhone: string;
  deliveryZoneName: string | null;
  itemCount: number;
};

export type OrderDetailRecord = {
  order: OrderSummaryRecord;
  customer: CustomerRecord;
  address: CustomerAddressRecord | null;
  items: OrderItemRecord[];
  history: OrderStatusHistoryRecord[];
  paymentHistory: OrderPaymentHistoryRecord[];
  incidents: OrderIncidentRecord[];
  substitutions: OrderSubstitutionRecord[];
};

export type DeliveryAssignmentStatus =
  | 'assigned'
  | 'en_route'
  | 'delivered'
  | 'failed'
  | 'cancelled';

export type DeliveryAssignmentRecord = {
  id: string;
  storeId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  address: string;
  district: string;
  instructions: string | null;
  driverUserId: string;
  driverName: string;
  status: DeliveryAssignmentStatus;
  recipientName: string | null;
  confirmationCode: string | null;
  evidenceUri: string | null;
  notes: string | null;
  assignedByUserId: string;
  deviceId: string;
  startedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  orderVersion: number;
  orderStatus: OrderStatus;
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
  actorUserId: string | null;
  operationId: string;
  entityType: string;
  entityId: string;
  operationType: string;
  payloadJson: string;
  status: SyncStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  errorCode: string | null;
  isTerminal: boolean;
  serverResultJson: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type SyncInboxRecord = {
  sequence: number;
  storeId: string;
  entityType: string;
  entityId: string;
  operationType: string;
  entityVersion: number;
  payloadJson: string;
  changedAt: string;
  sourceDeviceId: string | null;
  operationId: string | null;
  receivedAt: string;
};

export type LocalSyncStateRecord = {
  storeId: string;
  deviceId: string;
  lastPullCursor: number;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type LocalUserRole = 'administrator' | 'seller';

export type LocalUserRecord = {
  id: string;
  storeId: string;
  authUserId: string | null;
  displayName: string;
  role: LocalUserRole;
  hasPin: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type LocalUserPinCredentials = {
  id: string;
  pinHash: string | null;
  pinSalt: string | null;
  pinAlgorithm: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
  lastFailedAt: string | null;
};

export type CashSessionStatus = 'open' | 'closed';

export type CashSessionRecord = {
  id: string;
  storeId: string;
  deviceId: string;
  responsibleUserId: string;
  status: CashSessionStatus;
  openingCashCents: number;
  cashSalesCents: number | null;
  cashIncomeCents: number | null;
  cashOutflowCents: number | null;
  expectedCashCents: number | null;
  countedCashCents: number | null;
  differenceCents: number | null;
  openedAt: string;
  closedAt: string | null;
  closedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CashMovementType = 'income' | 'outflow';

export type CashMovementRecord = {
  id: string;
  storeId: string;
  cashSessionId: string;
  type: CashMovementType;
  amountCents: number;
  reason: string;
  actorUserId: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type SaleStatus = 'confirmed' | 'voided';

export type SaleRecord = {
  id: string;
  storeId: string;
  deviceId: string;
  cashSessionId: string;
  receiptNumber: string;
  actorUserId: string;
  status: SaleStatus;
  totalCents: number;
  voidedAt: string | null;
  voidedByUserId: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type SaleStatusHistoryRecord = {
  id: string;
  storeId: string;
  saleId: string;
  fromStatus: SaleStatus;
  toStatus: SaleStatus;
  reason: string;
  actorUserId: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type SaleItemRecord = {
  id: string;
  storeId: string;
  saleId: string;
  productId: string;
  productNameSnapshot: string;
  baseUnitSnapshot: ProductBaseUnit;
  quantity: number;
  priceCentsSnapshot: number;
  pricingQuantitySnapshot: number;
  costCentsSnapshot: number;
  costPricingQuantitySnapshot: number;
  lineTotalCents: number;
  presentationId: string | null;
  presentationNameSnapshot: string | null;
  presentationTypeSnapshot: PresentationType | null;
  presentationQuantitySnapshot: number | null;
  presentationCount: number | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type PaymentRecord = {
  id: string;
  storeId: string;
  saleId: string;
  method: PaymentMethod;
  amountCents: number;
  amountReceivedCents: number | null;
  changeCents: number;
  reference: string | null;
  actorUserId: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type RecentSaleRecord = SaleRecord & {
  actorDisplayName: string;
  paymentMethod: PaymentMethod;
};
