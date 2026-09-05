-- B2 - Catalogo, presentaciones e inventario
-- Proyecto Cogana - Supabase/PostgreSQL
-- Referencia: Esquema Backend v1.0 secciones 3, 5, 11, 12 y 15
--
-- Decisiones aplicadas:
--   * Dinero y cantidades se almacenan en bigint.
--   * Todo dato operativo pertenece a una tienda.
--   * Precio y stock solo cambian mediante funciones transaccionales.
--   * operation_id hace idempotentes los cambios de precio e inventario.
--   * Los historicos son insert-only.
--   * RLS se habilita antes de conceder acceso a authenticated.

-- =============================================================================
-- 1. Helpers privados
-- =============================================================================

-- Mantiene updated_at e incrementa la version en toda actualizacion mutable.
create or replace function private.bump_catalog_version()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;

-- Protege tablas historicas contra UPDATE y DELETE, incluso por error operativo.
create or replace function private.prevent_immutable_catalog_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I es insert-only; use un evento compensatorio', tg_table_name);
end;
$$;

-- Las categorias pertenecen a una organizacion, no a una tienda concreta.
create or replace function private.is_organization_admin(org_id uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog
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

-- =============================================================================
-- 2. Categorias y productos
-- =============================================================================

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id)
    on delete restrict on update cascade,
  name text not null check (btrim(name) <> ''),
  slug text not null check (btrim(slug) <> ''),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (organization_id, slug)
);

create trigger categories_bump_version
  before update on public.categories
  for each row execute function private.bump_catalog_version();

create index categories_organization_active_sort
  on public.categories (organization_id, is_active, sort_order, name);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  sku text not null check (btrim(sku) <> ''),
  name text not null check (btrim(name) <> ''),
  category_id uuid not null references public.categories(id)
    on delete restrict on update cascade,
  base_unit text not null check (base_unit in ('gram', 'unit')),
  pricing_quantity bigint not null check (pricing_quantity > 0),
  price_cents bigint not null check (price_cents >= 0),
  cost_cents bigint not null default 0 check (cost_cents >= 0),
  stock_quantity bigint not null default 0 check (stock_quantity >= 0),
  minimum_stock_quantity bigint not null default 0
    check (minimum_stock_quantity >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (store_id, sku),
  unique (id, store_id)
);

-- Impide asociar un producto con una categoria de otra organizacion.
create or replace function private.validate_product_category_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
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

create trigger products_validate_category_organization
  before insert or update of store_id, category_id on public.products
  for each row execute function private.validate_product_category_organization();

create trigger products_bump_version
  before update on public.products
  for each row execute function private.bump_catalog_version();

create index products_store_active_category_name
  on public.products (store_id, is_active, category_id, name);

create index products_store_low_stock
  on public.products (store_id, stock_quantity, minimum_stock_quantity)
  where is_active = true;

-- =============================================================================
-- 3. Presentaciones e imagenes
-- =============================================================================

create table public.product_presentations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  product_id uuid not null,
  sku text not null check (btrim(sku) <> ''),
  name text not null check (btrim(name) <> ''),
  kind text not null check (kind in ('unit', 'package', 'box', 'sack')),
  conversion_factor bigint not null check (conversion_factor > 0),
  price_mode text not null default 'calculated'
    check (price_mode in ('calculated', 'fixed')),
  fixed_price_cents bigint check (fixed_price_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (store_id, sku),
  unique (id, store_id),
  foreign key (product_id, store_id)
    references public.products (id, store_id)
    on delete restrict on update cascade,
  check (
    (price_mode = 'calculated' and fixed_price_cents is null)
    or
    (price_mode = 'fixed' and fixed_price_cents is not null)
  )
);

create trigger product_presentations_bump_version
  before update on public.product_presentations
  for each row execute function private.bump_catalog_version();

create index product_presentations_store_product_active
  on public.product_presentations (store_id, product_id, is_active, name);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  product_id uuid not null,
  storage_path text not null check (btrim(storage_path) <> ''),
  sort_order integer not null default 0 check (sort_order >= 0),
  alt_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (storage_path),
  unique (product_id, sort_order),
  foreign key (product_id, store_id)
    references public.products (id, store_id)
    on delete cascade on update cascade
);

create trigger product_images_bump_version
  before update on public.product_images
  for each row execute function private.bump_catalog_version();

create index product_images_store_product_sort
  on public.product_images (store_id, product_id, sort_order);

-- =============================================================================
-- 4. Historicos de precio e inventario
-- =============================================================================

create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  product_id uuid not null,
  old_price_cents bigint not null check (old_price_cents >= 0),
  new_price_cents bigint not null check (new_price_cents >= 0),
  reason text not null check (btrim(reason) <> ''),
  actor_user_id uuid not null references auth.users(id)
    on delete restrict on update cascade,
  device_id uuid,
  operation_id uuid not null unique,
  product_version bigint not null check (product_version >= 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version = 1),
  foreign key (product_id, store_id)
    references public.products (id, store_id)
    on delete restrict on update cascade,
  foreign key (store_id, device_id)
    references public.devices (store_id, id)
    on delete restrict on update cascade,
  check (old_price_cents <> new_price_cents)
);

create trigger price_history_is_immutable
  before update or delete on public.price_history
  for each row execute function private.prevent_immutable_catalog_change();

create index price_history_store_product_created
  on public.price_history (store_id, product_id, created_at desc);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  product_id uuid not null,
  movement_type text not null check (
    movement_type in ('opening', 'purchase', 'sale', 'adjustment', 'waste', 'return')
  ),
  quantity_delta bigint not null check (quantity_delta <> 0),
  resulting_quantity bigint not null check (resulting_quantity >= 0),
  reason text not null check (btrim(reason) <> ''),
  reference_type text,
  reference_id uuid,
  actor_user_id uuid not null references auth.users(id)
    on delete restrict on update cascade,
  device_id uuid,
  operation_id uuid not null unique,
  product_version bigint not null check (product_version >= 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version = 1),
  foreign key (product_id, store_id)
    references public.products (id, store_id)
    on delete restrict on update cascade,
  foreign key (store_id, device_id)
    references public.devices (store_id, id)
    on delete restrict on update cascade,
  check (
    (reference_type is null and reference_id is null)
    or
    (reference_type is not null and btrim(reference_type) <> '' and reference_id is not null)
  )
);

create trigger inventory_movements_are_immutable
  before update or delete on public.inventory_movements
  for each row execute function private.prevent_immutable_catalog_change();

create index inventory_movements_store_product_created
  on public.inventory_movements (store_id, product_id, created_at desc);

create index inventory_movements_store_created
  on public.inventory_movements (store_id, created_at desc);

-- =============================================================================
-- 5. Row Level Security y privilegios
-- =============================================================================

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_presentations enable row level security;
alter table public.product_images enable row level security;
alter table public.price_history enable row level security;
alter table public.inventory_movements enable row level security;

revoke all on public.categories from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.product_presentations from anon, authenticated;
revoke all on public.product_images from anon, authenticated;
revoke all on public.price_history from anon, authenticated;
revoke all on public.inventory_movements from anon, authenticated;

grant select on public.categories to authenticated;
grant insert on public.categories to authenticated;
grant update (name, slug, sort_order, is_active) on public.categories to authenticated;

grant select on public.products to authenticated;
grant insert on public.products to authenticated;
grant update (
  sku, name, category_id, base_unit, pricing_quantity, cost_cents,
  minimum_stock_quantity, is_active
) on public.products to authenticated;

grant select on public.product_presentations to authenticated;
grant insert on public.product_presentations to authenticated;
grant update (
  sku, name, kind, conversion_factor, price_mode, fixed_price_cents, is_active
) on public.product_presentations to authenticated;

grant select, insert, delete on public.product_images to authenticated;
grant update (storage_path, sort_order, alt_text) on public.product_images
  to authenticated;

grant select on public.price_history to authenticated;
grant select on public.inventory_movements to authenticated;

grant all on public.categories, public.products, public.product_presentations,
  public.product_images, public.price_history, public.inventory_movements
  to service_role;

create policy categories_select_organization_member
  on public.categories for select
  to authenticated
  using (private.is_organization_member(organization_id));

create policy categories_insert_organization_admin
  on public.categories for insert
  to authenticated
  with check (private.is_organization_admin(organization_id));

create policy categories_update_organization_admin
  on public.categories for update
  to authenticated
  using (private.is_organization_admin(organization_id))
  with check (private.is_organization_admin(organization_id));

create policy products_select_store_member
  on public.products for select
  to authenticated
  using (private.is_store_member(store_id));

create policy products_insert_store_admin
  on public.products for insert
  to authenticated
  with check (private.is_store_admin(store_id));

create policy products_update_store_admin
  on public.products for update
  to authenticated
  using (private.is_store_admin(store_id))
  with check (private.is_store_admin(store_id));

create policy product_presentations_select_store_member
  on public.product_presentations for select
  to authenticated
  using (private.is_store_member(store_id));

create policy product_presentations_insert_store_admin
  on public.product_presentations for insert
  to authenticated
  with check (private.is_store_admin(store_id));

create policy product_presentations_update_store_admin
  on public.product_presentations for update
  to authenticated
  using (private.is_store_admin(store_id))
  with check (private.is_store_admin(store_id));

create policy product_images_select_store_member
  on public.product_images for select
  to authenticated
  using (private.is_store_member(store_id));

create policy product_images_insert_store_admin
  on public.product_images for insert
  to authenticated
  with check (private.is_store_admin(store_id));

create policy product_images_update_store_admin
  on public.product_images for update
  to authenticated
  using (private.is_store_admin(store_id))
  with check (private.is_store_admin(store_id));

create policy product_images_delete_store_admin
  on public.product_images for delete
  to authenticated
  using (private.is_store_admin(store_id));

create policy price_history_select_store_member
  on public.price_history for select
  to authenticated
  using (private.is_store_member(store_id));

create policy inventory_movements_select_store_member
  on public.inventory_movements for select
  to authenticated
  using (private.is_store_member(store_id));

-- =============================================================================
-- 6. RPC idempotente: cambio de precio
-- =============================================================================

create or replace function public.change_product_price(
  p_product_id uuid,
  p_new_price_cents bigint,
  p_reason text,
  p_operation_id uuid,
  p_device_id uuid default null
)
returns table (
  product_id uuid,
  store_id uuid,
  price_cents bigint,
  product_version bigint,
  history_id uuid,
  operation_id uuid,
  applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_reason text := pg_catalog.btrim(p_reason);
  v_product public.products%rowtype;
  v_existing public.price_history%rowtype;
  v_history_id uuid := gen_random_uuid();
  v_product_version bigint;
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'Se requiere una sesion autenticada';
  end if;
  if p_operation_id is null then
    raise exception using errcode = '22004', message = 'operation_id es obligatorio';
  end if;
  if p_new_price_cents is null or p_new_price_cents < 0 then
    raise exception using errcode = '22023', message = 'El precio debe ser no negativo';
  end if;
  if v_reason is null or v_reason = '' then
    raise exception using errcode = '22023', message = 'El cambio de precio requiere un motivo';
  end if;

  -- Serializa reintentos concurrentes con el mismo operation_id.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::text, 0)
  );

  select ph.*
    into v_existing
  from public.price_history ph
  where ph.operation_id = p_operation_id;

  if found then
    if not private.is_store_admin(v_existing.store_id) then
      raise exception using errcode = '42501', message = 'Solo un administrador puede cambiar precios';
    end if;
    if v_existing.product_id <> p_product_id
      or v_existing.new_price_cents <> p_new_price_cents
      or v_existing.reason <> v_reason
      or v_existing.actor_user_id <> v_actor_user_id
      or v_existing.device_id is distinct from p_device_id
    then
      raise exception using
        errcode = '22023',
        message = 'operation_id ya fue usado con otro cambio de precio';
    end if;

    return query
    select
      v_existing.product_id,
      v_existing.store_id,
      v_existing.new_price_cents,
      v_existing.product_version,
      v_existing.id,
      v_existing.operation_id,
      false;
    return;
  end if;

  select p.*
    into v_product
  from public.products p
  where p.id = p_product_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'El producto no existe';
  end if;
  if not private.is_store_admin(v_product.store_id) then
    raise exception using errcode = '42501', message = 'Solo un administrador puede cambiar precios';
  end if;
  if p_device_id is not null and not exists (
    select 1
    from public.devices d
    where d.id = p_device_id
      and d.store_id = v_product.store_id
      and d.status = 'authorized'
      and d.deleted_at is null
  ) then
    raise exception using
      errcode = '22023',
      message = 'El dispositivo no esta autorizado para la tienda';
  end if;
  if v_product.price_cents = p_new_price_cents then
    raise exception using errcode = '22023', message = 'El precio nuevo debe ser diferente al actual';
  end if;

  update public.products p
  set price_cents = p_new_price_cents
  where p.id = v_product.id
  returning p.version into v_product_version;

  insert into public.price_history (
    id, store_id, product_id, old_price_cents, new_price_cents,
    reason, actor_user_id, device_id, operation_id, product_version
  ) values (
    v_history_id, v_product.store_id, v_product.id, v_product.price_cents,
    p_new_price_cents, v_reason, v_actor_user_id, p_device_id,
    p_operation_id, v_product_version
  );

  return query
  select
    v_product.id,
    v_product.store_id,
    p_new_price_cents,
    v_product_version,
    v_history_id,
    p_operation_id,
    true;
end;
$$;

revoke all on function public.change_product_price(uuid, bigint, text, uuid, uuid)
  from public;
grant execute on function public.change_product_price(uuid, bigint, text, uuid, uuid)
  to authenticated, service_role;

-- =============================================================================
-- 7. RPC idempotente: ajuste de inventario
-- =============================================================================

create or replace function public.adjust_inventory(
  p_product_id uuid,
  p_quantity_delta bigint,
  p_type text,
  p_reason text,
  p_operation_id uuid,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_device_id uuid default null
)
returns table (
  product_id uuid,
  store_id uuid,
  stock_quantity bigint,
  product_version bigint,
  movement_id uuid,
  operation_id uuid,
  applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_reason text := pg_catalog.btrim(p_reason);
  v_reference_type text := pg_catalog.btrim(p_reference_type);
  v_product public.products%rowtype;
  v_existing public.inventory_movements%rowtype;
  v_movement_id uuid := gen_random_uuid();
  v_resulting_quantity bigint;
  v_product_version bigint;
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'Se requiere una sesion autenticada';
  end if;
  if p_operation_id is null then
    raise exception using errcode = '22004', message = 'operation_id es obligatorio';
  end if;
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception using errcode = '22023', message = 'quantity_delta debe ser distinto de cero';
  end if;
  if p_type is null or p_type not in (
    'opening', 'purchase', 'sale', 'adjustment', 'waste', 'return'
  ) then
    raise exception using errcode = '22023', message = 'Tipo de movimiento invalido';
  end if;
  if v_reason is null or v_reason = '' then
    raise exception using errcode = '22023', message = 'El movimiento requiere un motivo';
  end if;
  if (v_reference_type is null) <> (p_reference_id is null) then
    raise exception using
      errcode = '22023',
      message = 'reference_type y reference_id deben enviarse juntos';
  end if;
  if v_reference_type = '' then
    raise exception using errcode = '22023', message = 'reference_type no puede estar vacio';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::text, 0)
  );

  select im.*
    into v_existing
  from public.inventory_movements im
  where im.operation_id = p_operation_id;

  if found then
    if not private.is_store_admin(v_existing.store_id) then
      raise exception using errcode = '42501', message = 'Solo un administrador puede ajustar inventario';
    end if;
    if v_existing.product_id <> p_product_id
      or v_existing.quantity_delta <> p_quantity_delta
      or v_existing.movement_type <> p_type
      or v_existing.reason <> v_reason
      or v_existing.reference_type is distinct from v_reference_type
      or v_existing.reference_id is distinct from p_reference_id
      or v_existing.actor_user_id <> v_actor_user_id
      or v_existing.device_id is distinct from p_device_id
    then
      raise exception using
        errcode = '22023',
        message = 'operation_id ya fue usado con otro movimiento de inventario';
    end if;

    return query
    select
      v_existing.product_id,
      v_existing.store_id,
      v_existing.resulting_quantity,
      v_existing.product_version,
      v_existing.id,
      v_existing.operation_id,
      false;
    return;
  end if;

  select p.*
    into v_product
  from public.products p
  where p.id = p_product_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'El producto no existe';
  end if;
  if not private.is_store_admin(v_product.store_id) then
    raise exception using errcode = '42501', message = 'Solo un administrador puede ajustar inventario';
  end if;
  if p_device_id is not null and not exists (
    select 1
    from public.devices d
    where d.id = p_device_id
      and d.store_id = v_product.store_id
      and d.status = 'authorized'
      and d.deleted_at is null
  ) then
    raise exception using
      errcode = '22023',
      message = 'El dispositivo no esta autorizado para la tienda';
  end if;

  v_resulting_quantity := v_product.stock_quantity + p_quantity_delta;
  if v_resulting_quantity < 0 then
    raise exception using
      errcode = '23514',
      message = 'El movimiento dejaria el inventario con stock negativo';
  end if;

  update public.products p
  set stock_quantity = v_resulting_quantity
  where p.id = v_product.id
  returning p.version into v_product_version;

  insert into public.inventory_movements (
    id, store_id, product_id, movement_type, quantity_delta,
    resulting_quantity, reason, reference_type, reference_id,
    actor_user_id, device_id, operation_id, product_version
  ) values (
    v_movement_id, v_product.store_id, v_product.id, p_type, p_quantity_delta,
    v_resulting_quantity, v_reason, v_reference_type, p_reference_id,
    v_actor_user_id, p_device_id, p_operation_id, v_product_version
  );

  return query
  select
    v_product.id,
    v_product.store_id,
    v_resulting_quantity,
    v_product_version,
    v_movement_id,
    p_operation_id,
    true;
end;
$$;

revoke all on function public.adjust_inventory(
  uuid, bigint, text, text, uuid, text, uuid, uuid
) from public;
grant execute on function public.adjust_inventory(
  uuid, bigint, text, text, uuid, text, uuid, uuid
) to authenticated, service_role;

-- =============================================================================
-- 8. Documentacion de esquema
-- =============================================================================

comment on table public.categories is
  'Categorias compartidas por las tiendas de una organizacion.';

comment on table public.products is
  'Catalogo por tienda. Precio y stock cambian solo mediante RPC auditados.';

comment on table public.product_presentations is
  'Presentaciones calculadas o de precio fijo expresadas en unidades base.';

comment on table public.product_images is
  'Metadatos de imagenes del catalogo; el archivo vive en Supabase Storage.';

comment on table public.price_history is
  'Historico insert-only de cambios de precio idempotentes.';

comment on table public.inventory_movements is
  'Ledger insert-only de inventario con saldo resultante e idempotencia.';

comment on function public.change_product_price(uuid, bigint, text, uuid, uuid) is
  'Cambia precio con bloqueo de fila, auditoria e idempotencia por operation_id.';

comment on function public.adjust_inventory(
  uuid, bigint, text, text, uuid, text, uuid, uuid
) is
  'Ajusta stock sin permitir negativos y registra un movimiento idempotente.';
