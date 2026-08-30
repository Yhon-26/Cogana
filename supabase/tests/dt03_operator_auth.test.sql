-- Pruebas pgTAP DT-03: sesion individual Supabase + PIN exclusivamente local.
-- Requiere todas las migraciones hasta DT-03 aplicadas en orden.

begin;

select plan(7);

select has_function(
  'public',
  'get_my_operator_context',
  array['uuid'],
  'DT-03 crea el RPC de contexto individual'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_my_operator_context(uuid)',
    'EXECUTE'
  ),
  'authenticated puede consultar su contexto'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_my_operator_context(uuid)',
    'EXECUTE'
  ),
  'anon no puede ejecutar el RPC'
);

select hasnt_column(
  'public',
  'profiles',
  'pin_hash',
  'El backend no almacena hash de PIN local'
);

create or replace function _dt03_create_auth_user(
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
    pg_catalog.jsonb_build_object(),
    pg_catalog.jsonb_build_object('full_name', p_full_name),
    now(),
    now()
  );

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    p_id,
    pg_catalog.jsonb_build_object('sub', p_id::text, 'email', p_email),
    'email',
    p_email,
    now(),
    now(),
    now()
  );
end;
$$;

select _dt03_create_auth_user(
  'b1000000-0000-4000-8000-000000000001',
  'seller-dt03@coguana.test',
  'Seller DT03'
);
select _dt03_create_auth_user(
  'b1000000-0000-4000-8000-000000000002',
  'outsider-dt03@coguana.test',
  'Outsider DT03'
);

insert into public.organizations(id, name)
values ('b2000000-0000-4000-8000-000000000001', 'Organizacion DT03');

insert into public.stores(id, organization_id, code, name)
values (
  'b3000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'DT03-A',
  'Tienda DT03'
);

insert into public.store_memberships(store_id, user_id, role, is_active)
values (
  'b3000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'seller',
  true
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'b1000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select is(
  (
    select auth_user_id
    from public.get_my_operator_context(
      'b3000000-0000-4000-8000-000000000001'
    )
  ),
  'b1000000-0000-4000-8000-000000000001'::uuid,
  'El RPC devuelve solo la identidad autenticada'
);

select is(
  (
    select store_role
    from public.get_my_operator_context(
      'b3000000-0000-4000-8000-000000000001'
    )
  ),
  'seller'::text,
  'El RPC devuelve el rol activo de tienda'
);

reset role;
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'b1000000-0000-4000-8000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select throws_ok(
  $$
    select *
    from public.get_my_operator_context(
      'b3000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'La cuenta no tiene acceso activo a la tienda',
  'Una cuenta ajena no obtiene contexto de tienda'
);

reset role;
select * from finish();
rollback;
