-- pgTAP B5: clientes, pedidos, RLS, idempotencia y transiciones.
begin;

select plan(19);

select has_table('public', 'customers', 'B5 crea customers');
select has_table('public', 'customer_addresses', 'B5 crea customer_addresses');
select has_table('public', 'orders', 'B5 crea orders');
select has_table('public', 'order_items', 'B5 crea order_items');
select has_table('public', 'order_status_history', 'B5 crea historial');

select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'customers', 'customer_addresses', 'orders',
        'order_items', 'order_status_history'
      )
  ),
  'RLS esta habilitado en todas las tablas B5'
);
select ok(
  not has_table_privilege('anon', 'public.orders', 'SELECT'),
  'anon no consulta pedidos'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.create_order(uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated ejecuta create_order'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.transition_order(uuid,uuid,text,text,jsonb,uuid,bigint)',
    'EXECUTE'
  ),
  'authenticated ejecuta transition_order'
);

create or replace function _b5_user(p_id uuid, p_email text) returns void
language plpgsql security definer set search_path = auth, public
as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    p_id, 'authenticated', 'authenticated', p_email, 'test-password-hash',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );
  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), p_id,
    jsonb_build_object('sub', p_id::text, 'email', p_email),
    'email', p_email, now(), now(), now()
  );
end;
$$;

select _b5_user('b5100000-0000-4000-8000-000000000001', 'admin-a-b5@test');
select _b5_user('b5100000-0000-4000-8000-000000000002', 'seller-a-b5@test');
select _b5_user('b5100000-0000-4000-8000-000000000003', 'admin-b-b5@test');

insert into public.organizations(id, name) values
  ('b5200000-0000-4000-8000-000000000001', 'Organizacion A B5'),
  ('b5200000-0000-4000-8000-000000000002', 'Organizacion B B5');
insert into public.stores(id, organization_id, code, name) values
  (
    'b5300000-0000-4000-8000-000000000001',
    'b5200000-0000-4000-8000-000000000001',
    'B5-A', 'Tienda A B5'
  ),
  (
    'b5300000-0000-4000-8000-000000000002',
    'b5200000-0000-4000-8000-000000000002',
    'B5-B', 'Tienda B B5'
  );
insert into public.store_memberships(store_id, user_id, role) values
  (
    'b5300000-0000-4000-8000-000000000001',
    'b5100000-0000-4000-8000-000000000001', 'admin'
  ),
  (
    'b5300000-0000-4000-8000-000000000001',
    'b5100000-0000-4000-8000-000000000002', 'seller'
  ),
  (
    'b5300000-0000-4000-8000-000000000002',
    'b5100000-0000-4000-8000-000000000003', 'admin'
  );
insert into public.devices(id, store_id, name, platform, status, registered_by)
values (
  'b5400000-0000-4000-8000-000000000001',
  'b5300000-0000-4000-8000-000000000001',
  'Android B5', 'android', 'authorized',
  'b5100000-0000-4000-8000-000000000001'
);
insert into public.categories(id, organization_id, name)
values (
  'b5500000-0000-4000-8000-000000000001',
  'b5200000-0000-4000-8000-000000000001',
  'Menestras B5'
);
insert into public.products (
  id, store_id, sku, name, category_id, base_unit, pricing_quantity,
  price_cents, cost_cents, stock_quantity, minimum_stock_quantity
) values (
  'b5600000-0000-4000-8000-000000000001',
  'b5300000-0000-4000-8000-000000000001',
  'B5-LEN', 'Lenteja B5',
  'b5500000-0000-4000-8000-000000000001',
  'gram', 1000, 850, 600, 10000, 1000
);
insert into public.delivery_zones (
  id, store_id, name, district, fee_cents, minimum_order_cents,
  eta_min_minutes, eta_max_minutes, schedule_text, created_by, updated_by
) values (
  'b5700000-0000-4000-8000-000000000001',
  'b5300000-0000-4000-8000-000000000001',
  'Santa Anita B5', 'Santa Anita', 700, 2000, 30, 50, 'Lun-Sab',
  'b5100000-0000-4000-8000-000000000001',
  'b5100000-0000-4000-8000-000000000001'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'b5100000-0000-4000-8000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select lives_ok(
  $$
    select * from public.create_order(
      'b5300000-0000-4000-8000-000000000001',
      'b5400000-0000-4000-8000-000000000001',
      'b5800000-0000-4000-8000-000000000001',
      jsonb_build_object(
        'orderNumber', 'P-B5-00001',
        'source', 'whatsapp',
        'fulfillmentType', 'delivery',
        'deliveryZoneId', 'b5700000-0000-4000-8000-000000000001',
        'customer', jsonb_build_object(
          'id', 'b5900000-0000-4000-8000-000000000001',
          'name', 'Cliente B5',
          'phone', '999111222',
          'type', 'retail'
        ),
        'address', jsonb_build_object(
          'id', 'b5a00000-0000-4000-8000-000000000001',
          'label', 'Principal',
          'address', 'Av. B5 123',
          'district', 'Santa Anita',
          'deliveryZoneId', 'b5700000-0000-4000-8000-000000000001'
        ),
        'items', jsonb_build_array(jsonb_build_object(
          'id', 'b5b00000-0000-4000-8000-000000000001',
          'productId', 'b5600000-0000-4000-8000-000000000001',
          'requestedQuantity', 3000,
          'substitutionPolicy', 'contact'
        ))
      ),
      'b5800000-0000-4000-8000-000000000001'
    )
  $$,
  'Seller crea pedido mediante RPC'
);

select is(
  (select estimated_total_cents from public.orders
   where id = 'b5800000-0000-4000-8000-000000000001'),
  3250::bigint,
  'Servidor recalcula subtotal y tarifa en centimos'
);
select is(
  (select count(*)::bigint from public.order_status_history
   where order_id = 'b5800000-0000-4000-8000-000000000001'),
  1::bigint,
  'Creacion inserta historial received'
);

select lives_ok(
  $$
    select * from public.create_order(
      'b5300000-0000-4000-8000-000000000001',
      'b5400000-0000-4000-8000-000000000001',
      'b5800000-0000-4000-8000-000000000001',
      '{}'::jsonb,
      'b5800000-0000-4000-8000-000000000001'
    )
  $$,
  'Repetir operation_id devuelve pedido existente'
);
select is(
  (select count(*)::bigint from public.orders
   where id = 'b5800000-0000-4000-8000-000000000001'),
  1::bigint,
  'Idempotencia no duplica pedido'
);

select lives_ok(
  $$
    select * from public.transition_order(
      'b5800000-0000-4000-8000-000000000001',
      'b5400000-0000-4000-8000-000000000001',
      'confirmed',
      'Pedido confirmado',
      null,
      'b5c00000-0000-4000-8000-000000000001',
      1
    )
  $$,
  'Seller confirma pedido por la funcion central'
);
select throws_ok(
  $$
    select * from public.transition_order(
      'b5800000-0000-4000-8000-000000000001',
      'b5400000-0000-4000-8000-000000000001',
      'delivered',
      'Salto invalido',
      null,
      'b5c00000-0000-4000-8000-000000000002',
      2
    )
  $$,
  '22023',
  'Transicion de pedido invalida',
  'No permite saltar la maquina de estados'
);
select throws_ok(
  $$
    select * from public.transition_order(
      'b5800000-0000-4000-8000-000000000001',
      'b5400000-0000-4000-8000-000000000001',
      'cancelled',
      'Cancelar',
      null,
      'b5c00000-0000-4000-8000-000000000003',
      2
    )
  $$,
  '42501',
  'Se requiere administrador',
  'Seller no cancela pedidos'
);

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'b5100000-0000-4000-8000-000000000003',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::bigint from public.orders),
  0::bigint,
  'RLS oculta pedidos de otra tienda'
);
select is(
  (select count(*)::bigint from public.customers),
  0::bigint,
  'RLS oculta clientes de otra tienda'
);

reset role;
select * from finish();
rollback;
