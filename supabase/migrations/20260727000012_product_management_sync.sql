-- MVP interno: alta y edición offline-first de productos.

create or replace function private.apply_product_sync_operation(
  p_store_id uuid,
  p_device_id uuid,
  p_actor_user_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_operation_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_category_id uuid;
  v_category_name text := nullif(pg_catalog.btrim(p_payload ->> 'category'), '');
  v_sku text := nullif(pg_catalog.upper(pg_catalog.btrim(p_payload ->> 'sku')), '');
  v_name text := nullif(pg_catalog.btrim(p_payload ->> 'name'), '');
  v_base_unit text := p_payload ->> 'baseUnit';
  v_pricing_quantity bigint := (p_payload ->> 'pricingQuantity')::bigint;
  v_price_cents bigint := (p_payload ->> 'priceCents')::bigint;
  v_cost_cents bigint := (p_payload ->> 'costCents')::bigint;
  v_minimum_stock bigint := (p_payload ->> 'minimumStockQuantity')::bigint;
  v_initial_stock bigint := coalesce(
    nullif(p_payload ->> 'initialStockQuantity', '')::bigint,
    0
  );
  v_expected_version bigint;
  v_opening_movement_id uuid;
  v_product public.products%rowtype;
begin
  if p_entity_type <> 'product'
    or p_operation_type not in ('product.created', 'product.updated')
  then
    raise exception using errcode = '22023', message = 'Operacion de producto invalida';
  end if;
  if not private.is_store_admin(p_store_id) then
    raise exception using errcode = '42501', message = 'Solo un administrador puede modificar productos';
  end if;
  if v_sku is null or v_name is null or v_category_name is null then
    raise exception using errcode = '22023', message = 'Codigo, nombre y categoria son obligatorios';
  end if;
  if v_base_unit not in ('gram', 'unit')
    or v_pricing_quantity < 1
    or v_price_cents < 0
    or v_cost_cents < 0
    or v_minimum_stock < 0
    or v_initial_stock < 0
  then
    raise exception using errcode = '22023', message = 'Cantidades o montos invalidos';
  end if;

  select s.organization_id into v_organization_id
  from public.stores s
  where s.id = p_store_id and s.status = 'active';
  if v_organization_id is null then
    raise exception using errcode = 'P0002', message = 'La tienda no esta activa';
  end if;

  select c.id into v_category_id
  from public.categories c
  where c.organization_id = v_organization_id
    and pg_catalog.lower(c.name) = pg_catalog.lower(v_category_name)
  order by c.is_active desc, c.created_at
  limit 1;

  if v_category_id is null then
    insert into public.categories (
      organization_id, name, slug, sort_order, is_active
    ) values (
      v_organization_id,
      v_category_name,
      pg_catalog.left(
        pg_catalog.regexp_replace(
          pg_catalog.lower(v_category_name),
          '[^a-z0-9]+',
          '-',
          'g'
        ),
        60
      ) || '-' || pg_catalog.substr(pg_catalog.md5(v_category_name), 1, 8),
      0,
      true
    )
    returning id into v_category_id;
  end if;

  if p_operation_type = 'product.created' then
    if exists (
      select 1 from public.products p
      where p.id = p_entity_id or (p.store_id = p_store_id and p.sku = v_sku)
    ) then
      raise exception using errcode = '23505', message = 'El producto o codigo ya existe';
    end if;
    insert into public.products (
      id, store_id, sku, name, category_id, base_unit, pricing_quantity,
      price_cents, cost_cents, stock_quantity, minimum_stock_quantity, is_active
    ) values (
      p_entity_id, p_store_id, v_sku, v_name, v_category_id, v_base_unit,
      v_pricing_quantity, v_price_cents, v_cost_cents, 0,
      v_minimum_stock, coalesce((p_payload ->> 'isActive')::boolean, true)
    )
    returning * into v_product;

    if v_initial_stock > 0 then
      begin
        v_opening_movement_id := (p_payload ->> 'openingMovementId')::uuid;
      exception when others then
        raise exception using errcode = '22023', message = 'openingMovementId debe ser UUID';
      end;
      if v_opening_movement_id is null then
        raise exception using errcode = '22023', message = 'Falta el movimiento de apertura';
      end if;
      perform *
      from public.adjust_inventory(
        p_entity_id,
        v_initial_stock,
        'opening',
        'Stock inicial',
        v_opening_movement_id,
        null,
        null,
        p_device_id
      );
      select * into v_product
      from public.products p
      where p.id = p_entity_id;
    end if;
  else
    begin
      v_expected_version := (p_payload ->> 'expectedVersion')::bigint;
    exception when others then
      raise exception using errcode = '22023', message = 'expectedVersion es invalida';
    end;
    select * into v_product
    from public.products p
    where p.id = p_entity_id and p.store_id = p_store_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'El producto no existe';
    end if;
    if v_product.version <> v_expected_version then
      raise exception using errcode = '40001', message = 'El producto cambio en el servidor';
    end if;
    if v_product.base_unit <> v_base_unit
      and (v_product.stock_quantity <> 0 or v_product.minimum_stock_quantity <> 0)
    then
      raise exception using errcode = '23514', message = 'La unidad requiere stock cero';
    end if;
    update public.products p
    set sku = v_sku,
        name = v_name,
        category_id = v_category_id,
        base_unit = v_base_unit,
        pricing_quantity = v_pricing_quantity,
        cost_cents = v_cost_cents,
        minimum_stock_quantity = v_minimum_stock,
        is_active = coalesce((p_payload ->> 'isActive')::boolean, true)
    where p.id = p_entity_id
    returning * into v_product;
  end if;

  return pg_catalog.jsonb_build_object(
    'productId', v_product.id,
    'productVersion', v_product.version,
    'stockQuantity', v_product.stock_quantity,
    'applied', true
  );
end;
$$;

revoke all on function private.apply_product_sync_operation(
  uuid, uuid, uuid, text, uuid, text, jsonb
) from public, anon, authenticated;

-- Inserta los dos casos nuevos sin reescribir manualmente el RPC B4 completo.
do $migration$
declare
  v_definition text;
  v_marker text := 'when v_operation_type = ''product.price_updated'' then';
  v_replacement text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.process_sync_batch(uuid,uuid,integer,jsonb)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_marker) = 0 then
    raise exception 'No se encontro el punto de extension de process_sync_batch';
  end if;
  v_replacement :=
    'when v_operation_type in (''product.created'', ''product.updated'') then
            v_result := private.apply_product_sync_operation(
              p_store_id,
              p_device_id,
              v_actor_user_id,
              v_entity_type,
              v_entity_id,
              v_operation_type,
              v_payload
            );
            v_server_entity_id := v_entity_id;

          ' || v_marker;
  execute pg_catalog.replace(v_definition, v_marker, v_replacement);
end;
$migration$;

comment on function private.apply_product_sync_operation(
  uuid, uuid, uuid, text, uuid, text, jsonb
) is 'Aplica altas y ediciones offline-first de productos desde process_sync_batch.';
