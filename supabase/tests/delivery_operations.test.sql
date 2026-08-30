-- pgTAP: despacho propio, seguimiento y operadores externos.
begin;
select plan(12);

select has_table('public','delivery_operators','Existe configuración de operadores');
select has_table('public','delivery_assignments','Existe asignación de reparto');
select has_table('public','delivery_events','Existe cronología de reparto');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.delivery_operators'::regclass),
  'Operadores tiene RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.delivery_assignments'::regclass),
  'Asignaciones tiene RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.delivery_events'::regclass),
  'Eventos tiene RLS'
);
select has_function(
  'public','upsert_delivery_operator',
  array['uuid','uuid','text','text','text','text','text','integer','boolean'],
  'Existe configuración segura de operador'
);
select has_function(
  'public','get_my_delivery_tracking',array['uuid'],
  'Cliente consulta seguimiento'
);
select ok(
  has_function_privilege(
    'authenticated','public.get_my_delivery_tracking(uuid)','EXECUTE'
  ),
  'Cliente autenticado consulta seguimiento'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.upsert_delivery_operator(uuid,uuid,text,text,text,text,text,integer,boolean)',
    'EXECUTE'
  ),
  'Anon no configura operadores'
);
select ok(
  not has_table_privilege('authenticated','public.delivery_assignments','INSERT'),
  'Asignaciones no se insertan directamente'
);
select ok(
  not has_table_privilege('authenticated','public.delivery_events','UPDATE'),
  'Cronología no se altera directamente'
);

select * from finish();
rollback;
