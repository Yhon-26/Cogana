-- DO-04: permite que sale.confirmed sincronice uno o varios pagos.
-- Se aplica despues de B4 para no reescribir una migracion ya publicada.

do $migration$
declare
  v_body text;
  v_old text := $old$
            v_payment := v_payload -> 'payment';
            v_payments := pg_catalog.jsonb_build_array(
              pg_catalog.jsonb_build_object(
                'id', v_payment ->> 'id',
                'method', v_payment ->> 'method',
                'amount_cents', v_payment ->> 'amountCents',
                'amount_received_cents', v_payment ->> 'amountReceivedCents',
                'reference', v_payment ->> 'reference'
              )
            );
$old$;
  v_new text := $new$
            if pg_catalog.jsonb_typeof(v_payload -> 'payments') = 'array' then
              v_payment := v_payload -> 'payments';
            elsif pg_catalog.jsonb_typeof(v_payload -> 'payment') = 'object' then
              -- Compatibilidad con clientes anteriores a DO-04.
              v_payment := pg_catalog.jsonb_build_array(v_payload -> 'payment');
            else
              raise exception using
                errcode = '22023',
                message = 'La venta debe incluir payment o payments';
            end if;

            if pg_catalog.jsonb_array_length(v_payment) = 0 then
              raise exception using
                errcode = '22023',
                message = 'La venta debe incluir al menos un pago';
            end if;

            select coalesce(
              pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'id', payment.value ->> 'id',
                  'method', payment.value ->> 'method',
                  'amount_cents', payment.value ->> 'amountCents',
                  'amount_received_cents', payment.value ->> 'amountReceivedCents',
                  'reference', payment.value ->> 'reference'
                )
                order by payment.ordinality
              ),
              '[]'::jsonb
            )
              into v_payments
            from pg_catalog.jsonb_array_elements(v_payment)
              with ordinality as payment(value, ordinality);
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
    raise exception 'No se encontro el bloque B4 esperado para pagos';
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

comment on function public.process_sync_batch(uuid, uuid, integer, jsonb) is
  'Aplica operaciones offline; sale.confirmed admite payment legado o payments combinado.';
