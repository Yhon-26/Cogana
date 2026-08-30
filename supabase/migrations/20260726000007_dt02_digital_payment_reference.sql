-- DT-02: Yape y Plin requieren una referencia antes de confirmarse.
-- NOT VALID conserva compatibilidad con filas historicas, pero protege toda
-- insercion o actualizacion posterior a esta migracion.

alter table public.sale_payments
  add constraint sale_payments_digital_reference_required
  check (
    payment_method not in ('yape', 'plin')
    or nullif(pg_catalog.btrim(provider_reference), '') is not null
  )
   not valid;

alter table public.sale_payments
  validate constraint sale_payments_digital_reference_required;

comment on constraint sale_payments_digital_reference_required
  on public.sale_payments is
  'Yape/Plin requieren codigo; la aprobacion real se delegara al adaptador contratado.';
