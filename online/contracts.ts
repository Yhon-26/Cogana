import type {
  FulfillmentType,
  PaymentMethod,
  ProductBaseUnit,
  SubstitutionPolicy,
} from '../database/models';

export type OnlinePresentation = {
  id: string;
  name: string;
  kind: 'unit' | 'package' | 'box' | 'sack';
  quantityInBaseUnits: number;
  priceCents: number;
};

export type OnlineProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  baseUnit: ProductBaseUnit;
  pricingQuantity: number;
  priceCents: number;
  stockQuantity: number;
  minimumStockQuantity: number;
  presentations: OnlinePresentation[];
};

export type OnlineDeliveryZone = {
  id: string;
  name: string;
  district: string;
  feeCents: number;
  minimumOrderCents: number;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  scheduleText: string;
  restrictions: string | null;
};

export type OnlineCatalog = {
  products: OnlineProduct[];
  categories: string[];
  deliveryZones: OnlineDeliveryZone[];
  serverTime: string;
};

export type CartItem = {
  product: OnlineProduct;
  quantity: number;
  substitutionPolicy: SubstitutionPolicy;
};

export type CheckoutAddress = {
  id?: string;
  label: string;
  address: string;
  district: string;
  instructions: string;
};

export type OnlineCheckoutAttempt = {
  fingerprint: string;
  orderId: string;
  operationId: string;
  addressId: string;
  itemIds: Record<string, string>;
};

export type CreateOnlineOrderInput = {
  fulfillmentType: FulfillmentType;
  deliveryZoneId: string | null;
  address: CheckoutAddress | null;
  items: CartItem[];
  paymentMethod: PaymentMethod;
  paymentReference: string | null;
  notes: string;
};

export type OnlineOrderResult = {
  id: string;
  orderNumber: string;
  status: string;
  estimatedSubtotalCents: number;
  deliveryFeeCents: number;
  estimatedTotalCents: number;
  duplicate: boolean;
};

export type OnlineOrder = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: PaymentMethod;
  fulfillmentType: FulfillmentType;
  estimatedTotalCents: number;
  finalTotalCents: number | null;
  createdAt: string;
  updatedAt: string;
  items: {
    id: string;
    productId: string;
    productName: string;
    requestedQuantity: number;
    preparedQuantity: number | null;
    baseUnit: ProductBaseUnit;
    estimatedCents: number;
    finalCents: number | null;
  }[];
  history: { status: string; reason: string; createdAt: string }[];
  substitutions: {
    id: string;
    orderId: string;
    orderItemId: string;
    replacementProductId: string;
    replacementProductName: string;
    status: 'proposed' | 'accepted' | 'rejected';
    notes: string | null;
    updatedAt: string;
  }[];
  deliveryTracking: {
    status: 'assigned' | 'en_route' | 'delivered' | 'failed' | 'cancelled';
    trackingUrl: string | null;
    startedAt: string | null;
    deliveredAt: string | null;
    recipientName: string | null;
    updatedAt: string;
  } | null;
};

export type SavedCustomerAddress = {
  id: string;
  label: string;
  address: string;
  district: string;
  instructions: string | null;
  delivery_zone_id: string | null;
  is_default: boolean;
};

export type OnlinePreferences = {
  favoriteProductIds: string[];
  orderNotifications: boolean;
  promotionNotifications: boolean;
  marketingConsent: boolean;
  promotions: {
    id: string;
    title: string;
    description: string;
    couponCode: string | null;
    endsAt: string;
  }[];
};
