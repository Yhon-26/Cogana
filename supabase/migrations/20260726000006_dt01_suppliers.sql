-- DT-01: maestro de proveedores por tienda, RLS y sincronizacion push/pull.

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  name text not null check (btrim(name) <> ''),
  tax_id text check (tax_id is null or tax_id ~ '^[0-9]{11}$'),
  contact_name text,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict on update cascade,
  updated_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id, store_id),
  unique (store_id, tax_id)
);

create index suppliers_store_active_name
  on public.suppliers(store_id, is_active, name);

create or replace function private.bump_supplier_version()
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

create trigger suppliers_bump_version
  before update on public.suppliers
  for each row execute function private.bump_supplier_version();

create or replace function private.append_supplier_change()
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
    'supplier',
    new.id,
    'upsert',
    new.version,
    pg_catalog.jsonb_build_object(
      'id', new.id,
      'store_id', new.store_id,
      'name', new.name,
      'tax_id', new.tax_id,
      'contact_name', new.contact_name,
      'phone', new.phone,
      'email', new.email,
      'address', new.address,
      'notes', new.notes,
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

create trigger suppliers_publish_change
  after insert or update on public.suppliers
  for each row execute function private.append_supplier_change();

alter table public.suppliers enable row level security;

revoke all on public.suppliers from public, anon, authenticated;
grant select on public.suppliers to authenticated;
grant insert (
  id, store_id, name, tax_id, contact_name, phone, email,
  address, notes, is_active
) on public.suppliers to authenticated;
grant update (
  name, tax_id, contact_name, phone, email, address, notes, is_active
) on public.suppliers to authenticated;
grant all on public.suppliers to service_role;

create policy suppliers_select_store_member
  on public.suppliers for select
  to authenticated
  using (private.is_store_member(store_id));

create policy suppliers_insert_store_admin
  on public.suppliers for insert
  to authenticated
  with check (private.is_store_admin(store_id));

create policy suppliers_update_store_admin
  on public.suppliers for update
  to authenticated
  using (private.is_store_admin(store_id))
  with check (private.is_store_admin(store_id));

-- Extiende el procesador B4 sin reescribir la migracion ya aplicada.
do $migration$
declare
  v_body text;
  v_old text := $old$
          when v_operation_type = 'product_presentation.created' then
$old$;
  v_new text := $new$
          when v_operation_type in (
            'supplier.created',
            'supplier.updated',
            'supplier.activated',
            'supplier.deactivated'
          ) then
            if not private.is_store_admin(p_store_id) then
              raise exception using
                errcode = '42501',
                message = 'Solo un administrador puede modificar proveedores';
            end if;

            if v_operation_type = 'supplier.created' then
              insert into public.suppliers (
                id,
                store_id,
                name,
                tax_id,
                contact_name,
                phone,
                email,
                address,
                notes,
                is_active,
                created_by,
                updated_by
              ) values (
                v_entity_id,
                p_store_id,
                pg_catalog.btrim(v_payload ->> 'name'),
                nullif(pg_catalog.btrim(v_payload ->> 'taxId'), ''),
                nullif(pg_catalog.btrim(v_payload ->> 'contactName'), ''),
                nullif(pg_catalog.btrim(v_payload ->> 'phone'), ''),
                nullif(pg_catalog.btrim(v_payload ->> 'email'), ''),
                nullif(pg_catalog.btrim(v_payload ->> 'address'), ''),
                nullif(pg_catalog.btrim(v_payload ->> 'notes'), ''),
                coalesce((v_payload ->> 'isActive')::boolean, true),
                v_actor_user_id,
                v_actor_user_id
              )
              returning id into v_server_entity_id;
            else
              update public.suppliers s
              set name = pg_catalog.btrim(v_payload ->> 'name'),
                  tax_id = nullif(pg_catalog.btrim(v_payload ->> 'taxId'), ''),
                  contact_name = nullif(
                    pg_catalog.btrim(v_payload ->> 'contactName'), ''
                  ),
                  phone = nullif(pg_catalog.btrim(v_payload ->> 'phone'), ''),
                  email = nullif(pg_catalog.btrim(v_payload ->> 'email'), ''),
                  address = nullif(pg_catalog.btrim(v_payload ->> 'address'), ''),
                  notes = nullif(pg_catalog.btrim(v_payload ->> 'notes'), ''),
                  is_active = (v_payload ->> 'isActive')::boolean,
                  updated_by = v_actor_user_id
              where s.id = v_entity_id
                and s.store_id = p_store_id
                and s.version = (v_payload ->> 'expectedVersion')::bigint
              returning s.id into v_server_entity_id;

              if not found then
                if exists (
                  select 1
                  from public.suppliers s
                  where s.id = v_entity_id
                    and s.store_id = p_store_id
                ) then
                  raise exception using
                    errcode = '40001',
                    message = 'El proveedor cambio en el servidor';
                end if;
                raise exception using
                  errcode = 'P0002',
                  message = 'El proveedor no existe';
              end if;
            end if;

            select pg_catalog.jsonb_build_object(
              'supplier_id', s.id,
              'supplier_version', s.version,
              'applied', true
            )
              into v_result
            from public.suppliers s
            where s.id = v_server_entity_id
              and s.store_id = p_store_id;

          when v_operation_type = 'product_presentation.created' then
$new$;
begin
  select p.prosrc
    into v_body
  from pg_catalog.pg_proc p
  where p.oid = 'public.process_sync_batch(uuid,uuid,integer,jsonb)'::pg_catalog.regprocedure;

  if v_body is null then
    raise exception 'process_sync_batch B4 no existe';
  end if;
  if pg_catalog.strpos(v_body, v_old) = 0 then
    raise exception 'No se encontro el punto de extension B4 para proveedores';
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

comment on table public.suppliers is
  'Directorio de proveedores por tienda; bajas mediante is_active.';
