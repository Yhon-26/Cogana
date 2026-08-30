-- Entrega 3: cuentas comerciales, precios acordados, cotizaciones y recurrencia.

create table public.business_accounts (
  id uuid primary key,
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  legal_name text not null check (btrim(legal_name) <> ''),
  trade_name text,
  tax_id text not null check (tax_id ~ '^[0-9]{11}$'),
  business_type text not null check (business_type in ('restaurant','wholesale')),
  contact_name text not null check (btrim(contact_name) <> ''),
  contact_phone text not null check (btrim(contact_phone) <> ''),
  contact_email text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','suspended')),
  credit_limit_cents bigint not null default 0 check (credit_limit_cents >= 0),
  credit_used_cents bigint not null default 0
    check (credit_used_cents >= 0 and credit_used_cents <= credit_limit_cents),
  payment_terms_days integer not null default 0 check (payment_terms_days between 0 and 180),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  unique (store_id, tax_id)
);

alter table public.orders
  add column business_account_id uuid;
alter table public.orders
  add constraint orders_business_account_fk
  foreign key (business_account_id,store_id)
  references public.business_accounts(id,store_id)
  on delete restrict on update cascade;
create index orders_business_account_date
  on public.orders(store_id,business_account_id,created_at desc)
  where business_account_id is not null;

create table public.business_members (
  business_account_id uuid not null,
  store_id uuid not null,
  user_id uuid not null references auth.users(id)
    on delete cascade on update cascade,
  member_role text not null default 'owner' check (member_role in ('owner','buyer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  primary key (business_account_id, user_id),
  foreign key (business_account_id, store_id)
    references public.business_accounts(id, store_id)
    on delete cascade on update cascade
);

create table public.business_prices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  business_account_id uuid not null,
  product_id uuid not null,
  minimum_quantity bigint not null check (minimum_quantity > 0),
  price_cents bigint not null check (price_cents >= 0),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  foreign key (business_account_id, store_id)
    references public.business_accounts(id, store_id)
    on delete cascade on update cascade,
  foreign key (product_id, store_id) references public.products(id, store_id)
    on delete restrict on update cascade,
  check (valid_until is null or valid_until > valid_from)
);

create table public.business_quotes (
  id uuid primary key,
  store_id uuid not null,
  business_account_id uuid not null,
  order_id uuid,
  status text not null default 'requested'
    check (status in ('requested','quoted','accepted','rejected','expired')),
  requested_delivery_at timestamptz,
  recurrence text check (recurrence is null or recurrence in ('once','weekly','biweekly','monthly')),
  notes text,
  quoted_total_cents bigint check (quoted_total_cents is null or quoted_total_cents >= 0),
  valid_until timestamptz,
  admin_notes text,
  created_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  foreign key (business_account_id, store_id)
    references public.business_accounts(id, store_id)
    on delete restrict on update cascade,
  foreign key (order_id, store_id)
    references public.orders(id, store_id)
    on delete restrict on update cascade,
  unique (store_id, order_id)
);

create table public.business_quote_items (
  id uuid primary key,
  store_id uuid not null,
  quote_id uuid not null,
  product_id uuid not null,
  product_name_snapshot text not null,
  quantity bigint not null check (quantity > 0),
  base_unit text not null check (base_unit in ('gram','unit')),
  catalog_price_cents bigint not null check (catalog_price_cents >= 0),
  quoted_price_cents bigint check (quoted_price_cents is null or quoted_price_cents >= 0),
  quoted_line_cents bigint check (quoted_line_cents is null or quoted_line_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  foreign key (quote_id, store_id) references public.business_quotes(id, store_id)
    on delete cascade on update cascade,
  foreign key (product_id, store_id) references public.products(id, store_id)
    on delete restrict on update cascade
);

create table public.recurring_orders (
  id uuid primary key,
  store_id uuid not null,
  business_account_id uuid not null,
  name text not null check (btrim(name) <> ''),
  frequency text not null check (frequency in ('weekly','biweekly','monthly')),
  next_run_at timestamptz not null,
  fulfillment_type text not null check (fulfillment_type in ('pickup','delivery')),
  delivery_address jsonb,
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  foreign key (business_account_id, store_id)
    references public.business_accounts(id, store_id)
    on delete cascade on update cascade
);

create table public.business_documents (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  business_account_id uuid not null,
  document_type text not null
    check (document_type in ('quotation','account_statement','invoice','credit_note')),
  document_number text not null,
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  issued_at timestamptz not null default now(),
  due_at timestamptz,
  download_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  unique (store_id, document_type, document_number),
  foreign key (business_account_id, store_id)
    references public.business_accounts(id, store_id)
    on delete restrict on update cascade
);

create index business_accounts_store_status on public.business_accounts(store_id,status);
create index business_members_user on public.business_members(user_id,store_id,is_active);
create index business_prices_lookup on public.business_prices(
  store_id,business_account_id,product_id,is_active,minimum_quantity
);
create index business_quotes_account on public.business_quotes(
  store_id,business_account_id,created_at desc
);
create index recurring_orders_due on public.recurring_orders(store_id,is_active,next_run_at);
create index business_documents_account on public.business_documents(
  store_id,business_account_id,issued_at desc
);

create trigger business_accounts_bump_version before update on public.business_accounts
  for each row execute function private.bump_catalog_version();
create trigger business_members_bump_version before update on public.business_members
  for each row execute function private.bump_catalog_version();
create trigger business_prices_bump_version before update on public.business_prices
  for each row execute function private.bump_catalog_version();
create trigger business_quotes_bump_version before update on public.business_quotes
  for each row execute function private.bump_catalog_version();
create trigger business_quote_items_bump_version before update on public.business_quote_items
  for each row execute function private.bump_catalog_version();
create trigger recurring_orders_bump_version before update on public.recurring_orders
  for each row execute function private.bump_catalog_version();
create trigger business_documents_bump_version before update on public.business_documents
  for each row execute function private.bump_catalog_version();

alter table public.business_accounts enable row level security;
alter table public.business_members enable row level security;
alter table public.business_prices enable row level security;
alter table public.business_quotes enable row level security;
alter table public.business_quote_items enable row level security;
alter table public.recurring_orders enable row level security;
alter table public.business_documents enable row level security;

revoke all on public.business_accounts,public.business_members,
  public.business_prices,public.business_quotes,public.business_quote_items,
  public.recurring_orders,public.business_documents
  from public,anon,authenticated;
grant select on public.business_accounts,public.business_members,
  public.business_prices,public.business_quotes,public.business_quote_items,
  public.recurring_orders,public.business_documents to authenticated;
grant all on public.business_accounts,public.business_members,
  public.business_prices,public.business_quotes,public.business_quote_items,
  public.recurring_orders,public.business_documents to service_role;

create or replace function private.is_business_member(
  p_store_id uuid,
  p_business_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members bm
    where bm.store_id = p_store_id
      and bm.business_account_id = p_business_account_id
      and bm.user_id = auth.uid()
      and bm.is_active
  )
$$;
revoke all on function private.is_business_member(uuid,uuid)
  from public,anon,authenticated;

create policy business_accounts_read on public.business_accounts
  for select to authenticated using (
    private.is_store_member(store_id) or private.is_business_member(store_id,id)
  );
create policy business_members_read on public.business_members
  for select to authenticated using (
    private.is_store_member(store_id)
    or private.is_business_member(store_id,business_account_id)
  );
create policy business_prices_read on public.business_prices
  for select to authenticated using (
    private.is_store_member(store_id)
    or private.is_business_member(store_id,business_account_id)
  );
create policy business_quotes_read on public.business_quotes
  for select to authenticated using (
    private.is_store_member(store_id)
    or private.is_business_member(store_id,business_account_id)
  );
create policy business_quote_items_read on public.business_quote_items
  for select to authenticated using (
    private.is_store_member(store_id)
    or exists (
      select 1 from public.business_quotes q
      where q.id = business_quote_items.quote_id
        and q.store_id = business_quote_items.store_id
        and private.is_business_member(q.store_id,q.business_account_id)
    )
  );
create policy recurring_orders_read on public.recurring_orders
  for select to authenticated using (
    private.is_store_member(store_id)
    or private.is_business_member(store_id,business_account_id)
  );
create policy business_documents_read on public.business_documents
  for select to authenticated using (
    private.is_store_member(store_id)
    or private.is_business_member(store_id,business_account_id)
  );

create or replace function public.register_business_account(
  p_store_id uuid,
  p_business_id uuid,
  p_legal_name text,
  p_trade_name text,
  p_tax_id text,
  p_business_type text,
  p_contact_name text,
  p_contact_phone text,
  p_contact_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Inicia sesion';
  end if;
  if not exists (select 1 from public.stores s where s.id = p_store_id and s.status = 'active' and s.deleted_at is null) then
    raise exception using errcode = 'P0002', message = 'Tienda no disponible';
  end if;
  if btrim(p_legal_name) = '' or p_tax_id !~ '^[0-9]{11}$'
     or p_business_type not in ('restaurant','wholesale')
     or btrim(p_contact_name) = '' or btrim(p_contact_phone) = '' then
    raise exception using errcode = '22023', message = 'Datos comerciales invalidos';
  end if;
  insert into public.business_accounts(
    id,store_id,legal_name,trade_name,tax_id,business_type,
    contact_name,contact_phone,contact_email
  ) values (
    p_business_id,p_store_id,btrim(p_legal_name),nullif(btrim(p_trade_name),''),
    p_tax_id,p_business_type,btrim(p_contact_name),btrim(p_contact_phone),
    nullif(lower(btrim(p_contact_email)),'')
  );
  insert into public.business_members(
    business_account_id,store_id,user_id,member_role
  ) values (p_business_id,p_store_id,v_actor,'owner');
  return jsonb_build_object('id',p_business_id,'status','pending');
end;
$$;

create or replace function public.get_my_business_context(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'accounts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'legalName',a.legal_name,'tradeName',a.trade_name,
        'taxId',a.tax_id,'businessType',a.business_type,'status',a.status,
        'contactName',a.contact_name,'contactPhone',a.contact_phone,
        'contactEmail',a.contact_email,'creditLimitCents',a.credit_limit_cents,
        'creditUsedCents',a.credit_used_cents,
        'paymentTermsDays',a.payment_terms_days
      ) order by a.created_at)
      from public.business_accounts a
      join public.business_members bm
        on bm.business_account_id = a.id and bm.store_id = a.store_id
      where a.store_id = p_store_id and bm.user_id = auth.uid() and bm.is_active
    ),'[]'::jsonb),
    'prices',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',bp.id,'businessAccountId',bp.business_account_id,
        'productId',bp.product_id,'productName',p.name,
        'minimumQuantity',bp.minimum_quantity,'priceCents',bp.price_cents,
        'validFrom',bp.valid_from,'validUntil',bp.valid_until
      ) order by p.name,bp.minimum_quantity)
      from public.business_prices bp
      join public.products p on p.id = bp.product_id and p.store_id = bp.store_id
      where bp.store_id = p_store_id and bp.is_active
        and (bp.valid_until is null or bp.valid_until > now())
        and private.is_business_member(bp.store_id,bp.business_account_id)
    ),'[]'::jsonb),
    'quotes',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',q.id,'businessAccountId',q.business_account_id,'status',q.status,
        'orderId',q.order_id,
        'requestedDeliveryAt',q.requested_delivery_at,'recurrence',q.recurrence,
        'notes',q.notes,'quotedTotalCents',q.quoted_total_cents,
        'validUntil',q.valid_until,'adminNotes',q.admin_notes,
        'createdAt',q.created_at,
        'items',coalesce((select jsonb_agg(jsonb_build_object(
          'id',qi.id,'productId',qi.product_id,'productName',qi.product_name_snapshot,
          'quantity',qi.quantity,'baseUnit',qi.base_unit,
          'catalogPriceCents',qi.catalog_price_cents,
          'quotedPriceCents',qi.quoted_price_cents,
          'quotedLineCents',qi.quoted_line_cents
        ) order by qi.created_at) from public.business_quote_items qi
          where qi.quote_id = q.id and qi.store_id = q.store_id),'[]'::jsonb)
      ) order by q.created_at desc)
      from public.business_quotes q
      where q.store_id = p_store_id
        and private.is_business_member(q.store_id,q.business_account_id)
    ),'[]'::jsonb),
    'recurringOrders',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,'businessAccountId',r.business_account_id,'name',r.name,
        'frequency',r.frequency,'nextRunAt',r.next_run_at,
        'fulfillmentType',r.fulfillment_type,'deliveryAddress',r.delivery_address,
        'items',r.items,'isActive',r.is_active
      ) order by r.next_run_at)
      from public.recurring_orders r
      where r.store_id = p_store_id
        and private.is_business_member(r.store_id,r.business_account_id)
    ),'[]'::jsonb),
    'documents',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',d.id,'businessAccountId',d.business_account_id,
        'documentType',d.document_type,'documentNumber',d.document_number,
        'amountCents',d.amount_cents,'issuedAt',d.issued_at,'dueAt',d.due_at,
        'downloadUrl',d.download_url
      ) order by d.issued_at desc)
      from public.business_documents d
      where d.store_id = p_store_id
        and private.is_business_member(d.store_id,d.business_account_id)
    ),'[]'::jsonb)
  )
$$;

create or replace function public.create_business_quote(
  p_store_id uuid,
  p_quote_id uuid,
  p_business_account_id uuid,
  p_requested_delivery_at timestamptz,
  p_recurrence text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_item jsonb;
  v_product public.products%rowtype;
  v_item_id uuid;
  v_quantity bigint;
begin
  if not private.is_business_member(p_store_id,p_business_account_id) then
    raise exception using errcode = '42501', message = 'Sin acceso al negocio';
  end if;
  if not exists (
    select 1 from public.business_accounts a
    where a.id = p_business_account_id and a.store_id = p_store_id
      and a.status in ('pending','approved')
  ) then
    raise exception using errcode = '22023', message = 'Cuenta comercial no disponible';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'La cotizacion requiere productos';
  end if;
  insert into public.business_quotes(
    id,store_id,business_account_id,requested_delivery_at,recurrence,notes,created_by
  ) values (
    p_quote_id,p_store_id,p_business_account_id,p_requested_delivery_at,
    nullif(p_recurrence,''),nullif(btrim(p_notes),''),v_actor
  );
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item ->> 'id')::uuid;
    v_quantity := (v_item ->> 'quantity')::bigint;
    select * into v_product from public.products p
    where p.id = (v_item ->> 'productId')::uuid
      and p.store_id = p_store_id and p.is_active;
    if not found or v_quantity <= 0 then
      raise exception using errcode = '22023', message = 'Producto de cotizacion invalido';
    end if;
    insert into public.business_quote_items(
      id,store_id,quote_id,product_id,product_name_snapshot,quantity,
      base_unit,catalog_price_cents
    ) values (
      v_item_id,p_store_id,p_quote_id,v_product.id,v_product.name,v_quantity,
      v_product.base_unit,v_product.price_cents
    );
  end loop;
  return jsonb_build_object('id',p_quote_id,'status','requested');
end;
$$;

create or replace function public.save_recurring_order(
  p_store_id uuid,
  p_recurring_id uuid,
  p_business_account_id uuid,
  p_name text,
  p_frequency text,
  p_next_run_at timestamptz,
  p_fulfillment_type text,
  p_delivery_address jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_business_member(p_store_id,p_business_account_id) then
    raise exception using errcode = '42501', message = 'Sin acceso al negocio';
  end if;
  insert into public.recurring_orders(
    id,store_id,business_account_id,name,frequency,next_run_at,
    fulfillment_type,delivery_address,items,created_by
  ) values (
    p_recurring_id,p_store_id,p_business_account_id,btrim(p_name),p_frequency,
    p_next_run_at,p_fulfillment_type,p_delivery_address,p_items,auth.uid()
  )
  on conflict (id) do update set
    name = excluded.name,frequency = excluded.frequency,
    next_run_at = excluded.next_run_at,
    fulfillment_type = excluded.fulfillment_type,
    delivery_address = excluded.delivery_address,items = excluded.items,
    is_active = true
  where recurring_orders.store_id = p_store_id
    and recurring_orders.business_account_id = p_business_account_id;
  return jsonb_build_object('id',p_recurring_id,'active',true);
end;
$$;

create or replace function public.accept_my_business_quote(
  p_store_id uuid,
  p_quote_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.business_quotes%rowtype;
  v_customer public.customers%rowtype;
  v_item public.business_quote_items%rowtype;
  v_product public.products%rowtype;
  v_order_id uuid;
  v_operation_id uuid;
  v_order_number text;
begin
  select * into v_quote from public.business_quotes q
  where q.id = p_quote_id and q.store_id = p_store_id
    and private.is_business_member(q.store_id,q.business_account_id)
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Cotizacion no encontrada';
  end if;
  if v_quote.status = 'accepted' and v_quote.order_id is not null then
    return jsonb_build_object(
      'id',p_quote_id,'status','accepted','orderId',v_quote.order_id
    );
  end if;
  if v_quote.status <> 'quoted'
    or v_quote.valid_until is null or v_quote.valid_until <= now() then
    raise exception using errcode = '22023', message = 'Cotizacion no disponible';
  end if;
  if not exists (
    select 1 from public.business_accounts a
    where a.id = v_quote.business_account_id and a.store_id = p_store_id
      and a.status = 'approved'
  ) then
    raise exception using errcode = '22023', message = 'Cuenta comercial no aprobada';
  end if;
  select c.* into v_customer from public.customers c
  where c.store_id = p_store_id and c.auth_user_id = auth.uid()
    and c.status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'Cliente no encontrado';
  end if;
  v_order_id := gen_random_uuid();
  v_operation_id := gen_random_uuid();
  v_order_number := 'B2B-' || to_char(now(),'YYYYMMDD') || '-' ||
    upper(substr(replace(v_order_id::text,'-',''),1,8));
  insert into public.orders(
    id,store_id,operation_id,order_number,customer_id,business_account_id,
    source,fulfillment_type,status,payment_status,payment_method,
    estimated_subtotal_cents,delivery_fee_cents,estimated_total_cents,
    notes,created_by,source_device_id,scheduled_for
  ) values (
    v_order_id,p_store_id,v_operation_id,v_order_number,v_customer.id,
    v_quote.business_account_id,'online','pickup','received','pending','cash',
    v_quote.quoted_total_cents,0,v_quote.quoted_total_cents,
    concat_ws(' · ','Cotizacion ' || p_quote_id::text,v_quote.notes),
    auth.uid(),null,v_quote.requested_delivery_at
  );
  for v_item in
    select * from public.business_quote_items qi
    where qi.quote_id = p_quote_id and qi.store_id = p_store_id
  loop
    select * into strict v_product from public.products p
    where p.id = v_item.product_id and p.store_id = p_store_id;
    if v_item.quoted_price_cents is null or v_item.quoted_line_cents is null then
      raise exception using errcode = '22023', message = 'Cotizacion incompleta';
    end if;
    insert into public.order_items(
      store_id,order_id,product_id,product_name_snapshot,base_unit_snapshot,
      requested_quantity,price_cents_snapshot,pricing_quantity_snapshot,
      estimated_cents,substitution_policy
    ) values (
      p_store_id,v_order_id,v_item.product_id,v_item.product_name_snapshot,
      v_item.base_unit,v_item.quantity,v_item.quoted_price_cents,
      v_product.pricing_quantity,v_item.quoted_line_cents,'contact'
    );
  end loop;
  insert into public.order_status_history(
    store_id,order_id,operation_id,from_status,to_status,reason,
    actor_user_id,device_id
  ) values (
    p_store_id,v_order_id,v_operation_id,null,'received',
    'Cotizacion comercial aceptada',auth.uid(),null
  );
  update public.business_quotes
  set status = 'accepted',order_id = v_order_id
  where id = p_quote_id;
  perform private.append_order_change(
    v_order_id,'order.created',null,v_operation_id
  );
  return jsonb_build_object(
    'id',p_quote_id,'status','accepted','orderId',v_order_id
  );
end;
$$;

create or replace function public.review_business_account(
  p_store_id uuid,
  p_business_account_id uuid,
  p_status text,
  p_credit_limit_cents bigint,
  p_payment_terms_days integer
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
  if p_status not in ('approved','rejected','suspended')
    or p_credit_limit_cents < 0 or p_payment_terms_days not between 0 and 180 then
    raise exception using errcode = '22023', message = 'Condiciones invalidas';
  end if;
  update public.business_accounts a set
    status = p_status,credit_limit_cents = p_credit_limit_cents,
    payment_terms_days = p_payment_terms_days,
    reviewed_by = auth.uid(),reviewed_at = now()
  where a.id = p_business_account_id and a.store_id = p_store_id;
  if not found then raise exception using errcode = 'P0002', message = 'Negocio no encontrado'; end if;
  return jsonb_build_object('id',p_business_account_id,'status',p_status);
end;
$$;

create or replace function public.respond_business_quote(
  p_store_id uuid,
  p_quote_id uuid,
  p_valid_until timestamptz,
  p_admin_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_total bigint := 0;
  v_line bigint;
begin
  if not private.is_store_admin(p_store_id) then
    raise exception using errcode = '42501', message = 'Solo administrador emite cotizaciones';
  end if;
  if p_valid_until <= now() then
    raise exception using errcode = '22023', message = 'Vigencia invalida';
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_line := (v_item ->> 'lineCents')::bigint;
    if v_line < 0 then raise exception using errcode = '22023', message = 'Importe invalido'; end if;
    update public.business_quote_items qi set
      quoted_price_cents = (v_item ->> 'priceCents')::bigint,
      quoted_line_cents = v_line
    where qi.id = (v_item ->> 'id')::uuid
      and qi.quote_id = p_quote_id and qi.store_id = p_store_id;
    if not found then raise exception using errcode = 'P0002', message = 'Item no encontrado'; end if;
    v_total := v_total + v_line;
  end loop;
  update public.business_quotes q set
    status = 'quoted',quoted_total_cents = v_total,valid_until = p_valid_until,
    admin_notes = nullif(btrim(p_admin_notes),''),reviewed_by = auth.uid()
  where q.id = p_quote_id and q.store_id = p_store_id and q.status = 'requested';
  if not found then raise exception using errcode = '22023', message = 'Cotizacion ya atendida'; end if;
  return jsonb_build_object('id',p_quote_id,'status','quoted','totalCents',v_total);
end;
$$;

create or replace function public.update_my_business_account(
  p_store_id uuid,
  p_business_account_id uuid,
  p_legal_name text,
  p_trade_name text,
  p_contact_name text,
  p_contact_phone text,
  p_contact_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.business_members bm
    where bm.store_id = p_store_id
      and bm.business_account_id = p_business_account_id
      and bm.user_id = auth.uid()
      and bm.member_role = 'owner' and bm.is_active
  ) then
    raise exception using errcode = '42501', message = 'Solo el titular modifica el negocio';
  end if;
  if btrim(p_legal_name) = '' or btrim(p_contact_name) = ''
    or btrim(p_contact_phone) = '' then
    raise exception using errcode = '22023', message = 'Datos comerciales invalidos';
  end if;
  update public.business_accounts a set
    legal_name = btrim(p_legal_name),
    trade_name = nullif(btrim(p_trade_name),''),
    contact_name = btrim(p_contact_name),
    contact_phone = btrim(p_contact_phone),
    contact_email = nullif(lower(btrim(p_contact_email)),'')
  where a.id = p_business_account_id and a.store_id = p_store_id;
  return jsonb_build_object('id',p_business_account_id,'updated',true);
end;
$$;

create or replace function public.set_business_price(
  p_store_id uuid,
  p_price_id uuid,
  p_business_account_id uuid,
  p_product_id uuid,
  p_minimum_quantity bigint,
  p_price_cents bigint,
  p_valid_until timestamptz,
  p_is_active boolean
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
  if p_minimum_quantity <= 0 or p_price_cents < 0
    or (p_valid_until is not null and p_valid_until <= now()) then
    raise exception using errcode = '22023', message = 'Precio acordado invalido';
  end if;
  insert into public.business_prices(
    id,store_id,business_account_id,product_id,minimum_quantity,
    price_cents,valid_until,is_active,created_by
  ) values (
    p_price_id,p_store_id,p_business_account_id,p_product_id,
    p_minimum_quantity,p_price_cents,p_valid_until,p_is_active,auth.uid()
  )
  on conflict (id) do update set
    minimum_quantity = excluded.minimum_quantity,
    price_cents = excluded.price_cents,
    valid_until = excluded.valid_until,
    is_active = excluded.is_active
  where business_prices.store_id = p_store_id
    and business_prices.business_account_id = p_business_account_id;
  return jsonb_build_object('id',p_price_id,'active',p_is_active);
end;
$$;

revoke all on function public.register_business_account(
  uuid,uuid,text,text,text,text,text,text,text
), public.get_my_business_context(uuid),
  public.create_business_quote(uuid,uuid,uuid,timestamptz,text,text,jsonb),
  public.save_recurring_order(uuid,uuid,uuid,text,text,timestamptz,text,jsonb,jsonb),
  public.accept_my_business_quote(uuid,uuid),
  public.review_business_account(uuid,uuid,text,bigint,integer),
  public.respond_business_quote(uuid,uuid,timestamptz,text,jsonb),
  public.update_my_business_account(uuid,uuid,text,text,text,text,text),
  public.set_business_price(uuid,uuid,uuid,uuid,bigint,bigint,timestamptz,boolean)
  from public,anon,authenticated;
grant execute on function public.register_business_account(
  uuid,uuid,text,text,text,text,text,text,text
), public.get_my_business_context(uuid),
  public.create_business_quote(uuid,uuid,uuid,timestamptz,text,text,jsonb),
  public.save_recurring_order(uuid,uuid,uuid,text,text,timestamptz,text,jsonb,jsonb),
  public.accept_my_business_quote(uuid,uuid),
  public.review_business_account(uuid,uuid,text,bigint,integer),
  public.respond_business_quote(uuid,uuid,timestamptz,text,jsonb),
  public.update_my_business_account(uuid,uuid,text,text,text,text,text),
  public.set_business_price(uuid,uuid,uuid,uuid,bigint,bigint,timestamptz,boolean)
  to authenticated,service_role;
