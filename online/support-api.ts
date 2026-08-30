import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getCustomerSupabaseClient,
  getSupabaseClient,
} from '@/auth/supabase-client';
import { createId } from '@/database/ids';
import { DEFAULT_STORE_ID } from '@/database/seed';

export type SupportTicket = {
  id: string;
  orderId: string | null;
  category: 'order' | 'payment' | 'delivery' | 'account' | 'product' | 'other';
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  createdAt: string;
  updatedAt: string;
  messages: {
    id: string;
    authorUserId: string;
    body: string;
    evidenceUrl: string | null;
    createdAt: string;
  }[];
};

function requireClient(value: SupabaseClient | null) {
  if (!value) throw new Error('Supabase no está configurado.');
  return value;
}

async function getTickets(client: SupabaseClient) {
  const { data, error } = await client.rpc('get_my_support_tickets', {
    p_store_id: DEFAULT_STORE_ID,
  });
  if (error) throw error;
  return data as SupportTicket[];
}

export function getMyCustomerSupportTickets() {
  return getTickets(requireClient(getCustomerSupabaseClient()));
}

export function getStaffSupportTickets() {
  return getTickets(requireClient(getSupabaseClient()));
}

export async function createCustomerSupportTicket(input: {
  orderId?: string | null;
  category: SupportTicket['category'];
  subject: string;
  description: string;
  evidenceUrl?: string;
}) {
  const { data, error } = await requireClient(
    getCustomerSupabaseClient()
  ).rpc('create_support_ticket', {
    p_store_id: DEFAULT_STORE_ID,
    p_ticket_id: createId(),
    p_order_id: input.orderId ?? null,
    p_category: input.category,
    p_subject: input.subject,
    p_description: input.description,
    p_evidence_url: input.evidenceUrl || null,
  });
  if (error) throw error;
  return data;
}

export async function addCustomerSupportMessage(
  ticketId: string,
  body: string,
  evidenceUrl = ''
) {
  const { data, error } = await requireClient(
    getCustomerSupabaseClient()
  ).rpc('add_support_message', {
    p_store_id: DEFAULT_STORE_ID,
    p_ticket_id: ticketId,
    p_message_id: createId(),
    p_body: body,
    p_evidence_url: evidenceUrl || null,
  });
  if (error) throw error;
  return data;
}

export async function addStaffSupportMessage(
  ticketId: string,
  body: string
) {
  const { data, error } = await requireClient(getSupabaseClient()).rpc(
    'add_support_message',
    {
      p_store_id: DEFAULT_STORE_ID,
      p_ticket_id: ticketId,
      p_message_id: createId(),
      p_body: body,
      p_evidence_url: null,
    }
  );
  if (error) throw error;
  return data;
}

export async function updateStaffSupportTicket(
  ticketId: string,
  status: SupportTicket['status'],
  priority: SupportTicket['priority']
) {
  const { data, error } = await requireClient(getSupabaseClient()).rpc(
    'update_support_ticket',
    {
      p_store_id: DEFAULT_STORE_ID,
      p_ticket_id: ticketId,
      p_status: status,
      p_priority: priority,
      p_assigned_to: null,
    }
  );
  if (error) throw error;
  return data;
}
