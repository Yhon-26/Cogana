-- Expansión: soporte, configuración de tienda y base segura para SUNAT.

create table public.store_settings (
  store_id uuid primary key references public.stores(id)
    on delete cascade on update cascade,
  legal_name text,
  tax_id text check (tax_id is null or tax_id ~ '^[0-9]{11}$'),
  address text,
  phone text,
  business_hours text,
  currency text not null default 'PEN' check (currency = 'PEN'),
  locale text not null default 'es-PE',
  receipt_footer text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1)
);

create table public.support_tickets (
  id uuid primary key,
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  requester_user_id uuid not null references auth.users(id)
    on delete restrict on update cascade,
  requester_type text not null check (requester_type in ('customer','staff')),
  order_id uuid,
  category text not null
    check (category in ('order','payment','delivery','account','product','other')),
  subject text not null check (btrim(subject) <> ''),
  description text not null check (btrim(description) <> ''),
  status text not null default 'open'
    check (status in ('open','in_progress','waiting_customer','resolved','closed')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  foreign key (order_id,store_id) references public.orders(id,store_id)
    on delete restrict on update cascade
);

create table public.support_messages (
  id uuid primary key,
  store_id uuid not null,
  ticket_id uuid not null,
  author_user_id uuid not null references auth.users(id)
    on delete restrict on update cascade,
  body text not null check (btrim(body) <> ''),
  evidence_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  foreign key (ticket_id,store_id) references public.support_tickets(id,store_id)
    on delete cascade on update cascade
);

create table public.fiscal_integrations (
  store_id uuid primary key references public.stores(id)
    on delete cascade on update cascade,
  provider text not null default 'none',
  environment text not null default 'disabled'
    check (environment in ('disabled','demo','production')),
  invoice_series text,
  receipt_series text,
  is_enabled boolean not null default false,
  last_health_at timestamptz,
  last_error text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  check (not is_enabled or environment <> 'disabled')
);

create table public.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  sale_id uuid,
  order_id uuid,
  customer_id uuid,
  document_type text not null
    check (document_type in ('receipt','invoice','credit_note')),
  series text not null,
  number bigint not null check (number > 0),
  status text not null default 'queued'
    check (status in ('queued','submitted','accepted','rejected','voided')),
  total_cents bigint not null check (total_cents >= 0),
  provider_reference text,
  xml_url text,
  pdf_url text,
  error_message text,
  issued_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  unique (store_id,series,number),
  foreign key (sale_id,store_id) references public.sales(id,store_id)
    on delete restrict on update cascade,
  foreign key (order_id,store_id) references public.orders(id,store_id)
    on delete restrict on update cascade,
  foreign key (customer_id,store_id) references public.customers(id,store_id)
    on delete restrict on update cascade,
  check (sale_id is not null or order_id is not null)
);

create index support_tickets_store_status
  on public.support_tickets(store_id,status,updated_at desc);
create index support_tickets_requester
  on public.support_tickets(requester_user_id,store_id,updated_at desc);
create index support_messages_ticket
  on public.support_messages(store_id,ticket_id,created_at);
create index fiscal_documents_status
  on public.fiscal_documents(store_id,status,created_at);

create trigger store_settings_bump_version before update on public.store_settings
  for each row execute function private.bump_catalog_version();
create trigger support_tickets_bump_version before update on public.support_tickets
  for each row execute function private.bump_catalog_version();
create trigger support_messages_bump_version before update on public.support_messages
  for each row execute function private.bump_catalog_version();
create trigger fiscal_integrations_bump_version before update on public.fiscal_integrations
  for each row execute function private.bump_catalog_version();
create trigger fiscal_documents_bump_version before update on public.fiscal_documents
  for each row execute function private.bump_catalog_version();

alter table public.store_settings enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.fiscal_integrations enable row level security;
alter table public.fiscal_documents enable row level security;
revoke all on public.store_settings,public.support_tickets,public.support_messages,
  public.fiscal_integrations,public.fiscal_documents
  from public,anon,authenticated;
grant select on public.store_settings,public.support_tickets,public.support_messages,
  public.fiscal_integrations,public.fiscal_documents to authenticated;
grant all on public.store_settings,public.support_tickets,public.support_messages,
  public.fiscal_integrations,public.fiscal_documents to service_role;

create policy store_settings_member on public.store_settings
  for select to authenticated using (private.is_store_member(store_id));
create policy support_tickets_participant on public.support_tickets
  for select to authenticated using (
    requester_user_id = auth.uid() or private.is_store_member(store_id)
  );
create policy support_messages_participant on public.support_messages
  for select to authenticated using (
    exists (
      select 1 from public.support_tickets t
      where t.id = support_messages.ticket_id
        and t.store_id = support_messages.store_id
        and (t.requester_user_id = auth.uid() or private.is_store_member(t.store_id))
    )
  );
create policy fiscal_integrations_admin on public.fiscal_integrations
  for select to authenticated using (private.is_store_admin(store_id));
create policy fiscal_documents_member_customer on public.fiscal_documents
  for select to authenticated using (
    private.is_store_member(store_id)
    or exists (
      select 1 from public.customers c
      where c.id = fiscal_documents.customer_id
        and c.store_id = fiscal_documents.store_id
        and c.auth_user_id = auth.uid()
    )
  );

create or replace function public.create_support_ticket(
  p_store_id uuid,
  p_ticket_id uuid,
  p_order_id uuid,
  p_category text,
  p_subject text,
  p_description text,
  p_evidence_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_type text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Inicia sesion';
  end if;
  v_type := case when private.is_store_member(p_store_id) then 'staff' else 'customer' end;
  if p_order_id is not null and v_type = 'customer' and not exists (
    select 1 from public.orders o
    join public.customers c on c.id = o.customer_id and c.store_id = o.store_id
    where o.id = p_order_id and o.store_id = p_store_id
      and c.auth_user_id = v_actor
  ) then
    raise exception using errcode = '42501', message = 'Pedido no pertenece al usuario';
  end if;
  insert into public.support_tickets(
    id,store_id,requester_user_id,requester_type,order_id,
    category,subject,description
  ) values (
    p_ticket_id,p_store_id,v_actor,v_type,p_order_id,p_category,
    btrim(p_subject),btrim(p_description)
  );
  insert into public.support_messages(
    id,store_id,ticket_id,author_user_id,body,evidence_url
  ) values (
    gen_random_uuid(),p_store_id,p_ticket_id,v_actor,btrim(p_description),
    nullif(btrim(p_evidence_url),'')
  );
  return jsonb_build_object('id',p_ticket_id,'status','open');
end;
$$;

create or replace function public.add_support_message(
  p_store_id uuid,
  p_ticket_id uuid,
  p_message_id uuid,
  p_body text,
  p_evidence_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets%rowtype;
begin
  select * into v_ticket from public.support_tickets t
  where t.id = p_ticket_id and t.store_id = p_store_id
    and (t.requester_user_id = auth.uid() or private.is_store_member(t.store_id))
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Solicitud no encontrada'; end if;
  if v_ticket.status = 'closed' then
    raise exception using errcode = '22023', message = 'Solicitud cerrada';
  end if;
  insert into public.support_messages(
    id,store_id,ticket_id,author_user_id,body,evidence_url
  ) values (
    p_message_id,p_store_id,p_ticket_id,auth.uid(),btrim(p_body),
    nullif(btrim(p_evidence_url),'')
  );
  update public.support_tickets set
    status = case when requester_user_id = auth.uid()
      then 'open' else 'waiting_customer' end
  where id = p_ticket_id;
  return jsonb_build_object('id',p_message_id,'created',true);
end;
$$;

create or replace function public.get_my_support_tickets(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'orderId',t.order_id,'category',t.category,
    'subject',t.subject,'description',t.description,'status',t.status,
    'priority',t.priority,'createdAt',t.created_at,'updatedAt',t.updated_at,
    'messages',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'authorUserId',m.author_user_id,'body',m.body,
      'evidenceUrl',m.evidence_url,'createdAt',m.created_at
    ) order by m.created_at) from public.support_messages m
      where m.ticket_id = t.id and m.store_id = t.store_id),'[]'::jsonb)
  ) order by t.updated_at desc),'[]'::jsonb)
  from public.support_tickets t
  where t.store_id = p_store_id
    and (t.requester_user_id = auth.uid() or private.is_store_member(t.store_id))
$$;

create or replace function public.update_support_ticket(
  p_store_id uuid,
  p_ticket_id uuid,
  p_status text,
  p_priority text,
  p_assigned_to uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_store_member(p_store_id) then
    raise exception using errcode = '42501', message = 'Sin acceso a soporte';
  end if;
  update public.support_tickets set
    status = p_status,priority = p_priority,assigned_to = p_assigned_to,
    resolved_at = case when p_status in ('resolved','closed') then now() else null end
  where id = p_ticket_id and store_id = p_store_id;
  if not found then raise exception using errcode = 'P0002', message = 'Solicitud no encontrada'; end if;
  return jsonb_build_object('id',p_ticket_id,'status',p_status);
end;
$$;

create or replace function public.update_store_settings(
  p_store_id uuid,
  p_legal_name text,
  p_tax_id text,
  p_address text,
  p_phone text,
  p_business_hours text,
  p_receipt_footer text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_store_admin(p_store_id) then
    raise exception using errcode = '42501', message = 'Solo administrador';
  end if;
  insert into public.store_settings(
    store_id,legal_name,tax_id,address,phone,business_hours,
    receipt_footer,updated_by
  ) values (
    p_store_id,nullif(btrim(p_legal_name),''),nullif(btrim(p_tax_id),''),
    nullif(btrim(p_address),''),nullif(btrim(p_phone),''),
    nullif(btrim(p_business_hours),''),nullif(btrim(p_receipt_footer),''),
    auth.uid()
  )
  on conflict (store_id) do update set
    legal_name = excluded.legal_name,tax_id = excluded.tax_id,
    address = excluded.address,phone = excluded.phone,
    business_hours = excluded.business_hours,
    receipt_footer = excluded.receipt_footer,updated_by = auth.uid();
  return jsonb_build_object('storeId',p_store_id,'updated',true);
end;
$$;

create or replace function public.configure_fiscal_integration(
  p_store_id uuid,
  p_provider text,
  p_environment text,
  p_invoice_series text,
  p_receipt_series text,
  p_is_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_store_admin(p_store_id) then
    raise exception using errcode = '42501', message = 'Solo administrador';
  end if;
  if p_is_enabled and p_environment = 'production'
    and nullif(btrim(p_provider),'') is null then
    raise exception using errcode = '22023', message = 'Proveedor fiscal requerido';
  end if;
  insert into public.fiscal_integrations(
    store_id,provider,environment,invoice_series,receipt_series,
    is_enabled,updated_by
  ) values (
    p_store_id,p_provider,p_environment,nullif(btrim(p_invoice_series),''),
    nullif(btrim(p_receipt_series),''),p_is_enabled,auth.uid()
  )
  on conflict (store_id) do update set
    provider = excluded.provider,environment = excluded.environment,
    invoice_series = excluded.invoice_series,
    receipt_series = excluded.receipt_series,
    is_enabled = excluded.is_enabled,updated_by = auth.uid();
  return jsonb_build_object(
    'storeId',p_store_id,'enabled',p_is_enabled,
    'requiresServerSecret',p_is_enabled
  );
end;
$$;

revoke all on function public.create_support_ticket(
  uuid,uuid,uuid,text,text,text,text
),public.add_support_message(uuid,uuid,uuid,text,text),
  public.get_my_support_tickets(uuid),
  public.update_support_ticket(uuid,uuid,text,text,uuid),
  public.update_store_settings(uuid,text,text,text,text,text,text),
  public.configure_fiscal_integration(uuid,text,text,text,text,boolean)
  from public,anon,authenticated;
grant execute on function public.create_support_ticket(
  uuid,uuid,uuid,text,text,text,text
),public.add_support_message(uuid,uuid,uuid,text,text),
  public.get_my_support_tickets(uuid),
  public.update_support_ticket(uuid,uuid,text,text,uuid),
  public.update_store_settings(uuid,text,text,text,text,text,text),
  public.configure_fiscal_integration(uuid,text,text,text,text,boolean)
  to authenticated,service_role;
