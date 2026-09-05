-- Seed de desarrollo: organización Cogana y tienda Santa Anita.
-- Ejecutar SOLO en el entorno de development; nunca en production.
-- Referencia: Esquema Backend v1.0 §4 y Plan de Implementación §8.2.

-- 1. Insertar la organización Cogana si no existe.
insert into organizations (id, name, legal_name, tax_id, status)
values (
  '00000000-0000-4000-8000-000000000001',
  'Cogana',
  'Cogana S.A.C.',
  '20612345678',
  'active'
)
on conflict (id) do update
  set name = excluded.name,
      legal_name = excluded.legal_name,
      updated_at = now();

-- 2. Insertar la tienda Santa Anita si no existe.
insert into stores (id, organization_id, code, name, address, timezone, status)
values (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'ST-01',
  'Cogana Santa Anita',
  'Av. Santa Anita 123, Santa Anita, Lima',
  'America/Lima',
  'active'
)
on conflict (id) do update
  set code = excluded.code,
      name = excluded.name,
      address = excluded.address,
      updated_at = now();

-- 3. Nota sobre membresías y dispositivos.
--    Las membresías y los devices se crean en runtime desde la app o vía
--    panel administrativo una vez que el primer usuario auth se registra.
--    El bootstrap inicial del owner se documenta en ops/onboarding.md.
