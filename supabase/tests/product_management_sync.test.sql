-- pgTAP: alta y edición offline-first de productos.
begin;

select plan(9);

select has_function(
  'private',
  'apply_product_sync_operation',
  array['uuid', 'uuid', 'uuid', 'text', 'uuid', 'text', 'jsonb'],
  'Existe el aplicador privado de productos'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.process_sync_batch(uuid,uuid,integer,jsonb)'::regprocedure
    ),
    'product.created'
  ) > 0,
  'El push B4 reconoce altas de producto'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'd1100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'product-admin@cogana.test',
  'test-password-hash', now(), '{}'::jsonb,
  '{"full_name":"Product Admin"}'::jsonb, now(), now()
);
insert into auth.identities (
  id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(), 'd1100000-0000-4000-8000-000000000001',
  '{"sub":"d1100000-0000-4000-8000-000000000001","email":"product-admin@cogana.test"}'::jsonb,
  'email', 'product-admin@cogana.test', now(), now(), now()
);
insert into public.organizations(id, name)
values ('d1200000-0000-4000-8000-000000000001', 'Organizacion Productos');
insert into public.stores(id, organization_id, code, name)
values (
  'd1300000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'PRODUCTS',
  'Tienda Productos'
);
insert into public.store_memberships(store_id, user_id, role, is_active)
values (
  'd1300000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'admin',
  true
);
insert into public.devices(id, store_id, name, platform, status, registered_by)
values (
  'd1400000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'TPV Productos',
  'android',
  'authorized',
  'd1100000-0000-4000-8000-000000000001'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"d1100000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$
    select public.process_sync_batch(
      'd1300000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000001',
      1,
      jsonb_build_array(jsonb_build_object(
        'operation_id', 'd1500000-0000-4000-8000-000000000001',
        'entity_type', 'product',
        'entity_id', 'd1500000-0000-4000-8000-000000000001',
        'operation_type', 'product.created',
        'payload', jsonb_build_object(
          'storeId', 'd1300000-0000-4000-8000-000000000001',
          'deviceId', 'd1400000-0000-4000-8000-000000000001',
          'sku', 'ARR-TEST',
          'name', 'Arroz Test',
          'category', 'Arroces',
          'baseUnit', 'gram',
          'pricingQuantity', 1000,
          'priceCents', 500,
          'costCents', 350,
          'initialStockQuantity', 20000,
          'minimumStockQuantity', 5000,
          'isActive', true,
          'openingMovementId', 'd1600000-0000-4000-8000-000000000001'
        )
      ))
    )
  $$,
  'El lote crea el producto'
);
select is(
  (select stock_quantity from public.products where sku = 'ARR-TEST'),
  20000::bigint,
  'Conserva el stock inicial entero'
);
select is(
  (
    select quantity_delta from public.inventory_movements
    where operation_id = 'd1600000-0000-4000-8000-000000000001'
  ),
  20000::bigint,
  'Registra el movimiento de apertura'
);
select is(
  (select count(*)::bigint from public.categories where name = 'Arroces'),
  1::bigint,
  'Crea la categoría faltante una sola vez'
);
select is(
  (
    select status from public.sync_operations
    where operation_id = 'd1500000-0000-4000-8000-000000000001'
  ),
  'applied',
  'Marca la operación aplicada'
);
select lives_ok(
  $$
    select public.process_sync_batch(
      'd1300000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000001',
      1,
      jsonb_build_array(jsonb_build_object(
        'operation_id', 'd1500000-0000-4000-8000-000000000001',
        'entity_type', 'product',
        'entity_id', 'd1500000-0000-4000-8000-000000000001',
        'operation_type', 'product.created',
        'payload', jsonb_build_object(
          'storeId', 'd1300000-0000-4000-8000-000000000001',
          'deviceId', 'd1400000-0000-4000-8000-000000000001',
          'sku', 'ARR-TEST',
          'name', 'Arroz Test',
          'category', 'Arroces',
          'baseUnit', 'gram',
          'pricingQuantity', 1000,
          'priceCents', 500,
          'costCents', 350,
          'initialStockQuantity', 20000,
          'minimumStockQuantity', 5000,
          'isActive', true,
          'openingMovementId', 'd1600000-0000-4000-8000-000000000001'
        )
      ))
    )
  $$,
  'Reintentar el mismo lote es idempotente'
);
select is(
  (select count(*)::bigint from public.products where sku = 'ARR-TEST'),
  1::bigint,
  'El reintento no duplica el producto'
);

reset role;
select * from finish();
rollback;
