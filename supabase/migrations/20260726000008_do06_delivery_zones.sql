-- DO-06: zonas, tarifas y restricciones de delivery por tienda.

create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  name text not null check (btrim(name) <> ''),
  district text not null check (btrim(district) <> ''),
  fee_cents bigint not null check (fee_cents >= 0),
  minimum_order_cents bigint not null default 0 check (minimum_order_cents >= 0),
  eta_min_minutes integer not null check (eta_min_minutes > 0),
  eta_max_minutes integer not null,
  schedule_text text not null check (btrim(schedule_text) <> ''),
  restrictions text,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict on update cascade,
  updated_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  constraint delivery_zones_eta_range
    check (eta_max_minutes >= eta_min_minutes),
  unique (id, store_id),
  unique (store_id, name)
);

create index delivery_zones_store_active_name
  on public.delivery_zones(store_id, is_active, name);

create or replace function private.bump_delivery_zone_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  if auth.uid() is not null then
    new.updated_by = auth.uid();
  end if;
  return new;
end;
$$;

create trigger delivery_zones_bump_version
  before update on public.delivery_zones
  for each row execute function private.bump_delivery_zone_version();

create or replace function private.append_delivery_zone_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.change_log (
    store_id,
    entity_type,
    entity_id,
    operation,
    entity_version,
    payload,
    changed_at
  ) values (
    new.store_id,
    'delivery_zone',
    new.id,
    'upsert',
    new.version,
    pg_catalog.jsonb_build_object(
      'id', new.id,
      'store_id', new.store_id,
      'name', new.name,
      'district', new.district,
      'fee_cents', new.fee_cents,
      'minimum_order_cents', new.minimum_order_cents,
      'eta_min_minutes', new.eta_min_minutes,
      'eta_max_minutes', new.eta_max_minutes,
      'schedule_text', new.schedule_text,
      'restrictions', new.restrictions,
      'is_active', new.is_active,
      'created_by', new.created_by,
      'updated_by', new.updated_by,
      'created_at', new.created_at,
      'updated_at', new.updated_at,
      'version', new.version
    ),
    new.updated_at
  );
  return new;
end;
$$;

create trigger delivery_zones_publish_change
  after insert or update on public.delivery_zones
  for each row execute function private.append_delivery_zone_change();

alter table public.delivery_zones enable row level security;

revoke all on public.delivery_zones from public, anon, authenticated;
grant select on public.delivery_zones to authenticated;
grant insert (
  id, store_id, name, district, fee_cents, minimum_order_cents,
  eta_min_minutes, eta_max_minutes, schedule_text, restrictions, is_active
) on public.delivery_zones to authenticated;
grant update (
  name, district, fee_cents, minimum_order_cents,
  eta_min_minutes, eta_max_minutes, schedule_text, restrictions, is_active
) on public.delivery_zones to authenticated;
grant all on public.delivery_zones to service_role;

create policy delivery_zones_select_store_member
  on public.delivery_zones for select
  to authenticated
  using (private.is_store_member(store_id));

create policy delivery_zones_insert_store_admin
  on public.delivery_zones for insert
  to authenticated
  with check (private.is_store_admin(store_id));

create policy delivery_zones_update_store_admin
  on public.delivery_zones for update
  to authenticated
  using (private.is_store_admin(store_id))
  with check (private.is_store_admin(store_id));

-- Extiende el procesador B4 sin reescribir migraciones ya aplicadas.
do $migration$
declare
  v_body text;
  v_old text := $old$
          when v_operation_type = 'product_presentation.created' then
$old$;
  v_new text := $new$
          when v_operation_type in (
            'delivery_zone.created',
            'delivery_zone.updated',
            'delivery_zone.activated',
            'delivery_zone.deactivated'
          ) then
            if not private.is_store_admin(p_store_id) then
              raise exception using
                errcode = '42501',
                message = 'Solo un administrador puede modificar zonas de delivery';
            end if;

            if v_operation_type = 'delivery_zone.created' then
              insert into public.delivery_zones (
                id,
                store_id,
                name,
                district,
                fee_cents,
                minimum_order_cents,
                eta_min_minutes,
                eta_max_minutes,
                schedule_text,
                restrictions,
                is_active,
                created_by,
                updated_by
              ) values (
                v_entity_id,
                p_store_id,
                pg_catalog.btrim(v_payload ->> 'name'),
                pg_catalog.btrim(v_payload ->> 'district'),
                (v_payload ->> 'feeCents')::bigint,
                (v_payload ->> 'minimumOrderCents')::bigint,
                (v_payload ->> 'etaMinMinutes')::integer,
                (v_payload ->> 'etaMaxMinutes')::integer,
                pg_catalog.btrim(v_payload ->> 'scheduleText'),
                nullif(pg_catalog.btrim(v_payload ->> 'restrictions'), ''),
                coalesce((v_payload ->> 'isActive')::boolean, true),
                v_actor_user_id,
                v_actor_user_id
              )
              returning id into v_server_entity_id;
            else
              update public.delivery_zones z
              set name = pg_catalog.btrim(v_payload ->> 'name'),
                  district = pg_catalog.btrim(v_payload ->> 'district'),
                  fee_cents = (v_payload ->> 'feeCents')::bigint,
                  minimum_order_cents =
                    (v_payload ->> 'minimumOrderCents')::bigint,
                  eta_min_minutes = (v_payload ->> 'etaMinMinutes')::integer,
                  eta_max_minutes = (v_payload ->> 'etaMaxMinutes')::integer,
                  schedule_text = pg_catalog.btrim(v_payload ->> 'scheduleText'),
                  restrictions = nullif(
                    pg_catalog.btrim(v_payload ->> 'restrictions'), ''
                  ),
                  is_active = (v_payload ->> 'isActive')::boolean,
                  updated_by = v_actor_user_id
              where z.id = v_entity_id
                and z.store_id = p_store_id
                and z.version = (v_payload ->> 'expectedVersion')::bigint
              returning z.id into v_server_entity_id;

              if not found then
                if exists (
                  select 1
                  from public.delivery_zones z
                  where z.id = v_entity_id
                    and z.store_id = p_store_id
                ) then
                  raise exception using
                    errcode = '40001',
                    message = 'La zona cambio en el servidor';
                end if;
                raise exception using
                  errcode = 'P0002',
                  message = 'La zona no existe';
              end if;
            end if;

            select pg_catalog.jsonb_build_object(
              'delivery_zone_id', z.id,
              'delivery_zone_version', z.version,
              'applied', true
            )
              into v_result
            from public.delivery_zones z
            where z.id = v_server_entity_id
              and z.store_id = p_store_id;

          when v_operation_type = 'product_presentation.created' then
$new$;
begin
  select p.prosrc
    into v_body
  from pg_catalog.pg_proc p
  where p.oid =
    'public.process_sync_batch(uuid,uuid,integer,jsonb)'::pg_catalog.regprocedure;

  if v_body is null then
    raise exception 'process_sync_batch B4 no existe';
  end if;
  if pg_catalog.strpos(v_body, v_old) = 0 then
    raise exception 'No se encontro el punto de extension B4 para zonas';
  end if;

  v_body := pg_catalog.replace(v_body, v_old, v_new);

  execute pg_catalog.format(
    $sql$
      create or replace function public.process_sync_batch(
        p_store_id uuid,
        p_device_id uuid,
        p_schema_version integer,
        p_operations jsonb
      )
      returns jsonb
      language plpgsql
      security definer
      set search_path = ''
      as %L
    $sql$,
    v_body
  );
end;
$migration$;

comment on table public.delivery_zones is
  'Cobertura, tarifa, pedido minimo, ETA y restricciones de delivery por tienda.';
