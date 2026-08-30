-- B3 - Ventas, pagos, sesiones de caja y outbox de sincronizacion
-- Proyecto Coguana - Supabase/PostgreSQL
-- Referencia: Esquema Backend v1.0 secciones 6, 10, 11, 12 y 15
--
-- Decisiones aplicadas:
--   * Una sola caja abierta por (store_id, device_id).
--   * Las ventas son idempotentes por operation_id.
--   * store_device_pos_id conserva el comprobante generado por el dispositivo.
--   * Una venta, sus pagos, el stock y el outbox se confirman atomicamente.
--   * Una anulacion restaura stock, no borra historicos y no crea un movimiento
--     compensatorio de efectivo.
--   * El efectivo esperado excluye ventas con voided_at no nulo.
--   * RLS esta habilitado en toda tabla expuesta.

-- =============================================================================
-- 1. Helpers privados de autorizacion y consistencia
-- =============================================================================

create or replace function private.is_authorized_store_device(
  p_store_id uuid,
  p_device_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.devices d
    where d.id = p_device_id
      and d.store_id = p_store_id
      and d.status = 'authorized'
      and d.deleted_at is null
  );
$$;

-- =============================================================================
-- 2. Sesiones de caja
-- =============================================================================

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  device_id uuid not null,
  responsible_user_id uuid not null references auth.users(id)
    on delete restrict on update cascade,
  status text not null default 'open' check (status in ('open', 'closed')),
  opening_cash_cents bigint not null check (opening_cash_cents >= 0),
  cash_sales_cents bigint check (cash_sales_cents is null or cash_sales_cents >= 0),
  cash_income_cents bigint check (cash_income_cents is null or cash_income_cents >= 0),
  cash_outflow_cents bigint check (cash_outflow_cents is null or cash_outflow_cents >= 0),
  expected_cash_cents bigint check (expected_cash_cents is null or expected_cash_cents >= 0),
  counted_cash_cents bigint check (counted_cash_cents is null or counted_cash_cents >= 0),
  difference_cents bigint,
  open_operation_id uuid not null unique,
  close_operation_id uuid unique,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by_user_id uuid references auth.users(id)
    on delete restrict on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  unique (id, store_id, device_id),
  foreign key (store_id, device_id)
    references public.devices (store_id, id)
    on delete restrict on update cascade,
  check (
    (
      status = 'open'
      and close_operation_id is null
      and cash_sales_cents is null
      and cash_income_cents is null
      and cash_outflow_cents is null
      and expected_cash_cents is null
      and counted_cash_cents is null
      and difference_cents is null
      and closed_at is null
      and closed_by_user_id is null
    )
    or
    (
      status = 'closed'
      and close_operation_id is not null
      and cash_sales_cents is not null
      and cash_income_cents is not null
      and cash_outflow_cents is not null
      and expected_cash_cents is not null
      and counted_cash_cents is not null
      and difference_cents is not null
      and closed_at is not null
      and closed_by_user_id is not null
    )
  )
);

create unique index cash_sessions_one_open_per_device
  on public.cash_sessions (store_id, device_id)
  where status = 'open';

create index cash_sessions_store_device_status_opened
  on public.cash_sessions (store_id, device_id, status, opened_at desc);

-- Solo permite la transicion open -> closed. El resto de campos de identidad
-- y apertura son inmutables.
create or replace function private.validate_cash_session_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'open' or new.status <> 'closed' then
    raise exception using
      errcode = '55000',
      message = 'La unica actualizacion permitida es cerrar una caja abierta';
  end if;

  if new.id is distinct from old.id
    or new.store_id is distinct from old.store_id
    or new.device_id is distinct from old.device_id
    or new.responsible_user_id is distinct from old.responsible_user_id
    or new.opening_cash_cents is distinct from old.opening_cash_cents
    or new.open_operation_id is distinct from old.open_operation_id
    or new.opened_at is distinct from old.opened_at
    or new.created_at is distinct from old.created_at
  then
    raise exception using
      errcode = '55000',
      message = 'Los datos de apertura de caja son inmutables';
  end if;

  return new;
end;
$$;

create trigger cash_sessions_10_validate_close
  before update on public.cash_sessions
  for each row execute function private.validate_cash_session_update();

create trigger cash_sessions_20_bump_version
  before update on public.cash_sessions
  for each row execute function private.bump_catalog_version();

create or replace function private.is_open_cash_session_for_device(
  p_cash_session_id uuid,
  p_store_id uuid,
  p_device_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.cash_sessions cs
    where cs.id = p_cash_session_id
      and cs.store_id = p_store_id
      and cs.device_id = p_device_id
      and cs.status = 'open'
  );
$$;

-- =============================================================================
-- 3. Ventas, items y pagos
-- =============================================================================

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  device_id uuid not null,
  cash_session_id uuid not null,
  store_device_pos_id text not null check (btrim(store_device_pos_id) <> ''),
  actor_user_id uuid not null references auth.users(id)
    on delete restrict on update cascade,
  status text not null default 'confirmed' check (status = 'confirmed'),
  subtotal_cents bigint not null check (subtotal_cents > 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  total_cents bigint not null check (total_cents > 0),
  operation_id uuid not null unique,
  request_hash text not null check (length(request_hash) = 32),
  voided_at timestamptz,
  voided_by_user_id uuid references auth.users(id)
    on delete restrict on update cascade,
  void_reason text,
  void_operation_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (store_id, store_device_pos_id),
  unique (id, store_id),
  foreign key (cash_session_id, store_id, device_id)
    references public.cash_sessions (id, store_id, device_id)
    on delete restrict on update cascade,
  foreign key (store_id, device_id)
    references public.devices (store_id, id)
    on delete restrict on update cascade,
  check (discount_cents <= subtotal_cents),
  check (total_cents = subtotal_cents - discount_cents),
  check (
    (
      voided_at is null
      and voided_by_user_id is null
      and void_reason is null
      and void_operation_id is null
    )
    or
    (
      voided_at is not null
      and voided_by_user_id is not null
      and void_reason is not null
      and btrim(void_reason) <> ''
      and void_operation_id is not null
    )
  )
);

create index sales_store_session_created
  on public.sales (store_id, cash_session_id, created_at desc);

create index sales_store_voided_created
  on public.sales (store_id, voided_at, created_at desc);

create or replace function private.validate_sale_void_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.voided_at is not null or new.voided_at is null then
    raise exception using
      errcode = '55000',
      message = 'La unica actualizacion permitida es anular una venta vigente';
  end if;

  if new.id is distinct from old.id
    or new.store_id is distinct from old.store_id
    or new.device_id is distinct from old.device_id
    or new.cash_session_id is distinct from old.cash_session_id
    or new.store_device_pos_id is distinct from old.store_device_pos_id
    or new.actor_user_id is distinct from old.actor_user_id
    or new.status is distinct from old.status
    or new.subtotal_cents is distinct from old.subtotal_cents
    or new.discount_cents is distinct from old.discount_cents
    or new.total_cents is distinct from old.total_cents
    or new.operation_id is distinct from old.operation_id
    or new.request_hash is distinct from old.request_hash
    or new.created_at is distinct from old.created_at
  then
    raise exception using
      errcode = '55000',
      message = 'La cabecera confirmada de la venta es inmutable';
  end if;

  return new;
end;
$$;

create trigger sales_10_validate_void
  before update on public.sales
  for each row execute function private.validate_sale_void_update();

create trigger sales_20_bump_version
  before update on public.sales
  for each row execute function private.bump_catalog_version();

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  sale_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_id uuid not null,
  product_name_snapshot text not null check (btrim(product_name_snapshot) <> ''),
  base_unit_snapshot text not null check (base_unit_snapshot in ('gram', 'unit')),
  quantity bigint not null check (quantity > 0),
  price_cents_snapshot bigint not null check (price_cents_snapshot >= 0),
  pricing_quantity_snapshot bigint not null check (pricing_quantity_snapshot > 0),
  cost_cents_snapshot bigint not null check (cost_cents_snapshot >= 0),
  cost_pricing_quantity_snapshot bigint not null
    check (cost_pricing_quantity_snapshot > 0),
  line_total_cents bigint not null check (line_total_cents > 0),
  presentation_id uuid,
  presentation_name_snapshot text,
  presentation_type_snapshot text check (
    presentation_type_snapshot is null
    or presentation_type_snapshot in ('unit', 'package', 'box', 'sack')
  ),
  presentation_quantity_snapshot bigint check (
    presentation_quantity_snapshot is null
    or presentation_quantity_snapshot > 0
  ),
  presentation_count bigint check (
    presentation_count is null
    or presentation_count > 0
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version = 1),
  unique (sale_id, line_number),
  unique (id, store_id),
  foreign key (sale_id, store_id)
    references public.sales (id, store_id)
    on delete restrict on update cascade,
  foreign key (product_id, store_id)
    references public.products (id, store_id)
    on delete restrict on update cascade,
  foreign key (presentation_id, store_id)
    references public.product_presentations (id, store_id)
    on delete restrict on update cascade,
  check (
    (
      presentation_id is null
      and presentation_name_snapshot is null
      and presentation_type_snapshot is null
      and presentation_quantity_snapshot is null
      and presentation_count is null
    )
    or
    (
      presentation_id is not null
      and presentation_name_snapshot is not null
      and btrim(presentation_name_snapshot) <> ''
      and presentation_type_snapshot is not null
      and presentation_quantity_snapshot is not null
      and presentation_count is not null
    )
  )
);

create index sale_items_store_sale_line
  on public.sale_items (store_id, sale_id, line_number);

create index sale_items_store_product_created
  on public.sale_items (store_id, product_id, created_at desc);

create trigger sale_items_are_immutable
  before update or delete on public.sale_items
  for each row execute function private.prevent_immutable_catalog_change();

create table public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  sale_id uuid not null,
  payment_method text not null check (
    payment_method in ('cash', 'yape', 'plin', 'card')
  ),
  payment_status text not null default 'confirmed' check (
    payment_status in ('pending', 'confirmed', 'failed', 'refunded')
  ),
  amount_cents bigint not null check (amount_cents > 0),
  amount_received_cents bigint check (
    amount_received_cents is null or amount_received_cents >= 0
  ),
  change_cents bigint not null default 0 check (change_cents >= 0),
  provider_reference text,
  actor_user_id uuid not null references auth.users(id)
    on delete restrict on update cascade,
  device_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version = 1),
  unique (id, store_id),
  foreign key (sale_id, store_id)
    references public.sales (id, store_id)
    on delete restrict on update cascade,
  foreign key (store_id, device_id)
    references public.devices (store_id, id)
    on delete restrict on update cascade,
  check (
    (
      payment_method = 'cash'
      and payment_status = 'confirmed'
      and amount_received_cents is not null
      and amount_received_cents >= amount_cents
      and change_cents = amount_received_cents - amount_cents
    )
    or
    (
      payment_method <> 'cash'
      and amount_received_cents is null
      and change_cents = 0
    )
  )
);

create index sale_payments_store_sale_method
  on public.sale_payments (store_id, sale_id, payment_method);

create trigger sale_payments_are_immutable
  before update or delete on public.sale_payments
  for each row execute function private.prevent_immutable_catalog_change();

create table public.sale_status_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  sale_id uuid not null,
  from_status text not null check (from_status in ('confirmed', 'voided')),
  to_status text not null check (to_status in ('confirmed', 'voided')),
  reason text not null check (btrim(reason) <> ''),
  actor_user_id uuid not null references auth.users(id)
    on delete restrict on update cascade,
  device_id uuid not null,
  operation_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version = 1),
  unique (id, store_id),
  foreign key (sale_id, store_id)
    references public.sales (id, store_id)
    on delete restrict on update cascade,
  foreign key (store_id, device_id)
    references public.devices (store_id, id)
    on delete restrict on update cascade,
  check (from_status <> to_status)
);

create index sale_status_history_store_sale_created
  on public.sale_status_history (store_id, sale_id, created_at desc);

create trigger sale_status_history_is_immutable
  before update or delete on public.sale_status_history
  for each row execute function private.prevent_immutable_catalog_change();

-- =============================================================================
-- 4. Movimientos manuales de caja
-- =============================================================================

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  cash_session_id uuid not null,
  movement_type text not null check (movement_type in ('income', 'outflow')),
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null check (btrim(reason) <> ''),
  sale_id uuid,
  actor_user_id uuid not null references auth.users(id)
    on delete restrict on update cascade,
  device_id uuid not null,
  operation_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version = 1),
  unique (id, store_id),
  foreign key (cash_session_id, store_id, device_id)
    references public.cash_sessions (id, store_id, device_id)
    on delete restrict on update cascade,
  foreign key (sale_id, store_id)
    references public.sales (id, store_id)
    on delete restrict on update cascade,
  foreign key (store_id, device_id)
    references public.devices (store_id, id)
    on delete restrict on update cascade
);

create index cash_movements_store_session_created
  on public.cash_movements (store_id, cash_session_id, created_at);

create index cash_movements_store_sale
  on public.cash_movements (store_id, sale_id)
  where sale_id is not null;

create trigger cash_movements_are_immutable
  before update or delete on public.cash_movements
  for each row execute function private.prevent_immutable_catalog_change();

-- =============================================================================
-- 5. Outbox central para sincronizacion
-- =============================================================================

create table public.sync_outbox (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  source_device_id uuid,
  operation_id uuid not null,
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id uuid not null,
  event_type text not null check (btrim(event_type) <> ''),
  direction text not null default 'pull' check (direction in ('push', 'pull')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (
    status in ('pending', 'syncing', 'synced', 'error')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id)
    on delete restrict on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (store_id, operation_id),
  foreign key (store_id, source_device_id)
    references public.devices (store_id, id)
    on delete restrict on update cascade,
  check (
    (status in ('pending', 'syncing', 'error') and processed_at is null)
    or
    (status = 'synced' and processed_at is not null)
  )
);

create index sync_outbox_pending_available
  on public.sync_outbox (status, available_at, created_at)
  where status in ('pending', 'error');

create index sync_outbox_store_created
  on public.sync_outbox (store_id, created_at, id);

create trigger sync_outbox_bump_version
  before update on public.sync_outbox
  for each row execute function private.bump_catalog_version();

create or replace function private.enqueue_sync_outbox(
  p_store_id uuid,
  p_source_device_id uuid,
  p_operation_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.sync_outbox (
    id, store_id, source_device_id, operation_id, entity_type, entity_id,
    event_type, direction, payload, status, created_by
  ) values (
    v_id, p_store_id, p_source_device_id, p_operation_id, p_entity_type,
    p_entity_id, p_event_type, 'pull', p_payload, 'pending', p_created_by
  );

  return v_id;
end;
$$;

-- Valida movimientos directos de caja y evita retiros mayores al efectivo
-- esperado. El bloqueo de la sesion los serializa con ventas y cierre.
create or replace function private.validate_cash_movement_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.cash_sessions%rowtype;
  v_cash_sales bigint;
  v_cash_income bigint;
  v_cash_outflow bigint;
  v_expected bigint;
begin
  select cs.*
    into v_session
  from public.cash_sessions cs
  where cs.id = new.cash_session_id
    and cs.store_id = new.store_id
  for update;

  if not found
    or v_session.status <> 'open'
    or v_session.device_id <> new.device_id
  then
    raise exception using
      errcode = '42501',
      message = 'El movimiento requiere la caja abierta del mismo dispositivo';
  end if;

  if new.movement_type = 'outflow' then
    select coalesce(sum(sp.amount_cents), 0)::bigint
      into v_cash_sales
    from public.sale_payments sp
    join public.sales s
      on s.id = sp.sale_id
      and s.store_id = sp.store_id
    where s.store_id = new.store_id
      and s.cash_session_id = new.cash_session_id
      and s.voided_at is null
      and sp.payment_method = 'cash'
      and sp.payment_status = 'confirmed';

    select
      coalesce(sum(cm.amount_cents) filter (where cm.movement_type = 'income'), 0)::bigint,
      coalesce(sum(cm.amount_cents) filter (where cm.movement_type = 'outflow'), 0)::bigint
      into v_cash_income, v_cash_outflow
    from public.cash_movements cm
    where cm.store_id = new.store_id
      and cm.cash_session_id = new.cash_session_id;

    v_expected :=
      v_session.opening_cash_cents + v_cash_sales + v_cash_income - v_cash_outflow;

    if new.amount_cents > v_expected then
      raise exception using
        errcode = '23514',
        message = 'La salida supera el efectivo esperado en caja';
    end if;
  end if;

  return new;
end;
$$;

create trigger cash_movements_10_validate_insert
  before insert on public.cash_movements
  for each row execute function private.validate_cash_movement_insert();

create or replace function private.enqueue_cash_movement_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enqueue_sync_outbox(
    new.store_id,
    new.device_id,
    new.operation_id,
    'cash_movement',
    new.id,
    'cash_movement.' || new.movement_type,
    pg_catalog.jsonb_build_object(
      'id', new.id,
      'store_id', new.store_id,
      'cash_session_id', new.cash_session_id,
      'type', new.movement_type,
      'amount_cents', new.amount_cents,
      'reason', new.reason,
      'sale_id', new.sale_id,
      'actor_user_id', new.actor_user_id,
      'device_id', new.device_id,
      'created_at', new.created_at
    ),
    new.actor_user_id
  );
  return new;
end;
$$;

create trigger cash_movements_20_enqueue_outbox
  after insert on public.cash_movements
  for each row execute function private.enqueue_cash_movement_event();

-- =============================================================================
-- 6. Row Level Security y privilegios
-- =============================================================================

alter table public.cash_sessions enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;
alter table public.sale_status_history enable row level security;
alter table public.cash_movements enable row level security;
alter table public.sync_outbox enable row level security;

revoke all on public.cash_sessions from anon, authenticated;
revoke all on public.sales from anon, authenticated;
revoke all on public.sale_items from anon, authenticated;
revoke all on public.sale_payments from anon, authenticated;
revoke all on public.sale_status_history from anon, authenticated;
revoke all on public.cash_movements from anon, authenticated;
revoke all on public.sync_outbox from anon, authenticated;

grant select on public.cash_sessions, public.sales, public.sale_items,
  public.sale_payments, public.sale_status_history, public.cash_movements,
  public.sync_outbox to authenticated;

grant insert on public.cash_movements to authenticated;

grant all on public.cash_sessions, public.sales, public.sale_items,
  public.sale_payments, public.sale_status_history, public.cash_movements,
  public.sync_outbox to service_role;

create policy cash_sessions_select_store_member
  on public.cash_sessions for select
  to authenticated
  using (private.is_store_member(store_id));

create policy sales_select_store_member
  on public.sales for select
  to authenticated
  using (private.is_store_member(store_id));

create policy sale_items_select_store_member
  on public.sale_items for select
  to authenticated
  using (private.is_store_member(store_id));

create policy sale_payments_select_store_member
  on public.sale_payments for select
  to authenticated
  using (private.is_store_member(store_id));

create policy sale_status_history_select_store_member
  on public.sale_status_history for select
  to authenticated
  using (private.is_store_member(store_id));

create policy cash_movements_select_store_member
  on public.cash_movements for select
  to authenticated
  using (private.is_store_member(store_id));

create policy cash_movements_insert_open_same_device
  on public.cash_movements for insert
  to authenticated
  with check (
    actor_user_id = (select auth.uid())
    and private.is_store_member(store_id)
    and private.is_authorized_store_device(store_id, device_id)
    and private.is_open_cash_session_for_device(
      cash_session_id,
      store_id,
      device_id
    )
  );

create policy sync_outbox_select_store_member
  on public.sync_outbox for select
  to authenticated
  using (private.is_store_member(store_id));

-- =============================================================================
-- 7. RPC: open_cash_session
-- =============================================================================

create or replace function public.open_cash_session(
  p_store_id uuid,
  p_device_id uuid,
  p_opening_cash_cents bigint,
  p_operation_id uuid
)
returns table (
  cash_session_id uuid,
  store_id uuid,
  device_id uuid,
  status text,
  opening_cash_cents bigint,
  opened_at timestamptz,
  session_version bigint,
  applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_existing public.cash_sessions%rowtype;
  v_session public.cash_sessions%rowtype;
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'Se requiere una sesion autenticada';
  end if;
  if p_operation_id is null then
    raise exception using errcode = '22004', message = 'operation_id es obligatorio';
  end if;
  if p_opening_cash_cents is null or p_opening_cash_cents < 0 then
    raise exception using
      errcode = '22023',
      message = 'El fondo inicial debe ser un entero no negativo';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::text, 0)
  );

  select cs.*
    into v_existing
  from public.cash_sessions cs
  where cs.open_operation_id = p_operation_id;

  if found then
    if not private.is_store_member(v_existing.store_id) then
      raise exception using errcode = '42501', message = 'El usuario no pertenece a la tienda';
    end if;
    if v_existing.store_id <> p_store_id
      or v_existing.device_id <> p_device_id
      or v_existing.responsible_user_id <> v_actor_user_id
      or v_existing.opening_cash_cents <> p_opening_cash_cents
    then
      raise exception using
        errcode = '22023',
        message = 'operation_id ya fue usado con otra apertura de caja';
    end if;

    return query
    select
      v_existing.id,
      v_existing.store_id,
      v_existing.device_id,
      v_existing.status,
      v_existing.opening_cash_cents,
      v_existing.opened_at,
      v_existing.version,
      false;
    return;
  end if;

  if exists (
    select 1
    from public.sync_outbox so
    where so.store_id = p_store_id
      and so.operation_id = p_operation_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'operation_id ya pertenece a otra operacion';
  end if;

  if not private.is_store_member(p_store_id) then
    raise exception using errcode = '42501', message = 'El usuario no pertenece a la tienda';
  end if;
  if not private.is_authorized_store_device(p_store_id, p_device_id) then
    raise exception using errcode = '42501', message = 'El dispositivo no esta autorizado';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'cash-open:' || p_store_id::text || ':' || p_device_id::text,
      0
    )
  );

  if exists (
    select 1
    from public.cash_sessions cs
    where cs.store_id = p_store_id
      and cs.device_id = p_device_id
      and cs.status = 'open'
  ) then
    raise exception using
      errcode = '23505',
      message = 'Este dispositivo ya tiene una caja abierta';
  end if;

  insert into public.cash_sessions (
    store_id, device_id, responsible_user_id, status,
    opening_cash_cents, open_operation_id
  ) values (
    p_store_id, p_device_id, v_actor_user_id, 'open',
    p_opening_cash_cents, p_operation_id
  )
  returning * into v_session;

  perform private.enqueue_sync_outbox(
    p_store_id,
    p_device_id,
    p_operation_id,
    'cash_session',
    v_session.id,
    'cash_session.opened',
    pg_catalog.jsonb_build_object(
      'id', v_session.id,
      'store_id', p_store_id,
      'device_id', p_device_id,
      'responsible_user_id', v_actor_user_id,
      'opening_cash_cents', p_opening_cash_cents,
      'opened_at', v_session.opened_at
    ),
    v_actor_user_id
  );

  return query
  select
    v_session.id,
    v_session.store_id,
    v_session.device_id,
    v_session.status,
    v_session.opening_cash_cents,
    v_session.opened_at,
    v_session.version,
    true;
end;
$$;

revoke all on function public.open_cash_session(uuid, uuid, bigint, uuid)
  from public, anon;
grant execute on function public.open_cash_session(uuid, uuid, bigint, uuid)
  to authenticated, service_role;

-- =============================================================================
-- 8. RPC: create_sale
-- =============================================================================

create or replace function public.create_sale(
  p_store_id uuid,
  p_device_id uuid,
  p_store_device_pos_id text,
  p_items jsonb,
  p_payments jsonb,
  p_operation_id uuid,
  p_discount_cents bigint default 0
)
returns table (
  sale_id uuid,
  store_id uuid,
  cash_session_id uuid,
  store_device_pos_id text,
  subtotal_cents bigint,
  discount_cents bigint,
  total_cents bigint,
  sale_version bigint,
  applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_pos_id text := pg_catalog.btrim(p_store_device_pos_id);
  v_payload_hash text;
  v_existing public.sales%rowtype;
  v_session public.cash_sessions%rowtype;
  v_sale public.sales%rowtype;
  v_product public.products%rowtype;
  v_presentation public.product_presentations%rowtype;
  v_item_record record;
  v_payment_record record;
  v_quantity_record record;
  v_item jsonb;
  v_payment jsonb;
  v_product_id uuid;
  v_presentation_id uuid;
  v_item_id uuid;
  v_payment_id uuid;
  v_movement_id uuid;
  v_movement_operation_id uuid;
  v_quantity bigint;
  v_presentation_count bigint;
  v_price_cents bigint;
  v_pricing_quantity bigint;
  v_line_total bigint;
  v_running_quantity bigint;
  v_payment_amount bigint;
  v_amount_received bigint;
  v_change_cents bigint;
  v_payment_method text;
  v_payment_reference text;
  v_subtotal bigint := 0;
  v_total bigint;
  v_payment_total bigint := 0;
  v_resulting_stock bigint;
  v_product_version bigint;
  v_resolved_items jsonb := '[]'::jsonb;
  v_resolved_payments jsonb := '[]'::jsonb;
  v_quantities_by_product jsonb := '{}'::jsonb;
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'Se requiere una sesion autenticada';
  end if;
  if p_operation_id is null then
    raise exception using errcode = '22004', message = 'operation_id es obligatorio';
  end if;
  if v_pos_id is null or v_pos_id = '' then
    raise exception using
      errcode = '22023',
      message = 'store_device_pos_id es obligatorio';
  end if;
  if p_discount_cents is null or p_discount_cents < 0 then
    raise exception using
      errcode = '22023',
      message = 'El descuento debe ser no negativo';
  end if;
  if p_items is null
    or pg_catalog.jsonb_typeof(p_items) <> 'array'
    or pg_catalog.jsonb_array_length(p_items) = 0
  then
    raise exception using errcode = '22023', message = 'La venta requiere al menos un item';
  end if;
  if p_payments is null
    or pg_catalog.jsonb_typeof(p_payments) <> 'array'
    or pg_catalog.jsonb_array_length(p_payments) = 0
  then
    raise exception using errcode = '22023', message = 'La venta requiere al menos un pago';
  end if;

  v_payload_hash := pg_catalog.md5(
    p_store_id::text || '|' ||
    p_device_id::text || '|' ||
    v_actor_user_id::text || '|' ||
    v_pos_id || '|' ||
    p_items::text || '|' ||
    p_payments::text || '|' ||
    p_discount_cents::text
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::text, 0)
  );

  select s.*
    into v_existing
  from public.sales s
  where s.operation_id = p_operation_id;

  if found then
    if not private.is_store_member(v_existing.store_id) then
      raise exception using errcode = '42501', message = 'El usuario no pertenece a la tienda';
    end if;
    if v_existing.store_id <> p_store_id
      or v_existing.device_id <> p_device_id
      or v_existing.actor_user_id <> v_actor_user_id
      or v_existing.store_device_pos_id <> v_pos_id
      or v_existing.request_hash <> v_payload_hash
    then
      raise exception using
        errcode = '22023',
        message = 'operation_id ya fue usado con otra venta';
    end if;

    return query
    select
      v_existing.id,
      v_existing.store_id,
      v_existing.cash_session_id,
      v_existing.store_device_pos_id,
      v_existing.subtotal_cents,
      v_existing.discount_cents,
      v_existing.total_cents,
      v_existing.version,
      false;
    return;
  end if;

  if exists (
    select 1
    from public.sync_outbox so
    where so.store_id = p_store_id
      and so.operation_id = p_operation_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'operation_id ya pertenece a otra operacion';
  end if;

  if not private.is_store_member(p_store_id) then
    raise exception using errcode = '42501', message = 'El usuario no pertenece a la tienda';
  end if;
  if not private.is_authorized_store_device(p_store_id, p_device_id) then
    raise exception using errcode = '42501', message = 'El dispositivo no esta autorizado';
  end if;

  select cs.*
    into v_session
  from public.cash_sessions cs
  where cs.store_id = p_store_id
    and cs.device_id = p_device_id
    and cs.status = 'open'
  order by cs.opened_at desc
  limit 1
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'La venta requiere una caja abierta en el mismo dispositivo';
  end if;

  -- Resuelve y bloquea productos en orden estable para evitar deadlocks.
  for v_item_record in
    select item.value, item.ordinality
    from pg_catalog.jsonb_array_elements(p_items)
      with ordinality as item(value, ordinality)
    order by item.value ->> 'product_id', item.ordinality
  loop
    v_item := v_item_record.value;

    begin
      v_product_id := (v_item ->> 'product_id')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'Cada item requiere product_id uuid';
    end;

    select p.*
      into v_product
    from public.products p
    where p.id = v_product_id
      and p.store_id = p_store_id
    for update;

    if not found or not v_product.is_active then
      raise exception using errcode = '22023', message = 'Uno de los productos no esta disponible';
    end if;

    v_presentation_id := null;
    v_presentation_count := null;

    if nullif(v_item ->> 'presentation_id', '') is not null then
      begin
        v_presentation_id := (v_item ->> 'presentation_id')::uuid;
        v_presentation_count := (v_item ->> 'presentation_count')::bigint;
      exception when others then
        raise exception using
          errcode = '22023',
          message = 'La presentacion requiere id y cantidad validos';
      end;

      if v_presentation_count is null or v_presentation_count <= 0 then
        raise exception using
          errcode = '22023',
          message = 'presentation_count debe ser mayor que cero';
      end if;

      select pp.*
        into v_presentation
      from public.product_presentations pp
      where pp.id = v_presentation_id
        and pp.store_id = p_store_id
        and pp.product_id = v_product_id;

      if not found or not v_presentation.is_active then
        raise exception using
          errcode = '22023',
          message = 'La presentacion no esta disponible para el producto';
      end if;

      v_quantity := v_presentation.conversion_factor * v_presentation_count;
      if nullif(v_item ->> 'quantity', '') is not null
        and (v_item ->> 'quantity')::bigint <> v_quantity
      then
        raise exception using
          errcode = '22023',
          message = 'La cantidad no coincide con la conversion de la presentacion';
      end if;

      if v_presentation.price_mode = 'fixed' then
        v_price_cents := v_presentation.fixed_price_cents;
        v_pricing_quantity := v_presentation.conversion_factor;
      else
        v_price_cents := v_product.price_cents;
        v_pricing_quantity := v_product.pricing_quantity;
      end if;
    else
      begin
        v_quantity := (v_item ->> 'quantity')::bigint;
      exception when others then
        raise exception using
          errcode = '22023',
          message = 'Cada item sin presentacion requiere quantity';
      end;

      if v_quantity is null or v_quantity <= 0 then
        raise exception using errcode = '22023', message = 'quantity debe ser mayor que cero';
      end if;
      if nullif(v_item ->> 'presentation_count', '') is not null then
        raise exception using
          errcode = '22023',
          message = 'presentation_count requiere presentation_id';
      end if;

      v_price_cents := v_product.price_cents;
      v_pricing_quantity := v_product.pricing_quantity;
    end if;

    v_line_total := pg_catalog.floor(
      (
        v_quantity::numeric * v_price_cents::numeric
        + (v_pricing_quantity / 2)::numeric
      ) / v_pricing_quantity::numeric
    )::bigint;

    if v_line_total <= 0 then
      raise exception using
        errcode = '22023',
        message = 'El item debe producir un total mayor que cero';
    end if;

    v_subtotal := v_subtotal + v_line_total;
    v_running_quantity :=
      coalesce((v_quantities_by_product ->> v_product_id::text)::bigint, 0)
      + v_quantity;

    if v_running_quantity > v_product.stock_quantity then
      raise exception using
        errcode = '23514',
        message = 'Stock insuficiente para ' || v_product.name;
    end if;

    v_quantities_by_product := pg_catalog.jsonb_set(
      v_quantities_by_product,
      array[v_product_id::text],
      pg_catalog.to_jsonb(v_running_quantity),
      true
    );

    begin
      v_item_id := coalesce(
        nullif(v_item ->> 'id', '')::uuid,
        gen_random_uuid()
      );
    exception when others then
      raise exception using errcode = '22023', message = 'El id del item debe ser uuid';
    end;

    v_resolved_items := v_resolved_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_item_id,
        'line_number', v_item_record.ordinality,
        'product_id', v_product.id,
        'product_name_snapshot', v_product.name,
        'base_unit_snapshot', v_product.base_unit,
        'quantity', v_quantity,
        'price_cents_snapshot', v_price_cents,
        'pricing_quantity_snapshot', v_pricing_quantity,
        'cost_cents_snapshot', v_product.cost_cents,
        'cost_pricing_quantity_snapshot', v_product.pricing_quantity,
        'line_total_cents', v_line_total,
        'presentation_id', v_presentation_id,
        'presentation_name_snapshot',
          case when v_presentation_id is null then null else v_presentation.name end,
        'presentation_type_snapshot',
          case when v_presentation_id is null then null else v_presentation.kind end,
        'presentation_quantity_snapshot',
          case when v_presentation_id is null then null else v_presentation.conversion_factor end,
        'presentation_count', v_presentation_count
      )
    );
  end loop;

  if p_discount_cents > v_subtotal then
    raise exception using errcode = '22023', message = 'El descuento supera el subtotal';
  end if;

  v_total := v_subtotal - p_discount_cents;
  if v_total <= 0 then
    raise exception using errcode = '22023', message = 'El total debe ser mayor que cero';
  end if;

  for v_payment_record in
    select payment.value, payment.ordinality
    from pg_catalog.jsonb_array_elements(p_payments)
      with ordinality as payment(value, ordinality)
    order by payment.ordinality
  loop
    v_payment := v_payment_record.value;
    v_payment_method := v_payment ->> 'method';

    if v_payment_method is null
      or v_payment_method not in ('cash', 'yape', 'plin', 'card')
    then
      raise exception using errcode = '22023', message = 'Metodo de pago invalido';
    end if;

    begin
      v_payment_amount := (v_payment ->> 'amount_cents')::bigint;
    exception when others then
      raise exception using errcode = '22023', message = 'Cada pago requiere amount_cents';
    end;

    if v_payment_amount is null or v_payment_amount <= 0 then
      raise exception using errcode = '22023', message = 'El pago debe ser mayor que cero';
    end if;

    if v_payment_method = 'cash' then
      begin
        v_amount_received := (v_payment ->> 'amount_received_cents')::bigint;
      exception when others then
        raise exception using
          errcode = '22023',
          message = 'El pago en efectivo requiere amount_received_cents';
      end;

      if v_amount_received is null or v_amount_received < v_payment_amount then
        raise exception using
          errcode = '22023',
          message = 'El efectivo recibido debe cubrir el importe del pago';
      end if;
      v_change_cents := v_amount_received - v_payment_amount;
    else
      if nullif(v_payment ->> 'amount_received_cents', '') is not null then
        raise exception using
          errcode = '22023',
          message = 'Solo el efectivo registra amount_received_cents';
      end if;
      v_amount_received := null;
      v_change_cents := 0;
    end if;

    begin
      v_payment_id := coalesce(
        nullif(v_payment ->> 'id', '')::uuid,
        gen_random_uuid()
      );
    exception when others then
      raise exception using errcode = '22023', message = 'El id del pago debe ser uuid';
    end;

    v_payment_reference := nullif(pg_catalog.btrim(v_payment ->> 'reference'), '');
    v_payment_total := v_payment_total + v_payment_amount;

    v_resolved_payments := v_resolved_payments || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_payment_id,
        'method', v_payment_method,
        'amount_cents', v_payment_amount,
        'amount_received_cents', v_amount_received,
        'change_cents', v_change_cents,
        'reference', v_payment_reference
      )
    );
  end loop;

  if v_payment_total <> v_total then
    raise exception using
      errcode = '23514',
      message = 'La suma de pagos debe coincidir con el total de la venta';
  end if;

  insert into public.sales (
    store_id, device_id, cash_session_id, store_device_pos_id,
    actor_user_id, status, subtotal_cents, discount_cents, total_cents,
    operation_id, request_hash
  ) values (
    p_store_id, p_device_id, v_session.id, v_pos_id,
    v_actor_user_id, 'confirmed', v_subtotal, p_discount_cents, v_total,
    p_operation_id, v_payload_hash
  )
  returning * into v_sale;

  for v_item in
    select value
    from pg_catalog.jsonb_array_elements(v_resolved_items)
  loop
    insert into public.sale_items (
      id, store_id, sale_id, line_number, product_id,
      product_name_snapshot, base_unit_snapshot, quantity,
      price_cents_snapshot, pricing_quantity_snapshot,
      cost_cents_snapshot, cost_pricing_quantity_snapshot,
      line_total_cents, presentation_id, presentation_name_snapshot,
      presentation_type_snapshot, presentation_quantity_snapshot,
      presentation_count
    ) values (
      (v_item ->> 'id')::uuid,
      p_store_id,
      v_sale.id,
      (v_item ->> 'line_number')::integer,
      (v_item ->> 'product_id')::uuid,
      v_item ->> 'product_name_snapshot',
      v_item ->> 'base_unit_snapshot',
      (v_item ->> 'quantity')::bigint,
      (v_item ->> 'price_cents_snapshot')::bigint,
      (v_item ->> 'pricing_quantity_snapshot')::bigint,
      (v_item ->> 'cost_cents_snapshot')::bigint,
      (v_item ->> 'cost_pricing_quantity_snapshot')::bigint,
      (v_item ->> 'line_total_cents')::bigint,
      nullif(v_item ->> 'presentation_id', '')::uuid,
      v_item ->> 'presentation_name_snapshot',
      v_item ->> 'presentation_type_snapshot',
      nullif(v_item ->> 'presentation_quantity_snapshot', '')::bigint,
      nullif(v_item ->> 'presentation_count', '')::bigint
    );
  end loop;

  for v_payment in
    select value
    from pg_catalog.jsonb_array_elements(v_resolved_payments)
  loop
    insert into public.sale_payments (
      id, store_id, sale_id, payment_method, payment_status,
      amount_cents, amount_received_cents, change_cents,
      provider_reference, actor_user_id, device_id
    ) values (
      (v_payment ->> 'id')::uuid,
      p_store_id,
      v_sale.id,
      v_payment ->> 'method',
      'confirmed',
      (v_payment ->> 'amount_cents')::bigint,
      nullif(v_payment ->> 'amount_received_cents', '')::bigint,
      (v_payment ->> 'change_cents')::bigint,
      v_payment ->> 'reference',
      v_actor_user_id,
      p_device_id
    );
  end loop;

  for v_quantity_record in
    select q.key, q.value
    from pg_catalog.jsonb_each_text(v_quantities_by_product) as q(key, value)
    order by q.key
  loop
    v_product_id := v_quantity_record.key::uuid;
    v_quantity := v_quantity_record.value::bigint;

    update public.products p
    set stock_quantity = p.stock_quantity - v_quantity
    where p.id = v_product_id
      and p.store_id = p_store_id
      and p.stock_quantity >= v_quantity
    returning p.stock_quantity, p.version
      into v_resulting_stock, v_product_version;

    if not found then
      raise exception using errcode = '23514', message = 'El stock cambio durante la venta';
    end if;

    v_movement_id := gen_random_uuid();
    v_movement_operation_id := gen_random_uuid();

    insert into public.inventory_movements (
      id, store_id, product_id, movement_type, quantity_delta,
      resulting_quantity, reason, reference_type, reference_id,
      actor_user_id, device_id, operation_id, product_version
    ) values (
      v_movement_id, p_store_id, v_product_id, 'sale', -v_quantity,
      v_resulting_stock, 'Venta ' || v_pos_id, 'sale', v_sale.id,
      v_actor_user_id, p_device_id, v_movement_operation_id, v_product_version
    );

    perform private.enqueue_sync_outbox(
      p_store_id,
      p_device_id,
      v_movement_operation_id,
      'inventory_movement',
      v_movement_id,
      'inventory_movement.created',
      pg_catalog.jsonb_build_object(
        'id', v_movement_id,
        'store_id', p_store_id,
        'product_id', v_product_id,
        'type', 'sale',
        'quantity_delta', -v_quantity,
        'resulting_quantity', v_resulting_stock,
        'reference_type', 'sale',
        'reference_id', v_sale.id,
        'product_version', v_product_version
      ),
      v_actor_user_id
    );
  end loop;

  perform private.enqueue_sync_outbox(
    p_store_id,
    p_device_id,
    p_operation_id,
    'sale',
    v_sale.id,
    'sale.confirmed',
    pg_catalog.jsonb_build_object(
      'id', v_sale.id,
      'store_id', p_store_id,
      'device_id', p_device_id,
      'cash_session_id', v_session.id,
      'store_device_pos_id', v_pos_id,
      'actor_user_id', v_actor_user_id,
      'subtotal_cents', v_subtotal,
      'discount_cents', p_discount_cents,
      'total_cents', v_total,
      'items', v_resolved_items,
      'payments', v_resolved_payments,
      'created_at', v_sale.created_at
    ),
    v_actor_user_id
  );

  return query
  select
    v_sale.id,
    v_sale.store_id,
    v_sale.cash_session_id,
    v_sale.store_device_pos_id,
    v_sale.subtotal_cents,
    v_sale.discount_cents,
    v_sale.total_cents,
    v_sale.version,
    true;
end;
$$;

revoke all on function public.create_sale(
  uuid, uuid, text, jsonb, jsonb, uuid, bigint
) from public, anon;
grant execute on function public.create_sale(
  uuid, uuid, text, jsonb, jsonb, uuid, bigint
) to authenticated, service_role;

-- =============================================================================
-- 9. RPC: close_cash_session
-- =============================================================================

create or replace function public.close_cash_session(
  p_cash_session_id uuid,
  p_device_id uuid,
  p_counted_cash_cents bigint,
  p_operation_id uuid
)
returns table (
  cash_session_id uuid,
  store_id uuid,
  device_id uuid,
  status text,
  expected_cash_cents bigint,
  counted_cash_cents bigint,
  difference_cents bigint,
  session_version bigint,
  applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_existing public.cash_sessions%rowtype;
  v_session public.cash_sessions%rowtype;
  v_cash_sales bigint;
  v_cash_income bigint;
  v_cash_outflow bigint;
  v_expected bigint;
  v_difference bigint;
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'Se requiere una sesion autenticada';
  end if;
  if p_operation_id is null then
    raise exception using errcode = '22004', message = 'operation_id es obligatorio';
  end if;
  if p_counted_cash_cents is null or p_counted_cash_cents < 0 then
    raise exception using
      errcode = '22023',
      message = 'El efectivo contado debe ser un entero no negativo';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::text, 0)
  );

  select cs.*
    into v_existing
  from public.cash_sessions cs
  where cs.close_operation_id = p_operation_id;

  if found then
    if not private.is_store_member(v_existing.store_id) then
      raise exception using errcode = '42501', message = 'El usuario no pertenece a la tienda';
    end if;
    if v_existing.id <> p_cash_session_id
      or v_existing.device_id <> p_device_id
      or v_existing.closed_by_user_id <> v_actor_user_id
      or v_existing.counted_cash_cents <> p_counted_cash_cents
    then
      raise exception using
        errcode = '22023',
        message = 'operation_id ya fue usado con otro cierre de caja';
    end if;

    return query
    select
      v_existing.id,
      v_existing.store_id,
      v_existing.device_id,
      v_existing.status,
      v_existing.expected_cash_cents,
      v_existing.counted_cash_cents,
      v_existing.difference_cents,
      v_existing.version,
      false;
    return;
  end if;

  select cs.*
    into v_session
  from public.cash_sessions cs
  where cs.id = p_cash_session_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'La caja no existe';
  end if;
  if not private.is_store_member(v_session.store_id) then
    raise exception using errcode = '42501', message = 'El usuario no pertenece a la tienda';
  end if;
  if not private.is_authorized_store_device(v_session.store_id, p_device_id) then
    raise exception using errcode = '42501', message = 'El dispositivo no esta autorizado';
  end if;
  if v_session.status <> 'open' or v_session.device_id <> p_device_id then
    raise exception using
      errcode = '55000',
      message = 'Solo puede cerrarse la caja abierta del mismo dispositivo';
  end if;
  if exists (
    select 1
    from public.sync_outbox so
    where so.store_id = v_session.store_id
      and so.operation_id = p_operation_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'operation_id ya pertenece a otra operacion';
  end if;

  select coalesce(sum(sp.amount_cents), 0)::bigint
    into v_cash_sales
  from public.sale_payments sp
  join public.sales s
    on s.id = sp.sale_id
    and s.store_id = sp.store_id
  where s.store_id = v_session.store_id
    and s.cash_session_id = v_session.id
    and s.voided_at is null
    and sp.payment_method = 'cash'
    and sp.payment_status = 'confirmed';

  select
    coalesce(sum(cm.amount_cents) filter (where cm.movement_type = 'income'), 0)::bigint,
    coalesce(sum(cm.amount_cents) filter (where cm.movement_type = 'outflow'), 0)::bigint
    into v_cash_income, v_cash_outflow
  from public.cash_movements cm
  where cm.store_id = v_session.store_id
    and cm.cash_session_id = v_session.id;

  v_expected :=
    v_session.opening_cash_cents + v_cash_sales + v_cash_income - v_cash_outflow;

  if v_expected < 0 then
    raise exception using errcode = '23514', message = 'El efectivo esperado no puede ser negativo';
  end if;

  v_difference := p_counted_cash_cents - v_expected;

  update public.cash_sessions cs
  set status = 'closed',
      cash_sales_cents = v_cash_sales,
      cash_income_cents = v_cash_income,
      cash_outflow_cents = v_cash_outflow,
      expected_cash_cents = v_expected,
      counted_cash_cents = p_counted_cash_cents,
      difference_cents = v_difference,
      close_operation_id = p_operation_id,
      closed_at = now(),
      closed_by_user_id = v_actor_user_id
  where cs.id = v_session.id
  returning * into v_session;

  perform private.enqueue_sync_outbox(
    v_session.store_id,
    p_device_id,
    p_operation_id,
    'cash_session',
    v_session.id,
    'cash_session.closed',
    pg_catalog.jsonb_build_object(
      'id', v_session.id,
      'store_id', v_session.store_id,
      'device_id', p_device_id,
      'closed_by_user_id', v_actor_user_id,
      'opening_cash_cents', v_session.opening_cash_cents,
      'cash_sales_cents', v_cash_sales,
      'cash_income_cents', v_cash_income,
      'cash_outflow_cents', v_cash_outflow,
      'expected_cash_cents', v_expected,
      'counted_cash_cents', p_counted_cash_cents,
      'difference_cents', v_difference,
      'closed_at', v_session.closed_at
    ),
    v_actor_user_id
  );

  return query
  select
    v_session.id,
    v_session.store_id,
    v_session.device_id,
    v_session.status,
    v_session.expected_cash_cents,
    v_session.counted_cash_cents,
    v_session.difference_cents,
    v_session.version,
    true;
end;
$$;

revoke all on function public.close_cash_session(uuid, uuid, bigint, uuid)
  from public, anon;
grant execute on function public.close_cash_session(uuid, uuid, bigint, uuid)
  to authenticated, service_role;

-- =============================================================================
-- 10. RPC: void_sale
-- =============================================================================

create or replace function public.void_sale(
  p_sale_id uuid,
  p_device_id uuid,
  p_reason text,
  p_operation_id uuid
)
returns table (
  sale_id uuid,
  store_id uuid,
  voided_at timestamptz,
  voided_by_user_id uuid,
  void_reason text,
  sale_version bigint,
  applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_reason text := pg_catalog.btrim(p_reason);
  v_existing public.sales%rowtype;
  v_sale public.sales%rowtype;
  v_session public.cash_sessions%rowtype;
  v_product_record record;
  v_history_id uuid := gen_random_uuid();
  v_movement_id uuid;
  v_movement_operation_id uuid;
  v_resulting_stock bigint;
  v_product_version bigint;
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'Se requiere una sesion autenticada';
  end if;
  if p_operation_id is null then
    raise exception using errcode = '22004', message = 'operation_id es obligatorio';
  end if;
  if v_reason is null or v_reason = '' then
    raise exception using errcode = '22023', message = 'La anulacion requiere un motivo';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::text, 0)
  );

  select s.*
    into v_existing
  from public.sales s
  where s.void_operation_id = p_operation_id;

  if found then
    if not private.is_store_admin(v_existing.store_id) then
      raise exception using errcode = '42501', message = 'Solo un administrador puede anular ventas';
    end if;
    if v_existing.id <> p_sale_id
      or v_existing.device_id <> p_device_id
      or v_existing.voided_by_user_id <> v_actor_user_id
      or v_existing.void_reason <> v_reason
    then
      raise exception using
        errcode = '22023',
        message = 'operation_id ya fue usado con otra anulacion';
    end if;

    return query
    select
      v_existing.id,
      v_existing.store_id,
      v_existing.voided_at,
      v_existing.voided_by_user_id,
      v_existing.void_reason,
      v_existing.version,
      false;
    return;
  end if;

  select s.*
    into v_sale
  from public.sales s
  where s.id = p_sale_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'La venta no existe';
  end if;
  if not private.is_store_admin(v_sale.store_id) then
    raise exception using errcode = '42501', message = 'Solo un administrador puede anular ventas';
  end if;
  if not private.is_authorized_store_device(v_sale.store_id, p_device_id) then
    raise exception using errcode = '42501', message = 'El dispositivo no esta autorizado';
  end if;
  if v_sale.device_id <> p_device_id then
    raise exception using
      errcode = '42501',
      message = 'La anulacion debe realizarse desde el dispositivo original';
  end if;
  if v_sale.voided_at is not null then
    raise exception using errcode = '55000', message = 'La venta ya esta anulada';
  end if;
  if exists (
    select 1
    from public.sync_outbox so
    where so.store_id = v_sale.store_id
      and so.operation_id = p_operation_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'operation_id ya pertenece a otra operacion';
  end if;

  select cs.*
    into v_session
  from public.cash_sessions cs
  where cs.id = v_sale.cash_session_id
    and cs.store_id = v_sale.store_id
  for update;

  if not found
    or v_session.status <> 'open'
    or v_session.device_id <> p_device_id
  then
    raise exception using
      errcode = '55000',
      message = 'La anulacion requiere la misma caja abierta de la venta original';
  end if;

  update public.sales s
  set voided_at = now(),
      voided_by_user_id = v_actor_user_id,
      void_reason = v_reason,
      void_operation_id = p_operation_id
  where s.id = v_sale.id
  returning * into v_sale;

  insert into public.sale_status_history (
    id, store_id, sale_id, from_status, to_status, reason,
    actor_user_id, device_id, operation_id
  ) values (
    v_history_id, v_sale.store_id, v_sale.id, 'confirmed', 'voided',
    v_reason, v_actor_user_id, p_device_id, p_operation_id
  );

  for v_product_record in
    select si.product_id, sum(si.quantity)::bigint as quantity
    from public.sale_items si
    where si.store_id = v_sale.store_id
      and si.sale_id = v_sale.id
    group by si.product_id
    order by si.product_id
  loop
    update public.products p
    set stock_quantity = p.stock_quantity + v_product_record.quantity
    where p.id = v_product_record.product_id
      and p.store_id = v_sale.store_id
    returning p.stock_quantity, p.version
      into v_resulting_stock, v_product_version;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'No se encontro un producto de la venta anulada';
    end if;

    v_movement_id := gen_random_uuid();
    v_movement_operation_id := gen_random_uuid();

    insert into public.inventory_movements (
      id, store_id, product_id, movement_type, quantity_delta,
      resulting_quantity, reason, reference_type, reference_id,
      actor_user_id, device_id, operation_id, product_version
    ) values (
      v_movement_id, v_sale.store_id, v_product_record.product_id,
      'return', v_product_record.quantity, v_resulting_stock,
      'Anulacion ' || v_sale.store_device_pos_id,
      'sale_void', v_sale.id, v_actor_user_id, p_device_id,
      v_movement_operation_id, v_product_version
    );

    perform private.enqueue_sync_outbox(
      v_sale.store_id,
      p_device_id,
      v_movement_operation_id,
      'inventory_movement',
      v_movement_id,
      'inventory_movement.created',
      pg_catalog.jsonb_build_object(
        'id', v_movement_id,
        'store_id', v_sale.store_id,
        'product_id', v_product_record.product_id,
        'type', 'return',
        'quantity_delta', v_product_record.quantity,
        'resulting_quantity', v_resulting_stock,
        'reference_type', 'sale_void',
        'reference_id', v_sale.id,
        'product_version', v_product_version
      ),
      v_actor_user_id
    );
  end loop;

  perform private.enqueue_sync_outbox(
    v_sale.store_id,
    p_device_id,
    p_operation_id,
    'sale',
    v_sale.id,
    'sale.voided',
    pg_catalog.jsonb_build_object(
      'id', v_sale.id,
      'store_id', v_sale.store_id,
      'store_device_pos_id', v_sale.store_device_pos_id,
      'voided_by_user_id', v_actor_user_id,
      'device_id', p_device_id,
      'reason', v_reason,
      'voided_at', v_sale.voided_at
    ),
    v_actor_user_id
  );

  return query
  select
    v_sale.id,
    v_sale.store_id,
    v_sale.voided_at,
    v_sale.voided_by_user_id,
    v_sale.void_reason,
    v_sale.version,
    true;
end;
$$;

revoke all on function public.void_sale(uuid, uuid, text, uuid)
  from public, anon;
grant execute on function public.void_sale(uuid, uuid, text, uuid)
  to authenticated, service_role;

-- =============================================================================
-- 11. Comentarios de esquema
-- =============================================================================

comment on table public.cash_sessions is
  'Turnos de caja por tienda y dispositivo; una sola sesion abierta por contexto.';

comment on table public.sales is
  'Cabeceras de venta idempotentes; store_device_pos_id identifica el comprobante local.';

comment on table public.sale_items is
  'Items inmutables con snapshots de producto, precio, costo y presentacion.';

comment on table public.sale_payments is
  'Pagos inmutables; admite pagos combinados aunque la UI inicial use uno.';

comment on table public.cash_movements is
  'Ingresos y salidas manuales solo sobre la caja abierta del mismo dispositivo.';

comment on table public.sync_outbox is
  'Eventos centrales pendientes para push/pull incremental de B4.';

comment on function public.create_sale(uuid, uuid, text, jsonb, jsonb, uuid, bigint) is
  'Confirma venta, pagos, inventario y outbox atomicamente e idempotente.';

comment on function public.void_sale(uuid, uuid, text, uuid) is
  'Anula una venta en su caja original, restaura stock y no compensa efectivo.';
