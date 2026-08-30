-- Venta online: favoritos, preferencias y promociones configurables.

create table public.customer_favorites (
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  customer_id uuid not null,
  product_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (store_id, customer_id, product_id),
  foreign key (customer_id, store_id) references public.customers(id, store_id)
    on delete cascade on update cascade,
  foreign key (product_id, store_id) references public.products(id, store_id)
    on delete cascade on update cascade
);

create table public.customer_preferences (
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  customer_id uuid not null,
  order_notifications boolean not null default true,
  promotion_notifications boolean not null default false,
  marketing_consent boolean not null default false,
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  primary key (store_id, customer_id),
  foreign key (customer_id, store_id) references public.customers(id, store_id)
    on delete cascade on update cascade
);

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id)
    on delete restrict on update cascade,
  title text not null check (btrim(title) <> ''),
  description text not null check (btrim(description) <> ''),
  coupon_code text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (store_id, coupon_code),
  check (ends_at > starts_at)
);

create trigger customer_preferences_bump_version
  before update on public.customer_preferences
  for each row execute function private.bump_catalog_version();
create trigger promotions_bump_version
  before update on public.promotions
  for each row execute function private.bump_catalog_version();

alter table public.customer_favorites enable row level security;
alter table public.customer_preferences enable row level security;
alter table public.promotions enable row level security;

revoke all on public.customer_favorites, public.customer_preferences,
  public.promotions from public, anon, authenticated;
grant all on public.customer_favorites, public.customer_preferences,
  public.promotions to service_role;
grant select, insert, delete on public.customer_favorites to authenticated;
grant select, insert, update on public.customer_preferences to authenticated;
grant select on public.promotions to authenticated;
grant insert, update, delete on public.promotions to authenticated;

create policy favorites_owner_all on public.customer_favorites
  for all to authenticated
  using (exists (
    select 1 from public.customers c
    where c.id = customer_favorites.customer_id
      and c.store_id = customer_favorites.store_id
      and c.auth_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.customers c
    where c.id = customer_favorites.customer_id
      and c.store_id = customer_favorites.store_id
      and c.auth_user_id = auth.uid()
  ));
create policy preferences_owner_all on public.customer_preferences
  for all to authenticated
  using (exists (
    select 1 from public.customers c
    where c.id = customer_preferences.customer_id
      and c.store_id = customer_preferences.store_id
      and c.auth_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.customers c
    where c.id = customer_preferences.customer_id
      and c.store_id = customer_preferences.store_id
      and c.auth_user_id = auth.uid()
  ));
create policy promotions_customer_select on public.promotions
  for select to authenticated
  using (
    private.is_store_member(store_id)
    or private.is_store_customer(store_id)
  );
create policy promotions_admin_write on public.promotions
  for all to authenticated
  using (private.is_store_admin(store_id))
  with check (private.is_store_admin(store_id));

create or replace function public.get_my_online_preferences(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_preferences public.customer_preferences%rowtype;
  v_favorites jsonb;
  v_promotions jsonb;
begin
  select c.id into v_customer_id
  from public.customers c
  where c.store_id = p_store_id and c.auth_user_id = auth.uid() and c.status = 'active';
  if v_customer_id is null then
    raise exception using errcode = '42501', message = 'Perfil de cliente requerido';
  end if;
  insert into public.customer_preferences(store_id, customer_id)
  values (p_store_id, v_customer_id)
  on conflict (store_id, customer_id) do nothing;
  select * into v_preferences from public.customer_preferences cp
  where cp.store_id = p_store_id and cp.customer_id = v_customer_id;
  select coalesce(jsonb_agg(cf.product_id), '[]'::jsonb) into v_favorites
  from public.customer_favorites cf
  where cf.store_id = p_store_id and cf.customer_id = v_customer_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', p.title, 'description', p.description,
    'couponCode', p.coupon_code, 'endsAt', p.ends_at
  ) order by p.ends_at), '[]'::jsonb) into v_promotions
  from public.promotions p
  where p.store_id = p_store_id and p.is_active
    and now() between p.starts_at and p.ends_at;
  return jsonb_build_object(
    'favoriteProductIds', v_favorites,
    'orderNotifications', v_preferences.order_notifications,
    'promotionNotifications', v_preferences.promotion_notifications,
    'marketingConsent', v_preferences.marketing_consent,
    'promotions', v_promotions
  );
end;
$$;

create or replace function public.set_favorite_product(
  p_store_id uuid,
  p_product_id uuid,
  p_favorite boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_customer_id uuid;
begin
  select c.id into v_customer_id from public.customers c
  where c.store_id = p_store_id and c.auth_user_id = auth.uid() and c.status = 'active';
  if v_customer_id is null or not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.store_id = p_store_id and p.is_active
  ) then
    raise exception using errcode = '22023', message = 'Cliente o producto invalido';
  end if;
  if p_favorite then
    insert into public.customer_favorites(store_id, customer_id, product_id)
    values (p_store_id, v_customer_id, p_product_id)
    on conflict do nothing;
  else
    delete from public.customer_favorites
    where store_id = p_store_id and customer_id = v_customer_id and product_id = p_product_id;
  end if;
  return p_favorite;
end;
$$;

create or replace function public.update_my_online_preferences(
  p_store_id uuid,
  p_order_notifications boolean,
  p_promotion_notifications boolean,
  p_marketing_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_customer_id uuid;
begin
  select c.id into v_customer_id from public.customers c
  where c.store_id = p_store_id and c.auth_user_id = auth.uid() and c.status = 'active';
  if v_customer_id is null then
    raise exception using errcode = '42501', message = 'Perfil de cliente requerido';
  end if;
  insert into public.customer_preferences(
    store_id, customer_id, order_notifications, promotion_notifications, marketing_consent
  ) values (
    p_store_id, v_customer_id, p_order_notifications,
    p_promotion_notifications, p_marketing_consent
  )
  on conflict (store_id, customer_id) do update set
    order_notifications = excluded.order_notifications,
    promotion_notifications = excluded.promotion_notifications,
    marketing_consent = excluded.marketing_consent;
  return public.get_my_online_preferences(p_store_id);
end;
$$;

revoke all on function public.get_my_online_preferences(uuid),
  public.set_favorite_product(uuid, uuid, boolean),
  public.update_my_online_preferences(uuid, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.get_my_online_preferences(uuid),
  public.set_favorite_product(uuid, uuid, boolean),
  public.update_my_online_preferences(uuid, boolean, boolean, boolean)
  to authenticated, service_role;
