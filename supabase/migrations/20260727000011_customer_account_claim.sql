-- Venta online: vinculación segura entre auth.users y customers.

create unique index customers_store_auth_user
  on public.customers(store_id, auth_user_id)
  where auth_user_id is not null;

create or replace function public.claim_customer_account(
  p_store_id uuid,
  p_name text default null,
  p_phone text default null,
  p_email text default null
)
returns table (
  customer_id uuid,
  auth_user_id uuid,
  customer_name text,
  customer_phone text,
  customer_email text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_customer public.customers%rowtype;
  v_name text := nullif(pg_catalog.btrim(p_name), '');
  v_phone text := nullif(
    pg_catalog.regexp_replace(pg_catalog.btrim(p_phone), '[^0-9+]', '', 'g'),
    ''
  );
  v_email text := nullif(pg_catalog.lower(pg_catalog.btrim(p_email)), '');
begin
  if v_auth_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'Se requiere una sesion autenticada';
  end if;
  if not exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.status = 'active'
  ) then
    raise exception using errcode = 'P0002', message = 'La tienda no esta activa';
  end if;

  select * into v_customer
  from public.customers c
  where c.store_id = p_store_id
    and c.auth_user_id = v_auth_user_id
  for update;

  if found then
    update public.customers c
    set name = coalesce(v_name, c.name),
        email = coalesce(v_email, c.email),
        status = 'active'
    where c.id = v_customer.id
    returning * into v_customer;
  else
    if coalesce(
      auth.jwt() -> 'user_metadata' ->> 'account_type',
      ''
    ) <> 'customer' then
      raise exception using
        errcode = '42501',
        message = 'La cuenta no esta registrada como cliente';
    end if;
    if v_name is null or length(v_name) < 2 then
      raise exception using errcode = '22023', message = 'Nombre de cliente invalido';
    end if;
    if v_phone is null or length(v_phone) < 7 or length(v_phone) > 16 then
      raise exception using errcode = '22023', message = 'Telefono de cliente invalido';
    end if;

    select * into v_customer
    from public.customers c
    where c.store_id = p_store_id
      and c.phone = v_phone
    for update;

    if found then
      if v_customer.auth_user_id is not null
        and v_customer.auth_user_id <> v_auth_user_id
      then
        raise exception using
          errcode = '23505',
          message = 'El telefono ya pertenece a otra cuenta';
      end if;
      update public.customers c
      set auth_user_id = v_auth_user_id,
          name = v_name,
          email = coalesce(v_email, c.email),
          status = 'active'
      where c.id = v_customer.id
      returning * into v_customer;
    else
      insert into public.customers (
        store_id,
        auth_user_id,
        customer_type,
        name,
        phone,
        email,
        status
      ) values (
        p_store_id,
        v_auth_user_id,
        'retail',
        v_name,
        v_phone,
        v_email,
        'active'
      )
      returning * into v_customer;
    end if;
  end if;

  return query select
    v_customer.id,
    v_customer.auth_user_id,
    v_customer.name,
    v_customer.phone,
    v_customer.email;
end;
$$;

revoke all on function public.claim_customer_account(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_customer_account(uuid, text, text, text)
  to authenticated, service_role;

comment on function public.claim_customer_account(uuid, text, text, text) is
  'Crea o vincula el perfil customers de la cuenta minorista autenticada.';
