-- Entrega 4: despacho propio y configuración segura de operadores externos.

create table public.delivery_operators (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  name text not null check (btrim(name) <> ''),
  operator_type text not null check (operator_type in ('own','external')),
  integration_mode text not null default 'manual'
    check (integration_mode in ('manual','api')),
  tracking_base_url text,
  support_phone text,
  priority integer not null default 100 check (priority >= 0),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  unique (store_id,name)
);

create table public.delivery_assignments (
  id uuid primary key,
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  order_id uuid not null,
  driver_user_id uuid references auth.users(id)
    on delete restrict on update cascade,
  delivery_operator_id uuid,
  status text not null default 'assigned'
    check (status in ('assigned','en_route','delivered','failed','cancelled')),
  external_reference text,
  tracking_url text,
  recipient_name text,
  confirmation_code text,
  evidence_uri text,
  notes text,
  assigned_by_user_id uuid not null references auth.users(id),
  source_device_id uuid,
  started_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  unique (store_id,order_id),
  foreign key (order_id,store_id) references public.orders(id,store_id)
    on delete restrict on update cascade,
  foreign key (delivery_operator_id,store_id)
    references public.delivery_operators(id,store_id)
    on delete restrict on update cascade,
  foreign key (store_id,source_device_id)
    references public.devices(store_id,id)
    on delete restrict on update cascade,
  check (driver_user_id is not null or delivery_operator_id is not null)
);

create table public.delivery_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  assignment_id uuid not null,
  event_type text not null
    check (event_type in ('assigned','started','confirmed','failed','cancelled')),
  notes text,
  actor_user_id uuid not null references auth.users(id),
  source_device_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  foreign key (assignment_id,store_id)
    references public.delivery_assignments(id,store_id)
    on delete restrict on update cascade,
  foreign key (store_id,source_device_id)
    references public.devices(store_id,id)
    on delete restrict on update cascade
);

create index delivery_assignments_driver
  on public.delivery_assignments(store_id,driver_user_id,status,created_at);
create index delivery_assignments_status
  on public.delivery_assignments(store_id,status,created_at);
create index delivery_events_assignment
  on public.delivery_events(store_id,assignment_id,created_at);
create index delivery_operators_priority
  on public.delivery_operators(store_id,is_active,priority);

create trigger delivery_operators_bump_version before update on public.delivery_operators
  for each row execute function private.bump_catalog_version();
create trigger delivery_assignments_bump_version before update on public.delivery_assignments
  for each row execute function private.bump_catalog_version();
create trigger delivery_events_bump_version before update on public.delivery_events
  for each row execute function private.bump_catalog_version();

alter table public.delivery_operators enable row level security;
alter table public.delivery_assignments enable row level security;
alter table public.delivery_events enable row level security;
revoke all on public.delivery_operators,public.delivery_assignments,
  public.delivery_events from public,anon,authenticated;
grant select on public.delivery_operators,public.delivery_assignments,
  public.delivery_events to authenticated;
grant all on public.delivery_operators,public.delivery_assignments,
  public.delivery_events to service_role;

create policy delivery_operators_store on public.delivery_operators
  for select to authenticated using (private.is_store_member(store_id));
create policy delivery_assignments_store_driver_customer
  on public.delivery_assignments for select to authenticated using (
    private.is_store_member(store_id)
    or driver_user_id = auth.uid()
    or exists (
      select 1 from public.orders o
      join public.customers c on c.id = o.customer_id and c.store_id = o.store_id
      where o.id = delivery_assignments.order_id
        and o.store_id = delivery_assignments.store_id
        and c.auth_user_id = auth.uid()
    )
  );
create policy delivery_events_store_driver_customer
  on public.delivery_events for select to authenticated using (
    private.is_store_member(store_id)
    or exists (
      select 1 from public.delivery_assignments da
      where da.id = delivery_events.assignment_id
        and da.store_id = delivery_events.store_id
        and (
          da.driver_user_id = auth.uid()
          or exists (
            select 1 from public.orders o
            join public.customers c
              on c.id = o.customer_id and c.store_id = o.store_id
            where o.id = da.order_id and o.store_id = da.store_id
              and c.auth_user_id = auth.uid()
          )
        )
    )
  );

create or replace function private.delivery_change_payload(
  p_assignment_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id',da.id,'store_id',da.store_id,'order_id',da.order_id,
    'driver_user_id',da.driver_user_id,'status',da.status,
    'recipient_name',da.recipient_name,
    'confirmation_code',da.confirmation_code,
    'evidence_uri',da.evidence_uri,'notes',da.notes,
    'assigned_by_user_id',da.assigned_by_user_id,
    'device_id',da.source_device_id,'started_at',da.started_at,
    'delivered_at',da.delivered_at,'created_at',da.created_at,
    'updated_at',da.updated_at
  )
  from public.delivery_assignments da where da.id = p_assignment_id
$$;
revoke all on function private.delivery_change_payload(uuid)
  from public,anon,authenticated;

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
  v_driver uuid;
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
    where delivery_assignments.status in ('assigned','failed');
  else
    select * into v_assignment from public.delivery_assignments da
    where da.id = p_entity_id and da.store_id = p_store_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Despacho no encontrado';
    end if;
    if v_assignment.driver_user_id <> p_actor_user_id
      and not private.is_store_admin(p_store_id) then
      raise exception using errcode = '42501', message = 'Despacho asignado a otro usuario';
    end if;
    if p_operation_type = 'delivery.started' then
      update public.delivery_assignments set
        status = 'en_route',
        started_at = coalesce((p_payload ->> 'startedAt')::timestamptz,now())
      where id = p_entity_id and status = 'assigned';
    elsif p_operation_type = 'delivery.confirmed' then
      update public.delivery_assignments set
        status = 'delivered',
        recipient_name = btrim(p_payload ->> 'recipientName'),
        confirmation_code = nullif(btrim(p_payload ->> 'confirmationCode'),''),
        evidence_uri = nullif(btrim(p_payload ->> 'evidenceUri'),''),
        notes = nullif(btrim(p_payload ->> 'notes'),''),
        delivered_at = coalesce((p_payload ->> 'deliveredAt')::timestamptz,now())
      where id = p_entity_id and status = 'en_route';
    else
      raise exception using errcode = '22023', message = 'Operacion delivery no soportada';
    end if;
    if not found then
      raise exception using errcode = '40001', message = 'Estado de delivery incompatible';
    end if;
  end if;
  select * into strict v_assignment from public.delivery_assignments da
  where da.id = p_entity_id and da.store_id = p_store_id;
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
  insert into public.change_log(
    store_id,source_device_id,operation_id,entity_type,entity_id,
    operation,entity_version,payload,changed_at
  ) values (
    p_store_id,p_device_id,
    nullif(p_payload ->> 'operationId','')::uuid,
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

create or replace function public.upsert_delivery_operator(
  p_store_id uuid,
  p_operator_id uuid,
  p_name text,
  p_operator_type text,
  p_integration_mode text,
  p_tracking_base_url text,
  p_support_phone text,
  p_priority integer,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_store_admin(p_store_id) then
    raise exception using errcode = '42501', message = 'Solo administrador';
  end if;
  insert into public.delivery_operators(
    id,store_id,name,operator_type,integration_mode,tracking_base_url,
    support_phone,priority,is_active,created_by
  ) values (
    p_operator_id,p_store_id,btrim(p_name),p_operator_type,p_integration_mode,
    nullif(btrim(p_tracking_base_url),''),nullif(btrim(p_support_phone),''),
    p_priority,p_is_active,auth.uid()
  )
  on conflict (id) do update set
    name = excluded.name,operator_type = excluded.operator_type,
    integration_mode = excluded.integration_mode,
    tracking_base_url = excluded.tracking_base_url,
    support_phone = excluded.support_phone,priority = excluded.priority,
    is_active = excluded.is_active
  where delivery_operators.store_id = p_store_id;
  return jsonb_build_object('id',p_operator_id,'active',p_is_active);
end;
$$;

create or replace function public.get_my_delivery_tracking(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'orderId',da.order_id,'status',da.status,
    'trackingUrl',da.tracking_url,'startedAt',da.started_at,
    'deliveredAt',da.delivered_at,'recipientName',da.recipient_name,
    'updatedAt',da.updated_at
  ) order by da.created_at desc),'[]'::jsonb)
  from public.delivery_assignments da
  join public.orders o on o.id = da.order_id and o.store_id = da.store_id
  join public.customers c on c.id = o.customer_id and c.store_id = o.store_id
  where da.store_id = p_store_id and c.auth_user_id = auth.uid()
$$;

revoke all on function public.upsert_delivery_operator(
  uuid,uuid,text,text,text,text,text,integer,boolean
), public.get_my_delivery_tracking(uuid)
from public,anon,authenticated;
grant execute on function public.upsert_delivery_operator(
  uuid,uuid,text,text,text,text,text,integer,boolean
), public.get_my_delivery_tracking(uuid)
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
    raise exception 'No se encontro extension B4 para delivery';
  end if;
  v_replacement :=
    'when v_operation_type in (
              ''delivery.assigned'',
              ''delivery.started'',
              ''delivery.confirmed''
            ) then
            v_result := private.apply_delivery_operation_sync(
              p_store_id,p_device_id,v_actor_user_id,v_entity_id,
              v_operation_type,v_payload
            );
            v_server_entity_id := v_entity_id;

          ' || v_marker;
  execute replace(v_definition,v_marker,v_replacement);
end;
$migration$;
