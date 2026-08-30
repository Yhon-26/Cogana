begin;
select plan(8);

select has_function(
  'public',
  'get_organization_stores',
  array['uuid'],
  'Lista las sucursales de la organización'
);
select has_function(
  'public',
  'save_store_branch',
  array['uuid','uuid','text','text','text','text','text'],
  'Crea o edita una sucursal'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.get_organization_stores(uuid)',
    'EXECUTE'
  ),
  'Administrador autenticado puede listar'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.get_organization_stores(uuid)',
    'EXECUTE'
  ),
  'Anon no puede listar'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.save_store_branch(uuid,uuid,text,text,text,text,text)',
    'EXECUTE'
  ),
  'Propietario autenticado usa el RPC de guardado'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.save_store_branch(uuid,uuid,text,text,text,text,text)',
    'EXECUTE'
  ),
  'Anon no puede guardar'
);
select ok(
  not has_table_privilege('authenticated','public.stores','INSERT'),
  'No existe alta directa de stores'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.stores'::regclass),
  'Stores conserva RLS'
);

select * from finish();
rollback;
