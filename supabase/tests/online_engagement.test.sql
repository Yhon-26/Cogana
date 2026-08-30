-- pgTAP: estructura y privilegios de favoritos/preferencias/promociones.
begin;
select plan(9);

select has_table('public', 'customer_favorites', 'Existe favoritos');
select has_table('public', 'customer_preferences', 'Existe preferencias');
select has_table('public', 'promotions', 'Existe promociones');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.customer_favorites'::regclass),
  'Favoritos tiene RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.customer_preferences'::regclass),
  'Preferencias tiene RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.promotions'::regclass),
  'Promociones tiene RLS'
);
select has_function(
  'public', 'get_my_online_preferences', array['uuid'],
  'Existe consulta consolidada'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.set_favorite_product(uuid,uuid,boolean)',
    'EXECUTE'
  ),
  'Cliente autenticado puede marcar favoritos'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.update_my_online_preferences(uuid,boolean,boolean,boolean)',
    'EXECUTE'
  ),
  'Anon no modifica preferencias'
);

select * from finish();
rollback;
