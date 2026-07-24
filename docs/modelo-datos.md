# Modelo de datos local de Coguana

## Alcance

Este modelo cubre productos, inventario, movimientos, historial básico de precios,
presentaciones comerciales y la cola local de sincronización. SQLite es la base
operativa de cada teléfono. PostgreSQL mediante Supabase será posteriormente la
fuente central y oficial; este sprint no incluye Supabase, credenciales ni tráfico
de red.

## Convenciones

- Los identificadores son UUID almacenados como `TEXT`. Se crean en el dispositivo
  y podrán conservarse al sincronizar con PostgreSQL.
- Dinero, peso y cantidades se almacenan siempre como enteros.
- Los importes usan céntimos: S/ 12.90 se guarda como `1290`.
- Cada producto usa una `base_unit`: `gram` para pesables o `unit` para contables.
- `stock_quantity`, `minimum_stock_quantity` y los movimientos se expresan en la
  unidad base del producto. Así, `250` significa 250 gramos para una menestra y
  250 unidades para un producto contable.
- `pricing_quantity` indica cuántas unidades base cubren `price_cents` y
  `cost_cents`. Un precio de S/ 8.50 por kilogramo se representa como
  `price_cents = 850`, `base_unit = gram` y `pricing_quantity = 1000`.
- Las fechas son texto ISO 8601 en UTC.
- Las entidades sincronizables incluyen `store_id`, `created_at`, `updated_at` y
  `version`.
- Los valores del usuario se envían mediante parámetros enlazados, no interpolados
  en SQL.

## Inicialización y migraciones

La base `coguana.db` se abre mediante `SQLiteProvider`; ningún componente crea
tablas directamente. La inicialización activa claves foráneas, intenta activar WAL,
consulta `PRAGMA user_version` y aplica las migraciones pendientes en orden y dentro
de transacciones.

La versión 1 usaba exclusivamente `stock_grams`,
`minimum_stock_grams` y `quantity_delta_grams`. La migración versión 2:

1. reconstruye las tablas con nombres genéricos;
2. convierte productos cuyo `unit` era `kg` o `gram` a
   `base_unit = gram` y `pricing_quantity = 1000`;
3. conserva sin conversión numérica sus saldos y movimientos, porque ya estaban
   guardados en gramos;
4. inicializa `cost_cents` en cero para registros existentes;
5. conserva historial, fechas y versiones;
6. añade auditoría, presentaciones e índices.

Por ello una instalación con la versión 1 se actualiza sin borrar manualmente su
base. Los productos de demostración solo se agregan si `products` está vacío.

## Tabla `products`

Mantiene catálogo, precio base, costo base y saldo actual.

| Columna | Tipo | Regla |
|---|---|---|
| `id` | TEXT | UUID y clave primaria |
| `store_id` | TEXT | Tienda propietaria |
| `sku` | TEXT | Código único por tienda |
| `name` | TEXT | Nombre comercial |
| `category` | TEXT | Categoría |
| `base_unit` | TEXT | `gram` o `unit` |
| `pricing_quantity` | INTEGER | Cantidad base cubierta por precio y costo; mayor que cero |
| `price_cents` | INTEGER | Precio base no negativo |
| `cost_cents` | INTEGER | Costo base no negativo para rentabilidad futura |
| `stock_quantity` | INTEGER | Saldo en unidad base; nunca negativo |
| `minimum_stock_quantity` | INTEGER | Umbral en unidad base |
| `is_active` | INTEGER | `1` activo o `0` inactivo |
| `created_at` | TEXT | Creación ISO 8601 |
| `updated_at` | TEXT | Último cambio ISO 8601 |
| `version` | INTEGER | Versión local, desde 1 |

Un pesable puede venderse descontando 100, 250, 500, 1000, 2500 o cualquier
cantidad entera de gramos. Un contable solo admite movimientos enteros en unidades.
Este sprint almacena costos, pero no calcula ni muestra reportes de ganancias.

## Tabla `product_presentations`

Representa una unidad, paquete, caja o saco que contiene una cantidad fija de la
unidad base del producto.

| Columna | Tipo | Regla |
|---|---|---|
| `id` | TEXT | UUID y clave primaria |
| `store_id` | TEXT | Tienda propietaria |
| `product_id` | TEXT | Producto al que pertenece |
| `sku` | TEXT | Código único por tienda |
| `name` | TEXT | Nombre visible |
| `presentation_type` | TEXT | `unit`, `package`, `box` o `sack` |
| `quantity_in_base_units` | INTEGER | Conversión positiva a gramos o unidades |
| `fixed_price_cents` | INTEGER / NULL | Precio fijo opcional, no negativo |
| `is_active` | INTEGER | `1` activo o `0` inactivo |
| `created_at` | TEXT | Creación ISO 8601 |
| `updated_at` | TEXT | Último cambio ISO 8601 |
| `version` | INTEGER | Versión local |

Si `fixed_price_cents` es `NULL`, el precio se calcula proporcionalmente:

`round(price_cents × quantity_in_base_units ÷ pricing_quantity)`

Si tiene valor, ese precio fijo prevalece. Por ejemplo, una caja de 12 latas
descuenta 12 unidades de stock aunque se venda como una sola presentación.

## Tabla `inventory_movements`

Registra cada variación en la unidad base del producto. El saldo se actualiza en
`products.stock_quantity` dentro de la misma transacción.

| Columna | Tipo | Regla |
|---|---|---|
| `id` | TEXT | UUID y operación idempotente |
| `store_id` | TEXT | Misma tienda que el producto |
| `product_id` | TEXT | Referencia a `products` |
| `movement_type` | TEXT | `opening`, `purchase`, `sale`, `adjustment`, `waste` o `return` |
| `quantity_delta` | INTEGER | Variación distinta de cero en unidad base |
| `reason` | TEXT | Motivo obligatorio |
| `reference_id` | TEXT / NULL | Referencia de negocio opcional |
| `actor_user_id` | TEXT / NULL | Usuario que originó el cambio |
| `device_id` | TEXT / NULL | Dispositivo de origen |
| `created_at` | TEXT | Creación ISO 8601 |
| `updated_at` | TEXT | Último cambio ISO 8601 |
| `version` | INTEGER | Versión local |

Las filas migradas desde v1 dejan `actor_user_id` y `device_id` en `NULL` porque
ese dato no existía. Las nuevas operaciones exigen ambos valores. Un saldo negativo
se rechaza y revierte por completo.

## Tabla `price_history`

Conserva un registro por cada cambio efectivo de precio.

| Columna | Tipo | Regla |
|---|---|---|
| `id` | TEXT | UUID y operación idempotente |
| `store_id` | TEXT | Misma tienda que el producto |
| `product_id` | TEXT | Referencia a `products` |
| `previous_price_cents` | INTEGER | Precio anterior |
| `new_price_cents` | INTEGER | Precio nuevo |
| `reason` | TEXT | Motivo |
| `actor_user_id` | TEXT / NULL | Usuario de origen |
| `device_id` | TEXT / NULL | Dispositivo de origen |
| `created_at` | TEXT | Creación ISO 8601 |
| `updated_at` | TEXT | Último cambio ISO 8601 |
| `version` | INTEGER | Versión local |

Repetir el mismo precio no crea historial ni una operación pendiente.

## Tabla `sync_outbox`

Implementa la cola local. Cada entrada tiene `operation_id` estable y único por
tienda, carga JSON, número de intentos y estado `pending`, `syncing`, `synced` o
`error`. En el backend futuro ese identificador también deberá ser único para que
un reintento no duplique una venta, movimiento o cambio de precio.

En este sprint la cola solo acumula operaciones; todavía no existe proceso de red.

## Índices de consulta

La versión 2 incluye índices para:

- productos por tienda, unidad base, estado y nombre;
- movimientos por tienda, producto y fecha, y por tienda y fecha;
- historial de precios por tienda, producto y fecha;
- presentaciones activas por tienda y producto;
- outbox por tienda, estado y fecha.

## Transacciones de dominio

Un movimiento lee producto y versión, valida el saldo, actualiza
`stock_quantity`, inserta el movimiento y agrega su outbox en una sola transacción.
Una actualización de precio modifica el producto con control optimista, agrega
historial y outbox en otra transacción. Crear una presentación también agrega su
operación pendiente.

## Límites actuales

- Inventario y Actualización de precios usan SQLite.
- Nueva venta permanece en memoria y no escribe movimientos.
- Las presentaciones están modeladas en la capa de datos, pero no se agregaron
  pantallas nuevas.
- No hay Supabase, PostgreSQL, autenticación ni sincronización de red.
- No se implementan reportes de rentabilidad.

## Seguridad de dependencias

Las 14 vulnerabilidades moderadas detectadas se revisarán durante una actualización
planificada de Expo. No debe ejecutarse `npm audit fix --force`, porque actualmente
propone una actualización mayor incompatible de Expo.
