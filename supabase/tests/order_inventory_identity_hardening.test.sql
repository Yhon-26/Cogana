begin;

select plan(19);

select has_table(
  'public','order_inventory_reservations','Existen reservas de pedido'
);
select has_table(
  'public','order_payment_history','Existe historial de pago'
);
select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.order_inventory_reservations'::regclass),
  'Reservas tiene RLS'
);
select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.order_payment_history'::regclass),
  'Historial de pago tiene RLS'
);
select ok(
  not has_table_privilege(
    'authenticated','public.order_inventory_reservations','INSERT'
  ),
  'Cliente no inserta reservas directamente'
);
select ok(
  not has_table_privilege(
    'authenticated','public.order_payment_history','INSERT'
  ),
  'Cliente no inserta historial de pago directamente'
);
select has_function(
  'public',
  'update_order_payment_status',
  array['uuid','uuid','text','text','text','uuid','bigint'],
  'Existe RPC de pago de pedido'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.update_order_payment_status(uuid,uuid,text,text,text,uuid,bigint)',
    'EXECUTE'
  ),
  'Autenticado puede invocar RPC de pago'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.update_order_payment_status(uuid,uuid,text,text,text,uuid,bigint)',
    'EXECUTE'
  ),
  'Anon no puede invocar RPC de pago'
);
select has_column(
  'public','orders','payment_verified_at','Pedido conserva verificacion de pago'
);
select is(
  (select count(*)::integer
   from storage.buckets
   where id in ('product-images','delivery-evidence','support-evidence')),
  3,
  'Existen los tres buckets administrados'
);
select has_table(
  'public','account_deletion_requests','Existe auditoria de baja de cuenta'
);
select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.account_deletion_requests'::regclass),
  'Solicitudes de baja tiene RLS'
);
select has_function(
  'public',
  'prepare_my_account_deletion',
  array['text'],
  'Existe preparacion de baja'
);
select ok(
  has_function_privilege(
    'authenticated','public.prepare_my_account_deletion(text)','EXECUTE'
  ),
  'Usuario autenticado puede solicitar su baja'
);
select ok(
  not has_function_privilege(
    'anon','public.prepare_my_account_deletion(text)','EXECUTE'
  ),
  'Anon no puede solicitar bajas'
);
select ok(
  not has_column_privilege(
    'authenticated','public.profiles','status','UPDATE'
  ),
  'Usuario no puede cambiar el estado de su perfil'
);
select ok(
  has_column_privilege(
    'authenticated','public.profiles','full_name','UPDATE'
  ),
  'Usuario puede cambiar su nombre'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.store_memberships'::regclass
      and tgname = 'store_memberships_protect_last_administrator'
      and not tgisinternal
  ),
  'Existe proteccion del ultimo administrador'
);

select * from finish();
rollback;
