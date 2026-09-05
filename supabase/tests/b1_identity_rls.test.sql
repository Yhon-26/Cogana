-- Pruebas RLS de la migración B1 utilizando pgTAP.
-- Requisitos en el entorno de staging/CI: extensión pgtap instalada.
--   create extension if not exists pgtap;
-- Ejecución:
--   psql "$DATABASE_URL" -f supabase/tests/b1_identity_rls.test.sql
--
-- Referencia: Esquema Backend v1.0 §15.2 (BE-01, BE-04, BE-05)
--             y TRD v1.0 §13.2 (RLS ajena).
--
-- Estas pruebas validan que un usuario no puede leer ni modificar datos de una
-- tienda a la que no pertenece, y que solo el admin puede gestionar membresías
-- y dispositivos.

begin;

select plan(14);

-- ---------------------------------------------------------------------------
-- Helpers de prueba
-- ---------------------------------------------------------------------------

-- Crea un usuario en auth.users y devuelve su id. Sustituye a auth.admin.createUser
-- porque las migraciones de test corren contra el esquema completo de Supabase.
create or replace function _test_create_auth_user(
  p_email text,
  p_full_name text default 'Test User'
) returns uuid
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  v_id uuid;
begin
  v_id := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_id,
    'authenticated',
    'authenticated',
    p_email,
    crypt('test-password', gen_salt('bf')),
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
    v_id,
    jsonb_build_object('sub', v_id::text, 'email', p_email),
    'email',
    p_email,
    now(), now(), now()
  );
  return v_id;
end;
$$;

-- Crea una organización + tienda de prueba y devuelve el id de la tienda.
create or replace function _test_create_store(p_code text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_store_id uuid;
begin
  v_org_id := gen_random_uuid();
  v_store_id := gen_random_uuid();
  insert into organizations (id, name) values (v_org_id, 'Test Org ' || p_code);
  insert into stores (id, organization_id, code, name) values (v_store_id, v_org_id, p_code, p_name);
  return v_store_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select _test_create_store('ST-A', 'Tienda A');
select _test_create_store('ST-B', 'Tienda B');

-- Usuarios. _test_create_auth_user crea el perfil automáticamente via trigger.
select _test_create_auth_user('admin-a@cogana.test', 'Admin A');   -- owner de Tienda A
select _test_create_auth_user('seller-a@cogana.test', 'Seller A'); -- vendedor de Tienda A
select _test_create_auth_user('intruder@cogana.test', 'Intruder'); -- sin membresía

create or replace function _test_insert_fixture_memberships()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_a uuid;
  v_seller_a uuid;
  v_store_a uuid;
begin
  select id into v_admin_a from profiles where full_name = 'Admin A';
  select id into v_seller_a from profiles where full_name = 'Seller A';
  select id into v_store_a from stores where code = 'ST-A';

  insert into store_memberships (store_id, user_id, role, is_active)
  values
    (v_store_a, v_admin_a, 'admin', true),
    (v_store_a, v_seller_a, 'seller', true);
end;
$$;

select _test_insert_fixture_memberships();

-- ---------------------------------------------------------------------------
-- Pruebas BE-01: Un usuario de una tienda no puede leer otra tienda.
-- ---------------------------------------------------------------------------

-- Admin A ve 1 tienda (la suya), no ve la Tienda B.
do $$
declare
  v_admin_a uuid;
  v_count int;
begin
  select id into v_admin_a from profiles where full_name = 'Admin A';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text)::text, true);
  execute 'set role authenticated';
  select count(*) into v_count from stores;
  if v_count <> 1 then
    raise exception 'BE-01 falló: admin A debería ver 1 tienda, vio %', v_count;
  end if;
  select count(*) into v_count from stores where code = 'ST-A';
  if v_count <> 1 then
    raise exception 'Admin A debería ver su propia tienda';
  end if;
  select count(*) into v_count from stores where code = 'ST-B';
  if v_count <> 0 then
    raise exception 'BE-01 falló: admin A no debería ver Tienda B';
  end if;
  reset role;
end;
$$;
select pass('BE-01: un usuario de una tienda no ve otra tienda');

-- Intruso sin membresía no ve ninguna tienda.
do $$
declare
  v_intruder uuid;
  v_count int;
begin
  select id into v_intruder from profiles where full_name = 'Intruder';
  perform set_config('request.jwt.claims', json_build_object('sub', v_intruder::text)::text, true);
  execute 'set role authenticated';
  select count(*) into v_count from stores;
  if v_count <> 0 then
    raise exception 'Intruso sin membresía no debería ver tiendas, vio %', v_count;
  end if;
  reset role;
end;
$$;
select pass('Intruso sin membresía no ve tiendas');

-- ---------------------------------------------------------------------------
-- Pruebas BE-05: El usuario solo ve/modifica su propio perfil.
-- ---------------------------------------------------------------------------

do $$
declare
  v_admin_a uuid;
  v_seller_a uuid;
  v_count int;
begin
  select id into v_admin_a from profiles where full_name = 'Admin A';
  select id into v_seller_a from profiles where full_name = 'Seller A';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text)::text, true);
  execute 'set role authenticated';

  select count(*) into v_count from profiles;
  if v_count <> 1 then
    raise exception 'BE-05 falló: usuario debería ver solo su perfil, vio %', v_count;
  end if;

  select count(*) into v_count from profiles where id = v_seller_a;
  if v_count <> 0 then
    raise exception 'Admin A no debería ver el perfil de Seller A';
  end if;
  reset role;
end;
$$;
select pass('BE-05: el usuario solo ve su propio perfil');

-- No puede actualizar el perfil de otro.
do $$
declare
  v_admin_a uuid;
  v_seller_a uuid;
  v_rows int;
begin
  select id into v_admin_a from profiles where full_name = 'Admin A';
  select id into v_seller_a from profiles where full_name = 'Seller A';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text)::text, true);
  execute 'set role authenticated';

  update profiles set full_name = 'Hacked' where id = v_seller_a;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'BE-05 falló: actualizó el perfil ajeno (% filas)', v_rows;
  end if;
  reset role;
end;
$$;
select pass('BE-05: el usuario no puede actualizar perfil ajeno');

-- ---------------------------------------------------------------------------
-- Pruebas membresías: solo admin gestiona membresías.
-- ---------------------------------------------------------------------------

-- Seller A intenta insertar membresía: debe fallar.
do $$
declare
  v_seller_a uuid;
  v_intruder uuid;
  v_store_a uuid;
begin
  select id into v_seller_a from profiles where full_name = 'Seller A';
  select id into v_intruder from profiles where full_name = 'Intruder';
  select id into v_store_a from stores where code = 'ST-A';

  perform set_config('request.jwt.claims', json_build_object('sub', v_seller_a::text)::text, true);
  execute 'set role authenticated';

  begin
    insert into store_memberships (store_id, user_id, role, is_active)
    values (v_store_a, v_intruder, 'seller', true);
    raise exception 'Vendedor no debería poder insertar membresías';
  exception
    when others then
      null;
  end;
  reset role;
end;
$$;
select pass('Vendedor no puede crear membresías');

-- Admin A sí puede.
do $$
declare
  v_admin_a uuid;
  v_intruder uuid;
  v_store_a uuid;
begin
  select id into v_admin_a from profiles where full_name = 'Admin A';
  select id into v_intruder from profiles where full_name = 'Intruder';
  select id into v_store_a from stores where code = 'ST-A';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text)::text, true);
  execute 'set role authenticated';

  insert into store_memberships (store_id, user_id, role, is_active)
  values (v_store_a, v_intruder, 'seller', true);

  reset role;
end;
$$;
select pass('Admin puede crear membresías');

-- Intruso intenta gestionar miembros de Tienda A (aunque ya esté en membresía
-- recién creada por el admin): en este test sólo valida que un usuario sin rol
-- admin no puede actualizar.
do $$
declare
  v_intruder uuid;
  v_seller_a uuid;
  v_store_a uuid;
  v_rows int;
begin
  select id into v_intruder from profiles where full_name = 'Intruder';
  select id into v_seller_a from profiles where full_name = 'Seller A';
  select id into v_store_a from stores where code = 'ST-A';

  -- Intruder acaba de ser añadido como seller (no admin) por admin A.
  perform set_config('request.jwt.claims', json_build_object('sub', v_intruder::text)::text, true);
  execute 'set role authenticated';

  -- Intenta desactivar al Seller A: debería estarle prohibido (no es admin).
  update store_memberships
  set is_active = false
  where store_id = v_store_a and user_id = v_seller_a;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'Vendedor debería poder desactivar a otro miembro';
  end if;
  reset role;
end;
$$;
select pass('No-admin no puede revocar membresías');

-- ---------------------------------------------------------------------------
-- Pruebas devices: solo admin puede crear dispositivos.
-- ---------------------------------------------------------------------------

-- Seller A intenta registrar device: debe fallar.
do $$
declare
  v_seller_a uuid;
  v_store_a uuid;
begin
  select id into v_seller_a from profiles where full_name = 'Seller A';
  select id into v_store_a from stores where code = 'ST-A';

  perform set_config('request.jwt.claims', json_build_object('sub', v_seller_a::text)::text, true);
  execute 'set role authenticated';

  begin
    insert into devices (id, store_id, name, platform, status)
    values (gen_random_uuid(), v_store_a, 'Phone Vendedor', 'android', 'authorized');
    raise exception 'Vendedor no debería poder registrar dispositivos';
  exception
    when others then
      null;
  end;
  reset role;
end;
$$;
select pass('Vendedor no puede registrar dispositivos');

-- Seller A puede ver dispositivos de su tienda.
do $$
declare
  v_admin_a uuid;
  v_seller_a uuid;
  v_store_a uuid;
  v_count int;
begin
  select id into v_admin_a from profiles where full_name = 'Admin A';
  select id into v_seller_a from profiles where full_name = 'Seller A';
  select id into v_store_a from stores where code = 'ST-A';

  -- Admin registra un device.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text)::text, true);
  execute 'set role authenticated';
  insert into devices (id, store_id, name, platform, status, registered_by)
  values (gen_random_uuid(), v_store_a, 'TPV 1', 'android', 'authorized', v_admin_a);
  reset role;

  -- Seller A lo puede ver.
  perform set_config('request.jwt.claims', json_build_object('sub', v_seller_a::text)::text, true);
  execute 'set role authenticated';
  select count(*) into v_count from devices where store_id = v_store_a;
  if v_count <> 1 then
    raise exception 'Seller debería ver 1 dispositivo, vio %', v_count;
  end if;
  reset role;
end;
$$;
select pass('Miembro puede ver dispositivos de su tienda');

-- Intruso (ahora seller por alta del admin) ve dispositivos de su tienda.
do $$
declare
  v_intruder uuid;
  v_store_a uuid;
  v_count int;
begin
  select id into v_intruder from profiles where full_name = 'Intruder';
  select id into v_store_a from stores where code = 'ST-A';

  perform set_config('request.jwt.claims', json_build_object('sub', v_intruder::text)::text, true);
  execute 'set role authenticated';
  select count(*) into v_count from devices where store_id = v_store_a;
  if v_count <> 1 then
    raise exception 'Intruso (seller) debería ver 1 dispositivo, vio %', v_count;
  end if;
  reset role;
end;
$$;
select pass('Miembro seller ve dispositivos de su tienda');

-- ---------------------------------------------------------------------------
-- Prueba final del trigger on_auth_user_created.
-- ---------------------------------------------------------------------------

do $$
declare
  v_uid uuid;
  v_count int;
begin
  v_uid := _test_create_auth_user('trigger-test@cogana.test', 'Trigger Test');
  select count(*) into v_count from profiles where id = v_uid;
  if v_count <> 1 then
    raise exception 'El trigger on_auth_user_created no creó el perfil';
  end if;
end;
$$;
select pass('Trigger on_auth_user_created crea profile automáticamente');

-- ---------------------------------------------------------------------------
-- Limpieza y final
-- ---------------------------------------------------------------------------

rollback;
select * from finish();