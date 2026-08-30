begin;
select plan(11);

select has_table('public','role_permissions','Existen permisos por rol');
select has_table('public','work_shifts','Existen turnos');
select has_table('public','attendance_entries','Existe asistencia');
select ok((select relrowsecurity from pg_class where oid = 'public.role_permissions'::regclass),'Permisos tiene RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.work_shifts'::regclass),'Turnos tiene RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.attendance_entries'::regclass),'Asistencia tiene RLS');
select ok(not has_table_privilege('authenticated','public.role_permissions','UPDATE'),'Sin edición directa');
select ok(not has_table_privilege('anon','public.attendance_entries','SELECT'),'Anon sin asistencia');
select has_function(
  'private','apply_personnel_operation_sync',
  array['uuid','uuid','uuid','uuid','uuid','text','jsonb'],
  'Existe helper de personal'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.apply_personnel_operation_sync(uuid,uuid,uuid,uuid,uuid,text,jsonb)',
    'EXECUTE'
  ),
  'Helper no expuesto'
);
select has_function('public','process_sync_batch',array['uuid','uuid','integer','jsonb'],'Sync público sigue disponible');

select * from finish();
rollback;
