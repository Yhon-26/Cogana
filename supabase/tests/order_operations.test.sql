-- pgTAP: planificacion, incidencias y sustituciones de pedidos E4.
begin;
select plan(12);

select has_column('public', 'orders', 'scheduled_for', 'Pedido puede programarse');
select has_column('public', 'orders', 'assigned_user_id', 'Pedido puede asignarse');
select has_table('public', 'order_incidents', 'Existe tabla de incidencias');
select has_table('public', 'order_substitutions', 'Existe tabla de sustituciones');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.order_incidents'::regclass),
  'Incidencias tiene RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.order_substitutions'::regclass),
  'Sustituciones tiene RLS'
);
select has_function(
  'public', 'get_my_order_substitutions', array['uuid'],
  'Existe consulta de sustituciones del cliente'
);
select has_function(
  'public', 'decide_my_order_substitution',
  array['uuid','uuid','uuid','boolean'],
  'Existe decision de sustitucion'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.get_my_order_substitutions(uuid)',
    'EXECUTE'
  ),
  'Cliente autenticado consulta sus sustituciones'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.decide_my_order_substitution(uuid,uuid,uuid,boolean)',
    'EXECUTE'
  ),
  'Anon no responde sustituciones'
);
select ok(
  not has_table_privilege('authenticated', 'public.order_incidents', 'INSERT'),
  'Cliente no inserta incidencias directamente'
);
select ok(
  not has_table_privilege('authenticated', 'public.order_substitutions', 'UPDATE'),
  'Cliente no actualiza sustituciones fuera del RPC'
);

select * from finish();
rollback;
