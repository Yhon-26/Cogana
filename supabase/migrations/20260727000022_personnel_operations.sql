-- Permisos restrictivos, programación de turnos y asistencia.

create table public.role_permissions (
  id uuid primary key,
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  role text not null check (role in ('administrator','seller')),
  module text not null check (btrim(module) <> ''),
  can_view boolean not null default true,
  can_manage boolean not null default false,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  unique (store_id,role,module),
  check (not can_manage or can_view)
);

create table public.work_shifts (
  id uuid primary key,
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  user_id uuid not null references auth.users(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled','completed','cancelled')),
  notes text,
  created_by uuid not null references auth.users(id),
  source_device_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  foreign key (store_id,source_device_id) references public.devices(store_id,id)
    on delete restrict on update cascade,
  check (ends_at > starts_at)
);

create table public.attendance_entries (
  id uuid primary key,
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  user_id uuid not null references auth.users(id),
  work_shift_id uuid,
  checked_in_at timestamptz not null,
  checked_out_at timestamptz,
  notes text,
  source_device_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  foreign key (work_shift_id,store_id) references public.work_shifts(id,store_id)
    on delete restrict on update cascade,
  foreign key (store_id,source_device_id) references public.devices(store_id,id)
    on delete restrict on update cascade,
  check (checked_out_at is null or checked_out_at >= checked_in_at)
);

create unique index attendance_open_user
  on public.attendance_entries(store_id,user_id) where checked_out_at is null;
create index work_shifts_user_date
  on public.work_shifts(store_id,user_id,starts_at);
create index attendance_user_date
  on public.attendance_entries(store_id,user_id,checked_in_at desc);

create trigger role_permissions_bump before update on public.role_permissions
  for each row execute function private.bump_catalog_version();
create trigger work_shifts_bump before update on public.work_shifts
  for each row execute function private.bump_catalog_version();
create trigger attendance_entries_bump before update on public.attendance_entries
  for each row execute function private.bump_catalog_version();

alter table public.role_permissions enable row level security;
alter table public.work_shifts enable row level security;
alter table public.attendance_entries enable row level security;
revoke all on public.role_permissions,public.work_shifts,public.attendance_entries
  from public,anon,authenticated;
grant select on public.role_permissions,public.work_shifts,public.attendance_entries
  to authenticated;
grant all on public.role_permissions,public.work_shifts,public.attendance_entries
  to service_role;

create policy role_permissions_store on public.role_permissions
  for select to authenticated using (private.is_store_member(store_id));
create policy work_shifts_store_or_self on public.work_shifts
  for select to authenticated using (
    private.is_store_admin(store_id) or user_id = auth.uid()
  );
create policy attendance_store_or_self on public.attendance_entries
  for select to authenticated using (
    private.is_store_admin(store_id) or user_id = auth.uid()
  );

create or replace function private.apply_personnel_operation_sync(
  p_store_id uuid,
  p_device_id uuid,
  p_actor_user_id uuid,
  p_entity_id uuid,
  p_operation_id uuid,
  p_operation_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid;
  v_shift uuid;
  v_version bigint;
  v_payload jsonb;
begin
  if not private.is_store_member(p_store_id) then
    raise exception using errcode = '42501', message = 'Sin acceso a personal';
  end if;
  if p_operation_type = 'role_permission.updated' then
    if not private.is_store_admin(p_store_id) then
      raise exception using errcode = '42501', message = 'Solo administrador';
    end if;
    insert into public.role_permissions(
      id,store_id,role,module,can_view,can_manage,updated_by
    ) values (
      p_entity_id,p_store_id,p_payload ->> 'role',btrim(p_payload ->> 'module'),
      (p_payload ->> 'canView')::boolean,
      (p_payload ->> 'canManage')::boolean,p_actor_user_id
    )
    on conflict (store_id,role,module) do update set
      can_view = excluded.can_view,can_manage = excluded.can_manage,
      updated_by = excluded.updated_by
    where role_permissions.version =
      coalesce((p_payload ->> 'expectedVersion')::bigint,role_permissions.version);
    select rp.version,jsonb_build_object(
      'id',rp.id,'store_id',rp.store_id,'role',rp.role,'module',rp.module,
      'can_view',rp.can_view,'can_manage',rp.can_manage,
      'updated_by',rp.updated_by,'updated_at',rp.updated_at,'version',rp.version
    ) into v_version,v_payload
    from public.role_permissions rp
    where rp.store_id = p_store_id and rp.role = p_payload ->> 'role'
      and rp.module = btrim(p_payload ->> 'module');
  elsif p_operation_type = 'work_shift.scheduled' then
    if not private.is_store_admin(p_store_id) then
      raise exception using errcode = '42501', message = 'Solo administrador';
    end if;
    v_target := nullif(p_payload ->> 'userAuthUserId','')::uuid;
    if v_target is null or not exists (
      select 1 from public.store_memberships m
      where m.store_id = p_store_id and m.user_id = v_target and m.is_active
    ) then
      raise exception using errcode = '22023', message = 'Empleado no vinculado';
    end if;
    insert into public.work_shifts(
      id,store_id,user_id,starts_at,ends_at,status,notes,created_by,
      source_device_id,created_at,updated_at
    ) values (
      p_entity_id,p_store_id,v_target,(p_payload ->> 'startsAt')::timestamptz,
      (p_payload ->> 'endsAt')::timestamptz,'scheduled',
      nullif(btrim(p_payload ->> 'notes'),''),p_actor_user_id,p_device_id,
      coalesce((p_payload ->> 'createdAt')::timestamptz,now()),
      coalesce((p_payload ->> 'createdAt')::timestamptz,now())
    );
    select ws.version,jsonb_build_object(
      'id',ws.id,'store_id',ws.store_id,'user_id',ws.user_id,
      'starts_at',ws.starts_at,'ends_at',ws.ends_at,'status',ws.status,
      'notes',ws.notes,'created_by',ws.created_by,
      'device_id',ws.source_device_id,'created_at',ws.created_at,
      'updated_at',ws.updated_at,'version',ws.version
    ) into v_version,v_payload from public.work_shifts ws
    where ws.id = p_entity_id;
  else
    v_target := nullif(p_payload ->> 'userAuthUserId','')::uuid;
    if v_target is null or (
      v_target <> p_actor_user_id and not private.is_store_admin(p_store_id)
    ) then
      raise exception using errcode = '42501', message = 'Asistencia de otro usuario';
    end if;
    if p_operation_type = 'attendance.checked_in' then
      select ws.id into v_shift from public.work_shifts ws
      where ws.store_id = p_store_id and ws.user_id = v_target
        and ws.status = 'scheduled'
        and ws.starts_at <= (p_payload ->> 'checkedAt')::timestamptz
        and ws.ends_at >= (p_payload ->> 'checkedAt')::timestamptz
      order by ws.starts_at limit 1;
      insert into public.attendance_entries(
        id,store_id,user_id,work_shift_id,checked_in_at,notes,source_device_id
      ) values (
        p_entity_id,p_store_id,v_target,v_shift,
        (p_payload ->> 'checkedAt')::timestamptz,
        nullif(btrim(p_payload ->> 'notes'),''),p_device_id
      );
    elsif p_operation_type = 'attendance.checked_out' then
      update public.attendance_entries set
        checked_out_at = (p_payload ->> 'checkedAt')::timestamptz,
        notes = coalesce(nullif(btrim(p_payload ->> 'notes'),''),notes)
      where id = p_entity_id and store_id = p_store_id
        and user_id = v_target and checked_out_at is null;
      if not found then
        raise exception using errcode = '40001', message = 'Entrada no disponible';
      end if;
    else
      raise exception using errcode = '22023', message = 'Operación de personal no soportada';
    end if;
    select ae.version,jsonb_build_object(
      'id',ae.id,'store_id',ae.store_id,'user_id',ae.user_id,
      'work_shift_id',ae.work_shift_id,'checked_in_at',ae.checked_in_at,
      'checked_out_at',ae.checked_out_at,'notes',ae.notes,
      'device_id',ae.source_device_id,'created_at',ae.created_at,
      'updated_at',ae.updated_at,'version',ae.version
    ) into v_version,v_payload from public.attendance_entries ae
    where ae.id = p_entity_id;
  end if;
  insert into public.change_log(
    store_id,source_device_id,operation_id,entity_type,entity_id,
    operation,entity_version,payload,changed_at
  ) values (
    p_store_id,p_device_id,p_operation_id,
    case
      when p_operation_type = 'role_permission.updated' then 'role_permission'
      when p_operation_type = 'work_shift.scheduled' then 'work_shift'
      else 'attendance_entry'
    end,
    p_entity_id,p_operation_type,v_version,v_payload,now()
  );
  return jsonb_build_object('id',p_entity_id,'version',v_version,'applied',true);
end;
$$;
revoke all on function private.apply_personnel_operation_sync(
  uuid,uuid,uuid,uuid,uuid,text,jsonb
) from public,anon,authenticated;

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
    raise exception 'No se encontró extensión B4 para personal';
  end if;
  v_replacement :=
    'when v_operation_type in (
              ''role_permission.updated'',
              ''work_shift.scheduled'',
              ''attendance.checked_in'',
              ''attendance.checked_out''
            ) then
            v_result := private.apply_personnel_operation_sync(
              p_store_id,p_device_id,v_actor_user_id,v_entity_id,
              v_operation_id,v_operation_type,v_payload
            );
            v_server_entity_id := v_entity_id;

          ' || v_marker;
  execute replace(v_definition,v_marker,v_replacement);
end;
$migration$;
