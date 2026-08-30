-- Venta online minorista: catálogo, checkout y autoservicio de pedidos.

alter table public.orders
  add column payment_method text not null default 'cash'
    check (payment_method in ('cash', 'yape', 'plin', 'card')),
  add column payment_reference text;

alter table public.orders add constraint orders_digital_reference_check check (
  (payment_method in ('yape', 'plin')
    and nullif(btrim(payment_reference), '') is not null)
  or
  (payment_method not in ('yape', 'plin'))
);

create or replace function private.is_store_customer(p_store_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.customers c
    where c.store_id = p_store_id
      and c.auth_user_id = (select auth.uid())
      and c.status = 'active'
  );
$$;

create or replace function public.get_online_catalog(
  p_store_id uuid,
  p_query text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_query text := nullif(pg_catalog.lower(pg_catalog.btrim(p_query)), '');
  v_products jsonb;
  v_categories jsonb;
  v_zones jsonb;
begin
  if auth.uid() is null or not private.is_store_customer(p_store_id) then
    raise exception using errcode = '42501', message = 'Cuenta de cliente requerida';
  end if;

  select coalesce(pg_catalog.jsonb_agg(row_data order by row_data ->> 'name'), '[]'::jsonb)
  into v_products
  from (
    select pg_catalog.jsonb_build_object(
      'id', p.id,
      'sku', p.sku,
      'name', p.name,
      'category', c.name,
      'baseUnit', p.base_unit,
      'pricingQuantity', p.pricing_quantity,
      'priceCents', p.price_cents,
      'stockQuantity', p.stock_quantity,
      'minimumStockQuantity', p.minimum_stock_quantity,
      'presentations', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', pp.id,
            'name', pp.name,
            'kind', pp.kind,
            'quantityInBaseUnits', pp.conversion_factor,
            'priceCents', case
              when pp.price_mode = 'fixed' then pp.fixed_price_cents
              else (
                pp.conversion_factor * p.price_cents + p.pricing_quantity / 2
              ) / p.pricing_quantity
            end
          )
          order by pp.conversion_factor, pp.name
        )
        from public.product_presentations pp
        where pp.store_id = p.store_id
          and pp.product_id = p.id
          and pp.is_active = true
      ), '[]'::jsonb)
    ) row_data
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.store_id = p_store_id
      and p.is_active = true
      and c.is_active = true
      and p.stock_quantity > 0
      and (
        v_query is null
        or pg_catalog.lower(p.name) like '%' || v_query || '%'
        or pg_catalog.lower(p.sku) like '%' || v_query || '%'
        or pg_catalog.lower(c.name) like '%' || v_query || '%'
      )
  ) catalog;

  select coalesce(pg_catalog.jsonb_agg(distinct c.name order by c.name), '[]'::jsonb)
  into v_categories
  from public.products p
  join public.categories c on c.id = p.category_id
  where p.store_id = p_store_id and p.is_active and c.is_active and p.stock_quantity > 0;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', z.id,
      'name', z.name,
      'district', z.district,
      'feeCents', z.fee_cents,
      'minimumOrderCents', z.minimum_order_cents,
      'etaMinMinutes', z.eta_min_minutes,
      'etaMaxMinutes', z.eta_max_minutes,
      'scheduleText', z.schedule_text,
      'restrictions', z.restrictions
    ) order by z.name
  ), '[]'::jsonb)
  into v_zones
  from public.delivery_zones z
  where z.store_id = p_store_id and z.is_active = true;

  return pg_catalog.jsonb_build_object(
    'products', v_products,
    'categories', v_categories,
    'deliveryZones', v_zones,
    'serverTime', now()
  );
end;
$$;

create or replace function public.create_online_order(
  p_store_id uuid,
  p_order_id uuid,
  p_operation_id uuid,
  p_fulfillment_type text,
  p_delivery_zone_id uuid,
  p_address jsonb,
  p_items jsonb,
  p_payment_method text,
  p_payment_reference text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_customer public.customers%rowtype;
  v_existing public.orders%rowtype;
  v_zone public.delivery_zones%rowtype;
  v_address_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity bigint;
  v_line bigint;
  v_subtotal bigint := 0;
  v_fee bigint := 0;
  v_count integer := 0;
  v_order_number text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Cuenta de cliente requerida';
  end if;
  select * into v_customer
  from public.customers c
  where c.store_id = p_store_id and c.auth_user_id = v_actor and c.status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'Perfil de cliente no disponible';
  end if;

  select * into v_existing
  from public.orders o
  where o.store_id = p_store_id and o.operation_id = p_operation_id;
  if found then
    if v_existing.customer_id <> v_customer.id or v_existing.id <> p_order_id then
      raise exception using errcode = '23505', message = 'operation_id ya fue utilizado';
    end if;
    return pg_catalog.jsonb_build_object(
      'id', v_existing.id,
      'orderNumber', v_existing.order_number,
      'status', v_existing.status,
      'estimatedTotalCents', v_existing.estimated_total_cents,
      'duplicate', true
    );
  end if;

  if p_payment_method not in ('cash', 'yape', 'plin', 'card') then
    raise exception using errcode = '22023', message = 'Medio de pago invalido';
  end if;
  if p_payment_method in ('yape', 'plin')
    and nullif(pg_catalog.btrim(p_payment_reference), '') is null
  then
    raise exception using errcode = '22023', message = 'La referencia digital es obligatoria';
  end if;
  if p_items is null
    or pg_catalog.jsonb_typeof(p_items) <> 'array'
    or pg_catalog.jsonb_array_length(p_items) < 1
    or pg_catalog.jsonb_array_length(p_items) > 100
  then
    raise exception using errcode = '22023', message = 'El pedido requiere entre 1 y 100 items';
  end if;

  if p_fulfillment_type = 'delivery' then
    select * into v_zone
    from public.delivery_zones z
    where z.id = p_delivery_zone_id and z.store_id = p_store_id and z.is_active;
    if not found then
      raise exception using errcode = '22023', message = 'Zona de delivery no disponible';
    end if;
    if p_address is null or pg_catalog.jsonb_typeof(p_address) <> 'object' then
      raise exception using errcode = '22023', message = 'La direccion es obligatoria';
    end if;
    begin
      v_address_id := (p_address ->> 'id')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'La direccion requiere un UUID';
    end;
    if nullif(pg_catalog.btrim(p_address ->> 'address'), '') is null
      or nullif(pg_catalog.btrim(p_address ->> 'district'), '') is null
    then
      raise exception using errcode = '22023', message = 'Direccion y distrito son obligatorios';
    end if;
    update public.customer_addresses ca
    set address = pg_catalog.btrim(p_address ->> 'address'),
        district = pg_catalog.btrim(p_address ->> 'district'),
        instructions = nullif(pg_catalog.btrim(p_address ->> 'instructions'), ''),
        delivery_zone_id = v_zone.id,
        label = coalesce(nullif(pg_catalog.btrim(p_address ->> 'label'), ''), ca.label)
    where ca.id = v_address_id
      and ca.store_id = p_store_id
      and ca.customer_id = v_customer.id;
    if not found then
      insert into public.customer_addresses (
        id, store_id, customer_id, label, address, district, instructions,
        delivery_zone_id, is_default
      ) values (
        v_address_id, p_store_id, v_customer.id,
        coalesce(nullif(pg_catalog.btrim(p_address ->> 'label'), ''), 'Principal'),
        pg_catalog.btrim(p_address ->> 'address'),
        pg_catalog.btrim(p_address ->> 'district'),
        nullif(pg_catalog.btrim(p_address ->> 'instructions'), ''),
        v_zone.id,
        not exists (
          select 1 from public.customer_addresses ca
          where ca.store_id = p_store_id and ca.customer_id = v_customer.id and ca.is_default
        )
      );
    end if;
    v_fee := v_zone.fee_cents;
  elsif p_fulfillment_type <> 'pickup' then
    raise exception using errcode = '22023', message = 'Modalidad de entrega invalida';
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_items)
  loop
    select * into v_product
    from public.products p
    where p.id = (v_item ->> 'productId')::uuid
      and p.store_id = p_store_id and p.is_active
    for share;
    if not found then
      raise exception using errcode = 'P0002', message = 'Producto no disponible';
    end if;
    v_quantity := (v_item ->> 'quantity')::bigint;
    if v_quantity is null or v_quantity <= 0 or v_quantity > v_product.stock_quantity then
      raise exception using errcode = '22023', message = 'Cantidad o stock invalido';
    end if;
    v_line := (
      v_quantity * v_product.price_cents + v_product.pricing_quantity / 2
    ) / v_product.pricing_quantity;
    if v_line <= 0 then
      raise exception using errcode = '22023', message = 'Subtotal de item invalido';
    end if;
    v_subtotal := v_subtotal + v_line;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    raise exception using errcode = '22023', message = 'El pedido no tiene items';
  end if;
  if v_zone.id is not null and v_subtotal < v_zone.minimum_order_cents then
    raise exception using errcode = '23514', message = 'Pedido menor al minimo de la zona';
  end if;

  v_order_number := 'ON-' || pg_catalog.to_char(now(), 'YYYYMMDD') || '-' ||
    pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(p_order_id::text, '-', ''), 1, 8));
  insert into public.orders (
    id, store_id, operation_id, order_number, customer_id, source,
    fulfillment_type, address_id, delivery_zone_id, status, payment_status,
    payment_method, payment_reference, estimated_subtotal_cents,
    delivery_fee_cents, estimated_total_cents, notes, created_by, source_device_id
  ) values (
    p_order_id, p_store_id, p_operation_id, v_order_number, v_customer.id, 'online',
    p_fulfillment_type, v_address_id, v_zone.id, 'received', 'pending',
    p_payment_method, nullif(pg_catalog.btrim(p_payment_reference), ''),
    v_subtotal, v_fee, v_subtotal + v_fee,
    nullif(pg_catalog.btrim(p_notes), ''), v_actor, null
  );

  for v_item in select value from pg_catalog.jsonb_array_elements(p_items)
  loop
    select * into strict v_product from public.products p
    where p.id = (v_item ->> 'productId')::uuid and p.store_id = p_store_id;
    v_quantity := (v_item ->> 'quantity')::bigint;
    v_line := (
      v_quantity * v_product.price_cents + v_product.pricing_quantity / 2
    ) / v_product.pricing_quantity;
    insert into public.order_items (
      id, store_id, order_id, product_id, product_name_snapshot,
      base_unit_snapshot, requested_quantity, price_cents_snapshot,
      pricing_quantity_snapshot, estimated_cents, substitution_policy
    ) values (
      coalesce(nullif(v_item ->> 'id', '')::uuid, gen_random_uuid()),
      p_store_id, p_order_id, v_product.id, v_product.name, v_product.base_unit,
      v_quantity, v_product.price_cents, v_product.pricing_quantity, v_line,
      coalesce(nullif(v_item ->> 'substitutionPolicy', ''), 'contact')
    );
  end loop;
  insert into public.order_status_history (
    store_id, order_id, operation_id, from_status, to_status, reason,
    actor_user_id, device_id
  ) values (
    p_store_id, p_order_id, p_operation_id, null, 'received',
    'Pedido online recibido', v_actor, null
  );
  perform private.append_order_change(
    p_order_id, 'order.created', null, p_operation_id
  );
  return pg_catalog.jsonb_build_object(
    'id', p_order_id,
    'orderNumber', v_order_number,
    'status', 'received',
    'estimatedSubtotalCents', v_subtotal,
    'deliveryFeeCents', v_fee,
    'estimatedTotalCents', v_subtotal + v_fee,
    'duplicate', false
  );
end;
$$;

create or replace function public.get_my_online_orders(p_store_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(pg_catalog.jsonb_agg(data order by (data ->> 'createdAt') desc), '[]'::jsonb)
  from (
    select pg_catalog.jsonb_build_object(
      'id', o.id,
      'orderNumber', o.order_number,
      'status', o.status,
      'paymentStatus', o.payment_status,
      'paymentMethod', o.payment_method,
      'fulfillmentType', o.fulfillment_type,
      'estimatedTotalCents', o.estimated_total_cents,
      'finalTotalCents', o.final_total_cents,
      'createdAt', o.created_at,
      'updatedAt', o.updated_at,
      'items', (
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', oi.id,
          'productId', oi.product_id,
          'productName', oi.product_name_snapshot,
          'requestedQuantity', oi.requested_quantity,
          'preparedQuantity', oi.prepared_quantity,
          'baseUnit', oi.base_unit_snapshot,
          'estimatedCents', oi.estimated_cents,
          'finalCents', oi.final_cents
        ) order by oi.created_at), '[]'::jsonb)
        from public.order_items oi
        where oi.order_id = o.id and oi.store_id = o.store_id
      ),
      'history', (
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'status', h.to_status,
          'reason', h.reason,
          'createdAt', h.created_at
        ) order by h.created_at), '[]'::jsonb)
        from public.order_status_history h
        where h.order_id = o.id and h.store_id = o.store_id
      )
    ) data
    from public.orders o
    join public.customers c on c.id = o.customer_id and c.store_id = o.store_id
    where o.store_id = p_store_id
      and c.auth_user_id = (select auth.uid())
  ) own_orders;
$$;

create or replace function public.cancel_my_online_order(
  p_store_id uuid,
  p_order_id uuid,
  p_operation_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  select o.* into v_order
  from public.orders o
  join public.customers c on c.id = o.customer_id and c.store_id = o.store_id
  where o.id = p_order_id
    and o.store_id = p_store_id
    and c.auth_user_id = v_actor
  for update of o;
  if not found then
    raise exception using errcode = 'P0002', message = 'Pedido no encontrado';
  end if;
  if exists (
    select 1 from public.order_status_history h
    where h.store_id = p_store_id and h.operation_id = p_operation_id
  ) then
    return pg_catalog.jsonb_build_object('id', v_order.id, 'status', v_order.status);
  end if;
  if v_order.status not in ('received', 'confirmed') then
    raise exception using errcode = '22023', message = 'El pedido ya no puede cancelarse';
  end if;
  if nullif(pg_catalog.btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'Indica el motivo de cancelacion';
  end if;
  update public.orders set status = 'cancelled' where id = p_order_id;
  insert into public.order_status_history (
    store_id, order_id, operation_id, from_status, to_status, reason,
    actor_user_id, device_id
  ) values (
    p_store_id, p_order_id, p_operation_id, v_order.status, 'cancelled',
    pg_catalog.btrim(p_reason), v_actor, null
  );
  perform private.append_order_change(
    p_order_id, 'order.status_changed', null, p_operation_id
  );
  return pg_catalog.jsonb_build_object('id', p_order_id, 'status', 'cancelled');
end;
$$;

revoke all on function public.get_online_catalog(uuid, text),
  public.create_online_order(uuid, uuid, uuid, text, uuid, jsonb, jsonb, text, text, text),
  public.get_my_online_orders(uuid),
  public.cancel_my_online_order(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_online_catalog(uuid, text),
  public.create_online_order(uuid, uuid, uuid, text, uuid, jsonb, jsonb, text, text, text),
  public.get_my_online_orders(uuid),
  public.cancel_my_online_order(uuid, uuid, uuid, text)
  to authenticated, service_role;
