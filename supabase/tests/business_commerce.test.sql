-- pgTAP: entrega 3 para restaurantes y mayoristas.
begin;
select plan(21);

select has_table('public', 'business_accounts', 'Existe cuenta comercial');
select has_table('public', 'business_members', 'Existe membresia comercial');
select has_table('public', 'business_prices', 'Existen precios acordados');
select has_table('public', 'business_quotes', 'Existen cotizaciones');
select has_table('public', 'business_quote_items', 'Existen items de cotizacion');
select has_table('public', 'recurring_orders', 'Existen pedidos recurrentes');
select has_table('public', 'business_documents', 'Existen documentos comerciales');
select has_column('public', 'orders', 'business_account_id', 'Pedido conserva negocio');
select has_column('public', 'business_quotes', 'order_id', 'Cotizacion aceptada conserva pedido');
select ok(
  (select bool_and(relrowsecurity)
   from pg_class
   where oid = any(array[
     'public.business_accounts'::regclass,
     'public.business_members'::regclass,
     'public.business_prices'::regclass,
     'public.business_quotes'::regclass,
     'public.business_quote_items'::regclass,
     'public.recurring_orders'::regclass,
     'public.business_documents'::regclass
   ])),
  'Todas las tablas comerciales tienen RLS'
);
select has_function(
  'public','register_business_account',
  array['uuid','uuid','text','text','text','text','text','text','text'],
  'Existe registro comercial'
);
select has_function(
  'public','get_my_business_context',array['uuid'],
  'Existe contexto comercial consolidado'
);
select has_function(
  'public','create_business_quote',
  array['uuid','uuid','uuid','timestamp with time zone','text','text','jsonb'],
  'Existe solicitud de cotizacion'
);
select has_function(
  'public','save_recurring_order',
  array['uuid','uuid','uuid','text','text','timestamp with time zone','text','jsonb','jsonb'],
  'Existe programacion recurrente'
);
select has_function(
  'public','accept_my_business_quote',array['uuid','uuid'],
  'Cliente puede aceptar propuesta'
);
select has_function(
  'public','review_business_account',
  array['uuid','uuid','text','bigint','integer'],
  'Administrador revisa cuenta'
);
select has_function(
  'public','respond_business_quote',
  array['uuid','uuid','timestamp with time zone','text','jsonb'],
  'Tienda responde cotizacion'
);
select has_function(
  'public','update_my_business_account',
  array['uuid','uuid','text','text','text','text','text'],
  'Titular mantiene el perfil comercial'
);
select has_function(
  'public','set_business_price',
  array['uuid','uuid','uuid','uuid','bigint','bigint','timestamp with time zone','boolean'],
  'Administrador configura precios acordados'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.register_business_account(uuid,uuid,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'Anon no registra negocios'
);
select ok(
  not has_table_privilege('authenticated','public.business_prices','INSERT'),
  'Precios acordados no se escriben directamente'
);

select * from finish();
rollback;
