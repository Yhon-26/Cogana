-- Pruebas pgTAP DO-06: zonas de delivery, RLS y sincronizacion.
-- Requiere todas las migraciones hasta DO-06 aplicadas en orden.

begin;

select plan(16);

select has_table('public', 'delivery_zones', 'DO-06 crea delivery_zones');

select ok(
  (
    select c.relrowsecurity
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'delivery_zones'
  ),
  'RLS esta habilitado en delivery_zones'
);

select ok(
  has_table_privilege('authenticated', 'public.delivery_zones', 'SELECT'),
  'authenticated puede consultar zonas'
);

select ok(
  not has_table_privilege('anon', 'public.delivery_zones', 'SELECT'),
  'anon no puede consultar zonas'
);

create or replace function _do06_create_auth_user(
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

select _do06_create_auth_user(
  'a1000000-0000-4000-8000-000000000001',
  'admin-a-do06@cogana.test',
  'Admin A DO06'
);
select _do06_create_auth_user(
  'a1000000-0000-4000-8000-000000000002',
  'seller-a-do06@cogana.test',
  'Seller A DO06'
);
select _do06_create_auth_user(
  'a1000000-0000-4000-8000-000000000003',
  'admin-b-do06@cogana.test',
  'Admin B DO06'
);

insert into public.organizations(id, name)
values
  ('a2000000-0000-4000-8000-000000000001', 'Organizacion A DO06'),
  ('a2000000-0000-4000-8000-000000000002', 'Organizacion B DO06');

insert into public.stores(id, organization_id, code, name)
values
  (
    'a3000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'DO06-A',
    'Tienda A DO06'
  ),
  (
    'a3000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000002',
    'DO06-B',
    'Tienda B DO06'
  );

insert into public.store_memberships(store_id, user_id, role, is_active)
values
  (
    'a3000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'admin',
    true
  ),
  (
    'a3000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'seller',
    true
  ),
  (
    'a3000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000003',
    'admin',
    true
  );

insert into public.devices(id, store_id, name, platform, status, registered_by)
values (
  'a4000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'TPV A DO06',
  'android',
  'authorized',
  'a1000000-0000-4000-8000-000000000001'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'a1000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select lives_ok(
  $$
    insert into public.delivery_zones (
      id, store_id, name, district, fee_cents, minimum_order_cents,
      eta_min_minutes, eta_max_minutes, schedule_text
    ) values (
      'a5000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'Zona directa DO06',
      'Santa Anita',
      700,
      3500,
      30,
      55,
      'Lun-Sab 09:00-18:00'
    )
  $$,
  'Admin puede crear una zona de su tienda'
);

update public.delivery_zones
set fee_cents = 800
where id = 'a5000000-0000-4000-8000-000000000001';

select is(
  (
    select version
    from public.delivery_zones
    where id = 'a5000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'Editar una zona incrementa su version'
);

reset role;
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'a1000000-0000-4000-8000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::bigint from public.delivery_zones),
  1::bigint,
  'Seller puede consultar zonas de su tienda'
);

select is(
  (
    with changed as (
      update public.delivery_zones
      set name = 'Cambio seller'
      where id = 'a5000000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::bigint from changed
  ),
  0::bigint,
  'Seller no puede modificar zonas'
);

select throws_ok(
  $$
    insert into public.delivery_zones (
      store_id, name, district, fee_cents,
      eta_min_minutes, eta_max_minutes, schedule_text
    ) values (
      'a3000000-0000-4000-8000-000000000001',
      'Alta seller',
      'Santa Anita',
      500,
      30,
      45,
      'Todos los dias'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "delivery_zones"',
  'Seller no puede crear zonas'
);

reset role;
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'a1000000-0000-4000-8000-000000000003',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::bigint from public.delivery_zones),
  0::bigint,
  'Un administrador no ve zonas de otra tienda'
);

reset role;
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'a1000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

create temporary table _do06_create_response(response jsonb);
insert into _do06_create_response
select public.process_sync_batch(
  'a3000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  1,
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'operation_id', 'a6000000-0000-4000-8000-000000000001',
      'entity_type', 'delivery_zone',
      'entity_id', 'a5000000-0000-4000-8000-000000000002',
      'operation_type', 'delivery_zone.created',
      'payload', pg_catalog.jsonb_build_object(
        'id', 'a5000000-0000-4000-8000-000000000002',
        'storeId', 'a3000000-0000-4000-8000-000000000001',
        'deviceId', 'a4000000-0000-4000-8000-000000000001',
        'name', 'Zona sincronizada DO06',
        'district', 'Santa Anita',
        'feeCents', 650,
        'minimumOrderCents', 3000,
        'etaMinMinutes', 25,
        'etaMaxMinutes', 45,
        'scheduleText', 'Lun-Sab 09:00-18:00',
        'restrictions', null,
        'isActive', true,
        'expectedVersion', null
      )
    )
  )
);

select is(
  (select response -> 'results' -> 0 ->> 'status' from _do06_create_response),
  'applied',
  'Push crea la zona'
);

select is(
  (
    select count(*)::bigint
    from public.delivery_zones
    where id = 'a5000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'La zona push queda persistida'
);

select ok(
  exists (
    select 1
    from public.change_log
    where entity_type = 'delivery_zone'
      and entity_id = 'a5000000-0000-4000-8000-000000000002'
      and payload ->> 'fee_cents' = '650'
  ),
  'La zona se publica para pull'
);

select is(
  (
    select public.process_sync_batch(
      'a3000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000001',
      1,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'operation_id', 'a6000000-0000-4000-8000-000000000001',
          'entity_type', 'delivery_zone',
          'entity_id', 'a5000000-0000-4000-8000-000000000002',
          'operation_type', 'delivery_zone.created',
          'payload', pg_catalog.jsonb_build_object(
            'id', 'a5000000-0000-4000-8000-000000000002',
            'storeId', 'a3000000-0000-4000-8000-000000000001',
            'deviceId', 'a4000000-0000-4000-8000-000000000001',
            'name', 'Zona sincronizada DO06',
            'district', 'Santa Anita',
            'feeCents', 650,
            'minimumOrderCents', 3000,
            'etaMinMinutes', 25,
            'etaMaxMinutes', 45,
            'scheduleText', 'Lun-Sab 09:00-18:00',
            'restrictions', null,
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

create temporary table _do06_update_response(response jsonb);
insert into _do06_update_response
select public.process_sync_batch(
  'a3000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  1,
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'operation_id', 'a6000000-0000-4000-8000-000000000002',
      'entity_type', 'delivery_zone',
      'entity_id', 'a5000000-0000-4000-8000-000000000002',
      'operation_type', 'delivery_zone.updated',
      'payload', pg_catalog.jsonb_build_object(
        'id', 'a5000000-0000-4000-8000-000000000002',
        'storeId', 'a3000000-0000-4000-8000-000000000001',
        'deviceId', 'a4000000-0000-4000-8000-000000000001',
        'name', 'Zona sincronizada ampliada',
        'district', 'Santa Anita',
        'feeCents', 750,
        'minimumOrderCents', 3000,
        'etaMinMinutes', 25,
        'etaMaxMinutes', 50,
        'scheduleText', 'Lun-Dom 09:00-19:00',
        'restrictions', null,
        'isActive', true,
        'expectedVersion', 1
      )
    )
  )
);

select is(
  (select response -> 'results' -> 0 ->> 'status' from _do06_update_response),
  'applied',
  'Push actualiza la zona con su version esperada'
);

select results_eq(
  $$
    select name, fee_cents, version
    from public.delivery_zones
    where id = 'a5000000-0000-4000-8000-000000000002'
  $$,
  $$
    values (
      'Zona sincronizada ampliada'::text,
      750::bigint,
      2::bigint
    )
  $$,
  'La actualizacion sincronizada conserva datos y version'
);

reset role;
select * from finish();
rollback;
