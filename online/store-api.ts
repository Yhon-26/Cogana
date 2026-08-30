import { getCustomerSupabaseClient } from '@/auth/supabase-client';
import { createId } from '@/database/ids';
import { DEFAULT_STORE_ID } from '@/database/seed';
import {
  clearCheckoutAttempt,
  getOrCreateCheckoutAttempt,
} from '@/online/checkout-storage';
import type {
  CreateOnlineOrderInput,
  OnlineCatalog,
  OnlineOrder,
  OnlineOrderResult,
  OnlinePreferences,
  SavedCustomerAddress,
} from '@/online/contracts';

function client() {
  const value = getCustomerSupabaseClient();
  if (!value) throw new Error('Supabase no está configurado.');
  return value;
}

export async function getOnlineCatalog(query = '') {
  const { data, error } = await client().rpc('get_online_catalog', {
    p_store_id: DEFAULT_STORE_ID,
    p_query: query || null,
  });
  if (error) throw error;
  return data as OnlineCatalog;
}

export async function createOnlineOrder(input: CreateOnlineOrderInput) {
  const attempt = await getOrCreateCheckoutAttempt(input);
  const orderedItems = [...input.items].sort((left, right) =>
    left.product.id.localeCompare(right.product.id)
  );
  const { data, error } = await client().rpc('create_online_order', {
    p_store_id: DEFAULT_STORE_ID,
    p_order_id: attempt.orderId,
    p_operation_id: attempt.operationId,
    p_fulfillment_type: input.fulfillmentType,
    p_delivery_zone_id: input.deliveryZoneId,
    p_address: input.address
      ? { ...input.address, id: attempt.addressId }
      : null,
    p_items: orderedItems.map((item) => ({
      id: attempt.itemIds[item.product.id],
      productId: item.product.id,
      quantity: item.quantity,
      substitutionPolicy: item.substitutionPolicy,
    })),
    p_payment_method: input.paymentMethod,
    p_payment_reference: input.paymentReference,
    p_notes: input.notes || null,
  });
  if (error) throw error;
  await clearCheckoutAttempt();
  return data as OnlineOrderResult;
}

export async function deleteMyAccount(confirmation: string) {
  const { data, error } = await client().functions.invoke('delete-account', {
    body: { confirmation },
  });
  if (error) throw error;
  return data as { status: 'completed' };
}

export async function getMyOnlineOrders() {
  const [ordersResult, substitutionsResult, trackingResult] = await Promise.all([
    client().rpc('get_my_online_orders', { p_store_id: DEFAULT_STORE_ID }),
    client().rpc('get_my_order_substitutions', {
      p_store_id: DEFAULT_STORE_ID,
    }),
    client().rpc('get_my_delivery_tracking', {
      p_store_id: DEFAULT_STORE_ID,
    }),
  ]);
  if (ordersResult.error) throw ordersResult.error;
  if (substitutionsResult.error) throw substitutionsResult.error;
  if (trackingResult.error) throw trackingResult.error;
  const substitutions = (substitutionsResult.data ??
    []) as OnlineOrder['substitutions'];
  const tracking = (trackingResult.data ?? []) as (NonNullable<
    OnlineOrder['deliveryTracking']
  > & { orderId: string })[];
  return (ordersResult.data as Omit<
    OnlineOrder,
    'substitutions' | 'deliveryTracking'
  >[]).map(
    (order) => ({
      ...order,
      substitutions: substitutions.filter(
        (substitution) => substitution.orderId === order.id
      ),
      deliveryTracking:
        tracking.find((delivery) => delivery.orderId === order.id) ?? null,
    })
  );
}

export async function cancelMyOnlineOrder(orderId: string, reason: string) {
  const { data, error } = await client().rpc('cancel_my_online_order', {
    p_store_id: DEFAULT_STORE_ID,
    p_order_id: orderId,
    p_operation_id: createId(),
    p_reason: reason,
  });
  if (error) throw error;
  return data as { id: string; status: string };
}

export async function decideMyOrderSubstitution(
  substitutionId: string,
  accept: boolean
) {
  const { data, error } = await client().rpc('decide_my_order_substitution', {
    p_store_id: DEFAULT_STORE_ID,
    p_substitution_id: substitutionId,
    p_operation_id: createId(),
    p_accept: accept,
  });
  if (error) throw error;
  return data as { id: string; status: 'accepted' | 'rejected' };
}

export async function getMyAddresses(customerId: string) {
  const { data, error } = await client()
    .from('customer_addresses')
    .select('id,label,address,district,instructions,delivery_zone_id,is_default')
    .eq('store_id', DEFAULT_STORE_ID)
    .eq('customer_id', customerId)
    .order('is_default', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SavedCustomerAddress[];
}

export async function saveMyAddress(
  customerId: string,
  address: {
    id?: string;
    label: string;
    address: string;
    district: string;
    instructions?: string;
  }
) {
  const payload = {
    id: address.id ?? createId(),
    store_id: DEFAULT_STORE_ID,
    customer_id: customerId,
    label: address.label.trim(),
    address: address.address.trim(),
    district: address.district.trim(),
    instructions: address.instructions?.trim() || null,
    delivery_zone_id: null,
    is_default: false,
  };
  const { data, error } = await client()
    .from('customer_addresses')
    .upsert(payload)
    .select('id,label,address,district,instructions,delivery_zone_id,is_default')
    .single();
  if (error) throw error;
  return data as SavedCustomerAddress;
}

export async function getMyOnlinePreferences() {
  const { data, error } = await client().rpc('get_my_online_preferences', {
    p_store_id: DEFAULT_STORE_ID,
  });
  if (error) throw error;
  return data as OnlinePreferences;
}

export async function setFavoriteProduct(productId: string, favorite: boolean) {
  const { data, error } = await client().rpc('set_favorite_product', {
    p_store_id: DEFAULT_STORE_ID,
    p_product_id: productId,
    p_favorite: favorite,
  });
  if (error) throw error;
  return data as boolean;
}

export async function updateMyOnlinePreferences(input: {
  orderNotifications: boolean;
  promotionNotifications: boolean;
  marketingConsent: boolean;
}) {
  const { data, error } = await client().rpc('update_my_online_preferences', {
    p_store_id: DEFAULT_STORE_ID,
    p_order_notifications: input.orderNotifications,
    p_promotion_notifications: input.promotionNotifications,
    p_marketing_consent: input.marketingConsent,
  });
  if (error) throw error;
  return data as OnlinePreferences;
}
