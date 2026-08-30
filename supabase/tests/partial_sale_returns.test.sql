begin;
select plan(10);

select has_table('public','sale_returns','Existen devoluciones parciales');
select has_table('public','sale_return_items','Existen ítems devueltos');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.sale_returns'::regclass),
  'Devoluciones tiene RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.sale_return_items'::regclass),
  'Ítems devueltos tiene RLS'
);
select ok(
  not has_table_privilege('authenticated','public.sale_returns','INSERT'),
  'No hay inserción directa'
);
select ok(
  not has_table_privilege('anon','public.sale_returns','SELECT'),
  'Anon no consulta devoluciones'
);
select has_function(
  'private','apply_sale_return_sync',
  array['uuid','uuid','uuid','uuid','uuid','jsonb'],
  'Existe aplicación transaccional de devolución'
);
select has_function(
  'private','sale_return_change_payload',array['uuid'],
  'Existe payload incremental'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.apply_sale_return_sync(uuid,uuid,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'El helper no se expone'
);
select trigger_is(
  'public','sales','sales_05_prevent_void_after_partial_return',
  'private','prevent_void_after_partial_return',
  'No se anula completa una venta con devolución'
);

select * from finish();
rollback;
