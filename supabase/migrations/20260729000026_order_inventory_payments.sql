-- Integridad de inventario de pedidos y verificacion operativa de pagos.
-- Las reservas evitan sobreventa; el stock fisico se consume al preparar.

alter table public.orders
  add column payment_verified_at timestamptz,
  add column payment_verified_by_user_id uuid
    references auth.users(id) on delete restrict on update cascade;

create table public.order_inventory_reservations (
  id uuid primary key,
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  order_id uuid not null,
  order_item_id uuid not null,
  product_id uuid not null,
  reserved_quantity bigint not null check (reserved_quantity > 0),
  consumed_quantity bigint not null default 0 check (consumed_quantity >= 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'consumed', 'released')),
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  unique (store_id, order_item_id),
  foreign key (order_id, store_id)
    references public.orders(id, store_id)
    on delete restrict on update cascade,
  foreign key (order_item_id, store_id)
    references public.order_items(id, store_id)
    on delete restrict on update cascade,
  foreign key (product_id, store_id)
    references public.products(id, store_id)
    on delete restrict on update cascade,
  check (
    (status = 'reserved' and consumed_at is null and released_at is null)
    or (status = 'consumed' and consumed_at is not null and released_at is null)
    or (status = 'released' and consumed_at is null and released_at is not null)
  )
);

create index order_inventory_reservations_product
  on public.order_inventory_reservations(store_id, product_id, status);
create index order_inventory_reservations_order
  on public.order_inventory_reservations(store_id, order_id, status);

create trigger order_inventory_reservations_bump_version
  before update on public.order_inventory_reservations
  for each row execute function private.bump_catalog_version();

-- Si ya existen pedidos activos incompatibles, se detiene la migracion en vez de
-- ocultar una sobreventa preexistente.
do $preflight$
begin
  if exists (
    select 1
    from public.products p
    join (
      select oi.store_id, oi.product_id, sum(oi.requested_quantity) as reserved
      from public.order_items oi
      join public.orders o
        on o.id = oi.order_id and o.store_id = oi.store_id
      where o.status in ('received', 'confirmed', 'preparing')
        and oi.prepared_quantity is null
      group by oi.store_id, oi.product_id
    ) pending
      on pending.store_id = p.store_id and pending.product_id = p.id
    where pending.reserved > p.stock_quantity
  ) then
    raise exception using
      errcode = '23514',
      message = 'Existen pedidos activos que exceden el stock; resuelvalos antes de migrar';
  end if;
end;
$preflight$;

insert into public.order_inventory_reservations (
  id, store_id, order_id, order_item_id, product_id,
  reserved_quantity, consumed_quantity, status,
  consumed_at, released_at, created_at, updated_at, version
)
select
  oi.id,
  oi.store_id,
  oi.order_id,
  oi.id,
  oi.product_id,
  oi.requested_quantity,
  coalesce(oi.prepared_quantity, 0),
  case
    when o.status = 'cancelled' then 'released'
    when oi.prepared_quantity is not null then 'consumed'
    else 'reserved'
  end,
  case
    when o.status <> 'cancelled' and oi.prepared_quantity is not null
      then oi.updated_at
    else null
  end,
  case when o.status = 'cancelled' then o.updated_at else null end,
  oi.created_at,
  oi.updated_at,
  1
from public.order_items oi
join public.orders o
  on o.id = oi.order_id and o.store_id = oi.store_id;

-- Las versiones anteriores registraban la cantidad preparada sin consumir stock.
-- Se reconcilian esos pedidos una sola vez y se crea el ledger faltante.
do $backfill$
declare
  v_item record;
  v_product public.products%rowtype;
  v_product_version bigint;
  v_resulting_quantity bigint;
begin
  for v_item in
    select
      oi.id,
      oi.store_id,
      oi.order_id,
      oi.product_id,
      oi.prepared_quantity,
      o.order_number,
      o.created_by,
      o.source_device_id
    from public.order_items oi
    join public.orders o
      on o.id = oi.order_id and o.store_id = oi.store_id
    where oi.prepared_quantity is not null
      and oi.prepared_quantity > 0
      and o.status <> 'cancelled'
    order by oi.created_at, oi.id
  loop
    select * into strict v_product
    from public.products
    where id = v_item.product_id and store_id = v_item.store_id
    for update;

    if v_product.stock_quantity < v_item.prepared_quantity then
      raise exception using
        errcode = '23514',
        message = 'Stock insuficiente para reconciliar pedidos ya preparados';
    end if;

    v_resulting_quantity :=
      v_product.stock_quantity - v_item.prepared_quantity;
    update public.products
    set stock_quantity = v_resulting_quantity
    where id = v_product.id
    returning version into v_product_version;

    insert into public.inventory_movements (
      id, store_id, product_id, movement_type, quantity_delta,
      resulting_quantity, reason, reference_type, reference_id,
      actor_user_id, device_id, operation_id, product_version
    ) values (
      v_item.id,
      v_item.store_id,
      v_item.product_id,
      'sale',
      -v_item.prepared_quantity,
      v_resulting_quantity,
      'Consumo reconciliado del pedido ' || v_item.order_number,
      'order',
      v_item.order_id,
      v_item.created_by,
      v_item.source_device_id,
      v_item.id,
      v_product_version
    );
  end loop;
end;
$backfill$;

create or replace function private.reserve_order_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_reserved bigint;
begin
  select * into strict v_product
  from public.products
  where id = new.product_id and store_id = new.store_id
  for update;

  select coalesce(sum(r.reserved_quantity), 0)
    into v_reserved
  from public.order_inventory_reservations r
  where r.store_id = new.store_id
    and r.product_id = new.product_id
    and r.status = 'reserved';

  if new.requested_quantity > v_product.stock_quantity - v_reserved then
    raise exception using
      errcode = '23514',
      message = 'Stock disponible insuficiente para reservar el pedido';
  end if;

  insert into public.order_inventory_reservations (
    id, store_id, order_id, order_item_id, product_id, reserved_quantity
  ) values (
    new.id, new.store_id, new.order_id, new.id, new.product_id,
    new.requested_quantity
  );
  return new;
end;
$$;

create trigger order_items_reserve_inventory
  after insert on public.order_items
  for each row execute function private.reserve_order_inventory();

create or replace function private.consume_order_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_reservation public.order_inventory_reservations%rowtype;
  v_product public.products%rowtype;
  v_other_reserved bigint;
  v_resulting_quantity bigint;
  v_product_version bigint;
  v_actor uuid := auth.uid();
begin
  if old.prepared_quantity is not null or new.prepared_quantity is null then
    return new;
  end if;

  select * into strict v_order
  from public.orders
  where id = new.order_id and store_id = new.store_id;

  if v_actor is null then
    v_actor := v_order.created_by;
  end if;

  select * into strict v_reservation
  from public.order_inventory_reservations
  where store_id = new.store_id and order_item_id = new.id
  for update;

  if v_reservation.status <> 'reserved' then
    raise exception using
      errcode = '55000',
      message = 'La reserva del item ya fue consumida o liberada';
  end if;

  select * into strict v_product
  from public.products
  where id = new.product_id and store_id = new.store_id
  for update;

  select coalesce(sum(r.reserved_quantity), 0)
    into v_other_reserved
  from public.order_inventory_reservations r
  where r.store_id = new.store_id
    and r.product_id = new.product_id
    and r.status = 'reserved'
    and r.order_item_id <> new.id;

  if new.prepared_quantity > v_product.stock_quantity - v_other_reserved then
    raise exception using
      errcode = '23514',
      message = 'Stock disponible insuficiente para preparar el pedido';
  end if;

  if new.prepared_quantity > 0 then
    v_resulting_quantity := v_product.stock_quantity - new.prepared_quantity;
    update public.products
    set stock_quantity = v_resulting_quantity
    where id = v_product.id
    returning version into v_product_version;

    insert into public.inventory_movements (
      id, store_id, product_id, movement_type, quantity_delta,
      resulting_quantity, reason, reference_type, reference_id,
      actor_user_id, device_id, operation_id, product_version
    ) values (
      new.id,
      new.store_id,
      new.product_id,
      'sale',
      -new.prepared_quantity,
      v_resulting_quantity,
      'Consumo por preparacion del pedido ' || v_order.order_number,
      'order',
      new.order_id,
      v_actor,
      v_order.source_device_id,
      new.id,
      v_product_version
    );
  end if;

  update public.order_inventory_reservations
  set status = 'consumed',
      consumed_quantity = new.prepared_quantity,
      consumed_at = now()
  where id = v_reservation.id;

  return new;
end;
$$;

create trigger order_items_consume_inventory
  after update of prepared_quantity on public.order_items
  for each row execute function private.consume_order_inventory();

create or replace function private.release_cancelled_order_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'cancelled' and new.status = 'cancelled' then
    update public.order_inventory_reservations
    set status = 'released', released_at = now()
    where store_id = new.store_id
      and order_id = new.id
      and status = 'reserved';
  end if;
  return new;
end;
$$;

create trigger orders_release_cancelled_inventory
  after update of status on public.orders
  for each row execute function private.release_cancelled_order_inventory();

create table public.order_payment_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  order_id uuid not null,
  operation_id uuid not null,
  from_status text not null
    check (from_status in ('pending', 'paid', 'failed', 'refunded')),
  to_status text not null
    check (to_status in ('pending', 'paid', 'failed', 'refunded')),
  payment_method text not null
    check (payment_method in ('cash', 'yape', 'plin', 'card')),
  payment_reference text,
  reason text not null check (btrim(reason) <> ''),
  actor_user_id uuid not null references auth.users(id)
    on delete restrict on update cascade,
  device_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version = 1),
  unique (id, store_id),
  unique (store_id, operation_id),
  foreign key (order_id, store_id)
    references public.orders(id, store_id)
    on delete restrict on update cascade,
  foreign key (store_id, device_id)
    references public.devices(store_id, id)
    on delete restrict on update cascade
);

create trigger order_payment_history_is_immutable
  before update or delete on public.order_payment_history
  for each row execute function private.prevent_immutable_catalog_change();

create index order_payment_history_order
  on public.order_payment_history(store_id, order_id, created_at desc);

-- Publica todos los campos de pago y su auditoria en la proyeccion del pedido.
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
  v_payment_history jsonb;
begin
  select * into strict v_order from public.orders where id = p_order_id;
  select * into strict v_customer
  from public.customers
  where id = v_order.customer_id and store_id = v_order.store_id;

  if v_order.address_id is not null then
    select * into strict v_address
    from public.customer_addresses
    where id = v_order.address_id and store_id = v_order.store_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
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
  ) order by oi.created_at, oi.id), '[]'::jsonb)
  into v_items
  from public.order_items oi
  where oi.store_id = v_order.store_id and oi.order_id = v_order.id;

  select coalesce(jsonb_agg(jsonb_build_object(
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
  ) order by h.created_at, h.id), '[]'::jsonb)
  into v_history
  from public.order_status_history h
  where h.store_id = v_order.store_id and h.order_id = v_order.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ph.id,
    'operation_id', ph.operation_id,
    'from_status', ph.from_status,
    'to_status', ph.to_status,
    'payment_method', ph.payment_method,
    'payment_reference', ph.payment_reference,
    'reason', ph.reason,
    'actor_user_id', ph.actor_user_id,
    'device_id', ph.device_id,
    'created_at', ph.created_at,
    'updated_at', ph.updated_at,
    'version', ph.version
  ) order by ph.created_at, ph.id), '[]'::jsonb)
  into v_payment_history
  from public.order_payment_history ph
  where ph.store_id = v_order.store_id and ph.order_id = v_order.id;

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
      'payment_method', v_order.payment_method,
      'payment_reference', v_order.payment_reference,
      'payment_verified_at', v_order.payment_verified_at,
      'payment_verified_by_user_id', v_order.payment_verified_by_user_id,
      'estimated_subtotal_cents', v_order.estimated_subtotal_cents,
      'delivery_fee_cents', v_order.delivery_fee_cents,
      'estimated_total_cents', v_order.estimated_total_cents,
      'final_subtotal_cents', v_order.final_subtotal_cents,
      'final_total_cents', v_order.final_total_cents,
      'notes', v_order.notes,
      'scheduled_for', v_order.scheduled_for,
      'assigned_user_id', v_order.assigned_user_id,
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
      'address', case when v_order.address_id is null then null else
        jsonb_build_object(
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
      'history', v_history,
      'payment_history', v_payment_history
    ),
    v_order.updated_at
  );
end;
$$;

create or replace function public.update_order_payment_status(
  p_order_id uuid,
  p_device_id uuid,
  p_to_status text,
  p_payment_reference text,
  p_reason text,
  p_operation_id uuid,
  p_expected_version bigint
)
returns table (order_id uuid, payment_status text, order_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_reference text := nullif(pg_catalog.btrim(p_payment_reference), '');
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Pedido no encontrado';
  end if;
  if v_actor is null or not private.is_store_admin(v_order.store_id) then
    raise exception using errcode = '42501', message = 'Se requiere administrador';
  end if;
  if not private.is_authorized_store_device(v_order.store_id, p_device_id) then
    raise exception using errcode = '42501', message = 'Dispositivo no autorizado';
  end if;
  if exists (
    select 1 from public.order_payment_history
    where store_id = v_order.store_id and operation_id = p_operation_id
  ) then
    return query select v_order.id, v_order.payment_status, v_order.version;
    return;
  end if;
  if v_order.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'El pedido cambio en el servidor';
  end if;
  if not (
    (v_order.payment_status = 'pending' and p_to_status in ('paid', 'failed'))
    or (v_order.payment_status = 'failed' and p_to_status in ('pending', 'paid'))
    or (v_order.payment_status = 'paid' and p_to_status = 'refunded')
  ) then
    raise exception using errcode = '22023', message = 'Transicion de pago invalida';
  end if;
  if v_order.status = 'cancelled' and p_to_status <> 'refunded' then
    raise exception using errcode = '22023', message = 'Pedido cancelado no admite cobro';
  end if;
  v_reference := coalesce(v_reference, v_order.payment_reference);
  if p_to_status = 'paid' and v_order.payment_method <> 'cash'
    and v_reference is null
  then
    raise exception using errcode = '22023', message = 'Referencia de pago obligatoria';
  end if;
  if nullif(pg_catalog.btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'Motivo de pago obligatorio';
  end if;

  update public.orders
  set payment_status = p_to_status,
      payment_reference = v_reference,
      payment_verified_at = case
        when p_to_status in ('paid', 'refunded') then now() else null
      end,
      payment_verified_by_user_id = case
        when p_to_status in ('paid', 'refunded') then v_actor else null
      end
  where id = p_order_id;

  insert into public.order_payment_history (
    store_id, order_id, operation_id, from_status, to_status,
    payment_method, payment_reference, reason, actor_user_id, device_id
  ) values (
    v_order.store_id,
    p_order_id,
    p_operation_id,
    v_order.payment_status,
    p_to_status,
    v_order.payment_method,
    v_reference,
    pg_catalog.btrim(p_reason),
    v_actor,
    p_device_id
  );

  perform private.append_order_change(
    p_order_id, 'order.payment_status_changed', p_device_id, p_operation_id
  );
  return query
  select o.id, o.payment_status, o.version
  from public.orders o
  where o.id = p_order_id;
end;
$$;

revoke all on function public.update_order_payment_status(
  uuid, uuid, text, text, text, uuid, bigint
) from public, anon, authenticated;
grant execute on function public.update_order_payment_status(
  uuid, uuid, text, text, text, uuid, bigint
) to authenticated, service_role;

-- Conserva el RPC offline existente y le agrega el medio de pago enviado por
-- clientes v18, sin perder las extensiones instaladas en process_sync_batch.
do $create_order_payment_extension$
declare
  v_definition text;
  v_columns_marker text :=
    'fulfillment_type, address_id, delivery_zone_id, status, payment_status,
    estimated_subtotal_cents';
  v_columns_replacement text :=
    'fulfillment_type, address_id, delivery_zone_id, status, payment_status,
    payment_method, payment_reference, estimated_subtotal_cents';
  v_values_marker text :=
    '''pending'',
    v_subtotal,';
  v_values_replacement text :=
    '''pending'',
    coalesce(nullif(pg_catalog.btrim(p_payload ->> ''paymentMethod''), ''''), ''cash''),
    nullif(pg_catalog.btrim(p_payload ->> ''paymentReference''), ''''),
    v_subtotal,';
begin
  select pg_get_functiondef(
    'public.create_order(uuid,uuid,uuid,jsonb,uuid)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_columns_marker) = 0
    or strpos(v_definition, v_values_marker) = 0
  then
    raise exception 'No se encontro el punto de extension de pago en create_order';
  end if;
  v_definition := replace(v_definition, v_columns_marker, v_columns_replacement);
  v_definition := replace(v_definition, v_values_marker, v_values_replacement);
  execute v_definition;
end;
$create_order_payment_extension$;

-- Los productos se bloquean en un orden estable y de forma exclusiva. Así el
-- chequeo de stock y la reserva posterior no intentan escalar un FOR SHARE,
-- evitando deadlocks entre checkouts concurrentes.
do $online_order_lock_hardening$
declare
  v_definition text;
  v_loop_marker text :=
    'for v_item in select value from pg_catalog.jsonb_array_elements(p_items)';
  v_loop_replacement text :=
    'for v_item in select value from pg_catalog.jsonb_array_elements(p_items)
    order by value ->> ''productId''';
begin
  select pg_get_functiondef(
    'public.create_online_order(uuid,uuid,uuid,text,uuid,jsonb,jsonb,text,text,text)'::regprocedure
  ) into v_definition;
  if v_definition !~* 'for[[:space:]]+share;'
    or strpos(v_definition, v_loop_marker) = 0
  then
    raise exception 'No se encontro el punto de endurecimiento de create_online_order';
  end if;
  v_definition := pg_catalog.regexp_replace(
    v_definition,
    'for[[:space:]]+share;',
    'for update;',
    'i'
  );
  v_definition := replace(v_definition, v_loop_marker, v_loop_replacement);
  execute v_definition;
end;
$online_order_lock_hardening$;

-- Agrega la operacion al procesador offline sin reemplazar las extensiones
-- instaladas por migraciones posteriores.
do $sync_extension$
declare
  v_definition text;
  v_marker text := 'when v_operation_type = ''order.created'' then';
  v_replacement text :=
    'when v_operation_type = ''order.payment_status_changed'' then
            select pg_catalog.to_jsonb(r), r.order_id
              into v_result, v_server_entity_id
            from public.update_order_payment_status(
              v_entity_id,
              p_device_id,
              v_payload ->> ''toStatus'',
              v_payload ->> ''paymentReference'',
              v_payload ->> ''reason'',
              v_operation_id,
              (v_payload ->> ''expectedVersion'')::bigint
            ) r;

          when v_operation_type = ''order.created'' then';
begin
  select pg_get_functiondef(
    'public.process_sync_batch(uuid,uuid,integer,jsonb)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_marker) = 0 then
    raise exception 'No se encontro el punto de extension de pagos de pedido';
  end if;
  v_definition := replace(v_definition, v_marker, v_replacement);
  execute v_definition;
end;
$sync_extension$;

alter table public.order_inventory_reservations enable row level security;
alter table public.order_payment_history enable row level security;

revoke all on public.order_inventory_reservations from anon, authenticated;
revoke all on public.order_payment_history from anon, authenticated;
grant select on public.order_inventory_reservations to authenticated;
grant select on public.order_payment_history to authenticated;

create policy order_inventory_reservations_select_member
  on public.order_inventory_reservations
  for select
  to authenticated
  using (private.is_store_member(store_id));

create policy order_payment_history_select_member_or_customer
  on public.order_payment_history
  for select
  to authenticated
  using (
    private.is_store_member(store_id)
    or exists (
      select 1
      from public.orders o
      join public.customers c
        on c.id = o.customer_id and c.store_id = o.store_id
      where o.id = order_payment_history.order_id
        and o.store_id = order_payment_history.store_id
        and c.auth_user_id = auth.uid()
    )
  );

comment on table public.order_inventory_reservations is
  'Reserva stock fisico por item y registra su consumo o liberacion.';
comment on table public.order_payment_history is
  'Auditoria insert-only de verificaciones, fallos y reembolsos de pedidos.';
comment on function public.update_order_payment_status(
  uuid, uuid, text, text, text, uuid, bigint
) is 'Verifica o revierte pagos de pedido de forma idempotente y solo administrativa.';
