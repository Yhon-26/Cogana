-- Corrige el drift entre las migraciones locales y la base de datos de
-- producción. Tres funciones tenían versiones divergentes (ediciones manuales
-- en producción) que rompen su ejecución en vivo:
--
--   1. public.register_business_account  -> referenciaba stores.is_active
--                                           (la columna es stores.status).
--   2. private.apply_sale_return_sync    -> llamaba a
--                                           private.is_open_session_on_device(),
--                                           que no existe.
--   3. public.transition_order           -> la referencia a order_id era ambigua
--                                           con el OUT parameter del RETURNS TABLE.
--
-- Se re-aplica la versión autoritativa (la de las migraciones) de cada función,
-- con la ambigüedad de order_id resuelta calificando la columna. create or
-- replace conserva los privilegios ya concedidos/revocados.

-- ---------------------------------------------------------------------------
-- 1. register_business_account (versión correcta de 20260727000016)
-- ---------------------------------------------------------------------------
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
  if not exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.status = 'active' and s.deleted_at is null
  ) then
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

-- ---------------------------------------------------------------------------
-- 2. apply_sale_return_sync (versión correcta de 20260727000021)
-- ---------------------------------------------------------------------------
create or replace function private.apply_sale_return_sync(
  p_store_id uuid,
  p_device_id uuid,
  p_actor_user_id uuid,
  p_entity_id uuid,
  p_operation_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_sale_item public.sale_items%rowtype;
  v_returned bigint;
  v_calculated bigint;
  v_total bigint := 0;
  v_expected_cash bigint;
  v_return public.sale_returns%rowtype;
begin
  if not private.is_store_admin(p_store_id) then
    raise exception using errcode = '42501', message = 'Solo administrador';
  end if;
  select * into v_sale from public.sales s
    where s.id = (p_payload ->> 'saleId')::uuid
      and s.store_id = p_store_id for update;
  if not found or v_sale.voided_at is not null then
    raise exception using errcode = '22023', message = 'Venta no disponible';
  end if;
  if jsonb_typeof(p_payload -> 'items') <> 'array'
    or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception using errcode = '22023', message = 'Devolucion sin items';
  end if;

  if (select count(*) from (select distinct value->>'saleItemId' as id
    from jsonb_array_elements(p_payload -> 'items')) sub) <>
    jsonb_array_length(p_payload -> 'items') then
    raise exception using errcode = '22023', message = 'Items duplicados en la solicitud';
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    select * into v_sale_item from public.sale_items si
      where si.id = (v_item ->> 'saleItemId')::uuid
        and si.store_id = p_store_id and si.sale_id = v_sale.id;
    if not found then
      raise exception using errcode = '23503', message = 'Ítem de venta inválido';
    end if;
    select coalesce(sum(ri.quantity),0) into v_returned
      from public.sale_return_items ri
      join public.sale_returns r on r.id = ri.sale_return_id
        and r.store_id = ri.store_id
      where ri.store_id = p_store_id and ri.sale_item_id = v_sale_item.id;
    if (v_item ->> 'quantity')::bigint <= 0
      or v_returned + (v_item ->> 'quantity')::bigint > v_sale_item.quantity then
      raise exception using errcode = '22023', message = 'Cantidad excede venta';
    end if;
    v_calculated := (
      (v_item ->> 'quantity')::bigint * v_sale_item.line_total_cents
      + v_sale_item.quantity / 2
    ) / v_sale_item.quantity;
    if v_calculated <> (v_item ->> 'refundCents')::bigint then
      raise exception using errcode = '22023', message = 'Monto de devolución inválido';
    end if;
    v_total := v_total + v_calculated;
  end loop;
  if v_total <> (p_payload ->> 'totalCents')::bigint then
    raise exception using errcode = '22023', message = 'Total de devolución inválido';
  end if;

  if p_payload ->> 'refundMethod' = 'cash' then
    if not private.is_open_cash_session_for_device(
      (p_payload ->> 'cashSessionId')::uuid, p_store_id, p_device_id
    ) then
      raise exception using errcode = '55000', message = 'Caja no disponible';
    end if;
    select cs.opening_cash_cents
      + coalesce((select sum(sp.amount_cents) from public.sale_payments sp
        join public.sales s on s.id = sp.sale_id and s.store_id = sp.store_id
        where s.cash_session_id = cs.id and s.voided_at is null
          and sp.payment_method = 'cash'),0)
      + coalesce((select sum(cm.amount_cents) from public.cash_movements cm
        where cm.cash_session_id = cs.id and cm.movement_type = 'income'),0)
      - coalesce((select sum(cm.amount_cents) from public.cash_movements cm
        where cm.cash_session_id = cs.id and cm.movement_type = 'outflow'),0)
      into v_expected_cash
      from public.cash_sessions cs
      where cs.id = (p_payload ->> 'cashSessionId')::uuid
        and cs.store_id = p_store_id;
    if v_expected_cash < v_total then
      raise exception using errcode = '22023', message = 'Efectivo insuficiente';
    end if;
  end if;

  insert into public.sale_returns(
    id,store_id,sale_id,cash_session_id,refund_method,total_cents,reason,
    actor_user_id,source_device_id,created_at,updated_at
  ) values (
    p_entity_id,p_store_id,v_sale.id,
    nullif(p_payload ->> 'cashSessionId','')::uuid,
    p_payload ->> 'refundMethod',v_total,btrim(p_payload ->> 'reason'),
    p_actor_user_id,p_device_id,
    coalesce((p_payload ->> 'createdAt')::timestamptz,now()),
    coalesce((p_payload ->> 'createdAt')::timestamptz,now())
  );
  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    insert into public.sale_return_items(
      id,store_id,sale_return_id,sale_item_id,product_id,quantity,
      refund_cents,created_at,updated_at
    ) values (
      (v_item ->> 'id')::uuid,p_store_id,p_entity_id,
      (v_item ->> 'saleItemId')::uuid,(v_item ->> 'productId')::uuid,
      (v_item ->> 'quantity')::bigint,(v_item ->> 'refundCents')::bigint,
      coalesce((p_payload ->> 'createdAt')::timestamptz,now()),
      coalesce((p_payload ->> 'createdAt')::timestamptz,now())
    );
  end loop;
  if p_payload ->> 'refundMethod' = 'cash' then
    insert into public.cash_movements(
      id,store_id,cash_session_id,movement_type,amount_cents,reason,sale_id,
      actor_user_id,device_id,operation_id
    ) values (
      (p_payload ->> 'cashMovementId')::uuid,p_store_id,
      (p_payload ->> 'cashSessionId')::uuid,'outflow',v_total,
      'Devolución ' || v_sale.store_device_pos_id || ': ' || btrim(p_payload ->> 'reason'),
      v_sale.id,p_actor_user_id,p_device_id,p_operation_id
    );
  end if;
  select * into strict v_return from public.sale_returns r
    where r.id = p_entity_id and r.store_id = p_store_id;
  insert into public.change_log(
    store_id,source_device_id,operation_id,entity_type,entity_id,
    operation,entity_version,payload,changed_at
  ) values (
    p_store_id,p_device_id,p_operation_id,'sale_return',p_entity_id,
    'sale.returned',v_return.version,
    private.sale_return_change_payload(p_entity_id),now()
  );
  return jsonb_build_object('id',p_entity_id,'version',v_return.version,'applied',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. transition_order (order_id calificado para resolver ambigüedad)
-- ---------------------------------------------------------------------------
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
        and public.order_items.order_id = p_order_id
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
      where public.order_items.order_id = p_order_id and store_id = v_order.store_id
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
