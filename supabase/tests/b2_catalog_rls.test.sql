-- Pruebas pgTAP de B2 - Catalogo, presentaciones e inventario.
-- Requiere las migraciones B1 y B2 aplicadas en orden.
--
-- Cubre:
--   BE-01: aislamiento por tienda.
--   BE-04: ninguna operacion deja stock negativo.
--   BE-07: el cambio de precio registra historial y version.
--   Idempotencia: repetir operation_id produce un solo efecto.

begin;

select plan(39);

-- =============================================================================
-- 1. Estructura y RLS
-- =============================================================================

select has_table('public', 'categories', 'B2 crea categories');
select has_table('public', 'products', 'B2 crea products');
select has_table('public', 'product_presentations', 'B2 crea product_presentations');
select has_table('public', 'product_images', 'B2 crea product_images');
select has_table('public', 'price_history', 'B2 crea price_history');
select has_table('public', 'inventory_movements', 'B2 crea inventory_movements');

select results_eq(
  $$
    select c.relname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'categories',
        'products',
        'product_presentations',
        'product_images',
        'price_history',
        'inventory_movements'
      )
      and c.relrowsecurity = true
    order by c.relname
  $$,
  $$
    values
      ('categories'),
      ('inventory_movements'),
      ('price_history'),
      ('product_images'),
      ('product_presentations'),
      ('products')
  $$,
  'RLS esta habilitado en las seis tablas expuestas de B2'
);

-- =============================================================================
-- 2. Fixtures
-- =============================================================================

create or replace function _b2_create_auth_user(
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

select _b2_create_auth_user(
  '10000000-0000-4000-8000-000000000001',
  'admin-a-b2@coguana.test',
  'Admin A B2'
);
select _b2_create_auth_user(
  '10000000-0000-4000-8000-000000000002',
  'seller-a-b2@coguana.test',
  'Seller A B2'
);
select _b2_create_auth_user(
  '10000000-0000-4000-8000-000000000003',
  'admin-b-b2@coguana.test',
  'Admin B B2'
);

insert into public.organizations (id, name)
values
  ('20000000-0000-4000-8000-000000000001', 'Organizacion A B2'),
  ('20000000-0000-4000-8000-000000000002', 'Organizacion B B2');

insert into public.stores (id, organization_id, code, name)
values
  (
    '21000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'B2-A',
    'Tienda A B2'
  ),
  (
    '21000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    'B2-B',
    'Tienda B B2'
  );

insert into public.store_memberships (store_id, user_id, role, is_active)
values
  (
    '21000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'admin',
    true
  ),
  (
    '21000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'seller',
    true
  ),
  (
    '21000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
    'admin',
    true
  );

insert into public.devices (id, store_id, name, platform, status, registered_by)
values
  (
    '22000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'Dispositivo A B2',
    'android',
    'authorized',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000002',
    'Dispositivo B B2',
    'android',
    'authorized',
    '10000000-0000-4000-8000-000000000003'
  );

insert into public.categories (id, organization_id, name, slug)
values
  (
    '23000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Menestras A',
    'menestras-a'
  ),
  (
    '23000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    'Menestras B',
    'menestras-b'
  );

insert into public.products (
  id, store_id, sku, name, category_id, base_unit, pricing_quantity,
  price_cents, cost_cents, stock_quantity, minimum_stock_quantity
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'PROD-A',
    'Frejol A',
    '23000000-0000-4000-8000-000000000001',
    'gram',
    1000,
    1000,
    700,
    100,
    10
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000002',
    'PROD-B',
    'Frejol B',
    '23000000-0000-4000-8000-000000000002',
    'gram',
    1000,
    2000,
    1400,
    200,
    20
  );

insert into public.product_presentations (
  id, store_id, product_id, sku, name, kind, conversion_factor, price_mode
) values
  (
    '31000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'PROD-A-S01',
    'Saco A',
    'sack',
    50000,
    'calculated'
  ),
  (
    '31000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    'PROD-B-S01',
    'Saco B',
    'sack',
    50000,
    'calculated'
  );

insert into public.product_images (
  id, store_id, product_id, storage_path, sort_order, alt_text
) values
  (
    '32000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'b2-a/frejol-a.webp',
    0,
    'Frejol A'
  ),
  (
    '32000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    'b2-b/frejol-b.webp',
    0,
    'Frejol B'
  );

-- =============================================================================
-- 3. BE-01: lectura y escritura aisladas por tienda
-- =============================================================================

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::bigint from public.products),
  1::bigint,
  'BE-01: seller solo ve productos de su tienda'
);

select is(
  (select count(*)::bigint from public.categories),
  1::bigint,
  'BE-01: seller solo ve categorias de su organizacion'
);

select is(
  (select count(*)::bigint from public.product_presentations),
  1::bigint,
  'BE-01: seller solo ve presentaciones de su tienda'
);

select is(
  (select count(*)::bigint from public.product_images),
  1::bigint,
  'BE-01: seller solo ve imagenes de su tienda'
);

select is(
  (
    with changed as (
      update public.products
      set name = 'Cambio no autorizado'
      where id = '30000000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::bigint from changed
  ),
  0::bigint,
  'Seller no puede editar catalogo'
);

select throws_ok(
  $$
    select *
    from public.change_product_price(
      '30000000-0000-4000-8000-000000000001',
      1200,
      'Intento seller',
      '40000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'Solo un administrador puede cambiar precios',
  'Seller no puede ejecutar cambios de precio'
);

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::bigint from public.products),
  1::bigint,
  'BE-01: admin tampoco ve productos de otra tienda'
);

select throws_ok(
  $$
    update public.products
    set price_cents = 9999
    where id = '30000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table products',
  'El precio no puede cambiarse con UPDATE directo'
);

select throws_ok(
  $$
    select *
    from public.change_product_price(
      '30000000-0000-4000-8000-000000000002',
      2200,
      'Intento tienda ajena',
      '40000000-0000-4000-8000-000000000002',
      null
    )
  $$,
  '42501',
  'Solo un administrador puede cambiar precios',
  'BE-01: admin no puede cambiar precio de otra tienda'
);

-- =============================================================================
-- 4. BE-07 e idempotencia del cambio de precio
-- =============================================================================

select is(
  (
    select applied
    from public.change_product_price(
      '30000000-0000-4000-8000-000000000001',
      1200,
      'Actualizacion de temporada',
      '41000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001'
    )
  ),
  true,
  'BE-07: el primer cambio de precio se aplica'
);

select is(
  (
    select price_cents
    from public.products
    where id = '30000000-0000-4000-8000-000000000001'
  ),
  1200::bigint,
  'BE-07: products conserva el nuevo precio'
);

select is(
  (
    select version
    from public.products
    where id = '30000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'BE-07: el cambio de precio incrementa version'
);

select is(
  (
    select count(*)::bigint
    from public.price_history
    where operation_id = '41000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'BE-07: el cambio inserta exactamente un historial'
);

select is(
  (
    select applied
    from public.change_product_price(
      '30000000-0000-4000-8000-000000000001',
      1200,
      'Actualizacion de temporada',
      '41000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001'
    )
  ),
  false,
  'Repetir operation_id devuelve el resultado previo'
);

select is(
  (
    select count(*)::bigint
    from public.price_history
    where operation_id = '41000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'Reintentar precio no duplica historial'
);

select is(
  (
    select version
    from public.products
    where id = '30000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'Reintentar precio no vuelve a incrementar version'
);

select throws_ok(
  $$
    select *
    from public.change_product_price(
      '30000000-0000-4000-8000-000000000001',
      1300,
      'Payload diferente',
      '41000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001'
    )
  $$,
  '22023',
  'operation_id ya fue usado con otro cambio de precio',
  'Un operation_id no puede reutilizarse con otro precio'
);

-- =============================================================================
-- 5. BE-04 e idempotencia del inventario
-- =============================================================================

select throws_ok(
  $$
    select *
    from public.adjust_inventory(
      '30000000-0000-4000-8000-000000000001',
      -101,
      'waste',
      'Merma imposible',
      '42000000-0000-4000-8000-000000000001',
      null,
      null,
      '22000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'El movimiento dejaria el inventario con stock negativo',
  'BE-04: un movimiento no puede dejar stock negativo'
);

select is(
  (
    select stock_quantity
    from public.products
    where id = '30000000-0000-4000-8000-000000000001'
  ),
  100::bigint,
  'BE-04: el rechazo conserva el stock anterior'
);

select is(
  (
    select applied
    from public.adjust_inventory(
      '30000000-0000-4000-8000-000000000001',
      25,
      'purchase',
      'Compra de reposicion',
      '42000000-0000-4000-8000-000000000002',
      null,
      null,
      '22000000-0000-4000-8000-000000000001'
    )
  ),
  true,
  'El primer ajuste de inventario se aplica'
);

select is(
  (
    select stock_quantity
    from public.products
    where id = '30000000-0000-4000-8000-000000000001'
  ),
  125::bigint,
  'El ajuste actualiza stock en la misma transaccion'
);

select is(
  (
    select version
    from public.products
    where id = '30000000-0000-4000-8000-000000000001'
  ),
  3::bigint,
  'El ajuste de inventario incrementa version'
);

select is(
  (
    select count(*)::bigint
    from public.inventory_movements
    where operation_id = '42000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'El ajuste inserta exactamente un movimiento'
);

select is(
  (
    select resulting_quantity
    from public.inventory_movements
    where operation_id = '42000000-0000-4000-8000-000000000002'
  ),
  125::bigint,
  'El movimiento conserva el saldo resultante'
);

select is(
  (
    select applied
    from public.adjust_inventory(
      '30000000-0000-4000-8000-000000000001',
      25,
      'purchase',
      'Compra de reposicion',
      '42000000-0000-4000-8000-000000000002',
      null,
      null,
      '22000000-0000-4000-8000-000000000001'
    )
  ),
  false,
  'Repetir operation_id de inventario devuelve el resultado previo'
);

select is(
  (
    select count(*)::bigint
    from public.inventory_movements
    where operation_id = '42000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'Reintentar inventario no duplica movimientos'
);

select is(
  (
    select stock_quantity
    from public.products
    where id = '30000000-0000-4000-8000-000000000001'
  ),
  125::bigint,
  'Reintentar inventario no vuelve a modificar stock'
);

select throws_ok(
  $$
    select *
    from public.adjust_inventory(
      '30000000-0000-4000-8000-000000000001',
      30,
      'purchase',
      'Payload diferente',
      '42000000-0000-4000-8000-000000000002',
      null,
      null,
      '22000000-0000-4000-8000-000000000001'
    )
  $$,
  '22023',
  'operation_id ya fue usado con otro movimiento de inventario',
  'Un operation_id no puede reutilizarse con otro movimiento'
);

select throws_ok(
  $$
    insert into public.price_history (
      store_id, product_id, old_price_cents, new_price_cents, reason,
      actor_user_id, operation_id, product_version
    ) values (
      '21000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      1200,
      1300,
      'Insercion directa',
      '10000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000001',
      4
    )
  $$,
  '42501',
  'permission denied for table price_history',
  'El historial no admite inserciones directas desde authenticated'
);

-- =============================================================================
-- 6. Integridad estructural e inmutabilidad
-- =============================================================================

reset role;

select throws_ok(
  $$
    update public.price_history
    set reason = 'Alterado'
    where operation_id = '41000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'price_history es insert-only; use un evento compensatorio',
  'price_history es inmutable'
);

select throws_ok(
  $$
    update public.inventory_movements
    set reason = 'Alterado'
    where operation_id = '42000000-0000-4000-8000-000000000002'
  $$,
  '55000',
  'inventory_movements es insert-only; use un evento compensatorio',
  'inventory_movements es inmutable'
);

select throws_ok(
  $$
    insert into public.products (
      id, store_id, sku, name, category_id, base_unit, pricing_quantity,
      price_cents, stock_quantity
    ) values (
      '30000000-0000-4000-8000-000000000003',
      '21000000-0000-4000-8000-000000000001',
      'CROSS-ORG',
      'Producto invalido',
      '23000000-0000-4000-8000-000000000002',
      'unit',
      1,
      100,
      1
    )
  $$,
  '23514',
  'La categoria debe pertenecer a la organizacion de la tienda',
  'Un producto no puede usar una categoria de otra organizacion'
);

select * from finish();
rollback;
