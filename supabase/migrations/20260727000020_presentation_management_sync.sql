-- Edición y baja lógica de presentaciones comerciales desde la outbox.

create or replace function private.apply_presentation_update_sync(
  p_store_id uuid,
  p_entity_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.product_presentations%rowtype;
begin
  if not private.is_store_admin(p_store_id) then
    raise exception using errcode = '42501', message = 'Solo administrador';
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = (p_payload ->> 'productId')::uuid
      and p.store_id = p_store_id
  ) then
    raise exception using errcode = '23503', message = 'Producto inválido';
  end if;
  update public.product_presentations set
    sku = btrim(p_payload ->> 'sku'),
    name = btrim(p_payload ->> 'name'),
    kind = p_payload ->> 'type',
    conversion_factor = (p_payload ->> 'quantityInBaseUnits')::bigint,
    price_mode = case
      when (p_payload -> 'fixedPriceCents') is null
        or p_payload -> 'fixedPriceCents' = 'null'::jsonb then 'derived'
      else 'fixed'
    end,
    fixed_price_cents = nullif(p_payload ->> 'fixedPriceCents','')::bigint,
    is_active = (p_payload ->> 'isActive')::boolean
  where id = p_entity_id
    and store_id = p_store_id
    and product_id = (p_payload ->> 'productId')::uuid
    and version = (p_payload ->> 'expectedVersion')::bigint
  returning * into v_row;
  if not found then
    raise exception using errcode = '40001', message = 'Presentación cambió';
  end if;
  return jsonb_build_object(
    'id',v_row.id,'version',v_row.version,'applied',true
  );
end;
$$;

revoke all on function private.apply_presentation_update_sync(uuid,uuid,jsonb)
  from public,anon,authenticated;

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
    raise exception 'No se encontró extensión B4 para presentaciones';
  end if;
  v_replacement :=
    'when v_operation_type = ''product_presentation.updated'' then
            v_result := private.apply_presentation_update_sync(
              p_store_id,v_entity_id,v_payload
            );
            v_server_entity_id := v_entity_id;

          ' || v_marker;
  execute replace(v_definition,v_marker,v_replacement);
end;
$migration$;
