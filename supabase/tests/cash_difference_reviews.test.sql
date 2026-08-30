begin;
select plan(7);

select has_table('public','cash_difference_reviews','Existe revisión de caja');
select has_column(
  'public','cash_difference_reviews','decision','Registra decisión'
);
select has_column(
  'public','cash_difference_reviews','justification','Registra justificación'
);
select ok(
  (select relrowsecurity
   from pg_class where oid = 'public.cash_difference_reviews'::regclass),
  'La tabla tiene RLS'
);
select ok(
  has_table_privilege('authenticated','public.cash_difference_reviews','SELECT'),
  'Autenticado puede consultar sujeto a RLS'
);
select ok(
  not has_table_privilege('authenticated','public.cash_difference_reviews','INSERT'),
  'No existe inserción directa'
);
select has_function(
  'private','apply_cash_difference_review_sync',
  array['uuid','uuid','uuid','uuid','uuid','jsonb'],
  'El sync valida la revisión'
);

select * from finish();
rollback;
