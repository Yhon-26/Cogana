-- B1 — Identidad, organizaciones, tiendas y dispositivos
-- Proyecto Coguana · Supabase/PostgreSQL
-- Referencia: Esquema Backend v1.0 §4 y §11
--
-- Esta migración crea las tablas centrales de identidad con Row Level Security
-- habilitado desde el primer día. Nada se expone sin una política explícita.
--
-- Reglas (SEC-BE-01..SEC-BE-06):
--   * RLS activo en toda tabla expuesta del esquema public.
--   * El acceso se resuelve por membresía activa (store_memberships).
--   * Las funciones SECURITY DEFINER son pocas, con search_path fijo.
--   * Las claves service_role nunca se usan dentro de políticas.

-- =============================================================================
-- 1. Esquema privado de helpers
-- =============================================================================

create schema if not exists private;

-- Marcas de tiempo centralizadas (trigger para updated_at).
create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Devuelve el uuid del usuario autenticado actual.
create or replace function private.current_user_id()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  return auth.uid();
end;
$$;

-- Devuelve verdadero si el usuario actual pertenece a la organización indicada.
create or replace function private.is_organization_member(org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from store_memberships m
    join stores s on s.id = m.store_id
    where m.user_id = (select auth.uid())
      and m.is_active = true
      and s.organization_id = org_id
  );
end;
$$;

-- Devuelve verdadero si el usuario actual es miembro de la tienda indicada.
create or replace function private.is_store_member(store_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from store_memberships m
    where m.user_id = (select auth.uid())
      and m.is_active = true
      and m.store_id = is_store_member.store_id
  );
end;
$$;

-- Devuelve el rol del usuario actual en la tienda indicada (o null).
create or replace function private.current_store_role(store_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return (
    select m.role
    from store_memberships m
    where m.user_id = (select auth.uid())
      and m.is_active = true
      and m.store_id = current_store_role.store_id
    limit 1
  );
end;
$$;

-- Devuelve verdadero si el usuario actual es administrador de la tienda.
create or replace function private.is_store_admin(store_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from store_memberships m
    where m.user_id = (select auth.uid())
      and m.is_active = true
      and m.store_id = is_store_admin.store_id
      and m.role in ('owner', 'admin')
  );
end;
$$;

-- =============================================================================
-- 2. Organizaciones y tiendas
-- =============================================================================

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  tax_id text,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger organizations_set_updated_at
  before update on organizations
  for each row execute function private.set_updated_at();

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id)
    on delete restrict on update cascade,
  code text not null,
  name text not null,
  address text,
  timezone text not null default 'America/Lima',
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, code)
);

create trigger stores_set_updated_at
  before update on stores
  for each row execute function private.set_updated_at();

create index stores_organization_active
  on stores (organization_id, status) where deleted_at is null;

-- =============================================================================
-- 3. Perfiles de usuario
-- =============================================================================

-- profiles extiende auth.users con datos de negocio.
-- id = auth.users.id (relación 1:1).
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade on update cascade,
  full_name text,
  phone text,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function private.set_updated_at();

-- Sincroniza la creación de profiles cuando se inserta un usuario en auth.users.
-- El primer administrador se gestiona manualmente fuera de banda (bootstrap).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'phone')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- 4. Membresías de tienda (vínculo usuario ↔ tienda ↔ rol)
-- =============================================================================

create table if not exists store_memberships (
  store_id uuid not null references stores(id) on delete cascade on update cascade,
  user_id uuid not null references auth.users(id) on delete cascade on update cascade,
  role text not null check (role in ('owner', 'admin', 'seller', 'driver')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create trigger store_memberships_set_updated_at
  before update on store_memberships
  for each row execute function private.set_updated_at();

create index store_memberships_user_active
  on store_memberships (user_id) where is_active = true;

create index store_memberships_store_active
  on store_memberships (store_id) where is_active = true;

-- =============================================================================
-- 5. Dispositivos autorizados
-- =============================================================================

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete restrict on update cascade,
  name text not null,
  platform text check (platform in ('android', 'ios', 'web')),
  app_version text,
  status text not null default 'authorized'
    check (status in ('authorized', 'revoked', 'lost')),
  last_sync_at timestamptz,
  registered_by uuid references auth.users(id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (store_id, id)
);

create trigger devices_set_updated_at
  before update on devices
  for each row execute function private.set_updated_at();

create index devices_store_active
  on devices (store_id, status) where deleted_at is null;

-- =============================================================================
-- 6. Habilitación de RLS
-- =============================================================================
-- SEC-BE-01: RLS debe estar habilitado antes de exponer una tabla al cliente.

alter table organizations enable row level security;
alter table stores enable row level security;
alter table profiles enable row level security;
alter table store_memberships enable row level security;
alter table devices enable row level security;

-- =============================================================================
-- 7. Permisos mínimos por rol Postgres
-- =============================================================================

grant select on organizations to authenticated;
grant select on stores to authenticated;
grant select, insert, update on profiles to authenticated;
grant select, insert, update on store_memberships to authenticated;
grant select, insert, update on devices to authenticated;

-- service_role hereda bypassrls; no necesita políticas.
grant all on organizations, stores, profiles, store_memberships, devices to service_role;

-- =============================================================================
-- 8. Políticas RLS — organizations
-- =============================================================================

create policy organizations_select_member
  on organizations for select
  to authenticated
  using ( private.is_organization_member(id) );

-- =============================================================================
-- 9. Políticas RLS — stores
-- =============================================================================

create policy stores_select_member
  on stores for select
  to authenticated
  using ( private.is_store_member(id) );

-- =============================================================================
-- 10. Políticas RLS — profiles
-- =============================================================================

-- El usuario lee y edita solo su propio perfil.
-- BE-05 (Esquema Backend): "Un cliente solo accede a sus pedidos y direcciones";
-- los perfiles siguen el mismo principio de propiedad.
create policy profiles_select_self
  on profiles for select
  to authenticated
  using ( id = (select auth.uid()) );

create policy profiles_update_self
  on profiles for update
  to authenticated
  using ( id = (select auth.uid()) )
  with check ( id = (select auth.uid()) );

create policy profiles_insert_self
  on profiles for insert
  to authenticated
  with check ( id = (select auth.uid()) );

-- =============================================================================
-- 11. Políticas RLS — store_memberships
-- =============================================================================

-- Función helper security definer para evitar recursión RLS.
create or replace function private.user_store_ids()
returns uuid[]
language sql
security definer
set search_path = public
as $$
  select array_agg(store_id)
  from store_memberships
  where user_id = (select auth.uid())
    and is_active = true;
$$;

-- Un usuario ve las membresías en las que participa.
-- Usa private.user_store_ids() (security definer) para evitar recursión RLS.
create policy memberships_select_participant
  on store_memberships for select
  to authenticated
  using ( store_id = any (private.user_store_ids()) );

-- Solo un admin de la tienda puede crear nuevas membresías.
create policy memberships_insert_store_admin
  on store_memberships for insert
  to authenticated
  with check ( private.is_store_admin(store_id) );

-- Solo un admin puede modificar membresías (desactivar/cambiar rol).
-- No puede degradarse a sí mismo ni revocarse si es el último admin.
create policy memberships_update_store_admin
  on store_memberships for update
  to authenticated
  using ( private.is_store_admin(store_id) )
  with check ( private.is_store_admin(store_id) );

-- =============================================================================
-- 12. Políticas RLS — devices
-- =============================================================================

-- Los miembros de la tienda ven sus dispositivos autorizados.
create policy devices_select_member
  on devices for select
  to authenticated
  using ( private.is_store_member(store_id) );

-- Solo el admin registra o revoca dispositivos.
create policy devices_insert_store_admin
  on devices for insert
  to authenticated
  with check ( private.is_store_admin(store_id) );

create policy devices_update_store_admin
  on devices for update
  to authenticated
  using ( private.is_store_admin(store_id) )
  with check ( private.is_store_admin(store_id) );

-- =============================================================================
-- 13. Comentario de auditoría
-- =============================================================================

comment on schema private is
  'Helpers internos de Coguana. No consume credenciales service_role.';

comment on table organizations is
  'Organizaciones Coguana. Una organización agrupa varias tiendas.';

comment on table stores is
  'Tiendas físicas de Coguana. Santa Anita es el primer registro.';

comment on table store_memberships is
  'Vínculo usuario ↔ tienda ↔ rol. La PK compuesta evita duplicados.';

comment on table devices is
  'Dispositivos autorizados por tienda. Revocables sin borrar históricos.';