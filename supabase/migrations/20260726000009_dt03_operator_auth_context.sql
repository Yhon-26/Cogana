-- DT-03: contexto autenticado para vincular una cuenta Supabase individual
-- con un operador/PIN local. El PIN nunca se almacena en PostgreSQL.

create or replace function public.get_my_operator_context(p_store_id uuid)
returns table (
  auth_user_id uuid,
  full_name text,
  store_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using
      errcode = '28000',
      message = 'Se requiere una sesion autenticada';
  end if;

  return query
  select
    m.user_id,
    p.full_name,
    m.role
  from public.store_memberships m
  join public.profiles p on p.id = m.user_id
  join public.stores s on s.id = m.store_id
  where m.store_id = p_store_id
    and m.user_id = auth.uid()
    and m.is_active = true
    and s.status = 'active';

  if not found then
    raise exception using
      errcode = '42501',
      message = 'La cuenta no tiene acceso activo a la tienda';
  end if;
end;
$$;

revoke all on function public.get_my_operator_context(uuid)
  from public, anon, authenticated;
grant execute on function public.get_my_operator_context(uuid)
  to authenticated, service_role;

comment on function public.get_my_operator_context(uuid) is
  'Devuelve identidad y rol de la sesion individual para vinculo con PIN local.';
