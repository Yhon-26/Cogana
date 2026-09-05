-- pgTAP: alta y vinculación de cuentas minoristas.
begin;

select plan(8);

select has_function(
  'public',
  'claim_customer_account',
  array['uuid', 'text', 'text', 'text'],
  'Existe RPC de perfil de cliente'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.claim_customer_account(uuid,text,text,text)',
    'EXECUTE'
  ),
  'authenticated puede reclamar su perfil'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.claim_customer_account(uuid,text,text,text)',
    'EXECUTE'
  ),
  'anon no ejecuta el RPC'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'c1100000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'cliente-claim@cogana.test',
  'test-password-hash',
  now(),
  '{}'::jsonb,
  '{"account_type":"customer","full_name":"Cliente Claim","phone":"999 888 777"}'::jsonb,
  now(),
  now()
);
insert into auth.identities (
  id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  'c1100000-0000-4000-8000-000000000001',
  '{"sub":"c1100000-0000-4000-8000-000000000001","email":"cliente-claim@cogana.test"}'::jsonb,
  'email',
  'cliente-claim@cogana.test',
  now(),
  now(),
  now()
);
insert into public.organizations(id, name)
values ('c1200000-0000-4000-8000-000000000001', 'Organizacion Claim');
insert into public.stores(id, organization_id, code, name)
values (
  'c1300000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001',
  'CLAIM',
  'Tienda Claim'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'c1100000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'user_metadata', jsonb_build_object('account_type', 'customer')
  )::text,
  true
);
set local role authenticated;

select lives_ok(
  $$
    select * from public.claim_customer_account(
      'c1300000-0000-4000-8000-000000000001',
      'Cliente Claim',
      '999 888 777',
      'CLIENTE-CLAIM@COGANA.TEST'
    )
  $$,
  'Cliente crea su perfil'
);
select is(
  (
    select phone from public.customers
    where auth_user_id = 'c1100000-0000-4000-8000-000000000001'
  ),
  '999888777',
  'Normaliza el teléfono'
);
select is(
  (
    select email from public.customers
    where auth_user_id = 'c1100000-0000-4000-8000-000000000001'
  ),
  'cliente-claim@cogana.test',
  'Normaliza el correo'
);
select lives_ok(
  $$
    select * from public.claim_customer_account(
      'c1300000-0000-4000-8000-000000000001',
      null,
      null,
      'cliente-claim@cogana.test'
    )
  $$,
  'Repetir el RPC reutiliza el perfil'
);
select is(
  (select count(*)::bigint from public.customers),
  1::bigint,
  'No duplica clientes'
);

reset role;
select * from finish();
rollback;
