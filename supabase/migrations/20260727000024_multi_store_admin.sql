-- Administración central segura de sucursales.
-- Las tablas base conservan SELECT por RLS y no exponen escritura directa.

create or replace function public.get_organization_stores(
  p_origin_store_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  if not private.is_store_admin(p_origin_store_id) then
    raise exception using errcode = '42501', message = 'Solo administrador';
  end if;

  select s.organization_id
  into v_organization_id
  from public.stores s
  where s.id = p_origin_store_id
    and s.deleted_at is null;

  if v_organization_id is null then
    raise exception using errcode = 'P0002', message = 'Tienda de origen no encontrada';
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'code', s.code,
          'name', s.name,
          'address', s.address,
          'timezone', s.timezone,
          'status', s.status
        )
        order by s.name, s.code
      ),
      '[]'::jsonb
    )
    from public.stores s
    where s.organization_id = v_organization_id
      and s.deleted_at is null
  );
end;
$$;

create or replace function public.save_store_branch(
  p_origin_store_id uuid,
  p_store_id uuid,
  p_code text,
  p_name text,
  p_address text,
  p_timezone text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_origin_role text;
  v_organization_id uuid;
  v_target_organization_id uuid;
  v_store_id uuid;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_timezone text := coalesce(nullif(btrim(p_timezone), ''), 'America/Lima');
  v_status text := coalesce(nullif(btrim(p_status), ''), 'active');
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Inicia sesion';
  end if;

  select s.organization_id, private.current_store_role(s.id)
  into v_organization_id, v_origin_role
  from public.stores s
  where s.id = p_origin_store_id
    and s.deleted_at is null;

  if v_organization_id is null or v_origin_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'Solo administrador';
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{1,31}$' then
    raise exception using errcode = '22023', message = 'Codigo de sucursal invalido';
  end if;
  if v_name = '' then
    raise exception using errcode = '22023', message = 'Nombre de sucursal requerido';
  end if;
  if v_status not in ('active', 'suspended', 'archived') then
    raise exception using errcode = '22023', message = 'Estado de sucursal invalido';
  end if;

  if p_store_id is null then
    if v_origin_role <> 'owner' then
      raise exception using errcode = '42501', message = 'Solo propietario puede crear sucursales';
    end if;

    insert into public.stores(
      organization_id, code, name, address, timezone, status
    )
    values (
      v_organization_id, v_code, v_name, nullif(btrim(p_address), ''),
      v_timezone, v_status
    )
    returning id into v_store_id;

    insert into public.store_memberships(store_id, user_id, role)
    values (v_store_id, v_actor, 'owner');
  else
    select s.organization_id
    into v_target_organization_id
    from public.stores s
    where s.id = p_store_id
      and s.deleted_at is null
    for update;

    if v_target_organization_id is null then
      raise exception using errcode = 'P0002', message = 'Sucursal no encontrada';
    end if;
    if v_target_organization_id <> v_organization_id then
      raise exception using errcode = '42501', message = 'Sucursal fuera de la organizacion';
    end if;
    if v_origin_role <> 'owner' and not private.is_store_admin(p_store_id) then
      raise exception using errcode = '42501', message = 'Sin permiso sobre la sucursal';
    end if;

    update public.stores
    set code = v_code,
        name = v_name,
        address = nullif(btrim(p_address), ''),
        timezone = v_timezone,
        status = v_status
    where id = p_store_id;
    v_store_id := p_store_id;
  end if;

  insert into public.store_settings(store_id, address, updated_by)
  values (v_store_id, nullif(btrim(p_address), ''), v_actor)
  on conflict (store_id) do update
  set address = excluded.address,
      updated_by = v_actor;

  return jsonb_build_object(
    'id', v_store_id,
    'code', v_code,
    'name', v_name,
    'address', nullif(btrim(p_address), ''),
    'timezone', v_timezone,
    'status', v_status,
    'created', p_store_id is null
  );
end;
$$;

revoke all on function public.get_organization_stores(uuid)
  from public, anon, authenticated;
revoke all on function public.save_store_branch(
  uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.get_organization_stores(uuid)
  to authenticated, service_role;
grant execute on function public.save_store_branch(
  uuid, uuid, text, text, text, text, text
) to authenticated, service_role;

