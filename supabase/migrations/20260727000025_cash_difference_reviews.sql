-- Revisión administrativa y auditable de faltantes/sobrantes de caja.

create table public.cash_difference_reviews (
  id uuid primary key,
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  cash_session_id uuid not null,
  decision text not null check (decision in ('approved','requires_action')),
  justification text not null check (btrim(justification) <> ''),
  reviewed_by uuid not null references auth.users(id)
    on delete restrict on update cascade,
  source_device_id uuid not null,
  reviewed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (id,store_id),
  unique (store_id,cash_session_id),
  foreign key (cash_session_id,store_id)
    references public.cash_sessions(id,store_id)
    on delete restrict on update cascade,
  foreign key (store_id,source_device_id)
    references public.devices(store_id,id)
    on delete restrict on update cascade
);

create index cash_difference_reviews_store_date
  on public.cash_difference_reviews(store_id,reviewed_at desc);

create trigger cash_difference_reviews_bump
  before update on public.cash_difference_reviews
  for each row execute function private.bump_catalog_version();

alter table public.cash_difference_reviews enable row level security;
revoke all on public.cash_difference_reviews from public,anon,authenticated;
grant select on public.cash_difference_reviews to authenticated;
grant all on public.cash_difference_reviews to service_role;

create policy cash_difference_reviews_admin
  on public.cash_difference_reviews
  for select to authenticated
  using (private.is_store_admin(store_id));

create or replace function private.apply_cash_difference_review_sync(
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
  v_existing public.cash_difference_reviews%rowtype;
  v_result public.cash_difference_reviews%rowtype;
  v_expected_version bigint :=
    coalesce((p_payload ->> 'expectedVersion')::bigint,0);
begin
  if not private.is_store_admin(p_store_id) then
    raise exception using errcode = '42501', message = 'Solo administrador';
  end if;
  if not exists (
    select 1 from public.cash_sessions cs
    where cs.id = (p_payload ->> 'cashSessionId')::uuid
      and cs.store_id = p_store_id
      and cs.status = 'closed'
      and cs.difference_cents <> 0
  ) then
    raise exception using errcode = '22023', message = 'Cierre sin diferencia revisable';
  end if;

  select * into v_existing
  from public.cash_difference_reviews cdr
  where cdr.store_id = p_store_id
    and cdr.cash_session_id = (p_payload ->> 'cashSessionId')::uuid
  for update;

  if found then
    if v_existing.version <> v_expected_version then
      raise exception using errcode = '40001', message = 'Revision desactualizada';
    end if;
    update public.cash_difference_reviews
    set decision = p_payload ->> 'decision',
        justification = btrim(p_payload ->> 'justification'),
        reviewed_by = p_actor_user_id,
        source_device_id = p_device_id,
        reviewed_at = (p_payload ->> 'reviewedAt')::timestamptz
    where id = v_existing.id
    returning * into v_result;
  else
    if v_expected_version <> 0 then
      raise exception using errcode = '40001', message = 'Revision no encontrada';
    end if;
    insert into public.cash_difference_reviews(
      id,store_id,cash_session_id,decision,justification,reviewed_by,
      source_device_id,reviewed_at
    ) values (
      p_entity_id,p_store_id,(p_payload ->> 'cashSessionId')::uuid,
      p_payload ->> 'decision',btrim(p_payload ->> 'justification'),
      p_actor_user_id,p_device_id,(p_payload ->> 'reviewedAt')::timestamptz
    )
    returning * into v_result;
  end if;

  insert into public.change_log(
    store_id,source_device_id,operation_id,entity_type,entity_id,
    operation,entity_version,payload,changed_at
  ) values (
    p_store_id,p_device_id,p_operation_id,'cash_difference_review',v_result.id,
    'cash_difference.reviewed',v_result.version,
    jsonb_build_object(
      'id',v_result.id,'store_id',v_result.store_id,
      'cash_session_id',v_result.cash_session_id,
      'decision',v_result.decision,'justification',v_result.justification,
      'reviewed_by',v_result.reviewed_by,
      'source_device_id',v_result.source_device_id,
      'reviewed_at',v_result.reviewed_at,'created_at',v_result.created_at,
      'updated_at',v_result.updated_at,'version',v_result.version
    ),
    now()
  );
  return jsonb_build_object(
    'id',v_result.id,'version',v_result.version,'applied',true
  );
end;
$$;

revoke all on function private.apply_cash_difference_review_sync(
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
    raise exception 'No se encontró extensión B4 para diferencias de caja';
  end if;
  v_replacement :=
    'when v_operation_type = ''cash_difference.reviewed'' then
            v_result := private.apply_cash_difference_review_sync(
              p_store_id,p_device_id,v_actor_user_id,v_entity_id,
              v_operation_id,v_payload
            );
            v_server_entity_id := (v_result ->> ''id'')::uuid;

          ' || v_marker;
  execute replace(v_definition,v_marker,v_replacement);
end;
$migration$;

