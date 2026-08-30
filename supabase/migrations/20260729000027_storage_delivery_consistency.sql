-- Buckets administrados y consistencia eventual/atomica de entregas.

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values
  (
    'product-images',
    'product-images',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'delivery-evidence',
    'delivery-evidence',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'support-evidence',
    'support-evidence',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  )
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy product_images_public_read
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'product-images');

create policy product_images_admin_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and private.is_store_admin(((storage.foldername(name))[1])::uuid)
  );

create policy product_images_admin_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and private.is_store_admin(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and private.is_store_admin(((storage.foldername(name))[1])::uuid)
  );

create policy product_images_admin_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and private.is_store_admin(((storage.foldername(name))[1])::uuid)
  );

create policy delivery_evidence_member_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'delivery-evidence'
    and (storage.foldername(name))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and private.is_store_member(((storage.foldername(name))[1])::uuid)
  );

create policy delivery_evidence_member_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'delivery-evidence'
    and (storage.foldername(name))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and private.is_store_member(((storage.foldername(name))[1])::uuid)
  );

create policy delivery_evidence_admin_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'delivery-evidence'
    and (storage.foldername(name))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and private.is_store_admin(((storage.foldername(name))[1])::uuid)
  );

create policy support_evidence_owner_or_member_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'support-evidence'
    and (storage.foldername(name))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (
      private.is_store_member(((storage.foldername(name))[1])::uuid)
      or (storage.foldername(name))[2] = auth.uid()::text
    )
  );

create policy support_evidence_owner_or_member_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'support-evidence'
    and (storage.foldername(name))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and private.is_store_member(((storage.foldername(name))[1])::uuid)
  );

create policy support_evidence_owner_or_admin_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'support-evidence'
    and (storage.foldername(name))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (
      private.is_store_admin(((storage.foldername(name))[1])::uuid)
      or (storage.foldername(name))[2] = auth.uid()::text
    )
  );

create or replace function private.apply_delivery_operation_sync(
  p_store_id uuid,
  p_device_id uuid,
  p_actor_user_id uuid,
  p_entity_id uuid,
  p_operation_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.delivery_assignments%rowtype;
  v_order public.orders%rowtype;
  v_driver uuid;
  v_order_changed boolean := false;
  v_evidence_uri text;
  v_operation_id uuid := nullif(p_payload ->> 'operationId', '')::uuid;
begin
  if not private.is_store_member(p_store_id) then
    raise exception using errcode = '42501', message = 'Sin acceso a delivery';
  end if;

  if p_operation_type = 'delivery.assigned' then
    if not private.is_store_admin(p_store_id) then
      raise exception using errcode = '42501', message = 'Solo administrador asigna';
    end if;
    v_driver := nullif(p_payload ->> 'driverAuthUserId','')::uuid;
    if v_driver is null or not exists (
      select 1 from public.store_memberships m
      where m.store_id = p_store_id and m.user_id = v_driver and m.is_active
    ) then
      raise exception using errcode = '22023', message = 'Repartidor no vinculado';
    end if;
    select * into v_order
    from public.orders o
    where o.id = (p_payload ->> 'orderId')::uuid
      and o.store_id = p_store_id
      and o.fulfillment_type = 'delivery'
      and o.status in ('ready', 'out_for_delivery')
    for update;
    if not found then
      raise exception using errcode = '40001', message = 'Pedido no disponible para reparto';
    end if;
    insert into public.delivery_assignments(
      id,store_id,order_id,driver_user_id,status,notes,
      assigned_by_user_id,source_device_id
    ) values (
      p_entity_id,p_store_id,(p_payload ->> 'orderId')::uuid,v_driver,
      'assigned',nullif(btrim(p_payload ->> 'notes'),''),
      p_actor_user_id,p_device_id
    )
    on conflict (store_id,order_id) do update set
      driver_user_id = excluded.driver_user_id,status = 'assigned',
      notes = excluded.notes,assigned_by_user_id = excluded.assigned_by_user_id,
      source_device_id = excluded.source_device_id,
      started_at = null,delivered_at = null
    where delivery_assignments.status in ('assigned','failed')
      and delivery_assignments.id = excluded.id;
    if not found then
      raise exception using errcode = '40001', message = 'Asignacion de reparto incompatible';
    end if;
  else
    select * into v_assignment
    from public.delivery_assignments da
    where da.id = p_entity_id and da.store_id = p_store_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Despacho no encontrado';
    end if;
    if v_assignment.driver_user_id <> p_actor_user_id
      and not private.is_store_admin(p_store_id)
    then
      raise exception using errcode = '42501', message = 'Despacho asignado a otro usuario';
    end if;

    select * into strict v_order
    from public.orders o
    where o.id = v_assignment.order_id and o.store_id = p_store_id
    for update;

    if p_operation_type = 'delivery.started' then
      update public.delivery_assignments
      set status = 'en_route',
          started_at = coalesce((p_payload ->> 'startedAt')::timestamptz,now())
      where id = p_entity_id and status = 'assigned';
      if not found then
        raise exception using errcode = '40001', message = 'Estado de delivery incompatible';
      end if;

      if v_order.status = 'ready' then
        update public.orders set status = 'out_for_delivery' where id = v_order.id;
        insert into public.order_status_history (
          store_id, order_id, operation_id, from_status, to_status, reason,
          actor_user_id, device_id
        ) values (
          p_store_id, v_order.id, v_operation_id, 'ready', 'out_for_delivery',
          'Repartidor inicia ruta', p_actor_user_id, p_device_id
        );
        v_order_changed := true;
      elsif v_order.status <> 'out_for_delivery' then
        raise exception using errcode = '40001', message = 'Estado de pedido incompatible';
      end if;
    elsif p_operation_type = 'delivery.confirmed' then
      v_evidence_uri := nullif(btrim(p_payload ->> 'evidenceUri'),'');
      if nullif(btrim(p_payload ->> 'recipientName'),'') is null then
        raise exception using errcode = '22023', message = 'Destinatario obligatorio';
      end if;
      if nullif(btrim(p_payload ->> 'confirmationCode'),'') is null
        and v_evidence_uri is null
      then
        raise exception using errcode = '22023', message = 'Falta prueba de entrega';
      end if;
      if v_evidence_uri is not null and (
        v_evidence_uri like '%..%'
        or v_evidence_uri not like
          p_store_id::text || '/' || p_entity_id::text || '/%'
        or not exists (
          select 1 from storage.objects so
          where so.bucket_id = 'delivery-evidence'
            and so.name = v_evidence_uri
        )
      ) then
        raise exception using errcode = '22023', message = 'Evidencia de entrega invalida';
      end if;
      update public.delivery_assignments
      set status = 'delivered',
          recipient_name = btrim(p_payload ->> 'recipientName'),
          confirmation_code = nullif(btrim(p_payload ->> 'confirmationCode'),''),
          evidence_uri = v_evidence_uri,
          notes = nullif(btrim(p_payload ->> 'notes'),''),
          delivered_at = coalesce((p_payload ->> 'deliveredAt')::timestamptz,now())
      where id = p_entity_id and status = 'en_route';
      if not found then
        raise exception using errcode = '40001', message = 'Estado de delivery incompatible';
      end if;

      if v_order.status = 'out_for_delivery' then
        update public.orders set status = 'delivered' where id = v_order.id;
        insert into public.order_status_history (
          store_id, order_id, operation_id, from_status, to_status, reason,
          actor_user_id, device_id
        ) values (
          p_store_id, v_order.id, v_operation_id, 'out_for_delivery', 'delivered',
          'Entrega confirmada', p_actor_user_id, p_device_id
        );
        v_order_changed := true;
      elsif v_order.status <> 'delivered' then
        raise exception using errcode = '40001', message = 'Estado de pedido incompatible';
      end if;
    elsif p_operation_type = 'delivery.evidence_attached' then
      v_evidence_uri := nullif(btrim(p_payload ->> 'evidenceUri'), '');
      if v_evidence_uri is null
        or v_evidence_uri like '%..%'
        or v_evidence_uri not like
          p_store_id::text || '/' || p_entity_id::text || '/%'
      then
        raise exception using errcode = '22023', message = 'Ruta de evidencia invalida';
      end if;
      if not exists (
        select 1 from storage.objects so
        where so.bucket_id = 'delivery-evidence'
          and so.name = v_evidence_uri
      ) then
        raise exception using errcode = '22023', message = 'La evidencia no existe';
      end if;
      update public.delivery_assignments
      set evidence_uri = v_evidence_uri
      where id = p_entity_id;
    else
      raise exception using errcode = '22023', message = 'Operacion delivery no soportada';
    end if;
  end if;

  select * into strict v_assignment
  from public.delivery_assignments da
  where da.id = p_entity_id and da.store_id = p_store_id;

  if p_operation_type <> 'delivery.evidence_attached' then
    insert into public.delivery_events(
      store_id,assignment_id,event_type,notes,actor_user_id,source_device_id
    ) values (
      p_store_id,p_entity_id,
      case p_operation_type
        when 'delivery.assigned' then 'assigned'
        when 'delivery.started' then 'started'
        else 'confirmed'
      end,
      v_assignment.notes,p_actor_user_id,p_device_id
    );
  end if;

  if v_order_changed then
    perform private.append_order_change(
      v_order.id,
      'order.status_changed',
      p_device_id,
      v_operation_id
    );
  end if;

  insert into public.change_log(
    store_id,source_device_id,operation_id,entity_type,entity_id,
    operation,entity_version,payload,changed_at
  ) values (
    p_store_id,p_device_id,v_operation_id,
    'delivery_assignment',v_assignment.id,p_operation_type,
    v_assignment.version,private.delivery_change_payload(v_assignment.id),now()
  );
  return jsonb_build_object(
    'id',v_assignment.id,'version',v_assignment.version,'applied',true
  );
end;
$$;

revoke all on function private.apply_delivery_operation_sync(
  uuid,uuid,uuid,uuid,text,jsonb
) from public,anon,authenticated;

do $sync_extension$
declare
  v_definition text;
  v_marker text := '''delivery.confirmed''
            ) then';
  v_replacement text := '''delivery.confirmed'',
              ''delivery.evidence_attached''
            ) then';
begin
  select pg_get_functiondef(
    'public.process_sync_batch(uuid,uuid,integer,jsonb)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_marker) = 0 then
    raise exception 'No se encontro la extension delivery en process_sync_batch';
  end if;
  v_definition := replace(v_definition, v_marker, v_replacement);
  execute v_definition;
end;
$sync_extension$;
