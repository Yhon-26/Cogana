-- Compras, lotes y conteos físicos offline-first.

create table public.purchase_orders (
  id uuid primary key,
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  supplier_id uuid not null,
  order_number text not null check (btrim(order_number) <> ''),
  status text not null default 'ordered'
    check (status in ('ordered','partially_received','received','cancelled')),
  expected_at date,
  notes text,
  total_cents bigint not null check (total_cents >= 0),
  actor_user_id uuid not null references auth.users(id),
  source_device_id uuid,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  unique (store_id,order_number),
  foreign key (supplier_id,store_id) references public.suppliers(id,store_id)
    on delete restrict on update cascade,
  foreign key (store_id,source_device_id) references public.devices(store_id,id)
    on delete restrict on update cascade
);

create table public.purchase_order_items (
  id uuid primary key,
  store_id uuid not null,
  purchase_order_id uuid not null,
  product_id uuid not null,
  product_name_snapshot text not null check (btrim(product_name_snapshot) <> ''),
  ordered_quantity bigint not null check (ordered_quantity > 0),
  received_quantity bigint not null default 0
    check (received_quantity >= 0 and received_quantity <= ordered_quantity),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  pricing_quantity bigint not null check (pricing_quantity > 0),
  line_total_cents bigint not null check (line_total_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  foreign key (purchase_order_id,store_id)
    references public.purchase_orders(id,store_id)
    on delete restrict on update cascade,
  foreign key (product_id,store_id) references public.products(id,store_id)
    on delete restrict on update cascade
);

create table public.inventory_lots (
  id uuid primary key,
  store_id uuid not null,
  product_id uuid not null,
  supplier_id uuid not null,
  purchase_order_id uuid not null,
  purchase_order_item_id uuid not null,
  lot_code text not null check (btrim(lot_code) <> ''),
  expires_at date,
  received_quantity bigint not null check (received_quantity > 0),
  remaining_quantity bigint not null
    check (remaining_quantity >= 0 and remaining_quantity <= received_quantity),
  actor_user_id uuid not null references auth.users(id),
  source_device_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  unique (store_id,product_id,lot_code),
  foreign key (product_id,store_id) references public.products(id,store_id)
    on delete restrict on update cascade,
  foreign key (supplier_id,store_id) references public.suppliers(id,store_id)
    on delete restrict on update cascade,
  foreign key (purchase_order_id,store_id)
    references public.purchase_orders(id,store_id)
    on delete restrict on update cascade,
  foreign key (purchase_order_item_id,store_id)
    references public.purchase_order_items(id,store_id)
    on delete restrict on update cascade,
  foreign key (store_id,source_device_id) references public.devices(store_id,id)
    on delete restrict on update cascade
);

create table public.physical_counts (
  id uuid primary key,
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  count_number text not null check (btrim(count_number) <> ''),
  status text not null default 'completed' check (status = 'completed'),
  notes text,
  actor_user_id uuid not null references auth.users(id),
  source_device_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  unique (store_id,count_number),
  foreign key (store_id,source_device_id) references public.devices(store_id,id)
    on delete restrict on update cascade
);

create table public.physical_count_items (
  id uuid primary key,
  store_id uuid not null,
  physical_count_id uuid not null,
  product_id uuid not null,
  product_name_snapshot text not null check (btrim(product_name_snapshot) <> ''),
  expected_quantity bigint not null check (expected_quantity >= 0),
  counted_quantity bigint not null check (counted_quantity >= 0),
  difference_quantity bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  foreign key (physical_count_id,store_id)
    references public.physical_counts(id,store_id)
    on delete restrict on update cascade,
  foreign key (product_id,store_id) references public.products(id,store_id)
    on delete restrict on update cascade
);

create index purchase_orders_status
  on public.purchase_orders(store_id,status,created_at desc);
create index purchase_order_items_order
  on public.purchase_order_items(store_id,purchase_order_id);
create index inventory_lots_expiry
  on public.inventory_lots(store_id,expires_at,remaining_quantity);
create index physical_counts_date
  on public.physical_counts(store_id,created_at desc);

create trigger purchase_orders_bump_version before update on public.purchase_orders
  for each row execute function private.bump_catalog_version();
create trigger purchase_order_items_bump_version before update on public.purchase_order_items
  for each row execute function private.bump_catalog_version();
create trigger inventory_lots_bump_version before update on public.inventory_lots
  for each row execute function private.bump_catalog_version();
create trigger physical_counts_bump_version before update on public.physical_counts
  for each row execute function private.bump_catalog_version();
create trigger physical_count_items_bump_version before update on public.physical_count_items
  for each row execute function private.bump_catalog_version();

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.inventory_lots enable row level security;
alter table public.physical_counts enable row level security;
alter table public.physical_count_items enable row level security;

revoke all on public.purchase_orders,public.purchase_order_items,
  public.inventory_lots,public.physical_counts,public.physical_count_items
  from public,anon,authenticated;
grant select on public.purchase_orders,public.purchase_order_items,
  public.inventory_lots,public.physical_counts,public.physical_count_items
  to authenticated;
grant all on public.purchase_orders,public.purchase_order_items,
  public.inventory_lots,public.physical_counts,public.physical_count_items
  to service_role;

create policy purchase_orders_store on public.purchase_orders
  for select to authenticated using (private.is_store_member(store_id));
create policy purchase_order_items_store on public.purchase_order_items
  for select to authenticated using (private.is_store_member(store_id));
create policy inventory_lots_store on public.inventory_lots
  for select to authenticated using (private.is_store_member(store_id));
create policy physical_counts_store on public.physical_counts
  for select to authenticated using (private.is_store_member(store_id));
create policy physical_count_items_store on public.physical_count_items
  for select to authenticated using (private.is_store_member(store_id));

create or replace function private.purchase_order_change_payload(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id',po.id,'store_id',po.store_id,'supplier_id',po.supplier_id,
    'order_number',po.order_number,'status',po.status,
    'expected_at',po.expected_at,'notes',po.notes,'total_cents',po.total_cents,
    'actor_user_id',po.actor_user_id,'device_id',po.source_device_id,
    'received_at',po.received_at,'created_at',po.created_at,
    'updated_at',po.updated_at,'version',po.version,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'product_id',i.product_id,
        'product_name_snapshot',i.product_name_snapshot,
        'ordered_quantity',i.ordered_quantity,
        'received_quantity',i.received_quantity,
        'unit_cost_cents',i.unit_cost_cents,
        'pricing_quantity',i.pricing_quantity,
        'line_total_cents',i.line_total_cents,
        'created_at',i.created_at,'updated_at',i.updated_at,'version',i.version
      ) order by i.created_at)
      from public.purchase_order_items i
      where i.purchase_order_id = po.id and i.store_id = po.store_id
    ),'[]'::jsonb)
  )
  from public.purchase_orders po where po.id = p_order_id
$$;

create or replace function private.inventory_lot_change_payload(p_lot_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id',l.id,'store_id',l.store_id,'product_id',l.product_id,
    'supplier_id',l.supplier_id,'purchase_order_id',l.purchase_order_id,
    'purchase_order_item_id',l.purchase_order_item_id,'lot_code',l.lot_code,
    'expires_at',l.expires_at,'received_quantity',l.received_quantity,
    'remaining_quantity',l.remaining_quantity,'actor_user_id',l.actor_user_id,
    'device_id',l.source_device_id,'created_at',l.created_at,
    'updated_at',l.updated_at,'version',l.version
  ) from public.inventory_lots l where l.id = p_lot_id
$$;

create or replace function private.physical_count_change_payload(p_count_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id',c.id,'store_id',c.store_id,'count_number',c.count_number,
    'status',c.status,'notes',c.notes,'actor_user_id',c.actor_user_id,
    'device_id',c.source_device_id,'created_at',c.created_at,
    'updated_at',c.updated_at,'version',c.version,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'product_id',i.product_id,
        'product_name_snapshot',i.product_name_snapshot,
        'expected_quantity',i.expected_quantity,
        'counted_quantity',i.counted_quantity,
        'difference_quantity',i.difference_quantity,
        'created_at',i.created_at,'updated_at',i.updated_at,'version',i.version
      ) order by i.created_at)
      from public.physical_count_items i
      where i.physical_count_id = c.id and i.store_id = c.store_id
    ),'[]'::jsonb)
  )
  from public.physical_counts c where c.id = p_count_id
$$;

revoke all on function private.purchase_order_change_payload(uuid),
  private.inventory_lot_change_payload(uuid),
  private.physical_count_change_payload(uuid)
  from public,anon,authenticated;

create or replace function private.apply_procurement_operation_sync(
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
  v_item jsonb;
  v_lot_id uuid;
  v_order public.purchase_orders%rowtype;
  v_count public.physical_counts%rowtype;
begin
  if not private.is_store_member(p_store_id) then
    raise exception using errcode = '42501', message = 'Sin acceso a compras';
  end if;

  if p_operation_type = 'purchase_order.created' then
    if not private.is_store_admin(p_store_id) then
      raise exception using errcode = '42501', message = 'Solo administrador crea órdenes';
    end if;
    if jsonb_typeof(p_payload -> 'items') <> 'array'
      or jsonb_array_length(p_payload -> 'items') = 0 then
      raise exception using errcode = '22023', message = 'Orden sin ítems';
    end if;
    insert into public.purchase_orders(
      id,store_id,supplier_id,order_number,status,expected_at,notes,total_cents,
      actor_user_id,source_device_id,created_at,updated_at
    ) values (
      p_entity_id,p_store_id,(p_payload ->> 'supplierId')::uuid,
      btrim(p_payload ->> 'orderNumber'),'ordered',
      nullif(p_payload ->> 'expectedAt','')::date,
      nullif(btrim(p_payload ->> 'notes'),''),
      (p_payload ->> 'totalCents')::bigint,p_actor_user_id,p_device_id,
      coalesce((p_payload ->> 'createdAt')::timestamptz,now()),
      coalesce((p_payload ->> 'createdAt')::timestamptz,now())
    );
    for v_item in select value from jsonb_array_elements(p_payload -> 'items')
    loop
      if not exists (
        select 1 from public.products p
        where p.id = (v_item ->> 'productId')::uuid and p.store_id = p_store_id
      ) then
        raise exception using errcode = '23503', message = 'Producto de compra inválido';
      end if;
      insert into public.purchase_order_items(
        id,store_id,purchase_order_id,product_id,product_name_snapshot,
        ordered_quantity,received_quantity,unit_cost_cents,pricing_quantity,
        line_total_cents,created_at,updated_at
      ) values (
        (v_item ->> 'id')::uuid,p_store_id,p_entity_id,
        (v_item ->> 'productId')::uuid,btrim(v_item ->> 'productName'),
        (v_item ->> 'orderedQuantity')::bigint,0,
        (v_item ->> 'unitCostCents')::bigint,
        (v_item ->> 'pricingQuantity')::bigint,
        (v_item ->> 'lineTotalCents')::bigint,
        coalesce((p_payload ->> 'createdAt')::timestamptz,now()),
        coalesce((p_payload ->> 'createdAt')::timestamptz,now())
      );
    end loop;
  elsif p_operation_type = 'purchase_order.received' then
    if not private.is_store_admin(p_store_id) then
      raise exception using errcode = '42501', message = 'Solo administrador recibe ordenes';
    end if;
    select * into v_order from public.purchase_orders po
      where po.id = p_entity_id and po.store_id = p_store_id for update;
    if not found or v_order.status <> 'ordered' then
      raise exception using errcode = '40001', message = 'Orden no pendiente';
    end if;
    for v_item in select value from jsonb_array_elements(p_payload -> 'lots')
    loop
      update public.purchase_order_items set
        received_quantity = received_quantity
          + (v_item ->> 'receivedQuantity')::bigint
      where id = (v_item ->> 'itemId')::uuid
        and store_id = p_store_id and purchase_order_id = p_entity_id;
      if not found then
        raise exception using errcode = '23503', message = 'Ítem de compra inválido';
      end if;
      if nullif(v_item ->> 'lotCode','') is not null then
        v_lot_id := (v_item ->> 'id')::uuid;
        insert into public.inventory_lots(
          id,store_id,product_id,supplier_id,purchase_order_id,
          purchase_order_item_id,lot_code,expires_at,received_quantity,
          remaining_quantity,actor_user_id,source_device_id
        ) values (
          v_lot_id,p_store_id,(v_item ->> 'productId')::uuid,v_order.supplier_id,
          p_entity_id,(v_item ->> 'itemId')::uuid,btrim(v_item ->> 'lotCode'),
          nullif(v_item ->> 'expiresAt','')::date,
          (v_item ->> 'receivedQuantity')::bigint,
          (v_item ->> 'receivedQuantity')::bigint,p_actor_user_id,p_device_id
        );
        insert into public.change_log(
          store_id,source_device_id,operation_id,entity_type,entity_id,
          operation,entity_version,payload,changed_at
        ) values (
          p_store_id,p_device_id,p_operation_id,'inventory_lot',v_lot_id,
          'inventory_lot.received',1,
          private.inventory_lot_change_payload(v_lot_id),now()
        );
      end if;
    end loop;
    update public.purchase_orders set
      status = 'received',
      received_at = coalesce((p_payload ->> 'receivedAt')::timestamptz,now())
    where id = p_entity_id and store_id = p_store_id;
  elsif p_operation_type = 'physical_count.completed' then
    if not private.is_store_admin(p_store_id) then
      raise exception using errcode = '42501', message = 'Solo administrador cuenta';
    end if;
    insert into public.physical_counts(
      id,store_id,count_number,status,notes,actor_user_id,source_device_id,
      created_at,updated_at
    ) values (
      p_entity_id,p_store_id,btrim(p_payload ->> 'countNumber'),'completed',
      nullif(btrim(p_payload ->> 'notes'),''),p_actor_user_id,p_device_id,
      coalesce((p_payload ->> 'createdAt')::timestamptz,now()),
      coalesce((p_payload ->> 'createdAt')::timestamptz,now())
    );
    for v_item in select value from jsonb_array_elements(p_payload -> 'items')
    loop
      insert into public.physical_count_items(
        id,store_id,physical_count_id,product_id,product_name_snapshot,
        expected_quantity,counted_quantity,difference_quantity
      ) values (
        gen_random_uuid(),p_store_id,p_entity_id,
        (v_item ->> 'productId')::uuid,btrim(v_item ->> 'productName'),
        (v_item ->> 'expectedQuantity')::bigint,
        (v_item ->> 'countedQuantity')::bigint,
        (v_item ->> 'differenceQuantity')::bigint
      );
    end loop;
  else
    raise exception using errcode = '22023', message = 'Operación de compras no soportada';
  end if;

  if p_operation_type like 'purchase_order.%' then
    select * into strict v_order from public.purchase_orders po
      where po.id = p_entity_id and po.store_id = p_store_id;
    insert into public.change_log(
      store_id,source_device_id,operation_id,entity_type,entity_id,
      operation,entity_version,payload,changed_at
    ) values (
      p_store_id,p_device_id,p_operation_id,'purchase_order',p_entity_id,
      p_operation_type,v_order.version,
      private.purchase_order_change_payload(p_entity_id),now()
    );
    return jsonb_build_object('id',p_entity_id,'version',v_order.version,'applied',true);
  end if;

  select * into strict v_count from public.physical_counts c
    where c.id = p_entity_id and c.store_id = p_store_id;
  insert into public.change_log(
    store_id,source_device_id,operation_id,entity_type,entity_id,
    operation,entity_version,payload,changed_at
  ) values (
    p_store_id,p_device_id,p_operation_id,'physical_count',p_entity_id,
    p_operation_type,v_count.version,
    private.physical_count_change_payload(p_entity_id),now()
  );
  return jsonb_build_object('id',p_entity_id,'version',v_count.version,'applied',true);
end;
$$;

revoke all on function private.apply_procurement_operation_sync(
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
    raise exception 'No se encontró extensión B4 para compras';
  end if;
  v_replacement :=
    'when v_operation_type in (
              ''purchase_order.created'',
              ''purchase_order.received'',
              ''physical_count.completed''
            ) then
            v_result := private.apply_procurement_operation_sync(
              p_store_id,p_device_id,v_actor_user_id,v_entity_id,
              v_operation_id,v_operation_type,v_payload
            );
            v_server_entity_id := v_entity_id;

          ' || v_marker;
  execute replace(v_definition,v_marker,v_replacement);
end;
$migration$;
