-- B4 - Sincronizacion offline-first push/pull
-- Proyecto Cogana - Supabase/PostgreSQL
-- Referencia: Esquema Backend v1.0 seccion 10 y Plan de Implementacion seccion 9
--
-- Contrato v1:
--   * Cada push se deduplica por store_id + operation_id.
--   * Las operaciones de dominio se aplican mediante las RPC B2/B3.
--   * change_log entrega un cursor monotono por sequence.
--   * El cliente aplica cada pagina pull de manera atomica.
--   * Ventas, caja cerrada y movimientos son inmutables; el servidor decide.

-- =============================================================================
-- 1. Auditoria de push y cursor por dispositivo
-- =============================================================================

create table public.sync_operations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  device_id uuid not null,
  operation_id uuid not null,
  schema_version integer not null check (schema_version > 0),
  operation_type text not null check (btrim(operation_type) <> ''),
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id uuid not null,
  payload_hash text not null check (length(payload_hash) = 32),
  status text not null default 'received' check (
    status in ('received', 'applied', 'rejected')
  ),
  result jsonb,
  error_code text,
  error_message text,
  actor_user_id uuid not null references auth.users(id)
    on delete restrict on update cascade,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (store_id, operation_id),
  foreign key (store_id, device_id)
    references public.devices(store_id, id)
    on delete restrict on update cascade,
  check (
    (status = 'received'
      and processed_at is null
      and result is null
      and error_code is null
      and error_message is null)
    or
    (status = 'applied'
      and processed_at is not null
      and result is not null
      and error_code is null
      and error_message is null)
    or
    (status = 'rejected'
      and processed_at is not null
      and error_code is not null
      and error_message is not null)
  )
);

create index sync_operations_store_received
  on public.sync_operations(store_id, received_at desc);

create index sync_operations_store_entity
  on public.sync_operations(store_id, entity_type, entity_id, processed_at desc);

create trigger sync_operations_bump_version
  before update on public.sync_operations
  for each row execute function private.bump_catalog_version();

create table public.change_log (
  sequence bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  source_device_id uuid,
  operation_id uuid,
  source_outbox_id uuid,
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id uuid not null,
  operation text not null check (btrim(operation) <> ''),
  entity_version bigint not null default 1 check (entity_version >= 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (store_id, source_device_id)
    references public.devices(store_id, id)
    on delete restrict on update cascade,
  foreign key (source_outbox_id)
    references public.sync_outbox(id)
    on delete restrict on update cascade,
  unique (store_id, source_outbox_id)
);

create index change_log_store_sequence
  on public.change_log(store_id, sequence);

create index change_log_store_entity
  on public.change_log(store_id, entity_type, entity_id, sequence desc);

create table public.device_sync_state (
  store_id uuid not null,
  device_id uuid not null,
  last_pull_sequence bigint not null default 0 check (last_pull_sequence >= 0),
  last_push_at timestamptz,
  last_pull_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  primary key (store_id, device_id),
  foreign key (store_id, device_id)
    references public.devices(store_id, id)
    on delete restrict on update cascade
);

create trigger device_sync_state_bump_version
  before update on public.device_sync_state
  for each row execute function private.bump_catalog_version();

-- =============================================================================
-- 2. Publicacion de cambios
-- =============================================================================

create or replace function private.append_change_log_from_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.change_log (
    store_id,
    source_device_id,
    operation_id,
    source_outbox_id,
    entity_type,
    entity_id,
    operation,
    entity_version,
    payload,
    changed_at
  ) values (
    new.store_id,
    new.source_device_id,
    new.operation_id,
    new.id,
    new.entity_type,
    new.entity_id,
    new.event_type,
    coalesce((new.payload ->> 'product_version')::bigint, new.version, 1),
    new.payload,
    new.created_at
  )
  on conflict (store_id, source_outbox_id) do nothing;

  return new;
end;
$$;

create trigger sync_outbox_publish_change
  after insert on public.sync_outbox
  for each row execute function private.append_change_log_from_outbox();

create or replace function private.append_catalog_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_payload jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  if tg_table_name = 'products' then
    select pg_catalog.jsonb_build_object(
      'id', v_row.id,
      'store_id', v_row.store_id,
      'sku', v_row.sku,
      'name', v_row.name,
      'category_id', v_row.category_id,
      'category_name', c.name,
      'base_unit', v_row.base_unit,
      'pricing_quantity', v_row.pricing_quantity,
      'price_cents', v_row.price_cents,
      'cost_cents', v_row.cost_cents,
      'stock_quantity', v_row.stock_quantity,
      'minimum_stock_quantity', v_row.minimum_stock_quantity,
      'is_active', case when tg_op = 'DELETE' then false else v_row.is_active end,
      'created_at', v_row.created_at,
      'updated_at', v_row.updated_at,
      'version', v_row.version
    )
      into v_payload
    from public.categories c
    where c.id = v_row.category_id;

    insert into public.change_log (
      store_id, entity_type, entity_id, operation, entity_version, payload, changed_at
    ) values (
      v_row.store_id,
      'product',
      v_row.id,
      case when tg_op = 'DELETE' then 'delete' else 'upsert' end,
      v_row.version,
      v_payload,
      coalesce(v_row.updated_at, now())
    );
  elsif tg_table_name = 'product_presentations' then
    v_payload := pg_catalog.jsonb_build_object(
      'id', v_row.id,
      'store_id', v_row.store_id,
      'product_id', v_row.product_id,
      'sku', v_row.sku,
      'name', v_row.name,
      'kind', v_row.kind,
      'conversion_factor', v_row.conversion_factor,
      'price_mode', v_row.price_mode,
      'fixed_price_cents', v_row.fixed_price_cents,
      'is_active', case when tg_op = 'DELETE' then false else v_row.is_active end,
      'created_at', v_row.created_at,
      'updated_at', v_row.updated_at,
      'version', v_row.version
    );

    insert into public.change_log (
      store_id, entity_type, entity_id, operation, entity_version, payload, changed_at
    ) values (
      v_row.store_id,
      'product_presentation',
      v_row.id,
      case when tg_op = 'DELETE' then 'delete' else 'upsert' end,
      v_row.version,
      v_payload,
      coalesce(v_row.updated_at, now())
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger products_publish_change
  after insert or update or delete on public.products
  for each row execute function private.append_catalog_change();

create trigger product_presentations_publish_change
  after insert or update or delete on public.product_presentations
  for each row execute function private.append_catalog_change();

-- Cuando cambia el nombre de una categoria, publica snapshots de los productos
-- afectados porque SQLite conserva el nombre como snapshot.
create or replace function private.append_category_products_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.name is not distinct from new.name
    and old.is_active is not distinct from new.is_active
  then
    return new;
  end if;

  insert into public.change_log (
    store_id, entity_type, entity_id, operation, entity_version, payload, changed_at
  )
  select
    p.store_id,
    'product',
    p.id,
    'upsert',
    p.version,
    pg_catalog.jsonb_build_object(
      'id', p.id,
      'store_id', p.store_id,
      'sku', p.sku,
      'name', p.name,
      'category_id', p.category_id,
      'category_name', new.name,
      'base_unit', p.base_unit,
      'pricing_quantity', p.pricing_quantity,
      'price_cents', p.price_cents,
      'cost_cents', p.cost_cents,
      'stock_quantity', p.stock_quantity,
      'minimum_stock_quantity', p.minimum_stock_quantity,
      'is_active', p.is_active and new.is_active,
      'created_at', p.created_at,
      'updated_at', greatest(p.updated_at, new.updated_at),
      'version', p.version
    ),
    new.updated_at
  from public.products p
  where p.category_id = new.id;

  return new;
end;
$$;

create trigger categories_publish_product_changes
  after update of name, is_active on public.categories
  for each row execute function private.append_category_products_change();

-- Conserva los eventos ya producidos por B2/B3 antes de instalar B4.
insert into public.change_log (
  store_id,
  source_device_id,
  operation_id,
  source_outbox_id,
  entity_type,
  entity_id,
  operation,
  entity_version,
  payload,
  changed_at
)
select
  so.store_id,
  so.source_device_id,
  so.operation_id,
  so.id,
  so.entity_type,
  so.entity_id,
  so.event_type,
  coalesce((so.payload ->> 'product_version')::bigint, so.version, 1),
  so.payload,
  so.created_at
from public.sync_outbox so
on conflict (store_id, source_outbox_id) do nothing;

-- Snapshot inicial para dispositivos cuyo cursor comienza en cero.
insert into public.change_log (
  store_id, entity_type, entity_id, operation, entity_version, payload, changed_at
)
select
  p.store_id,
  'product',
  p.id,
  'upsert',
  p.version,
  pg_catalog.jsonb_build_object(
    'id', p.id,
    'store_id', p.store_id,
    'sku', p.sku,
    'name', p.name,
    'category_id', p.category_id,
    'category_name', c.name,
    'base_unit', p.base_unit,
    'pricing_quantity', p.pricing_quantity,
    'price_cents', p.price_cents,
    'cost_cents', p.cost_cents,
    'stock_quantity', p.stock_quantity,
    'minimum_stock_quantity', p.minimum_stock_quantity,
    'is_active', p.is_active and c.is_active,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'version', p.version
  ),
  p.updated_at
from public.products p
join public.categories c on c.id = p.category_id
order by p.store_id, p.id;

insert into public.change_log (
  store_id, entity_type, entity_id, operation, entity_version, payload, changed_at
)
select
  pp.store_id,
  'product_presentation',
  pp.id,
  'upsert',
  pp.version,
  pg_catalog.jsonb_build_object(
    'id', pp.id,
    'store_id', pp.store_id,
    'product_id', pp.product_id,
    'sku', pp.sku,
    'name', pp.name,
    'kind', pp.kind,
    'conversion_factor', pp.conversion_factor,
    'price_mode', pp.price_mode,
    'fixed_price_cents', pp.fixed_price_cents,
    'is_active', pp.is_active,
    'created_at', pp.created_at,
    'updated_at', pp.updated_at,
    'version', pp.version
  ),
  pp.updated_at
from public.product_presentations pp
order by pp.store_id, pp.id;

-- =============================================================================
-- 3. Helpers del procesador de push
-- =============================================================================

create or replace function private.synced_server_entity_id(
  p_store_id uuid,
  p_entity_type text,
  p_client_entity_id uuid
)
returns uuid
language sql
security definer
set search_path = ''
stable
as $$
  select nullif(so.result ->> 'server_entity_id', '')::uuid
  from public.sync_operations so
  where so.store_id = p_store_id
    and so.entity_type = p_entity_type
    and so.entity_id = p_client_entity_id
    and so.status = 'applied'
  order by so.processed_at desc
  limit 1;
$$;

create or replace function private.sync_error_code(p_sqlstate text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_sqlstate = '42501' then 'forbidden'
    when p_sqlstate = '23505' then 'conflict'
    when p_sqlstate = '23514' then 'constraint_violation'
    when p_sqlstate = 'P0002' then 'not_found'
    when p_sqlstate in ('22004', '22023', '22P02') then 'invalid_payload'
    else 'domain_error'
  end;
$$;

-- =============================================================================
-- 4. RPC push: aplica un lote y responde por operacion
-- =============================================================================

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
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_operation jsonb;
  v_payload jsonb;
  v_operation_id uuid;
  v_entity_id uuid;
  v_operation_type text;
  v_entity_type text;
  v_payload_hash text;
  v_existing public.sync_operations%rowtype;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_response_status text;
  v_sqlstate text;
  v_message text;
  v_server_entity_id uuid;
  v_cash_session_id uuid;
  v_sale_id uuid;
  v_items jsonb;
  v_payments jsonb;
  v_payment jsonb;
  v_has_rejection boolean := false;
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'Se requiere una sesion autenticada';
  end if;
  if p_schema_version <> 1 then
    raise exception using errcode = '22023', message = 'schema_version no soportado';
  end if;
  if p_operations is null or pg_catalog.jsonb_typeof(p_operations) <> 'array' then
    raise exception using errcode = '22023', message = 'operations debe ser un arreglo';
  end if;
  if pg_catalog.jsonb_array_length(p_operations) > 100 then
    raise exception using errcode = '22023', message = 'El lote supera 100 operaciones';
  end if;
  if not private.is_store_member(p_store_id) then
    raise exception using errcode = '42501', message = 'El usuario no pertenece a la tienda';
  end if;
  if not private.is_authorized_store_device(p_store_id, p_device_id) then
    raise exception using errcode = '42501', message = 'El dispositivo no esta autorizado';
  end if;

  insert into public.device_sync_state(store_id, device_id)
  values (p_store_id, p_device_id)
  on conflict (store_id, device_id) do nothing;

  for v_operation in
    select value
    from pg_catalog.jsonb_array_elements(p_operations)
  loop
    v_result := null;
    v_response_status := 'rejected';
    v_sqlstate := null;
    v_message := null;

    begin
      if pg_catalog.jsonb_typeof(v_operation) <> 'object' then
        raise exception using errcode = '22023', message = 'Cada operacion debe ser un objeto';
      end if;

      begin
        v_operation_id := (v_operation ->> 'operation_id')::uuid;
        v_entity_id := (v_operation ->> 'entity_id')::uuid;
      exception when others then
        raise exception using
          errcode = '22023',
          message = 'operation_id y entity_id deben ser UUID';
      end;

      v_operation_type := pg_catalog.btrim(v_operation ->> 'operation_type');
      v_entity_type := pg_catalog.btrim(v_operation ->> 'entity_type');
      v_payload := v_operation -> 'payload';

      if v_operation_id is null
        or v_entity_id is null
        or v_operation_type is null
        or v_operation_type = ''
        or v_entity_type is null
        or v_entity_type = ''
        or v_payload is null
        or pg_catalog.jsonb_typeof(v_payload) <> 'object'
      then
        raise exception using errcode = '22023', message = 'Operacion incompleta';
      end if;

      if nullif(v_payload ->> 'storeId', '') is not null
        and (v_payload ->> 'storeId')::uuid <> p_store_id
      then
        raise exception using errcode = '22023', message = 'La tienda del payload no coincide';
      end if;
      if nullif(v_payload ->> 'deviceId', '') is not null
        and (v_payload ->> 'deviceId')::uuid <> p_device_id
      then
        raise exception using errcode = '22023', message = 'El dispositivo del payload no coincide';
      end if;

      v_payload_hash := pg_catalog.md5(
        p_schema_version::text || ':' ||
        v_operation_type || ':' ||
        v_entity_type || ':' ||
        v_entity_id::text || ':' ||
        v_payload::text
      );

      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          p_store_id::text || ':' || v_operation_id::text,
          0
        )
      );

      select so.*
        into v_existing
      from public.sync_operations so
      where so.store_id = p_store_id
        and so.operation_id = v_operation_id;

      if found then
        if v_existing.payload_hash <> v_payload_hash
          or v_existing.operation_type <> v_operation_type
          or v_existing.entity_type <> v_entity_type
          or v_existing.entity_id <> v_entity_id
        then
          v_results := v_results || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'operationId', v_operation_id,
              'status', 'rejected',
              'result', null,
              'errorCode', 'operation_id_reused',
              'errorMessage', 'operation_id ya fue usado con otro payload'
            )
          );
          v_has_rejection := true;
        else
          v_results := v_results || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'operationId', v_operation_id,
              'status', case
                when v_existing.status = 'rejected' then 'rejected'
                else 'duplicate'
              end,
              'result', v_existing.result,
              'errorCode', v_existing.error_code,
              'errorMessage', v_existing.error_message
            )
          );
          v_has_rejection := v_has_rejection or v_existing.status = 'rejected';
        end if;
        continue;
      end if;

      insert into public.sync_operations (
        store_id,
        device_id,
        operation_id,
        schema_version,
        operation_type,
        entity_type,
        entity_id,
        payload_hash,
        actor_user_id
      ) values (
        p_store_id,
        p_device_id,
        v_operation_id,
        p_schema_version,
        v_operation_type,
        v_entity_type,
        v_entity_id,
        v_payload_hash,
        v_actor_user_id
      );

      begin
        case
          when v_operation_type = 'cash_session.opened' then
            select pg_catalog.to_jsonb(r), r.cash_session_id
              into v_result, v_server_entity_id
            from public.open_cash_session(
              p_store_id,
              p_device_id,
              (v_payload ->> 'openingCashCents')::bigint,
              v_operation_id
            ) r;

          when v_operation_type = 'cash_session.closed' then
            v_cash_session_id := private.synced_server_entity_id(
              p_store_id, 'cash_session', v_entity_id
            );
            if v_cash_session_id is null then
              raise exception using
                errcode = 'P0002',
                message = 'La apertura de caja local aun no fue sincronizada';
            end if;

            select pg_catalog.to_jsonb(r), r.cash_session_id
              into v_result, v_server_entity_id
            from public.close_cash_session(
              v_cash_session_id,
              p_device_id,
              (v_payload ->> 'countedCashCents')::bigint,
              v_operation_id
            ) r;

          when v_operation_type in ('cash_movement.income', 'cash_movement.outflow') then
            begin
              v_cash_session_id := private.synced_server_entity_id(
                p_store_id,
                'cash_session',
                (v_payload ->> 'cashSessionId')::uuid
              );
            exception when others then
              raise exception using errcode = '22023', message = 'cashSessionId debe ser UUID';
            end;
            if v_cash_session_id is null then
              raise exception using
                errcode = 'P0002',
                message = 'La apertura de caja local aun no fue sincronizada';
            end if;

            insert into public.cash_movements (
              store_id,
              cash_session_id,
              movement_type,
              amount_cents,
              reason,
              actor_user_id,
              device_id,
              operation_id
            ) values (
              p_store_id,
              v_cash_session_id,
              case
                when v_operation_type = 'cash_movement.income' then 'income'
                else 'outflow'
              end,
              (v_payload ->> 'amountCents')::bigint,
              v_payload ->> 'reason',
              v_actor_user_id,
              p_device_id,
              v_operation_id
            )
            returning id into v_server_entity_id;

            v_result := pg_catalog.jsonb_build_object(
              'cash_movement_id', v_server_entity_id,
              'cash_session_id', v_cash_session_id,
              'applied', true
            );

          when v_operation_type = 'sale.confirmed' then
            select coalesce(
              pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'id', item.value ->> 'id',
                  'product_id', item.value ->> 'productId',
                  'presentation_id', item.value ->> 'presentationId',
                  'quantity', item.value ->> 'quantity',
                  'presentation_count', item.value ->> 'presentationCount'
                )
                order by item.ordinality
              ),
              '[]'::jsonb
            )
              into v_items
            from pg_catalog.jsonb_array_elements(v_payload -> 'items')
              with ordinality as item(value, ordinality);

            v_payment := v_payload -> 'payment';
            v_payments := pg_catalog.jsonb_build_array(
              pg_catalog.jsonb_build_object(
                'id', v_payment ->> 'id',
                'method', v_payment ->> 'method',
                'amount_cents', v_payment ->> 'amountCents',
                'amount_received_cents', v_payment ->> 'amountReceivedCents',
                'reference', v_payment ->> 'reference'
              )
            );

            select pg_catalog.to_jsonb(r), r.sale_id
              into v_result, v_server_entity_id
            from public.create_sale(
              p_store_id,
              p_device_id,
              v_payload ->> 'receiptNumber',
              v_items,
              v_payments,
              v_operation_id,
              0
            ) r;

          when v_operation_type = 'sale.voided' then
            v_sale_id := private.synced_server_entity_id(
              p_store_id, 'sale', v_entity_id
            );
            if v_sale_id is null then
              raise exception using
                errcode = 'P0002',
                message = 'La venta local aun no fue sincronizada';
            end if;

            select pg_catalog.to_jsonb(r), r.sale_id
              into v_result, v_server_entity_id
            from public.void_sale(
              v_sale_id,
              p_device_id,
              v_payload ->> 'reason',
              v_operation_id
            ) r;

          when v_operation_type = 'product.price_updated' then
            select pg_catalog.to_jsonb(r), r.history_id
              into v_result, v_server_entity_id
            from public.change_product_price(
              (v_payload ->> 'productId')::uuid,
              (v_payload ->> 'newPriceCents')::bigint,
              v_payload ->> 'reason',
              v_operation_id,
              p_device_id
            ) r;

          when v_operation_type = 'inventory_movement.created' then
            -- create_sale/void_sale ya producen los movimientos sale/return.
            -- Una outbox local antigua puede contener tambien ese efecto
            -- derivado; se reconoce y se consume sin volver a tocar stock.
            if (v_payload ->> 'type') in ('sale', 'return')
              and nullif(v_payload ->> 'referenceId', '') is not null
              and exists (
                select 1
                from public.sync_operations parent
                where parent.store_id = p_store_id
                  and parent.entity_type = 'sale'
                  and parent.entity_id = (v_payload ->> 'referenceId')::uuid
                  and parent.status = 'applied'
              )
            then
              v_server_entity_id := v_entity_id;
              v_result := pg_catalog.jsonb_build_object(
                'ignored_as_domain_side_effect', true,
                'applied', false
              );
            else
              select pg_catalog.to_jsonb(r), r.movement_id
                into v_result, v_server_entity_id
              from public.adjust_inventory(
                (v_payload ->> 'productId')::uuid,
                (v_payload ->> 'quantityDelta')::bigint,
                v_payload ->> 'type',
                coalesce(nullif(v_payload ->> 'reason', ''), 'Sincronizacion offline'),
                v_operation_id,
                case
                  when nullif(v_payload ->> 'referenceId', '') is null then null
                  else 'local_reference'
                end,
                nullif(v_payload ->> 'referenceId', '')::uuid,
                p_device_id
              ) r;
            end if;

          when v_operation_type = 'product_presentation.created' then
            if not private.is_store_admin(p_store_id) then
              raise exception using
                errcode = '42501',
                message = 'Solo un administrador puede crear presentaciones';
            end if;
            if not exists (
              select 1
              from public.products p
              where p.id = (v_payload ->> 'productId')::uuid
                and p.store_id = p_store_id
            ) then
              raise exception using errcode = 'P0002', message = 'El producto no existe';
            end if;

            insert into public.product_presentations (
              id,
              store_id,
              product_id,
              sku,
              name,
              kind,
              conversion_factor,
              price_mode,
              fixed_price_cents,
              is_active
            ) values (
              v_entity_id,
              p_store_id,
              (v_payload ->> 'productId')::uuid,
              v_payload ->> 'sku',
              v_payload ->> 'name',
              v_payload ->> 'type',
              (v_payload ->> 'quantityInBaseUnits')::bigint,
              case
                when nullif(v_payload ->> 'fixedPriceCents', '') is null
                  then 'calculated'
                else 'fixed'
              end,
              nullif(v_payload ->> 'fixedPriceCents', '')::bigint,
              true
            )
            returning id into v_server_entity_id;

            v_result := pg_catalog.jsonb_build_object(
              'presentation_id', v_server_entity_id,
              'applied', true
            );

          else
            raise exception using
              errcode = '22023',
              message = 'Tipo de operacion no soportado';
        end case;

        v_result := coalesce(v_result, '{}'::jsonb) ||
          pg_catalog.jsonb_build_object('server_entity_id', v_server_entity_id);

        update public.sync_operations so
        set status = 'applied',
            result = v_result,
            processed_at = now()
        where so.store_id = p_store_id
          and so.operation_id = v_operation_id;

        v_response_status := 'applied';
      exception when others then
        get stacked diagnostics
          v_sqlstate = returned_sqlstate,
          v_message = message_text;

        update public.sync_operations so
        set status = 'rejected',
            error_code = private.sync_error_code(v_sqlstate),
            error_message = left(v_message, 500),
            processed_at = now()
        where so.store_id = p_store_id
          and so.operation_id = v_operation_id;

        v_response_status := 'rejected';
        v_has_rejection := true;
      end;

      v_results := v_results || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'operationId', v_operation_id,
          'status', v_response_status,
          'result', v_result,
          'errorCode', case
            when v_response_status = 'rejected' then private.sync_error_code(v_sqlstate)
            else null
          end,
          'errorMessage', case
            when v_response_status = 'rejected' then left(v_message, 500)
            else null
          end
        )
      );
    exception when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text;
      v_has_rejection := true;
      v_results := v_results || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'operationId', v_operation ->> 'operation_id',
          'status', 'rejected',
          'result', null,
          'errorCode', private.sync_error_code(v_sqlstate),
          'errorMessage', left(v_message, 500)
        )
      );
    end;
  end loop;

  update public.device_sync_state dss
  set last_push_at = now(),
      last_success_at = case when v_has_rejection then dss.last_success_at else now() end,
      last_error = case
        when v_has_rejection then 'Una o mas operaciones fueron rechazadas'
        else null
      end
  where dss.store_id = p_store_id
    and dss.device_id = p_device_id;

  update public.devices d
  set last_sync_at = now()
  where d.id = p_device_id
    and d.store_id = p_store_id;

  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'results', v_results,
    'serverTime', now()
  );
end;
$$;

-- =============================================================================
-- 5. RPC pull: pagina incremental por cursor
-- =============================================================================

create or replace function public.pull_changes(
  p_store_id uuid,
  p_device_id uuid,
  p_cursor bigint default 0,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_changes jsonb;
  v_next_cursor bigint;
  v_has_more boolean;
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'Se requiere una sesion autenticada';
  end if;
  if p_cursor is null or p_cursor < 0 then
    raise exception using errcode = '22023', message = 'El cursor debe ser no negativo';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'El limite debe estar entre 1 y 500';
  end if;
  if not private.is_store_member(p_store_id) then
    raise exception using errcode = '42501', message = 'El usuario no pertenece a la tienda';
  end if;
  if not private.is_authorized_store_device(p_store_id, p_device_id) then
    raise exception using errcode = '42501', message = 'El dispositivo no esta autorizado';
  end if;

  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'sequence', page.sequence,
          'entityType', page.entity_type,
          'entityId', page.entity_id,
          'operation', page.operation,
          'version', page.entity_version,
          'payload', page.payload,
          'changedAt', page.changed_at,
          'sourceDeviceId', page.source_device_id,
          'operationId', page.operation_id
        )
        order by page.sequence
      ),
      '[]'::jsonb
    ),
    coalesce(max(page.sequence), p_cursor)
    into v_changes, v_next_cursor
  from (
    select cl.*
    from public.change_log cl
    where cl.store_id = p_store_id
      and cl.sequence > p_cursor
    order by cl.sequence
    limit p_limit
  ) page;

  select exists (
    select 1
    from public.change_log cl
    where cl.store_id = p_store_id
      and cl.sequence > v_next_cursor
  )
    into v_has_more;

  insert into public.device_sync_state (
    store_id,
    device_id,
    last_pull_sequence,
    last_pull_at,
    last_success_at,
    last_error
  ) values (
    p_store_id,
    p_device_id,
    v_next_cursor,
    now(),
    now(),
    null
  )
  on conflict (store_id, device_id) do update
  set last_pull_sequence = greatest(
        public.device_sync_state.last_pull_sequence,
        excluded.last_pull_sequence
      ),
      last_pull_at = excluded.last_pull_at,
      last_success_at = excluded.last_success_at,
      last_error = null;

  update public.devices d
  set last_sync_at = now()
  where d.id = p_device_id
    and d.store_id = p_store_id;

  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'changes', v_changes,
    'nextCursor', v_next_cursor,
    'hasMore', v_has_more,
    'serverTime', now()
  );
end;
$$;

-- =============================================================================
-- 6. RLS y permisos
-- =============================================================================

alter table public.sync_operations enable row level security;
alter table public.change_log enable row level security;
alter table public.device_sync_state enable row level security;

revoke all on public.sync_operations from public, anon, authenticated;
revoke all on public.change_log from public, anon, authenticated;
revoke all on public.device_sync_state from public, anon, authenticated;

grant select on public.sync_operations to authenticated;
grant select on public.change_log to authenticated;
grant select on public.device_sync_state to authenticated;

grant all on public.sync_operations, public.change_log, public.device_sync_state
  to service_role;
grant usage, select on sequence public.change_log_sequence_seq to service_role;

create policy sync_operations_select_store_member
  on public.sync_operations for select
  to authenticated
  using (private.is_store_member(store_id));

create policy change_log_select_store_member
  on public.change_log for select
  to authenticated
  using (private.is_store_member(store_id));

create policy device_sync_state_select_same_device
  on public.device_sync_state for select
  to authenticated
  using (
    private.is_store_member(store_id)
    and private.is_authorized_store_device(store_id, device_id)
  );

revoke all on function public.process_sync_batch(uuid, uuid, integer, jsonb)
  from public, anon;
grant execute on function public.process_sync_batch(uuid, uuid, integer, jsonb)
  to authenticated, service_role;

revoke all on function public.pull_changes(uuid, uuid, bigint, integer)
  from public, anon;
grant execute on function public.pull_changes(uuid, uuid, bigint, integer)
  to authenticated, service_role;

comment on table public.sync_operations is
  'Deduplicacion y auditoria de cada operacion push por tienda.';
comment on table public.change_log is
  'Registro monotono de cambios entregado por pull incremental.';
comment on table public.device_sync_state is
  'Cursor y salud de sincronizacion central por dispositivo.';
comment on function public.process_sync_batch(uuid, uuid, integer, jsonb) is
  'Aplica hasta 100 operaciones offline y devuelve applied, duplicate o rejected.';
comment on function public.pull_changes(uuid, uuid, bigint, integer) is
  'Entrega cambios de una tienda posteriores al cursor indicado.';
