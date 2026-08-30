-- Endurece perfiles/membresias y agrega baja de cuenta verificable.

revoke insert, update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create or replace function private.protect_last_store_administrator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removes_privilege boolean;
begin
  v_removes_privilege :=
    old.is_active
    and old.role in ('owner', 'admin')
    and (
      tg_op = 'DELETE'
      or not new.is_active
      or new.role not in ('owner', 'admin')
    );

  if not v_removes_privilege then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(old.store_id::text, 0)
  );
  if not exists (
    select 1
    from public.store_memberships m
    where m.store_id = old.store_id
      and m.user_id <> old.user_id
      and m.is_active
      and m.role in ('owner', 'admin')
  ) then
    raise exception using
      errcode = '23514',
      message = 'No se puede retirar al ultimo administrador activo de la tienda';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger store_memberships_protect_last_administrator
  before update of role, is_active or delete
  on public.store_memberships
  for each row execute function private.protect_last_store_administrator();

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id)
    on delete set null on update cascade,
  requested_by uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'prepared', 'completed', 'failed')),
  requested_at timestamptz not null default now(),
  prepared_at timestamptz,
  completed_at timestamptz,
  error_message text,
  version bigint not null default 1 check (version >= 1),
  unique (requested_by)
);

create trigger account_deletion_requests_bump_version
  before update on public.account_deletion_requests
  for each row execute function private.bump_catalog_version();

alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;
grant select on public.account_deletion_requests to authenticated;

create policy account_deletion_requests_select_self
  on public.account_deletion_requests
  for select
  to authenticated
  using (requested_by = auth.uid());

create or replace function public.prepare_my_account_deletion(
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Sesion requerida';
  end if;
  if p_confirmation <> 'ELIMINAR' then
    raise exception using errcode = '22023', message = 'Confirmacion de baja invalida';
  end if;
  if exists (
    select 1
    from public.store_memberships own
    where own.user_id = v_actor
      and own.is_active
      and own.role in ('owner', 'admin')
      and not exists (
        select 1
        from public.store_memberships other
        where other.store_id = own.store_id
          and other.user_id <> v_actor
          and other.is_active
          and other.role in ('owner', 'admin')
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Transfiere la administracion de la tienda antes de eliminar tu cuenta';
  end if;

  insert into public.account_deletion_requests (
    user_id, requested_by, status
  ) values (
    v_actor, v_actor, 'pending'
  )
  on conflict (requested_by) do update
  set user_id = excluded.user_id,
      status = 'pending',
      requested_at = now(),
      prepared_at = null,
      completed_at = null,
      error_message = null
  returning id into v_request_id;

  update public.customer_addresses ca
  set label = 'Eliminada',
      address = 'Datos eliminados',
      district = 'Datos eliminados',
      instructions = null,
      is_default = false
  from public.customers c
  where c.id = ca.customer_id
    and c.store_id = ca.store_id
    and c.auth_user_id = v_actor;

  update public.customers
  set auth_user_id = null,
      name = 'Cuenta eliminada',
      phone = 'deleted-' || replace(v_actor::text, '-', ''),
      email = null,
      status = 'inactive'
  where auth_user_id = v_actor;

  update public.profiles
  set full_name = 'Cuenta eliminada',
      phone = null,
      status = 'archived',
      deleted_at = now()
  where id = v_actor;

  update public.store_memberships
  set is_active = false
  where user_id = v_actor and is_active;

  update public.account_deletion_requests
  set status = 'prepared', prepared_at = now()
  where id = v_request_id;

  return jsonb_build_object(
    'requestId', v_request_id,
    'status', 'prepared',
    'userId', v_actor
  );
end;
$$;

create or replace function public.complete_account_deletion_request(
  p_user_id uuid,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Solo service_role';
  end if;
  update public.account_deletion_requests
  set status = case when p_error is null then 'completed' else 'failed' end,
      completed_at = case when p_error is null then now() else null end,
      error_message = left(p_error, 500)
  where requested_by = p_user_id;
end;
$$;

revoke all on function public.prepare_my_account_deletion(text)
  from public, anon, authenticated;
grant execute on function public.prepare_my_account_deletion(text)
  to authenticated, service_role;

revoke all on function public.complete_account_deletion_request(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_account_deletion_request(uuid, text)
  to service_role;

comment on function public.prepare_my_account_deletion(text) is
  'Anonimiza PII y desactiva accesos antes del borrado suave del usuario Auth.';
