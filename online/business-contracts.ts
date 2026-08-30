export type BusinessAccount = {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  businessType: 'restaurant' | 'wholesale';
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  creditLimitCents: number;
  creditUsedCents: number;
  paymentTermsDays: number;
};

export type BusinessPrice = {
  id: string;
  businessAccountId: string;
  productId: string;
  productName: string;
  minimumQuantity: number;
  priceCents: number;
  validFrom: string;
  validUntil: string | null;
};

export type BusinessQuoteItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  baseUnit: 'gram' | 'unit';
  catalogPriceCents: number;
  quotedPriceCents: number | null;
  quotedLineCents: number | null;
};

export type BusinessQuote = {
  id: string;
  businessAccountId: string;
  orderId: string | null;
  status: 'requested' | 'quoted' | 'accepted' | 'rejected' | 'expired';
  requestedDeliveryAt: string | null;
  recurrence: 'once' | 'weekly' | 'biweekly' | 'monthly' | null;
  notes: string | null;
  quotedTotalCents: number | null;
  validUntil: string | null;
  adminNotes: string | null;
  createdAt: string;
  items: BusinessQuoteItem[];
};

export type RecurringBusinessOrder = {
  id: string;
  businessAccountId: string;
  name: string;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  nextRunAt: string;
  fulfillmentType: 'pickup' | 'delivery';
  deliveryAddress: Record<string, unknown> | null;
  items: { productId: string; quantity: number }[];
  isActive: boolean;
};

export type BusinessDocument = {
  id: string;
  businessAccountId: string;
  documentType: 'quotation' | 'account_statement' | 'invoice' | 'credit_note';
  documentNumber: string;
  amountCents: number;
  issuedAt: string;
  dueAt: string | null;
  downloadUrl: string | null;
};

export type BusinessContext = {
  accounts: BusinessAccount[];
  prices: BusinessPrice[];
  quotes: BusinessQuote[];
  recurringOrders: RecurringBusinessOrder[];
  documents: BusinessDocument[];
};
