-- Pruebas pgTAP de B4 - Push idempotente, pull incremental y RLS.
-- Requiere las migraciones B1-B4 y DO-04 aplicadas en orden.

begin;

select plan(54);

-- =============================================================================
-- 1. Estructura, RLS y privilegios
-- =============================================================================

select results_eq(
  $$
    select c.relname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('sync_operations', 'change_log', 'device_sync_state')
      and c.relkind = 'r'
    order by c.relname
  $$,
  $$ values ('change_log'), ('device_sync_state'), ('sync_operations') $$,
  'B4 crea las tres tablas de sincronizacion'
);

select results_eq(
  $$
    select c.relname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('sync_operations', 'change_log', 'device_sync_state')
      and c.relrowsecurity
    order by c.relname
  $$,
  $$ values ('change_log'), ('device_sync_state'), ('sync_operations') $$,
  'RLS esta habilitado en todas las tablas B4'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.process_sync_batch(uuid,uuid,integer,jsonb)',
    'EXECUTE'
  ),
  'authenticated puede ejecutar push'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.process_sync_batch(uuid,uuid,integer,jsonb)',
    'EXECUTE'
  ),
  'anon no puede ejecutar push'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.pull_changes(uuid,uuid,bigint,integer)',
    'EXECUTE'
  ),
  'authenticated puede ejecutar pull'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.pull_changes(uuid,uuid,bigint,integer)',
    'EXECUTE'
  ),
  'anon no puede ejecutar pull'
);

-- =============================================================================
-- 2. Fixtures de dos tiendas
-- =============================================================================

create or replace function _b4_create_auth_user(
  p_id uuid,
  p_email text,
  p_full_name text
) returns void
language plpgsql
security definer
set search_path = auth, public
as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    p_id,
    'authenticated',
    'authenticated',
    p_email,
    'test-password-hash',
    now(),
    jsonb_build_object(),
    jsonb_build_object('full_name', p_full_name),
    now(),
    now()
  );

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    p_id,
    jsonb_build_object('sub', p_id::text, 'email', p_email),
    'email',
    p_email,
    now(),
    now(),
    now()
  );
end;
$$;

select _b4_create_auth_user(
  '80000000-0000-4000-8000-000000000001',
  'admin-a-b4@coguana.test',
  'Admin A B4'
);
select _b4_create_auth_user(
  '80000000-0000-4000-8000-000000000002',
  'seller-a-b4@coguana.test',
  'Seller A B4'
);
select _b4_create_auth_user(
  '80000000-0000-4000-8000-000000000003',
  'admin-b-b4@coguana.test',
  'Admin B B4'
);

insert into public.organizations(id, name)
values
  ('81000000-0000-4000-8000-000000000001', 'Organizacion A B4'),
  ('81000000-0000-4000-8000-000000000002', 'Organizacion B B4');

insert into public.stores(id, organization_id, code, name)
values
  (
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'B4-A',
    'Tienda A B4'
  ),
  (
    '82000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000002',
    'B4-B',
    'Tienda B B4'
  );

insert into public.store_memberships(store_id, user_id, role, is_active)
values
  (
    '82000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    'admin',
    true
  ),
  (
    '82000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000002',
    'seller',
    true
  ),
  (
    '82000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000003',
    'admin',
    true
  );

insert into public.devices(id, store_id, name, platform, status, registered_by)
values
  (
    '83000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    'TPV A1 B4',
    'android',
    'authorized',
    '80000000-0000-4000-8000-000000000001'
  ),
  (
    '83000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000001',
    'TPV A2 B4',
    'android',
    'authorized',
    '80000000-0000-4000-8000-000000000001'
  ),
  (
    '83000000-0000-4000-8000-000000000003',
    '82000000-0000-4000-8000-000000000002',
    'TPV B1 B4',
    'android',
    'authorized',
    '80000000-0000-4000-8000-000000000003'
  );

insert into public.categories(id, organization_id, name, slug)
values
  (
    '84000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'Categoria A B4',
    'categoria-a-b4'
  ),
  (
    '84000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000002',
    'Categoria B B4',
    'categoria-b-b4'
  );

insert into public.products (
  id, store_id, sku, name, category_id, base_unit, pricing_quantity,
  price_cents, cost_cents, stock_quantity, minimum_stock_quantity
) values
  (
    '85000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    'PROD-A-B4',
    'Producto A B4',
    '84000000-0000-4000-8000-000000000001',
    'gram',
    1000,
    1000,
    700,
    1000,
    100
  ),
  (
    '85000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000002',
    'PROD-B-B4',
    'Producto B B4',
    '84000000-0000-4000-8000-000000000002',
    'gram',
    1000,
    2000,
    1400,
    1000,
    100
  );

select ok(
  exists (
    select 1
    from public.change_log
    where store_id = '82000000-0000-4000-8000-000000000001'
      and entity_type = 'product'
      and entity_id = '85000000-0000-4000-8000-000000000001'
      and operation = 'upsert'
  ),
  'Insertar un producto publica un snapshot pull'
);

select is(
  (
    select payload ->> 'category_name'
    from public.change_log
    where entity_id = '85000000-0000-4000-8000-000000000001'
    order by sequence desc
    limit 1
  ),
  'Categoria A B4',
  'El snapshot de producto incluye el nombre de categoria'
);

-- =============================================================================
-- 3. Push de apertura y venta como seller
-- =============================================================================

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '80000000-0000-4000-8000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

create temporary table _b4_first_batch(response jsonb);
insert into _b4_first_batch
select public.process_sync_batch(
  '82000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  1,
  jsonb_build_array(
    jsonb_build_object(
      'operation_id', '86000000-0000-4000-8000-000000000001',
      'entity_type', 'cash_session',
      'entity_id', '87000000-0000-4000-8000-000000000001',
      'operation_type', 'cash_session.opened',
      'payload', jsonb_build_object(
        'id', '87000000-0000-4000-8000-000000000001',
        'storeId', '82000000-0000-4000-8000-000000000001',
        'deviceId', '83000000-0000-4000-8000-000000000001',
        'openingCashCents', 1000
      )
    ),
    jsonb_build_object(
      'operation_id', '86000000-0000-4000-8000-000000000002',
      'entity_type', 'sale',
      'entity_id', '87000000-0000-4000-8000-000000000002',
      'operation_type', 'sale.confirmed',
      'payload', jsonb_build_object(
        'id', '87000000-0000-4000-8000-000000000002',
        'storeId', '82000000-0000-4000-8000-000000000001',
        'deviceId', '83000000-0000-4000-8000-000000000001',
        'cashSessionId', '87000000-0000-4000-8000-000000000001',
        'receiptNumber', 'B4-A1-000001',
        'items', jsonb_build_array(
          jsonb_build_object(
            'id', '87000000-0000-4000-8000-000000000003',
            'productId', '85000000-0000-4000-8000-000000000001',
            'quantity', 100,
            'presentationId', null,
            'presentationCount', null
          )
        ),
        'payments', jsonb_build_array(
          jsonb_build_object(
            'id', '87000000-0000-4000-8000-000000000004',
            'method', 'cash',
            'amountCents', 40,
            'amountReceivedCents', 40,
            'reference', null
          ),
          jsonb_build_object(
            'id', '87000000-0000-4000-8000-000000000005',
            'method', 'yape',
            'amountCents', 60,
            'amountReceivedCents', null,
            'reference', 'YAPE-DO04'
          )
        )
      )
    )
  )
);

select is(
  (select response -> 'results' -> 0 ->> 'status' from _b4_first_batch),
  'applied',
  'Push aplica apertura de caja'
);

select is(
  (select response -> 'results' -> 1 ->> 'status' from _b4_first_batch),
  'applied',
  'Push aplica venta'
);

select is(
  (
    select count(*)::bigint
    from public.cash_sessions
    where store_id = '82000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'La apertura crea una unica caja central'
);

select is(
  (
    select count(*)::bigint
    from public.sales
    where store_id = '82000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'La venta push crea una unica venta central'
);

select is(
  (
    select stock_quantity
    from public.products
    where id = '85000000-0000-4000-8000-000000000001'
  ),
  900::bigint,
  'La venta push descuenta stock una vez'
);

select is(
  (
    select count(*)::bigint
    from public.sale_payments sp
    join public.sales s on s.id = sp.sale_id
    where s.store_id = '82000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'La venta push conserva los dos pagos combinados'
);

select is(
  (
    select amount_cents
    from public.sale_payments
    where id = '87000000-0000-4000-8000-000000000004'
  ),
  40::bigint,
  'El tramo en efectivo conserva su monto'
);

select is(
  (
    select provider_reference
    from public.sale_payments
    where id = '87000000-0000-4000-8000-000000000005'
  ),
  'YAPE-DO04',
  'El tramo Yape conserva su referencia'
);

select is(
  (
    select count(*)::bigint
    from public.sync_operations
    where store_id = '82000000-0000-4000-8000-000000000001'
      and status = 'applied'
  ),
  2::bigint,
  'Cada operacion push aplicada queda auditada'
);

create temporary table _b4_duplicate_batch(response jsonb);
insert into _b4_duplicate_batch
select public.process_sync_batch(
  '82000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  1,
  (
    select jsonb_agg(
      jsonb_build_object(
        'operation_id', operation_id,
        'entity_type', entity_type,
        'entity_id', entity_id,
        'operation_type', operation_type,
        'payload', case operation_type
          when 'cash_session.opened' then jsonb_build_object(
            'id', '87000000-0000-4000-8000-000000000001',
            'storeId', '82000000-0000-4000-8000-000000000001',
            'deviceId', '83000000-0000-4000-8000-000000000001',
            'openingCashCents', 1000
          )
          else jsonb_build_object(
            'id', '87000000-0000-4000-8000-000000000002',
            'storeId', '82000000-0000-4000-8000-000000000001',
            'deviceId', '83000000-0000-4000-8000-000000000001',
            'cashSessionId', '87000000-0000-4000-8000-000000000001',
            'receiptNumber', 'B4-A1-000001',
            'items', jsonb_build_array(
              jsonb_build_object(
                'id', '87000000-0000-4000-8000-000000000003',
                'productId', '85000000-0000-4000-8000-000000000001',
                'quantity', 100,
                'presentationId', null,
                'presentationCount', null
              )
            ),
            'payments', jsonb_build_array(
              jsonb_build_object(
                'id', '87000000-0000-4000-8000-000000000004',
                'method', 'cash',
                'amountCents', 40,
                'amountReceivedCents', 40,
                'reference', null
              ),
              jsonb_build_object(
                'id', '87000000-0000-4000-8000-000000000005',
                'method', 'yape',
                'amountCents', 60,
                'amountReceivedCents', null,
                'reference', 'YAPE-DO04'
              )
            )
          )
        end
      )
      order by operation_id
    )
    from public.sync_operations
    where operation_id in (
      '86000000-0000-4000-8000-000000000001',
      '86000000-0000-4000-8000-000000000002'
    )
  )
);

select is(
  (select response -> 'results' -> 0 ->> 'status' from _b4_duplicate_batch),
  'duplicate',
  'Repetir apertura devuelve duplicate'
);

select is(
  (select response -> 'results' -> 1 ->> 'status' from _b4_duplicate_batch),
  'duplicate',
  'Repetir venta devuelve duplicate'
);

select is(
  (
    select stock_quantity
    from public.products
    where id = '85000000-0000-4000-8000-000000000001'
  ),
  900::bigint,
  'Repetir venta no vuelve a descontar stock'
);

select is(
  (
    select count(*)::bigint
    from public.sync_operations
    where operation_id in (
      '86000000-0000-4000-8000-000000000001',
      '86000000-0000-4000-8000-000000000002'
    )
  ),
  2::bigint,
  'Reintentar no duplica sync_operations'
);

create temporary table _b4_reused(response jsonb);
insert into _b4_reused
select public.process_sync_batch(
  '82000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  1,
  jsonb_build_array(
    jsonb_build_object(
      'operation_id', '86000000-0000-4000-8000-000000000001',
      'entity_type', 'cash_session',
      'entity_id', '87000000-0000-4000-8000-000000000001',
      'operation_type', 'cash_session.opened',
      'payload', jsonb_build_object(
        'storeId', '82000000-0000-4000-8000-000000000001',
        'deviceId', '83000000-0000-4000-8000-000000000001',
        'openingCashCents', 9999
      )
    )
  )
);

select is(
  (select response -> 'results' -> 0 ->> 'status' from _b4_reused),
  'rejected',
  'Reutilizar operation_id con otro payload se rechaza'
);

select is(
  (select response -> 'results' -> 0 ->> 'errorCode' from _b4_reused),
  'operation_id_reused',
  'El rechazo identifica operation_id reutilizado'
);

-- =============================================================================
-- 4. Efectos derivados, caja y rechazo persistente
-- =============================================================================

create temporary table _b4_side_effect(response jsonb);
insert into _b4_side_effect
select public.process_sync_batch(
  '82000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  1,
  jsonb_build_array(
    jsonb_build_object(
      'operation_id', '86000000-0000-4000-8000-000000000003',
      'entity_type', 'inventory_movement',
      'entity_id', '87000000-0000-4000-8000-000000000005',
      'operation_type', 'inventory_movement.created',
      'payload', jsonb_build_object(
        'storeId', '82000000-0000-4000-8000-000000000001',
        'deviceId', '83000000-0000-4000-8000-000000000001',
        'productId', '85000000-0000-4000-8000-000000000001',
        'type', 'sale',
        'quantityDelta', -100,
        'referenceId', '87000000-0000-4000-8000-000000000002'
      )
    )
  )
);

select is(
  (select response -> 'results' -> 0 ->> 'status' from _b4_side_effect),
  'applied',
  'El movimiento derivado de venta se consume'
);

select is(
  (
    select response -> 'results' -> 0 -> 'result'
      ->> 'ignored_as_domain_side_effect'
    from _b4_side_effect
  ),
  'true',
  'El movimiento derivado queda marcado como efecto del dominio'
);

select is(
  (
    select stock_quantity
    from public.products
    where id = '85000000-0000-4000-8000-000000000001'
  ),
  900::bigint,
  'El efecto derivado no descuenta stock por segunda vez'
);

create temporary table _b4_cash(response jsonb);
insert into _b4_cash
select public.process_sync_batch(
  '82000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  1,
  jsonb_build_array(
    jsonb_build_object(
      'operation_id', '86000000-0000-4000-8000-000000000004',
      'entity_type', 'cash_movement',
      'entity_id', '87000000-0000-4000-8000-000000000006',
      'operation_type', 'cash_movement.income',
      'payload', jsonb_build_object(
        'storeId', '82000000-0000-4000-8000-000000000001',
        'deviceId', '83000000-0000-4000-8000-000000000001',
        'cashSessionId', '87000000-0000-4000-8000-000000000001',
        'amountCents', 50,
        'reason', 'Cambio adicional'
      )
    )
  )
);

select is(
  (select response -> 'results' -> 0 ->> 'status' from _b4_cash),
  'applied',
  'Push aplica movimiento manual de caja'
);

select is(
  (
    select count(*)::bigint
    from public.cash_movements
    where operation_id = '86000000-0000-4000-8000-000000000004'
  ),
  1::bigint,
  'Movimiento de caja se registra una vez'
);

create temporary table _b4_close(response jsonb);
insert into _b4_close
select public.process_sync_batch(
  '82000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  1,
  jsonb_build_array(
    jsonb_build_object(
      'operation_id', '86000000-0000-4000-8000-000000000005',
      'entity_type', 'cash_session',
      'entity_id', '87000000-0000-4000-8000-000000000001',
      'operation_type', 'cash_session.closed',
      'payload', jsonb_build_object(
        'storeId', '82000000-0000-4000-8000-000000000001',
        'deviceId', '83000000-0000-4000-8000-000000000001',
        'countedCashCents', 1150
      )
    )
  )
);

select is(
  (select response -> 'results' -> 0 ->> 'status' from _b4_close),
  'applied',
  'Push cierra la caja sincronizada'
);

select is(
  (
    select status
    from public.cash_sessions
    where open_operation_id = '86000000-0000-4000-8000-000000000001'
  ),
  'closed',
  'La caja central queda cerrada'
);

create temporary table _b4_unsupported(response jsonb);
insert into _b4_unsupported
select public.process_sync_batch(
  '82000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  1,
  jsonb_build_array(
    jsonb_build_object(
      'operation_id', '86000000-0000-4000-8000-000000000006',
      'entity_type', 'unknown',
      'entity_id', '87000000-0000-4000-8000-000000000007',
      'operation_type', 'unknown.created',
      'payload', jsonb_build_object(
        'storeId', '82000000-0000-4000-8000-000000000001',
        'deviceId', '83000000-0000-4000-8000-000000000001'
      )
    )
  )
);

select is(
  (select response -> 'results' -> 0 ->> 'status' from _b4_unsupported),
  'rejected',
  'Tipo de operacion desconocido se rechaza'
);

select is(
  (
    select status
    from public.sync_operations
    where operation_id = '86000000-0000-4000-8000-000000000006'
  ),
  'rejected',
  'El rechazo queda persistido para auditoria'
);

select is(
  (
    public.process_sync_batch(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      1,
      jsonb_build_array(
        jsonb_build_object(
          'operation_id', '86000000-0000-4000-8000-000000000006',
          'entity_type', 'unknown',
          'entity_id', '87000000-0000-4000-8000-000000000007',
          'operation_type', 'unknown.created',
          'payload', jsonb_build_object(
            'storeId', '82000000-0000-4000-8000-000000000001',
            'deviceId', '83000000-0000-4000-8000-000000000001'
          )
        )
      )
    ) -> 'results' -> 0 ->> 'status'
  ),
  'rejected',
  'Reintentar un rechazo devuelve el rechazo previo'
);

-- =============================================================================
-- 5. Push administrativo de inventario, presentacion y precio
-- =============================================================================

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '80000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

create temporary table _b4_admin_batch(response jsonb);
insert into _b4_admin_batch
select public.process_sync_batch(
  '82000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000002',
  1,
  jsonb_build_array(
    jsonb_build_object(
      'operation_id', '86000000-0000-4000-8000-000000000007',
      'entity_type', 'inventory_movement',
      'entity_id', '87000000-0000-4000-8000-000000000008',
      'operation_type', 'inventory_movement.created',
      'payload', jsonb_build_object(
        'storeId', '82000000-0000-4000-8000-000000000001',
        'deviceId', '83000000-0000-4000-8000-000000000002',
        'productId', '85000000-0000-4000-8000-000000000001',
        'type', 'purchase',
        'quantityDelta', 50,
        'reason', 'Compra offline',
        'referenceId', null
      )
    ),
    jsonb_build_object(
      'operation_id', '86000000-0000-4000-8000-000000000008',
      'entity_type', 'product_presentation',
      'entity_id', '87000000-0000-4000-8000-000000000009',
      'operation_type', 'product_presentation.created',
      'payload', jsonb_build_object(
        'storeId', '82000000-0000-4000-8000-000000000001',
        'deviceId', '83000000-0000-4000-8000-000000000002',
        'productId', '85000000-0000-4000-8000-000000000001',
        'sku', 'PROD-A-B4-S50',
        'name', 'Saco B4',
        'type', 'sack',
        'quantityInBaseUnits', 50000,
        'fixedPriceCents', 45000
      )
    ),
    jsonb_build_object(
      'operation_id', '86000000-0000-4000-8000-000000000009',
      'entity_type', 'price_history',
      'entity_id', '87000000-0000-4000-8000-000000000010',
      'operation_type', 'product.price_updated',
      'payload', jsonb_build_object(
        'storeId', '82000000-0000-4000-8000-000000000001',
        'deviceId', '83000000-0000-4000-8000-000000000002',
        'productId', '85000000-0000-4000-8000-000000000001',
        'newPriceCents', 1100,
        'reason', 'Precio B4'
      )
    )
  )
);

select is(
  (select response -> 'results' -> 0 ->> 'status' from _b4_admin_batch),
  'applied',
  'Push administrativo aplica inventario'
);

select is(
  (
    select stock_quantity
    from public.products
    where id = '85000000-0000-4000-8000-000000000001'
  ),
  950::bigint,
  'Ajuste push actualiza stock central'
);

select is(
  (select response -> 'results' -> 1 ->> 'status' from _b4_admin_batch),
  'applied',
  'Push administrativo crea presentacion'
);

select is(
  (
    select count(*)::bigint
    from public.product_presentations
    where id = '87000000-0000-4000-8000-000000000009'
  ),
  1::bigint,
  'La presentacion local conserva su UUID en el backend'
);

select is(
  (select response -> 'results' -> 2 ->> 'status' from _b4_admin_batch),
  'applied',
  'Push administrativo cambia precio'
);

select is(
  (
    select price_cents
    from public.products
    where id = '85000000-0000-4000-8000-000000000001'
  ),
  1100::bigint,
  'Cambio de precio push actualiza catalogo central'
);

select is(
  (
    select count(*)::bigint
    from public.price_history
    where operation_id = '86000000-0000-4000-8000-000000000009'
  ),
  1::bigint,
  'Cambio de precio push deja un solo historico'
);

select ok(
  exists (
    select 1
    from public.change_log
    where store_id = '82000000-0000-4000-8000-000000000001'
      and entity_type = 'product'
      and entity_id = '85000000-0000-4000-8000-000000000001'
      and payload ->> 'price_cents' = '1100'
  ),
  'Actualizar precio publica snapshot de producto'
);

reset role;
update public.categories
set name = 'Categoria A B4 renombrada'
where id = '84000000-0000-4000-8000-000000000001';

select ok(
  exists (
    select 1
    from public.change_log
    where entity_id = '85000000-0000-4000-8000-000000000001'
      and payload ->> 'category_name' = 'Categoria A B4 renombrada'
  ),
  'Renombrar categoria publica nuevos snapshots de sus productos'
);

-- =============================================================================
-- 6. Pull incremental, estado por dispositivo y aislamiento
-- =============================================================================

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '80000000-0000-4000-8000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

create temporary table _b4_pull(response jsonb);
insert into _b4_pull
select public.pull_changes(
  '82000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000002',
  0,
  500
);

select is(
  (select (response ->> 'schemaVersion')::integer from _b4_pull),
  1,
  'Pull responde con schema_version 1'
);

select ok(
  (select jsonb_array_length(response -> 'changes') > 0 from _b4_pull),
  'Pull inicial devuelve cambios'
);

select ok(
  (select (response ->> 'nextCursor')::bigint > 0 from _b4_pull),
  'Pull inicial devuelve cursor monotono'
);

select is(
  (
    select min((item ->> 'sequence')::bigint)
      < max((item ->> 'sequence')::bigint)
    from _b4_pull,
      lateral jsonb_array_elements(response -> 'changes') item
  ),
  true,
  'Los cambios pull abarcan una secuencia ascendente'
);

select is(
  (
    select last_pull_sequence
    from public.device_sync_state
    where store_id = '82000000-0000-4000-8000-000000000001'
      and device_id = '83000000-0000-4000-8000-000000000002'
  ),
  (select (response ->> 'nextCursor')::bigint from _b4_pull),
  'Pull actualiza el cursor central del dispositivo'
);

select is(
  (
    public.pull_changes(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000002',
      (select (response ->> 'nextCursor')::bigint from _b4_pull),
      500
    ) ->> 'hasMore'
  ),
  'false',
  'Repetir pull desde el cursor final no deja paginas pendientes'
);

select is(
  (
    public.pull_changes(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000002',
      0,
      1
    ) ->> 'hasMore'
  ),
  'true',
  'Pull respeta limite y anuncia mas paginas'
);

select throws_ok(
  $$
    select public.pull_changes(
      '82000000-0000-4000-8000-000000000002',
      '83000000-0000-4000-8000-000000000003',
      0,
      100
    )
  $$,
  '42501',
  'El usuario no pertenece a la tienda',
  'Un miembro de tienda A no puede hacer pull de tienda B'
);

select throws_ok(
  $$
    select public.process_sync_batch(
      '82000000-0000-4000-8000-000000000002',
      '83000000-0000-4000-8000-000000000003',
      1,
      '[]'::jsonb
    )
  $$,
  '42501',
  'El usuario no pertenece a la tienda',
  'Un miembro de tienda A no puede hacer push a tienda B'
);

select is(
  (
    select count(*)::bigint
    from public.sync_operations
    where store_id = '82000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'RLS no expone operaciones de otra tienda'
);

select is(
  (
    select count(*)::bigint
    from public.change_log
    where store_id = '82000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'RLS no expone change_log de otra tienda'
);

select is(
  (
    select count(*)::bigint
    from public.device_sync_state
    where store_id = '82000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'RLS no expone estado sync de otra tienda'
);

reset role;
select * from finish();
rollback;
