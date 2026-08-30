-- Devoluciones parciales auditadas, con reposición mediante eventos de inventario.

create table public.sale_returns (
  id uuid primary key,
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  sale_id uuid not null,
  cash_session_id uuid,
  refund_method text not null check (refund_method in ('cash','yape','plin','card')),
  total_cents bigint not null check (total_cents > 0),
  reason text not null check (btrim(reason) <> ''),
  actor_user_id uuid not null references auth.users(id),
  source_device_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version = 1),
  unique (id,store_id),
  foreign key (sale_id,store_id) references public.sales(id,store_id)
    on delete restrict on update cascade,
  foreign key (cash_session_id,store_id,source_device_id)
    references public.cash_sessions(id,store_id,device_id)
    on delete restrict on update cascade,
  foreign key (store_id,source_device_id) references public.devices(store_id,id)
    on delete restrict on update cascade,
  check (
    (refund_method = 'cash' and cash_session_id is not null)
    or (refund_method <> 'cash' and cash_session_id is null)
  )
);

create table public.sale_return_items (
  id uuid primary key,
  store_id uuid not null,
  sale_return_id uuid not null,
  sale_item_id uuid not null,
  product_id uuid not null,
  quantity bigint not null check (quantity > 0),
  refund_cents bigint not null check (refund_cents > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version = 1),
  unique (id,store_id),
  foreign key (sale_return_id,store_id) references public.sale_returns(id,store_id)
    on delete restrict on update cascade,
  foreign key (sale_item_id,store_id) references public.sale_items(id,store_id)
    on delete restrict on update cascade,
  foreign key (product_id,store_id) references public.products(id,store_id)
    on delete restrict on update cascade
);

create index sale_returns_sale on public.sale_returns(store_id,sale_id,created_at desc);
create index sale_return_items_item on public.sale_return_items(store_id,sale_item_id);

create trigger sale_returns_immutable before update or delete on public.sale_returns
  for each row execute function private.prevent_immutable_catalog_change();
create trigger sale_return_items_immutable before update or delete on public.sale_return_items
  for each row execute function private.prevent_immutable_catalog_change();

alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;
revoke all on public.sale_returns,public.sale_return_items
  from public,anon,authenticated;
grant select on public.sale_returns,public.sale_return_items to authenticated;
grant all on public.sale_returns,public.sale_return_items to service_role;
create policy sale_returns_store on public.sale_returns
  for select to authenticated using (private.is_store_member(store_id));
create policy sale_return_items_store on public.sale_return_items
  for select to authenticated using (private.is_store_member(store_id));

create or replace function private.prevent_void_after_partial_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.voided_at is null and new.voided_at is not null and exists (
    select 1 from public.sale_returns r
    where r.store_id = old.store_id and r.sale_id = old.id
  ) then
    raise exception using
      errcode = '55000',
      message = 'Venta con devoluciones parciales no admite anulación total';
  end if;
  return new;
end;
$$;
create trigger sales_05_prevent_void_after_partial_return
  before update on public.sales
  for each row execute function private.prevent_void_after_partial_return();

create or replace function private.sale_return_change_payload(p_return_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id',r.id,'store_id',r.store_id,'sale_id',r.sale_id,
    'cash_session_id',r.cash_session_id,'refund_method',r.refund_method,
    'total_cents',r.total_cents,'reason',r.reason,
    'actor_user_id',r.actor_user_id,'device_id',r.source_device_id,
    'created_at',r.created_at,'updated_at',r.updated_at,'version',r.version,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'sale_item_id',i.sale_item_id,'product_id',i.product_id,
        'quantity',i.quantity,'refund_cents',i.refund_cents,
        'created_at',i.created_at,'updated_at',i.updated_at,'version',i.version
      ) order by i.created_at)
      from public.sale_return_items i
      where i.sale_return_id = r.id and i.store_id = r.store_id
    ),'[]'::jsonb)
  ) from public.sale_returns r where r.id = p_return_id
$$;
revoke all on function private.sale_return_change_payload(uuid)
  from public,anon,authenticated;

create or replace function private.apply_sale_return_sync(
  p_store_id uuid,
  p_device_id uuid,
  p_actor_user_id uuid,
  p_entity_id uuid,
  p_operation_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_sale_item public.sale_items%rowtype;
  v_returned bigint;
  v_calculated bigint;
  v_total bigint := 0;
  v_expected_cash bigint;
  v_return public.sale_returns%rowtype;
begin
  if not private.is_store_admin(p_store_id) then
    raise exception using errcode = '42501', message = 'Solo administrador';
  end if;
  select * into v_sale from public.sales s
    where s.id = (p_payload ->> 'saleId')::uuid
      and s.store_id = p_store_id for update;
  if not found or v_sale.voided_at is not null then
    raise exception using errcode = '22023', message = 'Venta no disponible';
  end if;
  if jsonb_typeof(p_payload -> 'items') <> 'array'
    or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception using errcode = '22023', message = 'Devolucion sin items';
  end if;

  if (select count(*) from (select distinct value->>'saleItemId' as id
    from jsonb_array_elements(p_payload -> 'items')) sub) <>
    jsonb_array_length(p_payload -> 'items') then
    raise exception using errcode = '22023', message = 'Items duplicados en la solicitud';
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    select * into v_sale_item from public.sale_items si
      where si.id = (v_item ->> 'saleItemId')::uuid
        and si.store_id = p_store_id and si.sale_id = v_sale.id;
    if not found then
      raise exception using errcode = '23503', message = 'Ítem de venta inválido';
    end if;
    select coalesce(sum(ri.quantity),0) into v_returned
      from public.sale_return_items ri
      join public.sale_returns r on r.id = ri.sale_return_id
        and r.store_id = ri.store_id
      where ri.store_id = p_store_id and ri.sale_item_id = v_sale_item.id;
    if (v_item ->> 'quantity')::bigint <= 0
      or v_returned + (v_item ->> 'quantity')::bigint > v_sale_item.quantity then
      raise exception using errcode = '22023', message = 'Cantidad excede venta';
    end if;
    v_calculated := (
      (v_item ->> 'quantity')::bigint * v_sale_item.line_total_cents
      + v_sale_item.quantity / 2
    ) / v_sale_item.quantity;
    if v_calculated <> (v_item ->> 'refundCents')::bigint then
      raise exception using errcode = '22023', message = 'Monto de devolución inválido';
    end if;
    v_total := v_total + v_calculated;
  end loop;
  if v_total <> (p_payload ->> 'totalCents')::bigint then
    raise exception using errcode = '22023', message = 'Total de devolución inválido';
  end if;

  if p_payload ->> 'refundMethod' = 'cash' then
    if not private.is_open_cash_session_for_device(
      (p_payload ->> 'cashSessionId')::uuid, p_store_id, p_device_id
    ) then
      raise exception using errcode = '55000', message = 'Caja no disponible';
    end if;
    select cs.opening_cash_cents
      + coalesce((select sum(sp.amount_cents) from public.sale_payments sp
        join public.sales s on s.id = sp.sale_id and s.store_id = sp.store_id
        where s.cash_session_id = cs.id and s.voided_at is null
          and sp.payment_method = 'cash'),0)
      + coalesce((select sum(cm.amount_cents) from public.cash_movements cm
        where cm.cash_session_id = cs.id and cm.movement_type = 'income'),0)
      - coalesce((select sum(cm.amount_cents) from public.cash_movements cm
        where cm.cash_session_id = cs.id and cm.movement_type = 'outflow'),0)
      into v_expected_cash
      from public.cash_sessions cs
      where cs.id = (p_payload ->> 'cashSessionId')::uuid
        and cs.store_id = p_store_id;
    if v_expected_cash < v_total then
      raise exception using errcode = '22023', message = 'Efectivo insuficiente';
    end if;
  end if;

  insert into public.sale_returns(
    id,store_id,sale_id,cash_session_id,refund_method,total_cents,reason,
    actor_user_id,source_device_id,created_at,updated_at
  ) values (
    p_entity_id,p_store_id,v_sale.id,
    nullif(p_payload ->> 'cashSessionId','')::uuid,
    p_payload ->> 'refundMethod',v_total,btrim(p_payload ->> 'reason'),
    p_actor_user_id,p_device_id,
    coalesce((p_payload ->> 'createdAt')::timestamptz,now()),
    coalesce((p_payload ->> 'createdAt')::timestamptz,now())
  );
  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    insert into public.sale_return_items(
      id,store_id,sale_return_id,sale_item_id,product_id,quantity,
      refund_cents,created_at,updated_at
    ) values (
      (v_item ->> 'id')::uuid,p_store_id,p_entity_id,
      (v_item ->> 'saleItemId')::uuid,(v_item ->> 'productId')::uuid,
      (v_item ->> 'quantity')::bigint,(v_item ->> 'refundCents')::bigint,
      coalesce((p_payload ->> 'createdAt')::timestamptz,now()),
      coalesce((p_payload ->> 'createdAt')::timestamptz,now())
    );
  end loop;
  if p_payload ->> 'refundMethod' = 'cash' then
    insert into public.cash_movements(
      id,store_id,cash_session_id,movement_type,amount_cents,reason,sale_id,
      actor_user_id,device_id,operation_id
    ) values (
      (p_payload ->> 'cashMovementId')::uuid,p_store_id,
      (p_payload ->> 'cashSessionId')::uuid,'outflow',v_total,
      'Devolución ' || v_sale.store_device_pos_id || ': ' || btrim(p_payload ->> 'reason'),
      v_sale.id,p_actor_user_id,p_device_id,p_operation_id
    );
  end if;
  select * into strict v_return from public.sale_returns r
    where r.id = p_entity_id and r.store_id = p_store_id;
  insert into public.change_log(
    store_id,source_device_id,operation_id,entity_type,entity_id,
    operation,entity_version,payload,changed_at
  ) values (
    p_store_id,p_device_id,p_operation_id,'sale_return',p_entity_id,
    'sale.returned',v_return.version,
    private.sale_return_change_payload(p_entity_id),now()
  );
  return jsonb_build_object('id',p_entity_id,'version',v_return.version,'applied',true);
end;
$$;
revoke all on function private.apply_sale_return_sync(
  uuid,uuid,uuid,uuid,uuid,jsonb
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
    raise exception 'No se encontró extensión B4 para devoluciones';
  end if;
  v_replacement :=
    'when v_operation_type = ''sale.returned'' then
            v_result := private.apply_sale_return_sync(
              p_store_id,p_device_id,v_actor_user_id,v_entity_id,
              v_operation_id,v_payload
            );
            v_server_entity_id := v_entity_id;

          ' || v_marker;
  execute replace(v_definition,v_marker,v_replacement);
end;
$migration$;
