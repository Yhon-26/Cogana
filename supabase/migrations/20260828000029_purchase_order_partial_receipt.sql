-- Permite recepciones parciales de órdenes de compra en el servidor.
-- Antes, `apply_procurement_operation_sync` solo aceptaba órdenes en estado
-- 'ordered' y siempre marcaba la orden entera como 'received' al recibir
-- cualquier ítem. Este reemplazo:
--   1) acepta órdenes en 'ordered' o 'partially_received' (para permitir
--      recibir en varias visitas del proveedor),
--   2) recalcula el estado resultante ('received' solo si TODOS los ítems
--      quedaron completos, 'partially_received' en caso contrario),
--   3) solo actualiza received_at cuando la orden queda completamente
--      recibida.
-- El resto de la función (purchase_order.created, physical_count.completed,
-- el registro en change_log) queda igual que en la migración original.

create or replace function private.apply_procurement_operation_sync(
  p_store_id uuid,
  p_device_id uuid,
  p_actor_user_id uuid,
  p_entity_id uuid,
  p_operation_id uuid,
  p_operation_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_lot_id uuid;
  v_order public.purchase_orders%rowtype;
  v_count public.physical_counts%rowtype;
  v_fully_received boolean;
begin
  if not private.is_store_member(p_store_id) then
    raise exception using errcode = '42501', message = 'Sin acceso a compras';
  end if;

  if p_operation_type = 'purchase_order.created' then
    if not private.is_store_admin(p_store_id) then
      raise exception using errcode = '42501', message = 'Solo administrador crea órdenes';
    end if;
    if jsonb_typeof(p_payload -> 'items') <> 'array'
      or jsonb_array_length(p_payload -> 'items') = 0 then
      raise exception using errcode = '22023', message = 'Orden sin ítems';
    end if;
    insert into public.purchase_orders(
      id,store_id,supplier_id,order_number,status,expected_at,notes,total_cents,
      actor_user_id,source_device_id,created_at,updated_at
    ) values (
      p_entity_id,p_store_id,(p_payload ->> 'supplierId')::uuid,
      btrim(p_payload ->> 'orderNumber'),'ordered',
      nullif(p_payload ->> 'expectedAt','')::date,
      nullif(btrim(p_payload ->> 'notes'),''),
      (p_payload ->> 'totalCents')::bigint,p_actor_user_id,p_device_id,
      coalesce((p_payload ->> 'createdAt')::timestamptz,now()),
      coalesce((p_payload ->> 'createdAt')::timestamptz,now())
    );
    for v_item in select value from jsonb_array_elements(p_payload -> 'items')
    loop
      if not exists (
        select 1 from public.products p
        where p.id = (v_item ->> 'productId')::uuid and p.store_id = p_store_id
      ) then
        raise exception using errcode = '23503', message = 'Producto de compra inválido';
      end if;
      insert into public.purchase_order_items(
        id,store_id,purchase_order_id,product_id,product_name_snapshot,
        ordered_quantity,received_quantity,unit_cost_cents,pricing_quantity,
        line_total_cents,created_at,updated_at
      ) values (
        (v_item ->> 'id')::uuid,p_store_id,p_entity_id,
        (v_item ->> 'productId')::uuid,btrim(v_item ->> 'productName'),
        (v_item ->> 'orderedQuantity')::bigint,0,
        (v_item ->> 'unitCostCents')::bigint,
        (v_item ->> 'pricingQuantity')::bigint,
        (v_item ->> 'lineTotalCents')::bigint,
        coalesce((p_payload ->> 'createdAt')::timestamptz,now()),
        coalesce((p_payload ->> 'createdAt')::timestamptz,now())
      );
    end loop;
  elsif p_operation_type = 'purchase_order.received' then
    if not private.is_store_admin(p_store_id) then
      raise exception using errcode = '42501', message = 'Solo administrador recibe ordenes';
    end if;
    select * into v_order from public.purchase_orders po
      where po.id = p_entity_id and po.store_id = p_store_id for update;
    if not found or v_order.status not in ('ordered','partially_received') then
      raise exception using errcode = '40001', message = 'Orden no pendiente';
    end if;
    for v_item in select value from jsonb_array_elements(p_payload -> 'lots')
    loop
      update public.purchase_order_items set
        received_quantity = received_quantity
          + (v_item ->> 'receivedQuantity')::bigint
      where id = (v_item ->> 'itemId')::uuid
        and store_id = p_store_id and purchase_order_id = p_entity_id;
      if not found then
        raise exception using errcode = '23503', message = 'Ítem de compra inválido';
      end if;
      if nullif(v_item ->> 'lotCode','') is not null then
        v_lot_id := (v_item ->> 'id')::uuid;
        insert into public.inventory_lots(
          id,store_id,product_id,supplier_id,purchase_order_id,
          purchase_order_item_id,lot_code,expires_at,received_quantity,
          remaining_quantity,actor_user_id,source_device_id
        ) values (
          v_lot_id,p_store_id,(v_item ->> 'productId')::uuid,v_order.supplier_id,
          p_entity_id,(v_item ->> 'itemId')::uuid,btrim(v_item ->> 'lotCode'),
          nullif(v_item ->> 'expiresAt','')::date,
          (v_item ->> 'receivedQuantity')::bigint,
          (v_item ->> 'receivedQuantity')::bigint,p_actor_user_id,p_device_id
        );
        insert into public.change_log(
          store_id,source_device_id,operation_id,entity_type,entity_id,
          operation,entity_version,payload,changed_at
        ) values (
          p_store_id,p_device_id,p_operation_id,'inventory_lot',v_lot_id,
          'inventory_lot.received',1,
          private.inventory_lot_change_payload(v_lot_id),now()
        );
      end if;
    end loop;

    select bool_and(i.received_quantity >= i.ordered_quantity) into v_fully_received
      from public.purchase_order_items i
      where i.purchase_order_id = p_entity_id and i.store_id = p_store_id;

    update public.purchase_orders set
      status = case when v_fully_received then 'received' else 'partially_received' end,
      received_at = case
        when v_fully_received then coalesce((p_payload ->> 'receivedAt')::timestamptz,now())
        else received_at
      end
    where id = p_entity_id and store_id = p_store_id;
  elsif p_operation_type = 'physical_count.completed' then
    if not private.is_store_admin(p_store_id) then
      raise exception using errcode = '42501', message = 'Solo administrador cuenta';
    end if;
    insert into public.physical_counts(
      id,store_id,count_number,status,notes,actor_user_id,source_device_id,
      created_at,updated_at
    ) values (
      p_entity_id,p_store_id,btrim(p_payload ->> 'countNumber'),'completed',
      nullif(btrim(p_payload ->> 'notes'),''),p_actor_user_id,p_device_id,
      coalesce((p_payload ->> 'createdAt')::timestamptz,now()),
      coalesce((p_payload ->> 'createdAt')::timestamptz,now())
    );
    for v_item in select value from jsonb_array_elements(p_payload -> 'items')
    loop
      insert into public.physical_count_items(
        id,store_id,physical_count_id,product_id,product_name_snapshot,
        expected_quantity,counted_quantity,difference_quantity
      ) values (
        gen_random_uuid(),p_store_id,p_entity_id,
        (v_item ->> 'productId')::uuid,btrim(v_item ->> 'productName'),
        (v_item ->> 'expectedQuantity')::bigint,
        (v_item ->> 'countedQuantity')::bigint,
        (v_item ->> 'differenceQuantity')::bigint
      );
    end loop;
  else
    raise exception using errcode = '22023', message = 'Operación de compras no soportada';
  end if;

  if p_operation_type like 'purchase_order.%' then
    select * into strict v_order from public.purchase_orders po
      where po.id = p_entity_id and po.store_id = p_store_id;
    insert into public.change_log(
      store_id,source_device_id,operation_id,entity_type,entity_id,
      operation,entity_version,payload,changed_at
    ) values (
      p_store_id,p_device_id,p_operation_id,'purchase_order',p_entity_id,
      p_operation_type,v_order.version,
      private.purchase_order_change_payload(p_entity_id),now()
    );
    return jsonb_build_object('id',p_entity_id,'version',v_order.version,'applied',true);
  end if;

  select * into strict v_count from public.physical_counts c
    where c.id = p_entity_id and c.store_id = p_store_id;
  insert into public.change_log(
    store_id,source_device_id,operation_id,entity_type,entity_id,
    operation,entity_version,payload,changed_at
  ) values (
    p_store_id,p_device_id,p_operation_id,'physical_count',p_entity_id,
    p_operation_type,v_count.version,
    private.physical_count_change_payload(p_entity_id),now()
  );
  return jsonb_build_object('id',p_entity_id,'version',v_count.version,'applied',true);
end;
$$;

revoke all on function private.apply_procurement_operation_sync(
  uuid,uuid,uuid,uuid,uuid,text,jsonb
) from public,anon,authenticated;
