-- pgTAP: catálogo, checkout y pedidos del cliente minorista.
begin;

select plan(10);

select has_column('public', 'orders', 'payment_method', 'Pedidos conserva medio de pago');
select has_function('public', 'get_online_catalog', array['uuid', 'text'], 'Existe RPC de catálogo online');
select has_function(
  'public',
  'create_online_order',
  array['uuid','uuid','uuid','text','uuid','jsonb','jsonb','text','text','text'],
  'Existe checkout online'
);
select ok(
  not has_function_privilege('anon', 'public.get_online_catalog(uuid,text)', 'EXECUTE'),
  'anon no consulta catálogo privado'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'e1100000-0000-4000-8000-000000000001',
  'authenticated','authenticated','online@coguana.test','hash',now(),
  '{}'::jsonb,'{"full_name":"Cliente Online"}'::jsonb,now(),now()
);
insert into auth.identities(id,user_id,identity_data,provider,provider_id,last_sign_in_at,created_at,updated_at)
values (
  gen_random_uuid(),'e1100000-0000-4000-8000-000000000001',
  '{"sub":"e1100000-0000-4000-8000-000000000001","email":"online@coguana.test"}',
  'email','online@coguana.test',now(),now(),now()
);
insert into public.organizations(id,name)
values ('e1200000-0000-4000-8000-000000000001','Org Online');
insert into public.stores(id,organization_id,code,name)
values (
  'e1300000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001','ONLINE','Tienda Online'
);
insert into public.categories(id,organization_id,name,slug)
values (
  'e1400000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001','Arroces','arroces-online'
);
insert into public.products(
  id,store_id,sku,name,category_id,base_unit,pricing_quantity,
  price_cents,cost_cents,stock_quantity,minimum_stock_quantity
) values (
  'e1500000-0000-4000-8000-000000000001',
  'e1300000-0000-4000-8000-000000000001','ARR-ON','Arroz Online',
  'e1400000-0000-4000-8000-000000000001','gram',1000,525,400,50000,5000
);
insert into public.customers(
  id,store_id,auth_user_id,customer_type,name,phone,email,status
) values (
  'e1600000-0000-4000-8000-000000000001',
  'e1300000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001','retail','Cliente Online',
  '999111222','online@coguana.test','active'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e1100000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  jsonb_array_length(public.get_online_catalog(
    'e1300000-0000-4000-8000-000000000001', null
  ) -> 'products'),
  1,
  'Cliente recibe producto disponible'
);
select lives_ok(
  $$
    select public.create_online_order(
      'e1300000-0000-4000-8000-000000000001',
      'e1700000-0000-4000-8000-000000000001',
      'e1800000-0000-4000-8000-000000000001',
      'pickup',null,null,
      '[{"id":"e1900000-0000-4000-8000-000000000001","productId":"e1500000-0000-4000-8000-000000000001","quantity":500,"substitutionPolicy":"contact"}]'::jsonb,
      'cash',null,null
    )
  $$,
  'Cliente crea pedido para recojo'
);
select is(
  (
    select estimated_total_cents from public.orders
    where id = 'e1700000-0000-4000-8000-000000000001'
  ),
  263::bigint,
  'Checkout redondea mitad hacia arriba con enteros'
);
select is(
  jsonb_array_length(public.get_my_online_orders(
    'e1300000-0000-4000-8000-000000000001'
  )),
  1,
  'Cliente consulta su pedido'
);
select lives_ok(
  $$
    select public.cancel_my_online_order(
      'e1300000-0000-4000-8000-000000000001',
      'e1700000-0000-4000-8000-000000000001',
      'e1800000-0000-4000-8000-000000000002',
      'Cambio de planes'
    )
  $$,
  'Cliente cancela pedido recibido'
);
select is(
  (
    select status from public.orders
    where id = 'e1700000-0000-4000-8000-000000000001'
  ),
  'cancelled',
  'Cancelación actualiza el estado'
);

reset role;
select * from finish();
rollback;
