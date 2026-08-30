-- pgTAP: soporte, tienda y configuración fiscal.
begin;
select plan(15);

select has_table('public','store_settings','Existe configuración de tienda');
select has_table('public','support_tickets','Existen solicitudes de soporte');
select has_table('public','support_messages','Existe conversación de soporte');
select has_table('public','fiscal_integrations','Existe configuración fiscal');
select has_table('public','fiscal_documents','Existen documentos fiscales');
select ok(
  (select bool_and(relrowsecurity) from pg_class where oid = any(array[
    'public.store_settings'::regclass,'public.support_tickets'::regclass,
    'public.support_messages'::regclass,'public.fiscal_integrations'::regclass,
    'public.fiscal_documents'::regclass
  ])),
  'Todas las tablas de expansión tienen RLS'
);
select has_function(
  'public','create_support_ticket',
  array['uuid','uuid','uuid','text','text','text','text'],
  'Existe creación segura de soporte'
);
select has_function(
  'public','add_support_message',
  array['uuid','uuid','uuid','text','text'],
  'Existe conversación segura'
);
select has_function(
  'public','get_my_support_tickets',array['uuid'],
  'Existe bandeja de soporte'
);
select has_function(
  'public','update_support_ticket',
  array['uuid','uuid','text','text','uuid'],
  'Equipo actualiza soporte'
);
select has_function(
  'public','update_store_settings',
  array['uuid','text','text','text','text','text','text'],
  'Administrador configura tienda'
);
select has_function(
  'public','configure_fiscal_integration',
  array['uuid','text','text','text','text','boolean'],
  'Administrador configura proveedor fiscal sin secreto'
);
select ok(
  not has_function_privilege(
    'anon','public.get_my_support_tickets(uuid)','EXECUTE'
  ),
  'Anon no consulta soporte'
);
select ok(
  not has_table_privilege('authenticated','public.fiscal_documents','INSERT'),
  'Documentos fiscales no se insertan directamente'
);
select ok(
  not has_table_privilege('authenticated','public.support_messages','UPDATE'),
  'Mensajes de soporte son inmutables'
);

select * from finish();
rollback;
