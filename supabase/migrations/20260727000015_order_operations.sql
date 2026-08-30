-- E4: planificación, incidencias y sustituciones sincronizables.

alter table public.orders
  add column scheduled_for timestamptz,
  add column assigned_user_id uuid references auth.users(id)
    on delete set null on update cascade;

create index orders_store_schedule
  on public.orders(store_id, scheduled_for, status)
  where scheduled_for is not null;
create index orders_store_assignee
  on public.orders(store_id, assigned_user_id, status)
  where assigned_user_id is not null;

create table public.order_incidents (
  id uuid primary key,
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  order_id uuid not null,
  incident_type text not null check (
    incident_type in ('missing_item','address','payment','quality','delivery','other')
  ),
  description text not null check (btrim(description) <> ''),
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text,
  actor_user_id uuid not null references auth.users(id)
    on delete restrict on update cascade,
  device_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  foreign key (order_id, store_id) references public.orders(id, store_id)
    on delete restrict on update cascade,
  foreign key (store_id, device_id) references public.devices(store_id, id)
    on delete restrict on update cascade
);

create table public.order_substitutions (
  id uuid primary key,
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  order_id uuid not null,
  order_item_id uuid not null,
  replacement_product_id uuid not null,
  replacement_product_name text not null check (btrim(replacement_product_name) <> ''),
  status text not null default 'proposed'
    check (status in ('proposed','accepted','rejected')),
  notes text,
  actor_user_id uuid not null references auth.users(id)
    on delete restrict on update cascade,
  device_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  foreign key (order_id, store_id) references public.orders(id, store_id)
    on delete restrict on update cascade,
  foreign key (order_item_id, store_id) references public.order_items(id, store_id)
    on delete restrict on update cascade,
  foreign key (replacement_product_id, store_id) references public.products(id, store_id)
    on delete restrict on update cascade,
  foreign key (store_id, device_id) references public.devices(store_id, id)
    on delete restrict on update cascade
);

create trigger order_incidents_bump_version before update on public.order_incidents
  for each row execute function private.bump_catalog_version();
create trigger order_substitutions_bump_version before update on public.order_substitutions
  for each row execute function private.bump_catalog_version();

alter table public.order_incidents enable row level security;
alter table public.order_substitutions enable row level security;
revoke all on public.order_incidents, public.order_substitutions
  from public, anon, authenticated;
grant select on public.order_incidents, public.order_substitutions to authenticated;
grant all on public.order_incidents, public.order_substitutions to service_role;
create policy order_incidents_store on public.order_incidents
  for select to authenticated using (private.is_store_member(store_id));
create policy order_substitutions_store_or_customer on public.order_substitutions
  for select to authenticated using (
    private.is_store_member(store_id)
    or exists (
      select 1
      from public.orders o
      join public.customers c on c.id = o.customer_id and c.store_id = o.store_id
      where o.id = order_substitutions.order_id
        and o.store_id = order_substitutions.store_id
        and c.auth_user_id = auth.uid()
    )
  );

create or replace function private.apply_order_operation_sync(
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
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_product public.products%rowtype;
  v_version bigint;
  v_assigned uuid;
  v_scheduled timestamptz;
begin
  if not private.is_store_member(p_store_id) then
    raise exception using errcode = '42501', message = 'Sin acceso a pedidos';
  end if;

  if p_operation_type = 'order.planning_updated' then
    if not private.is_store_admin(p_store_id) then
      raise exception using errcode = '42501', message = 'Solo administrador planifica pedidos';
    end if;
    v_assigned := nullif(p_payload ->> 'assignedAuthUserId', '')::uuid;
    v_scheduled := nullif(p_payload ->> 'scheduledFor', '')::timestamptz;
    if nullif(p_payload ->> 'assignedUserId','') is not null
      and v_assigned is null then
      raise exception using errcode = '22023', message = 'Responsable no vinculado a Supabase';
    end if;
    if v_assigned is not null and not exists (
      select 1 from public.store_memberships m
      where m.store_id = p_store_id and m.user_id = v_assigned and m.is_active
    ) then
      raise exception using errcode = '22023', message = 'Responsable no pertenece a la tienda';
    end if;
    update public.orders o
    set scheduled_for = v_scheduled, assigned_user_id = v_assigned
    where o.id = p_entity_id and o.store_id = p_store_id
      and o.version = (p_payload ->> 'expectedVersion')::bigint
      and o.status not in ('delivered','cancelled')
    returning o.version into v_version;
    if not found then
      raise exception using errcode = '40001', message = 'Pedido cambiado o cerrado';
    end if;
    insert into public.change_log(
      store_id,source_device_id,operation_id,entity_type,entity_id,
      operation,entity_version,payload,changed_at
    ) values (
      p_store_id,p_device_id,nullif(p_payload ->> 'operationId','')::uuid,
      'order_planning',p_entity_id,p_operation_type,v_version,
      jsonb_build_object(
        'order_id',p_entity_id,'scheduled_for',v_scheduled,
        'assigned_user_id',v_assigned,'order_version',v_version
      ),now()
    );
  elsif p_operation_type = 'order.incident_created' then
    insert into public.order_incidents(
      id,store_id,order_id,incident_type,description,status,resolution,
      actor_user_id,device_id
    ) values (
      p_entity_id,p_store_id,(p_payload ->> 'orderId')::uuid,
      p_payload ->> 'type',btrim(p_payload ->> 'description'),'open',null,
      p_actor_user_id,p_device_id
    );
    insert into public.change_log(
      store_id,source_device_id,entity_type,entity_id,operation,entity_version,payload
    ) select
      p_store_id,p_device_id,'order_incident',i.id,p_operation_type,i.version,
      jsonb_build_object(
        'id',i.id,'order_id',i.order_id,'incident_type',i.incident_type,
        'description',i.description,'status',i.status,'resolution',i.resolution,
        'actor_user_id',i.actor_user_id,'device_id',i.device_id,
        'created_at',i.created_at,'updated_at',i.updated_at
      )
    from public.order_incidents i where i.id = p_entity_id;
    v_version := 1;
  elsif p_operation_type = 'order.substitution_proposed' then
    select * into v_order from public.orders o
    where o.id = (p_payload ->> 'orderId')::uuid and o.store_id = p_store_id;
    if not found or v_order.status not in ('confirmed','preparing') then
      raise exception using errcode = '22023', message = 'Pedido no admite sustitucion';
    end if;
    select * into v_item from public.order_items oi
    where oi.id = (p_payload ->> 'orderItemId')::uuid
      and oi.order_id = v_order.id and oi.store_id = p_store_id;
    if not found or v_item.substitution_policy = 'remove' then
      raise exception using errcode = '22023', message = 'Item no admite sustitucion';
    end if;
    select * into v_product from public.products p
    where p.id = (p_payload ->> 'replacementProductId')::uuid
      and p.store_id = p_store_id and p.is_active;
    if not found or v_product.id = v_item.product_id then
      raise exception using errcode = '22023', message = 'Reemplazo invalido';
    end if;
    insert into public.order_substitutions(
      id,store_id,order_id,order_item_id,replacement_product_id,
      replacement_product_name,status,notes,actor_user_id,device_id
    ) values (
      p_entity_id,p_store_id,v_order.id,v_item.id,v_product.id,v_product.name,
      'proposed',nullif(btrim(p_payload ->> 'notes'),''),p_actor_user_id,p_device_id
    );
    insert into public.change_log(
      store_id,source_device_id,entity_type,entity_id,operation,entity_version,payload
    ) select
      p_store_id,p_device_id,'order_substitution',s.id,p_operation_type,s.version,
      jsonb_build_object(
        'id',s.id,'order_id',s.order_id,'order_item_id',s.order_item_id,
        'replacement_product_id',s.replacement_product_id,
        'replacement_product_name',s.replacement_product_name,
        'status',s.status,'notes',s.notes,'actor_user_id',s.actor_user_id,
        'device_id',s.device_id,'created_at',s.created_at,'updated_at',s.updated_at
      )
    from public.order_substitutions s where s.id = p_entity_id;
    v_version := 1;
  else
    raise exception using errcode = '22023', message = 'Operacion E4 no soportada';
  end if;
  return jsonb_build_object('id',p_entity_id,'version',v_version,'applied',true);
end;
$$;

revoke all on function private.apply_order_operation_sync(
  uuid,uuid,uuid,uuid,text,jsonb
) from public,anon,authenticated;

create or replace function public.get_my_order_substitutions(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',s.id,
      'orderId',s.order_id,
      'orderItemId',s.order_item_id,
      'replacementProductId',s.replacement_product_id,
      'replacementProductName',s.replacement_product_name,
      'status',s.status,
      'notes',s.notes,
      'updatedAt',s.updated_at
    ) order by s.created_at
  ), '[]'::jsonb)
  from public.order_substitutions s
  join public.orders o on o.id = s.order_id and o.store_id = s.store_id
  join public.customers c on c.id = o.customer_id and c.store_id = o.store_id
  where s.store_id = p_store_id
    and c.auth_user_id = auth.uid()
$$;

create or replace function public.decide_my_order_substitution(
  p_store_id uuid,
  p_substitution_id uuid,
  p_operation_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_substitution public.order_substitutions%rowtype;
begin
  select s.* into v_substitution
  from public.order_substitutions s
  join public.orders o on o.id = s.order_id and o.store_id = s.store_id
  join public.customers c on c.id = o.customer_id and c.store_id = o.store_id
  where s.id = p_substitution_id
    and s.store_id = p_store_id
    and c.auth_user_id = auth.uid()
    and o.status not in ('delivered','cancelled')
  for update of s;
  if not found then
    raise exception using errcode = 'P0002', message = 'Sustitucion no encontrada';
  end if;
  if exists (
    select 1 from public.change_log cl
    where cl.store_id = p_store_id and cl.operation_id = p_operation_id
  ) then
    return jsonb_build_object(
      'id',v_substitution.id,'status',v_substitution.status
    );
  end if;
  if v_substitution.status <> 'proposed' then
    raise exception using errcode = '22023', message = 'La sustitucion ya fue respondida';
  end if;

  update public.order_substitutions s
  set status = case when p_accept then 'accepted' else 'rejected' end
  where s.id = v_substitution.id
  returning s.* into v_substitution;

  insert into public.change_log(
    store_id,operation_id,entity_type,entity_id,operation,
    entity_version,payload,changed_at
  ) values (
    p_store_id,p_operation_id,'order_substitution',v_substitution.id,
    'order.substitution_decided',v_substitution.version,
    jsonb_build_object(
      'id',v_substitution.id,
      'order_id',v_substitution.order_id,
      'order_item_id',v_substitution.order_item_id,
      'replacement_product_id',v_substitution.replacement_product_id,
      'replacement_product_name',v_substitution.replacement_product_name,
      'status',v_substitution.status,
      'notes',v_substitution.notes,
      'actor_user_id',auth.uid(),
      'device_id',v_substitution.device_id,
      'created_at',v_substitution.created_at,
      'updated_at',v_substitution.updated_at
    ),now()
  );
  return jsonb_build_object(
    'id',v_substitution.id,'status',v_substitution.status
  );
end;
$$;

revoke all on function public.get_my_order_substitutions(uuid),
  public.decide_my_order_substitution(uuid,uuid,uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.get_my_order_substitutions(uuid),
  public.decide_my_order_substitution(uuid,uuid,uuid,boolean)
  to authenticated,service_role;

do $migration$
declare
  v_definition text;
  v_marker text := 'when v_operation_type = ''product.price_updated'' then';
  v_replacement text;
begin
  select pg_get_functiondef(
    'public.process_sync_batch(uuid,uuid,integer,jsonb)'::regprocedure
  ) into v_definition;
  if strpos(v_definition,v_marker) = 0 then
    raise exception 'No se encontro extension B4 para E4';
  end if;
  v_replacement :=
    'when v_operation_type in (
              ''order.planning_updated'',
              ''order.incident_created'',
              ''order.substitution_proposed''
            ) then
            v_result := private.apply_order_operation_sync(
              p_store_id,p_device_id,v_actor_user_id,v_entity_id,
              v_operation_type,v_payload
            );
            v_server_entity_id := v_entity_id;

          ' || v_marker;
  execute replace(v_definition,v_marker,v_replacement);
end;
$migration$;
