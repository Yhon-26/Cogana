-- Pruebas pgTAP DT-01: proveedores, RLS y sincronizacion.
-- Requiere migraciones B1-B4, DO-04 y DT-01 aplicadas en orden.

begin;

select plan(17);

select has_table('public', 'suppliers', 'DT-01 crea suppliers');

select ok(
  (
    select c.relrowsecurity
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'suppliers'
  ),
  'RLS esta habilitado en suppliers'
);

select ok(
  has_table_privilege('authenticated', 'public.suppliers', 'SELECT'),
  'authenticated puede consultar suppliers'
);

select ok(
  not has_table_privilege('anon', 'public.suppliers', 'SELECT'),
  'anon no puede consultar suppliers'
);

create or replace function _dt01_create_auth_user(
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

select _dt01_create_auth_user(
  '91000000-0000-4000-8000-000000000001',
  'admin-a-dt01@cogana.test',
  'Admin A DT01'
);
select _dt01_create_auth_user(
  '91000000-0000-4000-8000-000000000002',
  'seller-a-dt01@cogana.test',
  'Seller A DT01'
);
select _dt01_create_auth_user(
  '91000000-0000-4000-8000-000000000003',
  'admin-b-dt01@cogana.test',
  'Admin B DT01'
);

insert into public.organizations(id, name)
values
  ('92000000-0000-4000-8000-000000000001', 'Organizacion A DT01'),
  ('92000000-0000-4000-8000-000000000002', 'Organizacion B DT01');

insert into public.stores(id, organization_id, code, name)
values
  (
    '93000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'DT01-A',
    'Tienda A DT01'
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000002',
    'DT01-B',
    'Tienda B DT01'
  );

insert into public.store_memberships(store_id, user_id, role, is_active)
values
  (
    '93000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'admin',
    true
  ),
  (
    '93000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000002',
    'seller',
    true
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000003',
    'admin',
    true
  );

insert into public.devices(id, store_id, name, platform, status, registered_by)
values
  (
    '94000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    'TPV A DT01',
    'android',
    'authorized',
    '91000000-0000-4000-8000-000000000001'
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000002',
    'TPV B DT01',
    'android',
    'authorized',
    '91000000-0000-4000-8000-000000000003'
  );

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select lives_ok(
  $$
    insert into public.suppliers (
      id, store_id, name, tax_id, contact_name
    ) values (
      '95000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'Proveedor directo DT01',
      '20123456789',
      'Contacto directo'
    )
  $$,
  'Admin puede crear un proveedor de su tienda'
);

select is(
  (
    select created_by
    from public.suppliers
    where id = '95000000-0000-4000-8000-000000000001'
  ),
  '91000000-0000-4000-8000-000000000001'::uuid,
  'La autoria se toma de auth.uid'
);

update public.suppliers
set phone = '999111222'
where id = '95000000-0000-4000-8000-000000000001';

select is(
  (
    select version
    from public.suppliers
    where id = '95000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'Editar un proveedor incrementa su version'
);

reset role;
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::bigint from public.suppliers),
  1::bigint,
  'Seller puede consultar proveedores de su tienda'
);

select is(
  (
    with changed as (
      update public.suppliers
      set name = 'Cambio seller'
      where id = '95000000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::bigint from changed
  ),
  0::bigint,
  'Seller no puede modificar proveedores'
);

select throws_ok(
  $$
    insert into public.suppliers (store_id, name)
    values (
      '93000000-0000-4000-8000-000000000001',
      'Alta seller'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "suppliers"',
  'Seller no puede crear proveedores'
);

reset role;
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000003',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::bigint from public.suppliers),
  0::bigint,
  'Un administrador no ve proveedores de otra tienda'
);

reset role;
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

create temporary table _dt01_create_response(response jsonb);
insert into _dt01_create_response
select public.process_sync_batch(
  '93000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  1,
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'operation_id', '96000000-0000-4000-8000-000000000001',
      'entity_type', 'supplier',
      'entity_id', '95000000-0000-4000-8000-000000000002',
      'operation_type', 'supplier.created',
      'payload', pg_catalog.jsonb_build_object(
        'id', '95000000-0000-4000-8000-000000000002',
        'storeId', '93000000-0000-4000-8000-000000000001',
        'deviceId', '94000000-0000-4000-8000-000000000001',
        'name', 'Proveedor sincronizado DT01',
        'taxId', '20987654321',
        'contactName', 'Contacto sync',
        'phone', null,
        'email', 'sync@proveedor.pe',
        'address', null,
        'notes', null,
        'isActive', true,
        'expectedVersion', null
      )
    )
  )
);

select is(
  (select response -> 'results' -> 0 ->> 'status' from _dt01_create_response),
  'applied',
  'Push crea el proveedor'
);

select is(
  (
    select count(*)::bigint
    from public.suppliers
    where id = '95000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'El proveedor push queda persistido'
);

select ok(
  exists (
    select 1
    from public.change_log
    where entity_type = 'supplier'
      and entity_id = '95000000-0000-4000-8000-000000000002'
      and payload ->> 'tax_id' = '20987654321'
  ),
  'El proveedor se publica para pull'
);

select is(
  (
    select public.process_sync_batch(
      '93000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      1,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'operation_id', '96000000-0000-4000-8000-000000000001',
          'entity_type', 'supplier',
          'entity_id', '95000000-0000-4000-8000-000000000002',
          'operation_type', 'supplier.created',
          'payload', pg_catalog.jsonb_build_object(
            'id', '95000000-0000-4000-8000-000000000002',
            'storeId', '93000000-0000-4000-8000-000000000001',
            'deviceId', '94000000-0000-4000-8000-000000000001',
            'name', 'Proveedor sincronizado DT01',
            'taxId', '20987654321',
            'contactName', 'Contacto sync',
            'phone', null,
            'email', 'sync@proveedor.pe',
            'address', null,
            'notes', null,
            'isActive', true,
            'expectedVersion', null
          )
        )
      )
    ) -> 'results' -> 0 ->> 'status'
  ),
  'duplicate',
  'Repetir el alta devuelve duplicate'
);

create temporary table _dt01_update_response(response jsonb);
insert into _dt01_update_response
select public.process_sync_batch(
  '93000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  1,
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'operation_id', '96000000-0000-4000-8000-000000000002',
      'entity_type', 'supplier',
      'entity_id', '95000000-0000-4000-8000-000000000002',
      'operation_type', 'supplier.updated',
      'payload', pg_catalog.jsonb_build_object(
        'id', '95000000-0000-4000-8000-000000000002',
        'storeId', '93000000-0000-4000-8000-000000000001',
        'deviceId', '94000000-0000-4000-8000-000000000001',
        'name', 'Proveedor sincronizado editado',
        'taxId', '20987654321',
        'contactName', 'Contacto sync',
        'phone', '955000000',
        'email', 'sync@proveedor.pe',
        'address', null,
        'notes', null,
        'isActive', true,
        'expectedVersion', 1
      )
    )
  )
);

select is(
  (select response -> 'results' -> 0 ->> 'status' from _dt01_update_response),
  'applied',
  'Push actualiza el proveedor con su version esperada'
);

select results_eq(
  $$
    select name, version
    from public.suppliers
    where id = '95000000-0000-4000-8000-000000000002'
  $$,
  $$ values ('Proveedor sincronizado editado'::text, 2::bigint) $$,
  'La actualizacion sincronizada conserva nombre y version'
);

reset role;
select * from finish();
rollback;
