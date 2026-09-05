-- Endurece las funciones SECURITY DEFINER heredadas que aún usaban un
-- search_path mutable (public o pg_catalog). El estándar del proyecto es
-- set search_path = '' con referencias calificadas, para evitar el secuestro
-- de search_path. Se recalifican las referencias no calificadas a tablas
-- públicas. create or replace conserva los privilegios existentes.

-- =============================================================================
-- Helpers de identidad (B1)
-- =============================================================================

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.current_user_id()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return auth.uid();
end;
$$;

create or replace function private.is_organization_member(org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.store_memberships m
    join public.stores s on s.id = m.store_id
    where m.user_id = (select auth.uid())
      and m.is_active = true
      and s.organization_id = org_id
  );
end;
$$;

create or replace function private.is_store_member(store_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.store_memberships m
    where m.user_id = (select auth.uid())
      and m.is_active = true
      and m.store_id = is_store_member.store_id
  );
end;
$$;

create or replace function private.current_store_role(store_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  return (
    select m.role
    from public.store_memberships m
    where m.user_id = (select auth.uid())
      and m.is_active = true
      and m.store_id = current_store_role.store_id
    limit 1
  );
end;
$$;

create or replace function private.is_store_admin(store_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.store_memberships m
    where m.user_id = (select auth.uid())
      and m.is_active = true
      and m.store_id = is_store_admin.store_id
      and m.role in ('owner', 'admin')
  );
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'phone')
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function private.user_store_ids()
returns uuid[]
language sql
security definer
set search_path = ''
as $$
  select array_agg(store_id)
  from public.store_memberships
  where user_id = (select auth.uid())
    and is_active = true;
$$;

-- =============================================================================
-- Helpers de catálogo (B2)
-- =============================================================================

create or replace function private.bump_catalog_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;

create or replace function private.prevent_immutable_catalog_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I es insert-only; use un evento compensatorio', tg_table_name);
end;
$$;

create or replace function private.is_organization_admin(org_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.store_memberships m
    join public.stores s on s.id = m.store_id
    where m.user_id = (select auth.uid())
      and m.is_active = true
      and m.role in ('owner', 'admin')
      and s.organization_id = org_id
  );
$$;

create or replace function private.validate_product_category_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_organization_id uuid;
  v_category_organization_id uuid;
begin
  select s.organization_id
    into v_store_organization_id
  from public.stores s
  where s.id = new.store_id;

  select c.organization_id
    into v_category_organization_id
  from public.categories c
  where c.id = new.category_id;

  if v_store_organization_id is null or v_category_organization_id is null then
    raise exception using
      errcode = '23503',
      message = 'La tienda o la categoria indicada no existe';
  end if;

  if v_store_organization_id <> v_category_organization_id then
    raise exception using
      errcode = '23514',
      message = 'La categoria debe pertenecer a la organizacion de la tienda';
  end if;

  return new;
end;
$$;
