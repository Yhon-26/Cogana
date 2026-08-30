-- B5: clientes, direcciones y pedidos minoristas.
-- Los pedidos se crean y cambian de estado únicamente mediante RPC.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  auth_user_id uuid references auth.users(id)
    on delete set null on update cascade,
  customer_type text not null default 'retail'
    check (customer_type in ('retail', 'restaurant')),
  name text not null check (btrim(name) <> ''),
  phone text not null check (btrim(phone) <> ''),
  email text,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  unique (store_id, phone)
);

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  customer_id uuid not null,
  label text not null check (btrim(label) <> ''),
  address text not null check (btrim(address) <> ''),
  district text not null check (btrim(district) <> ''),
  instructions text,
  delivery_zone_id uuid,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  foreign key (customer_id, store_id)
    references public.customers(id, store_id)
    on delete restrict on update cascade,
  foreign key (delivery_zone_id, store_id)
    references public.delivery_zones(id, store_id)
    on delete restrict on update cascade
);

create unique index customer_addresses_one_default
  on public.customer_addresses(store_id, customer_id)
  where is_default = true;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  operation_id uuid not null,
  order_number text not null check (btrim(order_number) <> ''),
  customer_id uuid not null,
  source text not null check (source in ('phone', 'whatsapp', 'online')),
  fulfillment_type text not null check (fulfillment_type in ('pickup', 'delivery')),
  address_id uuid,
  delivery_zone_id uuid,
  status text not null default 'received' check (
    status in (
      'received', 'confirmed', 'preparing', 'weight_review', 'ready',
      'out_for_delivery', 'ready_for_pickup', 'delivered', 'cancelled'
    )
  ),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  estimated_subtotal_cents bigint not null check (estimated_subtotal_cents >= 0),
  delivery_fee_cents bigint not null default 0 check (delivery_fee_cents >= 0),
  estimated_total_cents bigint not null,
  final_subtotal_cents bigint check (final_subtotal_cents >= 0),
  final_total_cents bigint check (final_total_cents >= 0),
  notes text,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict on update cascade,
  source_device_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  unique (store_id, operation_id),
  unique (store_id, order_number),
  foreign key (customer_id, store_id)
    references public.customers(id, store_id)
    on delete restrict on update cascade,
  foreign key (address_id, store_id)
    references public.customer_addresses(id, store_id)
    on delete restrict on update cascade,
  foreign key (delivery_zone_id, store_id)
    references public.delivery_zones(id, store_id)
    on delete restrict on update cascade,
  foreign key (store_id, source_device_id)
    references public.devices(store_id, id)
    on delete restrict on update cascade,
  check (estimated_total_cents = estimated_subtotal_cents + delivery_fee_cents),
  check (
    (final_subtotal_cents is null and final_total_cents is null)
    or
    (final_subtotal_cents is not null
      and final_total_cents = final_subtotal_cents + delivery_fee_cents)
  ),
  check (
    (fulfillment_type = 'pickup'
      and address_id is null
      and delivery_zone_id is null
      and delivery_fee_cents = 0)
    or
    (fulfillment_type = 'delivery'
      and address_id is not null
      and delivery_zone_id is not null)
  )
);

create or replace function private.validate_order_customer_address()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fulfillment_type = 'delivery' and not exists (
    select 1
    from public.customer_addresses ca
    where ca.id = new.address_id
      and ca.store_id = new.store_id
      and ca.customer_id = new.customer_id
      and ca.delivery_zone_id = new.delivery_zone_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'La direccion no pertenece al cliente y zona del pedido';
  end if;
  return new;
end;
$$;

create trigger orders_validate_customer_address
  before insert or update of customer_id, address_id, delivery_zone_id, fulfillment_type
  on public.orders
  for each row execute function private.validate_order_customer_address();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  order_id uuid not null,
  product_id uuid not null,
  product_name_snapshot text not null,
  base_unit_snapshot text not null check (base_unit_snapshot in ('gram', 'unit')),
  requested_quantity bigint not null check (requested_quantity > 0),
  prepared_quantity bigint check (prepared_quantity >= 0),
  price_cents_snapshot bigint not null check (price_cents_snapshot >= 0),
  pricing_quantity_snapshot bigint not null check (pricing_quantity_snapshot > 0),
  estimated_cents bigint not null check (estimated_cents >= 0),
  final_cents bigint check (final_cents >= 0),
  substitution_policy text not null default 'contact'
    check (substitution_policy in ('allow', 'contact', 'remove')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  foreign key (order_id, store_id)
    references public.orders(id, store_id)
    on delete restrict on update cascade,
  foreign key (product_id, store_id)
    references public.products(id, store_id)
    on delete restrict on update cascade,
  check (
    (prepared_quantity is null and final_cents is null)
    or
    (prepared_quantity is not null and final_cents is not null)
  )
);

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  order_id uuid not null,
  operation_id uuid not null,
  from_status text,
  to_status text not null check (
    to_status in (
      'received', 'confirmed', 'preparing', 'weight_review', 'ready',
      'out_for_delivery', 'ready_for_pickup', 'delivered', 'cancelled'
    )
  ),
  reason text not null check (btrim(reason) <> ''),
  actor_user_id uuid not null references auth.users(id)
    on delete restrict on update cascade,
  device_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  unique (store_id, operation_id),
  foreign key (order_id, store_id)
    references public.orders(id, store_id)
    on delete restrict on update cascade,
  foreign key (store_id, device_id)
    references public.devices(store_id, id)
    on delete restrict on update cascade,
  check (
    from_status is null
    or from_status in (
      'received', 'confirmed', 'preparing', 'weight_review', 'ready',
      'out_for_delivery', 'ready_for_pickup', 'delivered', 'cancelled'
    )
  )
);

create index customers_store_status_name
  on public.customers(store_id, status, name);
create index customer_addresses_customer
  on public.customer_addresses(store_id, customer_id, is_default desc);
create index orders_store_status_date
  on public.orders(store_id, status, created_at desc);
create index orders_customer_date
  on public.orders(store_id, customer_id, created_at desc);
create index order_items_order
  on public.order_items(store_id, order_id);
create index order_status_history_order
  on public.order_status_history(store_id, order_id, created_at);

create trigger customers_bump_version
  before update on public.customers
  for each row execute function private.bump_catalog_version();
create trigger customer_addresses_bump_version
  before update on public.customer_addresses
  for each row execute function private.bump_catalog_version();
create trigger orders_bump_version
  before update on public.orders
  for each row execute function private.bump_catalog_version();
create trigger order_items_bump_version
  before update on public.order_items
  for each row execute function private.bump_catalog_version();

create or replace function private.append_order_change(
  p_order_id uuid,
  p_operation text,
  p_source_device_id uuid,
  p_operation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_customer public.customers%rowtype;
  v_address public.customer_addresses%rowtype;
  v_items jsonb;
  v_history jsonb;
begin
  select * into strict v_order
  from public.orders
  where id = p_order_id;

  select * into strict v_customer
  from public.customers
  where id = v_order.customer_id
    and store_id = v_order.store_id;

  if v_order.address_id is not null then
    select * into strict v_address
    from public.customer_addresses
    where id = v_order.address_id
      and store_id = v_order.store_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'product_id', oi.product_id,
        'product_name_snapshot', oi.product_name_snapshot,
        'base_unit_snapshot', oi.base_unit_snapshot,
        'requested_quantity', oi.requested_quantity,
        'prepared_quantity', oi.prepared_quantity,
        'price_cents_snapshot', oi.price_cents_snapshot,
        'pricing_quantity_snapshot', oi.pricing_quantity_snapshot,
        'estimated_cents', oi.estimated_cents,
        'final_cents', oi.final_cents,
        'substitution_policy', oi.substitution_policy,
        'created_at', oi.created_at,
        'updated_at', oi.updated_at,
        'version', oi.version
      )
      order by oi.created_at, oi.id
    ),
    '[]'::jsonb
  ) into v_items
  from public.order_items oi
  where oi.store_id = v_order.store_id
    and oi.order_id = v_order.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', h.id,
        'operation_id', h.operation_id,
        'from_status', h.from_status,
        'to_status', h.to_status,
        'reason', h.reason,
        'actor_user_id', h.actor_user_id,
        'device_id', h.device_id,
        'created_at', h.created_at,
        'updated_at', h.updated_at,
        'version', h.version
      )
      order by h.created_at, h.id
    ),
    '[]'::jsonb
  ) into v_history
  from public.order_status_history h
  where h.store_id = v_order.store_id
    and h.order_id = v_order.id;

  insert into public.change_log (
    store_id, source_device_id, operation_id, entity_type, entity_id,
    operation, entity_version, payload, changed_at
  ) values (
    v_order.store_id,
    p_source_device_id,
    p_operation_id,
    'order',
    v_order.id,
    p_operation,
    v_order.version,
    jsonb_build_object(
      'id', v_order.id,
      'store_id', v_order.store_id,
      'operation_id', v_order.operation_id,
      'order_number', v_order.order_number,
      'customer_id', v_order.customer_id,
      'source', v_order.source,
      'fulfillment_type', v_order.fulfillment_type,
      'address_id', v_order.address_id,
      'delivery_zone_id', v_order.delivery_zone_id,
      'status', v_order.status,
      'payment_status', v_order.payment_status,
      'estimated_subtotal_cents', v_order.estimated_subtotal_cents,
      'delivery_fee_cents', v_order.delivery_fee_cents,
      'estimated_total_cents', v_order.estimated_total_cents,
      'final_subtotal_cents', v_order.final_subtotal_cents,
      'final_total_cents', v_order.final_total_cents,
      'notes', v_order.notes,
      'actor_user_id', v_order.created_by,
      'device_id', v_order.source_device_id,
      'created_at', v_order.created_at,
      'updated_at', v_order.updated_at,
      'version', v_order.version,
      'customer', jsonb_build_object(
        'id', v_customer.id,
        'auth_user_id', v_customer.auth_user_id,
        'customer_type', v_customer.customer_type,
        'name', v_customer.name,
        'phone', v_customer.phone,
        'email', v_customer.email,
        'status', v_customer.status,
        'created_at', v_customer.created_at,
        'updated_at', v_customer.updated_at,
        'version', v_customer.version
      ),
      'address', case
        when v_order.address_id is null then null
        else jsonb_build_object(
          'id', v_address.id,
          'label', v_address.label,
          'address', v_address.address,
          'district', v_address.district,
          'instructions', v_address.instructions,
          'delivery_zone_id', v_address.delivery_zone_id,
          'is_default', v_address.is_default,
          'created_at', v_address.created_at,
          'updated_at', v_address.updated_at,
          'version', v_address.version
        )
      end,
      'items', v_items,
      'history', v_history
    ),
    v_order.updated_at
  );
end;
$$;

create or replace function public.create_order(
  p_store_id uuid,
  p_device_id uuid,
  p_order_id uuid,
  p_payload jsonb,
  p_operation_id uuid
)
returns table (order_id uuid, order_number text, order_status text, order_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_customer_id uuid;
  v_address_id uuid;
  v_zone public.delivery_zones%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity bigint;
  v_line bigint;
  v_subtotal bigint := 0;
  v_fee bigint := 0;
  v_item_count integer := 0;
  v_existing public.orders%rowtype;
begin
  if v_actor is null or not private.is_store_member(p_store_id) then
    raise exception using errcode = '42501', message = 'Sin acceso a la tienda';
  end if;
  if not private.is_authorized_store_device(p_store_id, p_device_id) then
    raise exception using errcode = '42501', message = 'Dispositivo no autorizado';
  end if;

  select * into v_existing
  from public.orders
  where store_id = p_store_id
    and operation_id = p_operation_id;
  if found then
    return query select
      v_existing.id, v_existing.order_number, v_existing.status, v_existing.version;
    return;
  end if;

  v_customer_id := (p_payload #>> '{customer,id}')::uuid;
  insert into public.customers (
    id, store_id, customer_type, name, phone, email, status
  ) values (
    v_customer_id,
    p_store_id,
    coalesce(p_payload #>> '{customer,type}', 'retail'),
    btrim(p_payload #>> '{customer,name}'),
    btrim(p_payload #>> '{customer,phone}'),
    nullif(btrim(p_payload #>> '{customer,email}'), ''),
    'active'
  )
  on conflict (store_id, phone) do update
  set name = excluded.name,
      email = excluded.email,
      status = 'active'
  returning id into v_customer_id;

  if p_payload ->> 'fulfillmentType' = 'delivery' then
    select * into v_zone
    from public.delivery_zones
    where id = (p_payload ->> 'deliveryZoneId')::uuid
      and store_id = p_store_id
      and is_active = true;
    if not found then
      raise exception using errcode = '22023', message = 'Zona de delivery no disponible';
    end if;
    v_fee := v_zone.fee_cents;
    v_address_id := (p_payload #>> '{address,id}')::uuid;
    insert into public.customer_addresses (
      id, store_id, customer_id, label, address, district, instructions,
      delivery_zone_id, is_default
    ) values (
      v_address_id,
      p_store_id,
      v_customer_id,
      coalesce(nullif(btrim(p_payload #>> '{address,label}'), ''), 'Principal'),
      btrim(p_payload #>> '{address,address}'),
      btrim(p_payload #>> '{address,district}'),
      nullif(btrim(p_payload #>> '{address,instructions}'), ''),
      v_zone.id,
      not exists (
        select 1 from public.customer_addresses ca
        where ca.store_id = p_store_id
          and ca.customer_id = v_customer_id
          and ca.is_default = true
      )
    )
    on conflict (id) do update
    set address = excluded.address,
        district = excluded.district,
        instructions = excluded.instructions,
        delivery_zone_id = excluded.delivery_zone_id
    where public.customer_addresses.store_id = p_store_id
      and public.customer_addresses.customer_id = v_customer_id;

    if not exists (
      select 1
      from public.customer_addresses ca
      where ca.id = v_address_id
        and ca.store_id = p_store_id
        and ca.customer_id = v_customer_id
        and ca.delivery_zone_id = v_zone.id
    ) then
      raise exception using
        errcode = '23514',
        message = 'Direccion de cliente invalida';
    end if;
  elsif p_payload ->> 'fulfillmentType' <> 'pickup' then
    raise exception using errcode = '22023', message = 'Modalidad de pedido invalida';
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    select * into v_product
    from public.products
    where id = (v_item ->> 'productId')::uuid
      and store_id = p_store_id
      and is_active = true;
    if not found then
      raise exception using errcode = 'P0002', message = 'Producto no disponible';
    end if;
    v_quantity := (v_item ->> 'requestedQuantity')::bigint;
    if v_quantity is null or v_quantity <= 0 then
      raise exception using errcode = '22023', message = 'Cantidad de pedido invalida';
    end if;
    if v_quantity > v_product.stock_quantity then
      raise exception using errcode = '22023', message = 'Stock insuficiente para el pedido';
    end if;
    v_line := (v_quantity * v_product.price_cents
      + v_product.pricing_quantity / 2) / v_product.pricing_quantity;
    if v_line <= 0 then
      raise exception using errcode = '22023', message = 'Subtotal de item invalido';
    end if;
    v_subtotal := v_subtotal + v_line;
    v_item_count := v_item_count + 1;
  end loop;

  if v_item_count = 0 then
    raise exception using errcode = '22023', message = 'El pedido requiere items';
  end if;
  if v_zone.id is not null and v_subtotal < v_zone.minimum_order_cents then
    raise exception using errcode = '22023', message = 'Pedido menor al minimo de la zona';
  end if;

  insert into public.orders (
    id, store_id, operation_id, order_number, customer_id, source,
    fulfillment_type, address_id, delivery_zone_id, status, payment_status,
    estimated_subtotal_cents, delivery_fee_cents, estimated_total_cents,
    notes, created_by, source_device_id
  ) values (
    p_order_id,
    p_store_id,
    p_operation_id,
    btrim(p_payload ->> 'orderNumber'),
    v_customer_id,
    p_payload ->> 'source',
    p_payload ->> 'fulfillmentType',
    v_address_id,
    v_zone.id,
    'received',
    'pending',
    v_subtotal,
    v_fee,
    v_subtotal + v_fee,
    nullif(btrim(p_payload ->> 'notes'), ''),
    v_actor,
    p_device_id
  );

  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    select * into strict v_product
    from public.products
    where id = (v_item ->> 'productId')::uuid
      and store_id = p_store_id;
    v_quantity := (v_item ->> 'requestedQuantity')::bigint;
    v_line := (v_quantity * v_product.price_cents
      + v_product.pricing_quantity / 2) / v_product.pricing_quantity;
    insert into public.order_items (
      id, store_id, order_id, product_id, product_name_snapshot,
      base_unit_snapshot, requested_quantity, price_cents_snapshot,
      pricing_quantity_snapshot, estimated_cents, substitution_policy
    ) values (
      (v_item ->> 'id')::uuid,
      p_store_id,
      p_order_id,
      v_product.id,
      v_product.name,
      v_product.base_unit,
      v_quantity,
      v_product.price_cents,
      v_product.pricing_quantity,
      v_line,
      coalesce(v_item ->> 'substitutionPolicy', 'contact')
    );
  end loop;

  insert into public.order_status_history (
    store_id, order_id, operation_id, from_status, to_status, reason,
    actor_user_id, device_id
  ) values (
    p_store_id, p_order_id, p_operation_id, null, 'received',
    'Pedido registrado', v_actor, p_device_id
  );

  perform private.append_order_change(
    p_order_id, 'order.created', p_device_id, p_operation_id
  );
  return query
  select o.id, o.order_number, o.status, o.version
  from public.orders o
  where o.id = p_order_id;
end;
$$;

create or replace function public.transition_order(
  p_order_id uuid,
  p_device_id uuid,
  p_to_status text,
  p_reason text,
  p_items jsonb,
  p_operation_id uuid,
  p_expected_version bigint
)
returns table (order_id uuid, order_status text, order_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_item jsonb;
  v_db_item public.order_items%rowtype;
  v_prepared bigint;
  v_final bigint;
  v_subtotal bigint := 0;
  v_count integer := 0;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Pedido no encontrado';
  end if;
  if v_actor is null or not private.is_store_member(v_order.store_id) then
    raise exception using errcode = '42501', message = 'Sin acceso al pedido';
  end if;
  if not private.is_authorized_store_device(v_order.store_id, p_device_id) then
    raise exception using errcode = '42501', message = 'Dispositivo no autorizado';
  end if;
  if exists (
    select 1 from public.order_status_history h
    where h.store_id = v_order.store_id
      and h.operation_id = p_operation_id
  ) then
    return query select v_order.id, v_order.status, v_order.version;
    return;
  end if;
  if v_order.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'El pedido cambio en el servidor';
  end if;
  if not (
    (v_order.status = 'received' and p_to_status in ('confirmed', 'cancelled'))
    or (v_order.status = 'confirmed' and p_to_status in ('preparing', 'cancelled'))
    or (v_order.status = 'preparing'
      and p_to_status in ('ready', 'weight_review', 'cancelled'))
    or (v_order.status = 'weight_review' and p_to_status = 'ready')
    or (v_order.status = 'ready' and (
      (v_order.fulfillment_type = 'delivery' and p_to_status = 'out_for_delivery')
      or (v_order.fulfillment_type = 'pickup' and p_to_status = 'ready_for_pickup')
    ))
    or (v_order.status in ('out_for_delivery', 'ready_for_pickup')
      and p_to_status = 'delivered')
  ) then
    raise exception using errcode = '22023', message = 'Transicion de pedido invalida';
  end if;
  if (p_to_status = 'cancelled' or v_order.status = 'weight_review')
    and not private.is_store_admin(v_order.store_id)
  then
    raise exception using errcode = '42501', message = 'Se requiere administrador';
  end if;

  if v_order.status = 'preparing' and p_to_status in ('ready', 'weight_review') then
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
      raise exception using errcode = '22023', message = 'Faltan cantidades preparadas';
    end if;
    for v_item in select value from jsonb_array_elements(p_items)
    loop
      select * into v_db_item
      from public.order_items
      where id = (v_item ->> 'id')::uuid
        and order_id = p_order_id
        and store_id = v_order.store_id;
      if not found then
        raise exception using errcode = 'P0002', message = 'Item de pedido no encontrado';
      end if;
      v_prepared := (v_item ->> 'preparedQuantity')::bigint;
      if v_prepared is null or v_prepared < 0 then
        raise exception using errcode = '22023', message = 'Cantidad preparada invalida';
      end if;
      if v_db_item.base_unit_snapshot = 'unit'
        and v_prepared <> v_db_item.requested_quantity
      then
        raise exception using errcode = '22023', message = 'Cantidad unitaria distinta';
      end if;
      v_final := case
        when v_prepared = 0 then 0
        else (v_prepared * v_db_item.price_cents_snapshot
          + v_db_item.pricing_quantity_snapshot / 2)
          / v_db_item.pricing_quantity_snapshot
      end;
      update public.order_items
      set prepared_quantity = v_prepared,
          final_cents = v_final
      where id = v_db_item.id;
      v_subtotal := v_subtotal + v_final;
      v_count := v_count + 1;
    end loop;
    if v_count <> (
      select count(*) from public.order_items
      where order_id = p_order_id and store_id = v_order.store_id
    ) then
      raise exception using errcode = '22023', message = 'Faltan items preparados';
    end if;
    update public.orders
    set final_subtotal_cents = v_subtotal,
        final_total_cents = v_subtotal + delivery_fee_cents
    where id = p_order_id;
  end if;

  update public.orders
  set status = p_to_status
  where id = p_order_id;

  insert into public.order_status_history (
    store_id, order_id, operation_id, from_status, to_status, reason,
    actor_user_id, device_id
  ) values (
    v_order.store_id, p_order_id, p_operation_id, v_order.status, p_to_status,
    btrim(p_reason), v_actor, p_device_id
  );
  perform private.append_order_change(
    p_order_id, 'order.status_changed', p_device_id, p_operation_id
  );
  return query
  select o.id, o.status, o.version
  from public.orders o
  where o.id = p_order_id;
end;
$$;

alter table public.customers enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;

revoke all on public.customers, public.customer_addresses, public.orders,
  public.order_items, public.order_status_history
  from public, anon, authenticated;
grant select on public.customers, public.customer_addresses, public.orders,
  public.order_items, public.order_status_history
  to authenticated;
grant insert (id, store_id, auth_user_id, customer_type, name, phone, email, status),
  update (name, phone, email)
  on public.customers to authenticated;
grant insert (
  id, store_id, customer_id, label, address, district, instructions,
  delivery_zone_id, is_default
), update (
  label, address, district, instructions, delivery_zone_id, is_default
) on public.customer_addresses to authenticated;
grant all on public.customers, public.customer_addresses, public.orders,
  public.order_items, public.order_status_history to service_role;

create policy customers_select_store_or_self
  on public.customers for select to authenticated
  using (private.is_store_member(store_id) or auth_user_id = auth.uid());
create policy customers_insert_store_or_self
  on public.customers for insert to authenticated
  with check (
    private.is_store_member(store_id)
  );
create policy customers_update_store_or_self
  on public.customers for update to authenticated
  using (private.is_store_member(store_id) or auth_user_id = auth.uid())
  with check (
    private.is_store_member(store_id)
    or (auth_user_id = auth.uid() and status = (select status from public.customers c where c.id = id))
  );

create policy addresses_select_store_or_owner
  on public.customer_addresses for select to authenticated
  using (
    private.is_store_member(store_id)
    or exists (
      select 1 from public.customers c
      where c.id = customer_addresses.customer_id
        and c.store_id = customer_addresses.store_id
        and c.auth_user_id = auth.uid()
    )
  );
create policy addresses_insert_store_or_owner
  on public.customer_addresses for insert to authenticated
  with check (
    private.is_store_member(store_id)
    or exists (
      select 1 from public.customers c
      where c.id = customer_addresses.customer_id
        and c.store_id = customer_addresses.store_id
        and c.auth_user_id = auth.uid()
    )
  );
create policy addresses_update_store_or_owner
  on public.customer_addresses for update to authenticated
  using (
    private.is_store_member(store_id)
    or exists (
      select 1 from public.customers c
      where c.id = customer_addresses.customer_id
        and c.store_id = customer_addresses.store_id
        and c.auth_user_id = auth.uid()
    )
  )
  with check (
    private.is_store_member(store_id)
    or exists (
      select 1 from public.customers c
      where c.id = customer_addresses.customer_id
        and c.store_id = customer_addresses.store_id
        and c.auth_user_id = auth.uid()
    )
  );

create policy orders_select_store_or_customer
  on public.orders for select to authenticated
  using (
    private.is_store_member(store_id)
    or exists (
      select 1 from public.customers c
      where c.id = orders.customer_id
        and c.store_id = orders.store_id
        and c.auth_user_id = auth.uid()
    )
  );
create policy order_items_select_store_or_customer
  on public.order_items for select to authenticated
  using (
    private.is_store_member(store_id)
    or exists (
      select 1
      from public.orders o
      join public.customers c
        on c.id = o.customer_id and c.store_id = o.store_id
      where o.id = order_items.order_id
        and o.store_id = order_items.store_id
        and c.auth_user_id = auth.uid()
    )
  );
create policy order_history_select_store_or_customer
  on public.order_status_history for select to authenticated
  using (
    private.is_store_member(store_id)
    or exists (
      select 1
      from public.orders o
      join public.customers c
        on c.id = o.customer_id and c.store_id = o.store_id
      where o.id = order_status_history.order_id
        and o.store_id = order_status_history.store_id
        and c.auth_user_id = auth.uid()
    )
  );

revoke all on function public.create_order(uuid, uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, uuid, uuid, jsonb, uuid)
  to authenticated, service_role;
revoke all on function public.transition_order(uuid, uuid, text, text, jsonb, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.transition_order(uuid, uuid, text, text, jsonb, uuid, bigint)
  to authenticated, service_role;

-- Extiende B4 con order.created y order.status_changed.
do $migration$
declare
  v_body text;
  v_old text := $old$
          when v_operation_type = 'product_presentation.created' then
$old$;
  v_new text := $new$
          when v_operation_type = 'order.created' then
            select pg_catalog.to_jsonb(r), r.order_id
              into v_result, v_server_entity_id
            from public.create_order(
              p_store_id,
              p_device_id,
              v_entity_id,
              v_payload,
              v_operation_id
            ) r;

          when v_operation_type = 'order.status_changed' then
            select pg_catalog.to_jsonb(r), r.order_id
              into v_result, v_server_entity_id
            from public.transition_order(
              v_entity_id,
              p_device_id,
              v_payload ->> 'toStatus',
              v_payload ->> 'reason',
              v_payload -> 'items',
              v_operation_id,
              (v_payload ->> 'expectedVersion')::bigint
            ) r;

          when v_operation_type = 'product_presentation.created' then
$new$;
begin
  select p.prosrc into v_body
  from pg_catalog.pg_proc p
  where p.oid =
    'public.process_sync_batch(uuid,uuid,integer,jsonb)'::pg_catalog.regprocedure;
  if v_body is null or pg_catalog.strpos(v_body, v_old) = 0 then
    raise exception 'No se encontro el punto de extension B4 para pedidos';
  end if;
  v_body := pg_catalog.replace(v_body, v_old, v_new);
  execute pg_catalog.format(
    $sql$
      create or replace function public.process_sync_batch(
        p_store_id uuid,
        p_device_id uuid,
        p_schema_version integer,
        p_operations jsonb
      )
      returns jsonb
      language plpgsql
      security definer
      set search_path = ''
      as %L
    $sql$,
    v_body
  );
end;
$migration$;

comment on table public.orders is
  'Pedidos minoristas con total estimado/final y maquina de estados auditada.';
comment on function public.create_order(uuid, uuid, uuid, jsonb, uuid) is
  'Crea un pedido idempotente, valida zona y recalcula precios en el servidor.';
comment on function public.transition_order(uuid, uuid, text, text, jsonb, uuid, bigint) is
  'Unico punto de cambio de estado y confirmacion de cantidades preparadas.';
