begin;
select plan(6);
select has_function('public','get_store_promotions',array['uuid'],'Lista promociones');
select has_function(
  'public','upsert_store_promotion',
  array['uuid','uuid','text','text','text','timestamp with time zone','timestamp with time zone','boolean','bigint'],
  'Guarda promociones'
);
select ok(has_function_privilege('authenticated','public.get_store_promotions(uuid)','EXECUTE'),'Admin autenticado usa RPC');
select ok(not has_function_privilege('anon','public.get_store_promotions(uuid)','EXECUTE'),'Anon no usa RPC');
select ok(not has_table_privilege('authenticated','public.promotions','INSERT'),'Sin inserción directa');
select ok((select relrowsecurity from pg_class where oid = 'public.promotions'::regclass),'Promociones conserva RLS');
select * from finish();
rollback;
