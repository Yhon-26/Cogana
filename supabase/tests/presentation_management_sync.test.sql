begin;
select plan(5);

select has_function(
  'private','apply_presentation_update_sync',array['uuid','uuid','jsonb'],
  'Existe actualización privada de presentaciones'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.apply_presentation_update_sync(uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'Authenticated no invoca el helper directamente'
);
select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.product_presentations'::regclass),
  'Presentaciones conserva RLS'
);
select ok(
  not has_table_privilege('authenticated','public.product_presentations','UPDATE'),
  'Presentaciones no se editan directamente'
);
select has_function(
  'public','process_sync_batch',array['uuid','uuid','integer','jsonb'],
  'La entrada de sync sigue disponible'
);

select * from finish();
rollback;
