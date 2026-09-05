# Backend Cogana — Supabase/PostgreSQL

Esquema central de Cogana. Implementa la arquitectura descrita en
`Esquema_Backend_Cogana_v1.0.docx` y el TRD §9.

## Estado

- **B1 — Fundación** (identidad, organizaciones, tiendas, perfiles, membresías,
  dispositivos y RLS) implementado en
  `supabase/migrations/20260726000001_b1_identity.sql`.
- **B2 — Catálogo** (categorías, productos, presentaciones, imágenes, historial
  de precios, inventario, RPC idempotentes y RLS) implementado en
  `supabase/migrations/20260726000002_b2_catalog.sql`.
- **B3 — POS** (ventas, ítems, pagos, caja, anulaciones, outbox, RPC
  transaccionales y RLS) implementado en
  `supabase/migrations/20260726000003_b3_pos.sql`.
- **B4 — Sync piloto** (`sync_operations`, `change_log`, estado por dispositivo,
  push idempotente y pull incremental) implementado en
  `supabase/migrations/20260726000004_b4_sync.sql`.
- **DO-04 — Pagos combinados** sincronizados mediante
  `supabase/migrations/20260726000005_do04_multi_payments_sync.sql`.
- **DT-01 — Proveedores** (CRUD, RLS y sincronización incremental) implementado
  en `supabase/migrations/20260726000006_dt01_suppliers.sql`.
- **DT-02 — Validación Yape/Plin demo** exige referencia digital mediante
  `supabase/migrations/20260726000007_dt02_digital_payment_reference.sql`.
- **DO-06 — Zonas y tarifas de delivery** (cobertura, mínimos, ETA, horarios,
  RLS y sync) implementado en
  `supabase/migrations/20260726000008_do06_delivery_zones.sql`.
- **DT-03 — PIN local + Supabase Auth** usa sesiones individuales y un RPC de
  contexto de operador; el PIN nunca se envía al backend. Implementado en
  `supabase/migrations/20260726000009_dt03_operator_auth_context.sql`.
- **B5 — Clientes y pedidos** (`customers`, direcciones, pedidos, ítems,
  historial, RLS, RPC transaccionales y push/pull) implementado en
  `supabase/migrations/20260726000010_b5_customers_orders.sql`.
- **Venta online — Cuenta minorista** vincula Supabase Auth con `customers`
  mediante un RPC restringido e idempotente. Implementado en
  `supabase/migrations/20260727000011_customer_account_claim.sql`.
- **MVP inventario — Gestión de productos** amplía el push para altas y
  ediciones con resiliencia offline en
  `supabase/migrations/20260727000012_product_management_sync.sql`.
- **Online minorista** expone catálogo autenticado, checkout, seguimiento y
  cancelación propia mediante
  `supabase/migrations/20260727000013_online_retail.sql`.
- **Engagement minorista** añade favoritos, preferencias y promociones con RLS
  en `supabase/migrations/20260727000014_online_engagement.sql`.
- **E4 operaciones** añade planificación, responsables, incidencias y
  sustituciones en `20260727000015_order_operations.sql`.
- **Negocios y delivery** implementan comercio B2B, reparto propio y
  configuración logística en las migraciones 16 y 17.
- **Expansión** implementa soporte, configuración, compras, catálogo avanzado,
  devoluciones, personal, promociones, sucursales y revisión de caja en las
  migraciones 18 a 25.
- **Integridad operativa** añade reservas/consumo de stock por pedido, pagos
  auditados, buckets Storage, evidencia de entrega y baja segura de cuenta en
  las migraciones 26 a 28.
- **Compras y control de inventario** añade órdenes, recepciones, lotes,
  conteos físicos y sincronización en
  `supabase/migrations/20260727000019_procurement_inventory_control.sql`.
- **Correcciones y endurecimiento** (29-32) añade recepción parcial de compras,
  corrige el drift de tres funciones, fija `search_path` vacío en 12 funciones
  SECURITY DEFINER y elimina pgTAP de producción.
- Seed de desarrollo (org Cogana + tienda Santa Anita) en `supabase/seed.sql`.
- Pruebas RLS y de dominio con pgTAP en `supabase/tests/`.

## Requisitos

- [Supabase CLI](https://supabase.com/docs/guides/local-development) `>= 2.0.0`.
- Docker (requerido por `supabase start`).
- Extensión `pgtap` para las pruebas de RLS.

## Entornos

| Entorno      | Uso                                  | Datos            |
|--------------|--------------------------------------|------------------|
| Local        | Desarrollo y `supabase start`        | Sintéticos       |
| Development  | CI con Supabase cloud de desarrollo  | Sintéticos       |
| Staging      | Pruebas E2E y aceptación             | Anonimizados     |
| Production   | Operación real de Cogana            | Reales, acceso mínimo |

Las migraciones son **versionadas y repetibles**: nunca editar una migración ya
aplicada en producción (TRD §14.1). Cambios manuales en producción están
prohibidos.

## Comandos

```bash
# Iniciar el stack local de Supabase (postgres, auth, api, storage).
supabase start

# Aplicar migraciones pendientes en la base local.
supabase db push

# Ejecutar el seed de desarrollo (solo local).
supabase db reset --with-seed

# Ejecutar pruebas RLS de B1 (requiere pgtap disponible).
psql "$(supabase status --output json | jq -r '.db.url')" \
  -f supabase/tests/b1_identity_rls.test.sql

# Ejecutar pruebas de catálogo, RLS e idempotencia de B2.
psql "$(supabase status --output json | jq -r '.db.url')" \
  -f supabase/tests/b2_catalog_rls.test.sql

# Ejecutar pruebas POS, caja, anulaciones y outbox de B3.
psql "$(supabase status --output json | jq -r '.db.url')" \
  -f supabase/tests/b3_pos_rls.test.sql

# Ejecutar pruebas push/pull, cursores, dos dispositivos y RLS de B4.
psql "$(supabase status --output json | jq -r '.db.url')" \
  -f supabase/tests/b4_sync_rls.test.sql

# Ejecutar pruebas CRUD, RLS y sync de proveedores.
psql "$(supabase status --output json | jq -r '.db.url')" \
  -f supabase/tests/dt01_suppliers_rls.test.sql

# Ejecutar pruebas CRUD, RLS y sync de zonas de delivery.
psql "$(supabase status --output json | jq -r '.db.url')" \
  -f supabase/tests/do06_delivery_zones_rls.test.sql

# Ejecutar pruebas del contexto de autenticación individual.
psql "$(supabase status --output json | jq -r '.db.url')" \
  -f supabase/tests/dt03_operator_auth.test.sql

# Ejecutar pruebas de clientes, pedidos, transiciones y RLS B5.
psql "$(supabase status --output json | jq -r '.db.url')" \
  -f supabase/tests/b5_customers_orders_rls.test.sql

# Ejecutar pruebas de alta y vinculación de cuentas minoristas.
psql "$(supabase status --output json | jq -r '.db.url')" \
  -f supabase/tests/customer_account_claim.test.sql

# Ejecutar pruebas de alta/edición de productos por outbox.
psql "$(supabase status --output json | jq -r '.db.url')" \
  -f supabase/tests/product_management_sync.test.sql

# Ejecutar pruebas del ciclo minorista online.
psql "$(supabase status --output json | jq -r '.db.url')" \
  -f supabase/tests/online_retail.test.sql

# Ejecutar pruebas de favoritos, preferencias y promociones.
psql "$(supabase status --output json | jq -r '.db.url')" \
  -f supabase/tests/online_engagement.test.sql

# Ejecutar toda la suite pgTAP en orden.
for test_file in supabase/tests/*.test.sql; do
  psql "$(supabase status --output json | jq -r '.db.url')" \
    -v ON_ERROR_STOP=1 -f "$test_file"
done

# Generar una migración por cambio coherente.
supabase migration new <nombre>
```

## Seguridad (no negociable)

- **RLS habilitado** en toda tabla del esquema `public` antes de exponerla (SEC-BE-01).
- **Secretos service_role** jamás en la app móvil ni en Git (SEC-BE-02).
- **Logs** no contienen tokens, PIN, datos de tarjeta ni secretos (SEC-BE-04).
- **Pertenencia** resuelve acceso: `store_memberships` + `auth.uid()` por policies.
- **Funciones SECURITY DEFINER**: helpers en `private`; RPC públicos con
  `search_path` vacío, referencias calificadas y `EXECUTE` restringido.

## Migraciones

| Etapa | Migración                                       | Contenido                                |
|-------|-------------------------------------------------|------------------------------------------|
| B1    | `20260726000001_b1_identity.sql`                | organizations, stores, profiles, memberships, devices + RLS |
| B2    | `20260726000002_b2_catalog.sql`                 | categories, products, presentations, images, price_history, inventory + RLS/RPC |
| B3    | `20260726000003_b3_pos.sql`                     | cash_sessions, sales, items, payments, voids, sync_outbox + RLS/RPC |
| B4    | `20260726000004_b4_sync.sql`                    | sync_operations, change_log, device_sync_state, push/pull + RLS/RPC |
| DO-04 | `20260726000005_do04_multi_payments_sync.sql`   | compatibilidad push para uno o varios pagos por venta |
| DT-01 | `20260726000006_dt01_suppliers.sql`             | suppliers, RLS, auditoría y push/pull |
| DT-02 | `20260726000007_dt02_digital_payment_reference.sql` | referencia obligatoria para Yape/Plin |
| DO-06 | `20260726000008_do06_delivery_zones.sql`         | zonas, tarifas, mínimos, ETA, RLS y sync |
| DT-03 | `20260726000009_dt03_operator_auth_context.sql`  | sesión individual y contexto operador |
| B5    | `20260726000010_b5_customers_orders.sql`         | customers, addresses, orders, RPC, RLS y sync |
| Online-01 | `20260727000011_customer_account_claim.sql` | vínculo seguro auth.users → customers |
| MVP inventario | `20260727000012_product_management_sync.sql` | alta/edición de productos por outbox |
| Online-02 | `20260727000013_online_retail.sql`            | catálogo, checkout, seguimiento y cancelación |
| Online-03 | `20260727000014_online_engagement.sql`        | favoritos, preferencias y promociones |
| E4 operaciones | `20260727000015_order_operations.sql`       | planificación, asignación, incidencias y sustituciones sincronizables |
| Negocios | `20260727000016_business_commerce.sql`          | cuentas comerciales, precios, cotizaciones, recurrencia, crédito y documentos |
| Delivery | `20260727000017_delivery_operations.sql`        | despacho con resiliencia offline, seguimiento y operadores externos |
| Expansión | `20260727000018_support_fiscal_settings.sql`    | soporte, configuración de tienda y base segura SUNAT |
| Compras | `20260727000019_procurement_inventory_control.sql` | órdenes, lotes, conteos físicos, RLS y sync |
| Catálogo avanzado | `20260727000020_presentation_management_sync.sql` | edición y baja lógica de presentaciones por sync |
| Devoluciones | `20260727000021_partial_sale_returns.sql` | devoluciones parciales, caja, RLS y sync |
| Personal | `20260727000022_personnel_operations.sql` | permisos, turnos, asistencia, RLS y sync |
| Promociones | `20260727000023_promotion_admin_rpc.sql` | administración segura de promociones |
| Multi-sucursal | `20260727000024_multi_store_admin.sql` | listado, alta y edición segura de sucursales |
| Diferencias de caja | `20260727000025_cash_difference_reviews.sql` | revisión administrativa, RLS y sync |
| Inventario/pagos de pedidos | `20260729000026_order_inventory_payments.sql` | reservas, consumo, ledger y verificación de pagos |
| Storage y delivery | `20260729000027_storage_delivery_consistency.sql` | buckets, políticas y evidencia sincronizable |
| Identidad | `20260729000028_identity_account_hardening.sql` | último admin, perfil mínimo y baja de cuenta |
| Recepción parcial | `20260828000029_purchase_order_partial_receipt.sql` | recepciones parciales de órdenes de compra |
| Corrección drift | `20260902000030_fix_function_drift.sql` | re-aplica register_business_account, apply_sale_return_sync y transition_order |
| Endurecimiento | `20260902000031_security_definer_search_path.sql` | search_path vacío en 12 funciones SECURITY DEFINER |
| Limpieza | `20260902000032_drop_pgtap.sql` | elimina la extensión pgTAP de producción |

## Próximo paso externo

Las migraciones 1 a 28 están aplicadas en el proyecto productivo vinculado
(`hcvrfmuheoaxaldmpzfr`) y la Edge Function `delete-account` está desplegada.
Pendiente: aplicar las migraciones 29 a 32 (`supabase db push`), re-ejecutar
`supabase db lint` para confirmar que no quedan avisos y validar push/pull con
dos teléfonos reales.
