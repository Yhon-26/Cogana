-- pgTAP: compras, lotes y conteos físicos.
begin;
select plan(16);

select has_table('public','purchase_orders','Existen órdenes de compra');
select has_table('public','purchase_order_items','Existen ítems de compra');
select has_table('public','inventory_lots','Existe trazabilidad por lote');
select has_table('public','physical_counts','Existen conteos físicos');
select has_table('public','physical_count_items','Existen líneas de conteo');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.purchase_orders'::regclass),
  'Órdenes tiene RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.purchase_order_items'::regclass),
  'Ítems de compra tiene RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.inventory_lots'::regclass),
  'Lotes tiene RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.physical_counts'::regclass),
  'Conteos tiene RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.physical_count_items'::regclass),
  'Ítems de conteo tiene RLS'
);
select ok(
  not has_table_privilege('authenticated','public.purchase_orders','INSERT'),
  'Authenticated no inserta órdenes directamente'
);
select ok(
  not has_table_privilege('authenticated','public.inventory_lots','UPDATE'),
  'Authenticated no altera lotes directamente'
);
select ok(
  not has_table_privilege('anon','public.physical_counts','SELECT'),
  'Anon no consulta conteos'
);
select has_function(
  'private','apply_procurement_operation_sync',
  array['uuid','uuid','uuid','uuid','uuid','text','jsonb'],
  'Existe aplicación privada de operaciones de compras'
);
select has_function(
  'private','purchase_order_change_payload',array['uuid'],
  'Existe payload de pull para compras'
);
select has_function(
  'private','physical_count_change_payload',array['uuid'],
  'Existe payload de pull para conteos'
);

select * from finish();
rollback;
