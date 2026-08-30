-- Pruebas pgTAP de B3 - Ventas, caja, anulaciones y sync_outbox.
-- Requiere las migraciones B1-B4, DO-04, DT-01 y DT-02 aplicadas en orden.
--
-- Cubre:
--   BE-01: aislamiento por tienda.
--   BE-02: create_sale es idempotente por operation_id.
--   BE-03: venta, pagos, inventario y outbox son atomicos.
--   BE-04: ninguna venta deja stock negativo.
--   Caja por dispositivo, pagos combinados, anulacion y cierre.

begin;

select plan(65);

-- =============================================================================
-- 1. Estructura y RLS
-- =============================================================================

select results_eq(
  $$
    select c.relname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'cash_sessions',
        'sales',
        'sale_items',
        'sale_payments',
        'sale_status_history',
        'cash_movements',
        'sync_outbox'
      )
    order by c.relname
  $$,
  $$
    values
      ('cash_movements'),
      ('cash_sessions'),
      ('sale_items'),
      ('sale_payments'),
      ('sale_status_history'),
      ('sales'),
      ('sync_outbox')
  $$,
  'B3 crea las siete tablas POS y de outbox'
);

select results_eq(
  $$
    select c.relname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'cash_sessions',
        'sales',
        'sale_items',
        'sale_payments',
        'sale_status_history',
        'cash_movements',
        'sync_outbox'
      )
      and c.relrowsecurity = true
    order by c.relname
  $$,
  $$
    values
      ('cash_movements'),
      ('cash_sessions'),
      ('sale_items'),
      ('sale_payments'),
      ('sale_status_history'),
      ('sales'),
      ('sync_outbox')
  $$,
  'RLS esta habilitado en todas las tablas B3'
);

-- =============================================================================
-- 2. Fixtures
-- =============================================================================

create or replace function _b3_create_auth_user(
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

select _b3_create_auth_user(
  '50000000-0000-4000-8000-000000000001',
  'admin-a-b3@coguana.test',
  'Admin A B3'
);
select _b3_create_auth_user(
  '50000000-0000-4000-8000-000000000002',
  'seller-a-b3@coguana.test',
  'Seller A B3'
);
select _b3_create_auth_user(
  '50000000-0000-4000-8000-000000000003',
  'admin-b-b3@coguana.test',
  'Admin B B3'
);

insert into public.organizations (id, name)
values
  ('51000000-0000-4000-8000-000000000001', 'Organizacion A B3'),
  ('51000000-0000-4000-8000-000000000002', 'Organizacion B B3');

insert into public.stores (id, organization_id, code, name)
values
  (
    '52000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001',
    'B3-A',
    'Tienda A B3'
  ),
  (
    '52000000-0000-4000-8000-000000000002',
    '51000000-0000-4000-8000-000000000002',
    'B3-B',
    'Tienda B B3'
  );

insert into public.store_memberships (store_id, user_id, role, is_active)
values
  (
    '52000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'admin',
    true
  ),
  (
    '52000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002',
    'seller',
    true
  ),
  (
    '52000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000003',
    'admin',
    true
  );

insert into public.devices (id, store_id, name, platform, status, registered_by)
values
  (
    '53000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001',
    'TPV A1 B3',
    'android',
    'authorized',
    '50000000-0000-4000-8000-000000000001'
  ),
  (
    '53000000-0000-4000-8000-000000000002',
    '52000000-0000-4000-8000-000000000001',
    'TPV A2 B3',
    'android',
    'authorized',
    '50000000-0000-4000-8000-000000000001'
  ),
  (
    '53000000-0000-4000-8000-000000000003',
    '52000000-0000-4000-8000-000000000002',
    'TPV B1 B3',
    'android',
    'authorized',
    '50000000-0000-4000-8000-000000000003'
  );

insert into public.categories (id, organization_id, name, slug)
values
  (
    '54000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001',
    'Menestras A B3',
    'menestras-a-b3'
  ),
  (
    '54000000-0000-4000-8000-000000000002',
    '51000000-0000-4000-8000-000000000002',
    'Menestras B B3',
    'menestras-b-b3'
  );

insert into public.products (
  id, store_id, sku, name, category_id, base_unit, pricing_quantity,
  price_cents, cost_cents, stock_quantity, minimum_stock_quantity
) values
  (
    '55000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001',
    'PROD-A-B3',
    'Frejol A B3',
    '54000000-0000-4000-8000-000000000001',
    'gram',
    1000,
    1000,
    700,
    1000,
    100
  ),
  (
    '55000000-0000-4000-8000-000000000002',
    '52000000-0000-4000-8000-000000000002',
    'PROD-B-B3',
    'Frejol B B3',
    '54000000-0000-4000-8000-000000000002',
    'gram',
    1000,
    2000,
    1400,
    1000,
    100
  );

-- =============================================================================
-- 3. Apertura y venta como Seller A
-- =============================================================================

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '50000000-0000-4000-8000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select is(
  (
    select applied
    from public.open_cash_session(
      '52000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      1000,
      '60000000-0000-4000-8000-000000000001'
    )
  ),
  true,
  'La primera apertura de caja se aplica'
);

select is(
  (
    select count(*)::bigint
    from public.cash_sessions
    where store_id = '52000000-0000-4000-8000-000000000001'
      and device_id = '53000000-0000-4000-8000-000000000001'
      and status = 'open'
  ),
  1::bigint,
  'Existe una caja abierta para el dispositivo'
);

select is(
  (
    select count(*)::bigint
    from public.sync_outbox
    where operation_id = '60000000-0000-4000-8000-000000000001'
      and event_type = 'cash_session.opened'
  ),
  1::bigint,
  'Abrir caja encola cash_session.opened'
);

select is(
  (
    select applied
    from public.open_cash_session(
      '52000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      1000,
      '60000000-0000-4000-8000-000000000001'
    )
  ),
  false,
  'Repetir operation_id de apertura devuelve el resultado previo'
);

select is(
  (
    select count(*)::bigint
    from public.cash_sessions
    where store_id = '52000000-0000-4000-8000-000000000001'
      and device_id = '53000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'Reintentar apertura no duplica sesiones'
);

select throws_ok(
  $$
    select *
    from public.open_cash_session(
      '52000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      500,
      '60000000-0000-4000-8000-000000000002'
    )
  $$,
  '23505',
  'Este dispositivo ya tiene una caja abierta',
  'No se permite una segunda caja abierta en el dispositivo'
);

select is(
  (
    select applied
    from public.create_sale(
      '52000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      'V-A1-000001',
      '[{
        "id": "61000000-0000-4000-8000-000000000001",
        "product_id": "55000000-0000-4000-8000-000000000001",
        "quantity": 100
      }]'::jsonb,
      '[
        {
          "id": "62000000-0000-4000-8000-000000000001",
          "method": "cash",
          "amount_cents": 60,
          "amount_received_cents": 100
        },
        {
          "id": "62000000-0000-4000-8000-000000000002",
          "method": "yape",
          "amount_cents": 40,
          "reference": "YAPE-B3-1"
        }
      ]'::jsonb,
      '60000000-0000-4000-8000-000000000010',
      0
    )
  ),
  true,
  'BE-03: create_sale aplica una venta con pago combinado'
);

select is(
  (
    select count(*)::bigint
    from public.sales
    where operation_id = '60000000-0000-4000-8000-000000000010'
  ),
  1::bigint,
  'BE-03: se inserta una sola cabecera'
);

select is(
  (
    select total_cents
    from public.sales
    where operation_id = '60000000-0000-4000-8000-000000000010'
  ),
  100::bigint,
  'BE-03: el total usa redondeo entero'
);

select is(
  (
    select count(*)::bigint
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    where s.operation_id = '60000000-0000-4000-8000-000000000010'
  ),
  1::bigint,
  'BE-03: la venta conserva su item'
);

select is(
  (
    select count(*)::bigint
    from public.sale_payments sp
    join public.sales s on s.id = sp.sale_id
    where s.operation_id = '60000000-0000-4000-8000-000000000010'
  ),
  2::bigint,
  'BE-03: la venta conserva los dos pagos'
);

select throws_ok(
  $$
    select *
    from public.create_sale(
      '52000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      'V-A1-DT02-001',
      '[{
        "id": "61000000-0000-4000-8000-000000000099",
        "product_id": "55000000-0000-4000-8000-000000000001",
        "quantity": 100
      }]'::jsonb,
      '[{
        "id": "62000000-0000-4000-8000-000000000099",
        "method": "yape",
        "amount_cents": 100
      }]'::jsonb,
      '60000000-0000-4000-8000-000000000099',
      0
    )
  $$,
  '23514',
  'new row for relation "sale_payments" violates check constraint "sale_payments_digital_reference_required"',
  'DT-02: Yape sin codigo de operacion se rechaza'
);

select is(
  (
    select count(*)::bigint
    from public.sales
    where operation_id = '60000000-0000-4000-8000-000000000099'
  ),
  0::bigint,
  'DT-02: el rechazo no deja una venta parcial'
);

select is(
  (
    select stock_quantity
    from public.products
    where id = '55000000-0000-4000-8000-000000000001'
  ),
  900::bigint,
  'BE-03: create_sale descuenta inventario'
);

select is(
  (
    select count(*)::bigint
    from public.inventory_movements im
    join public.sales s on s.id = im.reference_id
    where s.operation_id = '60000000-0000-4000-8000-000000000010'
      and im.reference_type = 'sale'
      and im.quantity_delta = -100
  ),
  1::bigint,
  'BE-03: create_sale registra el movimiento de salida'
);

select is(
  (
    select resulting_quantity
    from public.inventory_movements
    where reference_id = (
      select id
      from public.sales
      where operation_id = '60000000-0000-4000-8000-000000000010'
    )
      and reference_type = 'sale'
  ),
  900::bigint,
  'El movimiento conserva el saldo resultante'
);

select is(
  (
    select count(*)::bigint
    from public.sync_outbox
    where operation_id = '60000000-0000-4000-8000-000000000010'
      and event_type = 'sale.confirmed'
  ),
  1::bigint,
  'BE-03: create_sale encola sale.confirmed'
);

select is(
  (
    select applied
    from public.create_sale(
      '52000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      'V-A1-000001',
      '[{
        "id": "61000000-0000-4000-8000-000000000001",
        "product_id": "55000000-0000-4000-8000-000000000001",
        "quantity": 100
      }]'::jsonb,
      '[
        {
          "id": "62000000-0000-4000-8000-000000000001",
          "method": "cash",
          "amount_cents": 60,
          "amount_received_cents": 100
        },
        {
          "id": "62000000-0000-4000-8000-000000000002",
          "method": "yape",
          "amount_cents": 40,
          "reference": "YAPE-B3-1"
        }
      ]'::jsonb,
      '60000000-0000-4000-8000-000000000010',
      0
    )
  ),
  false,
  'BE-02: repetir operation_id devuelve la venta previa'
);

select is(
  (
    select count(*)::bigint
    from public.sales
    where operation_id = '60000000-0000-4000-8000-000000000010'
  ),
  1::bigint,
  'BE-02: el reintento no duplica la venta'
);

select is(
  (
    select count(*)::bigint
    from public.sale_payments sp
    join public.sales s on s.id = sp.sale_id
    where s.operation_id = '60000000-0000-4000-8000-000000000010'
  ),
  2::bigint,
  'BE-02: el reintento no duplica pagos'
);

select is(
  (
    select stock_quantity
    from public.products
    where id = '55000000-0000-4000-8000-000000000001'
  ),
  900::bigint,
  'BE-02: el reintento no vuelve a descontar stock'
);

select throws_ok(
  $$
    select *
    from public.create_sale(
      '52000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      'V-A1-DIFERENTE',
      '[{
        "product_id": "55000000-0000-4000-8000-000000000001",
        "quantity": 100
      }]'::jsonb,
      '[{
        "method": "cash",
        "amount_cents": 100,
        "amount_received_cents": 100
      }]'::jsonb,
      '60000000-0000-4000-8000-000000000010',
      0
    )
  $$,
  '22023',
  'operation_id ya fue usado con otra venta',
  'Un operation_id no puede reutilizarse con otro payload'
);

select throws_ok(
  $$
    select *
    from public.create_sale(
      '52000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      'V-A1-SIN-STOCK',
      '[{
        "id": "61000000-0000-4000-8000-000000000099",
        "product_id": "55000000-0000-4000-8000-000000000001",
        "quantity": 901
      }]'::jsonb,
      '[{
        "id": "62000000-0000-4000-8000-000000000099",
        "method": "cash",
        "amount_cents": 901,
        "amount_received_cents": 901
      }]'::jsonb,
      '60000000-0000-4000-8000-000000000099',
      0
    )
  $$,
  '23514',
  'Stock insuficiente para Frejol A B3',
  'BE-04: una venta no puede dejar stock negativo'
);

select is(
  (
    select count(*)::bigint
    from public.sales
    where store_device_pos_id = 'V-A1-SIN-STOCK'
  ),
  0::bigint,
  'BE-03: el rechazo no deja una venta parcial'
);

select is(
  (
    select stock_quantity
    from public.products
    where id = '55000000-0000-4000-8000-000000000001'
  ),
  900::bigint,
  'BE-03: el rechazo conserva el stock'
);

select is(
  (
    select count(*)::bigint
    from public.sync_outbox
    where operation_id = '60000000-0000-4000-8000-000000000099'
  ),
  0::bigint,
  'BE-03: el rechazo no deja un outbox parcial'
);

-- =============================================================================
-- 4. Movimientos manuales de caja
-- =============================================================================

select lives_ok(
  $$
    insert into public.cash_movements (
      store_id, cash_session_id, movement_type, amount_cents, reason,
      actor_user_id, device_id, operation_id
    ) values (
      '52000000-0000-4000-8000-000000000001',
      (
        select id
        from public.cash_sessions
        where open_operation_id = '60000000-0000-4000-8000-000000000001'
      ),
      'income',
      50,
      'Ingreso manual B3',
      '50000000-0000-4000-8000-000000000002',
      '53000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000020'
    )
  $$,
  'La caja abierta acepta un ingreso del mismo dispositivo'
);

select is(
  (
    select count(*)::bigint
    from public.cash_movements
    where operation_id = '60000000-0000-4000-8000-000000000020'
  ),
  1::bigint,
  'El ingreso queda registrado'
);

select is(
  (
    select count(*)::bigint
    from public.sync_outbox
    where operation_id = '60000000-0000-4000-8000-000000000020'
      and event_type = 'cash_movement.income'
  ),
  1::bigint,
  'El trigger encola el ingreso manual'
);

select throws_ok(
  $$
    insert into public.cash_movements (
      store_id, cash_session_id, movement_type, amount_cents, reason,
      actor_user_id, device_id, operation_id
    ) values (
      '52000000-0000-4000-8000-000000000001',
      (
        select id
        from public.cash_sessions
        where open_operation_id = '60000000-0000-4000-8000-000000000001'
      ),
      'outflow',
      1200,
      'Salida excesiva',
      '50000000-0000-4000-8000-000000000002',
      '53000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000021'
    )
  $$,
  '23514',
  'La salida supera el efectivo esperado en caja',
  'Una salida no puede superar el efectivo esperado'
);

select lives_ok(
  $$
    insert into public.cash_movements (
      store_id, cash_session_id, movement_type, amount_cents, reason,
      actor_user_id, device_id, operation_id
    ) values (
      '52000000-0000-4000-8000-000000000001',
      (
        select id
        from public.cash_sessions
        where open_operation_id = '60000000-0000-4000-8000-000000000001'
      ),
      'outflow',
      100,
      'Compra menor',
      '50000000-0000-4000-8000-000000000002',
      '53000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000022'
    )
  $$,
  'Una salida valida queda registrada'
);

select is(
  (
    select count(*)::bigint
    from public.cash_movements
    where cash_session_id = (
      select id
      from public.cash_sessions
      where open_operation_id = '60000000-0000-4000-8000-000000000001'
    )
  ),
  2::bigint,
  'La caja contiene ingreso y salida manual'
);

select throws_ok(
  $$
    insert into public.cash_movements (
      store_id, cash_session_id, movement_type, amount_cents, reason,
      actor_user_id, device_id, operation_id
    ) values (
      '52000000-0000-4000-8000-000000000001',
      (
        select id
        from public.cash_sessions
        where open_operation_id = '60000000-0000-4000-8000-000000000001'
      ),
      'income',
      10,
      'Dispositivo incorrecto',
      '50000000-0000-4000-8000-000000000002',
      '53000000-0000-4000-8000-000000000002',
      '60000000-0000-4000-8000-000000000023'
    )
  $$,
  '42501',
  'El movimiento requiere la caja abierta del mismo dispositivo',
  'Caja solo acepta movimientos del mismo dispositivo'
);

select throws_ok(
  $$
    select *
    from public.void_sale(
      (
        select id
        from public.sales
        where operation_id = '60000000-0000-4000-8000-000000000010'
      ),
      '53000000-0000-4000-8000-000000000001',
      'Intento seller',
      '60000000-0000-4000-8000-000000000030'
    )
  $$,
  '42501',
  'Solo un administrador puede anular ventas',
  'Seller no puede anular ventas'
);

-- =============================================================================
-- 5. BE-01: aislamiento por tienda
-- =============================================================================

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '50000000-0000-4000-8000-000000000003',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::bigint from public.cash_sessions),
  0::bigint,
  'BE-01: Admin B no ve cajas de Tienda A'
);

select is(
  (select count(*)::bigint from public.sales),
  0::bigint,
  'BE-01: Admin B no ve ventas de Tienda A'
);

select is(
  (select count(*)::bigint from public.sync_outbox),
  0::bigint,
  'BE-01: Admin B no ve outbox de Tienda A'
);

select throws_ok(
  $$
    select *
    from public.create_sale(
      '52000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      'V-B-INTRUSO',
      '[{
        "product_id": "55000000-0000-4000-8000-000000000001",
        "quantity": 100
      }]'::jsonb,
      '[{
        "method": "cash",
        "amount_cents": 100,
        "amount_received_cents": 100
      }]'::jsonb,
      '60000000-0000-4000-8000-000000000031',
      0
    )
  $$,
  '42501',
  'El usuario no pertenece a la tienda',
  'BE-01: Admin B no puede crear ventas en Tienda A'
);

-- =============================================================================
-- 6. Anulacion y cierre como Admin A
-- =============================================================================

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '50000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select throws_ok(
  $$
    select *
    from public.void_sale(
      (
        select id
        from public.sales
        where operation_id = '60000000-0000-4000-8000-000000000010'
      ),
      '53000000-0000-4000-8000-000000000002',
      'Dispositivo incorrecto',
      '60000000-0000-4000-8000-000000000032'
    )
  $$,
  '42501',
  'La anulacion debe realizarse desde el dispositivo original',
  'La anulacion exige el dispositivo original'
);

select is(
  (
    select applied
    from public.void_sale(
      (
        select id
        from public.sales
        where operation_id = '60000000-0000-4000-8000-000000000010'
      ),
      '53000000-0000-4000-8000-000000000001',
      'Error de registro',
      '60000000-0000-4000-8000-000000000033'
    )
  ),
  true,
  'Admin anula la venta en su caja original'
);

select ok(
  (
    select voided_at is not null
    from public.sales
    where operation_id = '60000000-0000-4000-8000-000000000010'
  ),
  'La venta queda marcada con voided_at'
);

select is(
  (
    select stock_quantity
    from public.products
    where id = '55000000-0000-4000-8000-000000000001'
  ),
  1000::bigint,
  'Anular la venta restaura el stock'
);

select is(
  (
    select count(*)::bigint
    from public.inventory_movements
    where reference_id = (
      select id
      from public.sales
      where operation_id = '60000000-0000-4000-8000-000000000010'
    )
      and reference_type = 'sale_void'
      and quantity_delta = 100
  ),
  1::bigint,
  'Anular registra un movimiento return'
);

select is(
  (
    select count(*)::bigint
    from public.sale_status_history
    where operation_id = '60000000-0000-4000-8000-000000000033'
  ),
  1::bigint,
  'Anular registra historial confirmed a voided'
);

select is(
  (
    select count(*)::bigint
    from public.cash_movements
    where cash_session_id = (
      select id
      from public.cash_sessions
      where open_operation_id = '60000000-0000-4000-8000-000000000001'
    )
  ),
  2::bigint,
  'La anulacion no crea movimiento compensatorio de efectivo'
);

select is(
  (
    select count(*)::bigint
    from public.sync_outbox
    where operation_id = '60000000-0000-4000-8000-000000000033'
      and event_type = 'sale.voided'
  ),
  1::bigint,
  'Anular encola sale.voided'
);

select is(
  (
    select applied
    from public.void_sale(
      (
        select id
        from public.sales
        where operation_id = '60000000-0000-4000-8000-000000000010'
      ),
      '53000000-0000-4000-8000-000000000001',
      'Error de registro',
      '60000000-0000-4000-8000-000000000033'
    )
  ),
  false,
  'Repetir operation_id de anulacion devuelve el resultado previo'
);

select is(
  (
    select count(*)::bigint
    from public.sale_status_history
    where operation_id = '60000000-0000-4000-8000-000000000033'
  ),
  1::bigint,
  'Reintentar anulacion no duplica historial'
);

select is(
  (
    select stock_quantity
    from public.products
    where id = '55000000-0000-4000-8000-000000000001'
  ),
  1000::bigint,
  'Reintentar anulacion no vuelve a restaurar stock'
);

select is(
  (
    select applied
    from public.create_sale(
      '52000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      'V-A1-000002',
      '[{
        "id": "61000000-0000-4000-8000-000000000002",
        "product_id": "55000000-0000-4000-8000-000000000001",
        "quantity": 100
      }]'::jsonb,
      '[{
        "id": "62000000-0000-4000-8000-000000000003",
        "method": "yape",
        "amount_cents": 100,
        "reference": "YAPE-B3-2"
      }]'::jsonb,
      '60000000-0000-4000-8000-000000000040',
      0
    )
  ),
  true,
  'Una segunda venta no efectiva se confirma antes del cierre'
);

select is(
  (
    select stock_quantity
    from public.products
    where id = '55000000-0000-4000-8000-000000000001'
  ),
  900::bigint,
  'La segunda venta vuelve a descontar stock'
);

select is(
  (
    select applied
    from public.close_cash_session(
      (
        select id
        from public.cash_sessions
        where open_operation_id = '60000000-0000-4000-8000-000000000001'
      ),
      '53000000-0000-4000-8000-000000000001',
      960,
      '60000000-0000-4000-8000-000000000050'
    )
  ),
  true,
  'El cierre de caja se aplica'
);

select is(
  (
    select status
    from public.cash_sessions
    where open_operation_id = '60000000-0000-4000-8000-000000000001'
  ),
  'closed',
  'La sesion queda cerrada'
);

select is(
  (
    select cash_sales_cents
    from public.cash_sessions
    where open_operation_id = '60000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'El cierre excluye efectivo de la venta anulada'
);

select is(
  (
    select expected_cash_cents
    from public.cash_sessions
    where open_operation_id = '60000000-0000-4000-8000-000000000001'
  ),
  950::bigint,
  'Esperado = fondo + ingresos - salidas, sin la venta anulada'
);

select is(
  (
    select difference_cents
    from public.cash_sessions
    where open_operation_id = '60000000-0000-4000-8000-000000000001'
  ),
  10::bigint,
  'El cierre conserva la diferencia contada'
);

select is(
  (
    select applied
    from public.close_cash_session(
      (
        select id
        from public.cash_sessions
        where open_operation_id = '60000000-0000-4000-8000-000000000001'
      ),
      '53000000-0000-4000-8000-000000000001',
      960,
      '60000000-0000-4000-8000-000000000050'
    )
  ),
  false,
  'Repetir operation_id de cierre devuelve el resultado previo'
);

select is(
  (
    select count(*)::bigint
    from public.sync_outbox
    where operation_id = '60000000-0000-4000-8000-000000000050'
      and event_type = 'cash_session.closed'
  ),
  1::bigint,
  'Cerrar caja encola cash_session.closed una sola vez'
);

select throws_ok(
  $$
    select *
    from public.void_sale(
      (
        select id
        from public.sales
        where operation_id = '60000000-0000-4000-8000-000000000040'
      ),
      '53000000-0000-4000-8000-000000000001',
      'Intento despues del cierre',
      '60000000-0000-4000-8000-000000000051'
    )
  $$,
  '55000',
  'La anulacion requiere la misma caja abierta de la venta original',
  'No se puede anular despues de cerrar la caja original'
);

select throws_ok(
  $$
    insert into public.cash_movements (
      store_id, cash_session_id, movement_type, amount_cents, reason,
      actor_user_id, device_id, operation_id
    ) values (
      '52000000-0000-4000-8000-000000000001',
      (
        select id
        from public.cash_sessions
        where open_operation_id = '60000000-0000-4000-8000-000000000001'
      ),
      'income',
      10,
      'Caja ya cerrada',
      '50000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000052'
    )
  $$,
  '42501',
  'El movimiento requiere la caja abierta del mismo dispositivo',
  'Una caja cerrada no acepta movimientos'
);

-- =============================================================================
-- 7. Inmutabilidad de historicos
-- =============================================================================

reset role;

select throws_ok(
  $$
    update public.sale_items
    set product_name_snapshot = 'Alterado'
    where id = '61000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'sale_items es insert-only; use un evento compensatorio',
  'sale_items es inmutable'
);

select throws_ok(
  $$
    update public.sale_payments
    set amount_cents = 1
    where id = '62000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'sale_payments es insert-only; use un evento compensatorio',
  'sale_payments es inmutable'
);

select throws_ok(
  $$
    update public.sales
    set total_cents = 1
    where operation_id = '60000000-0000-4000-8000-000000000040'
  $$,
  '55000',
  'La unica actualizacion permitida es anular una venta vigente',
  'La cabecera de venta no admite ediciones ordinarias'
);

select * from finish();
rollback;
