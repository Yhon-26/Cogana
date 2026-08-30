-- Administración explícita de promociones sin escritura directa desde el cliente.

revoke insert,update,delete on public.promotions from authenticated;

create or replace function public.get_store_promotions(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'title',p.title,'description',p.description,
    'couponCode',p.coupon_code,'startsAt',p.starts_at,'endsAt',p.ends_at,
    'isActive',p.is_active,'version',p.version
  ) order by p.starts_at desc),'[]'::jsonb)
  from public.promotions p
  where p.store_id = p_store_id and private.is_store_admin(p_store_id)
$$;

create or replace function public.upsert_store_promotion(
  p_store_id uuid,
  p_promotion_id uuid,
  p_title text,
  p_description text,
  p_coupon_code text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_is_active boolean,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.promotions%rowtype;
begin
  if not private.is_store_admin(p_store_id) then
    raise exception using errcode = '42501', message = 'Solo administrador';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception using errcode = '22023', message = 'Vigencia inválida';
  end if;
  if p_expected_version is null then
    insert into public.promotions(
      id,store_id,title,description,coupon_code,starts_at,ends_at,is_active
    ) values (
      p_promotion_id,p_store_id,btrim(p_title),btrim(p_description),
      nullif(upper(btrim(p_coupon_code)),''),
      p_starts_at,p_ends_at,p_is_active
    ) returning * into v_row;
  else
    update public.promotions set
      title = btrim(p_title),description = btrim(p_description),
      coupon_code = nullif(upper(btrim(p_coupon_code)),''),
      starts_at = p_starts_at,ends_at = p_ends_at,is_active = p_is_active
    where id = p_promotion_id and store_id = p_store_id
      and version = p_expected_version
    returning * into v_row;
    if not found then
      raise exception using errcode = '40001', message = 'Promoción cambió';
    end if;
  end if;
  return jsonb_build_object('id',v_row.id,'version',v_row.version);
end;
$$;

revoke all on function public.get_store_promotions(uuid),
  public.upsert_store_promotion(
    uuid,uuid,text,text,text,timestamptz,timestamptz,boolean,bigint
  ) from public,anon,authenticated;
grant execute on function public.get_store_promotions(uuid),
  public.upsert_store_promotion(
    uuid,uuid,text,text,text,timestamptz,timestamptz,boolean,bigint
  ) to authenticated,service_role;
