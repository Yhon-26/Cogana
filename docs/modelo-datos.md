# Modelo de datos local de Cogana

## Alcance

SQLite es la base operativa de cada teléfono. El esquema actual cubre:

- usuarios locales preconfigurados;
- apertura, movimientos y cierre de caja;
- ventas presenciales, ítems y pagos;
- productos, presentaciones, inventario e historial de precios;
- clientes, pedidos, preparación y reparto;
- proveedores, compras, lotes y conteos;
- devoluciones, personal, revisión de caja y preferencias;
- cola de operaciones pendientes de sincronización.

PostgreSQL mediante Supabase es la fuente central y oficial. Las etapas B1
(identidad), B2 (catálogo e inventario), B3 (ventas y caja) y B4
(sincronización push/pull) tienen migraciones y pruebas en `supabase/`. Este
documento describe la proyección operativa local.

## Convenciones

- Los identificadores son UUID almacenados como `TEXT` y generados en el
  dispositivo.
- Dinero, peso y cantidades se almacenan siempre como enteros.
- Los importes usan céntimos: S/ 12.90 se guarda como `1290`.
- Cada producto usa `base_unit = gram` o `base_unit = unit`.
- `stock_quantity`, `minimum_stock_quantity` y `quantity_delta` se expresan en la
  unidad base del producto.
- `pricing_quantity` indica cuántas unidades base cubren `price_cents`. Por
  ejemplo, S/ 8.50 por kilogramo se almacena como `850` céntimos por `1000`
  gramos.
- Los totales se calculan con aritmética entera:
  `round(quantity × price_cents ÷ pricing_quantity)`.
- Cuando una proporción cae exactamente en la mitad, se redondea hacia arriba.
  `roundIntegerRatio` aplica esta regla sin usar punto flotante.
- Las fechas se guardan en UTC con formato ISO 8601.
- Los registros sincronizables incluyen `store_id`, fechas y `version`.
- `actor_user_id` y `device_id` identifican quién y desde dónde originó una
  operación.
- Los valores se envían a SQLite mediante parámetros enlazados.

## Inicialización y migraciones

La base `cogana.db` se abre mediante `SQLiteProvider`; las pantallas no crean
tablas. La inicialización:

1. activa `PRAGMA foreign_keys = ON`;
2. intenta activar `PRAGMA journal_mode = WAL`;
3. consulta `PRAGMA user_version`;
4. ejecuta cada migración pendiente dentro de una transacción;
5. inserta datos demo solo fuera de producción y cuando
   `EXPO_PUBLIC_ENABLE_DEMO_DATA=true`.

Historial:

- **v1:** productos e inventario exclusivamente en gramos.
- **v2:** unidades base genéricas, costos, presentaciones, auditoría y outbox.
- **v3:** usuarios locales, caja, ventas, ítems, pagos y comprobantes.
- **v4:** anulaciones de venta: columnas `voided_at`/`voided_by_user_id`/`void_reason`
  en `sales`, tabla `sale_status_history` y `sale_id` opcional en `cash_movements`.
- **v5:** reintentos y resultados de `sync_outbox`, `sync_inbox` para deduplicar
  pull y `local_sync_state` para cursor, diagnóstico y lease por dispositivo.

Las migraciones v3, v4 y v5 agregan estructuras o columnas sin reconstruir las
tablas operativas; una base existente conserva productos, stock, movimientos,
precios, ventas y outbox.

La migración **v8** vincula opcionalmente cada operador local con una identidad
`auth.users` mediante `auth_user_id` y añade `actor_user_id` a la outbox. Las
operaciones pendientes anteriores recuperan su autor desde el payload JSON.

La migración **v9** agrega clientes, direcciones, pedidos, ítems, historial de
estados y secuencias de numeración por dispositivo. Los pedidos conservan
montos estimados y solo completan sus montos finales al confirmar cantidades
preparadas.

- **v10:** planificación, asignación, incidencias y sustituciones de pedidos.
- **v11:** asignaciones y eventos de reparto propio.
- **v12:** órdenes de compra, recepciones, lotes y conteos físicos.
- **v13:** devoluciones parciales de ventas.
- **v14:** permisos por rol, turnos y asistencia.
- **v15:** revisión administrativa de diferencias de caja.
- **v16:** preferencias locales por operador.
- **v17:** bloqueo progresivo de PIN, contador de fallos y actualización
  transparente de hashes heredados a PBKDF2-HMAC-SHA256.
- **v18:** reservas de inventario por ítem, consumo auditable al preparar,
  estado/medio de pago e historial de verificaciones.
- **v19:** cola durable para subir evidencia de reparto a Storage antes de
  sincronizar la confirmación.

## `products`

Mantiene el catálogo, el precio y costo base, y el saldo actual.

| Columna clave | Regla |
|---|---|
| `id`, `store_id`, `sku` | UUID, tienda y código único por tienda |
| `base_unit` | `gram` o `unit` |
| `pricing_quantity` | Cantidad base cubierta por precio y costo |
| `price_cents`, `cost_cents` | Importes enteros no negativos |
| `stock_quantity` | Saldo entero no negativo |
| `minimum_stock_quantity` | Umbral entero de reposición |
| `is_active` | `1` activo o `0` inactivo |

Un pesable admite cualquier cantidad entera de gramos. Un contable solo admite
cantidades enteras de unidades.

## `product_presentations`

Representa una unidad, paquete, caja o saco.

| Columna clave | Regla |
|---|---|
| `product_id` | Producto al que pertenece |
| `presentation_type` | `unit`, `package`, `box` o `sack` |
| `quantity_in_base_units` | Conversión entera positiva a gramos o unidades |
| `fixed_price_cents` | Precio fijo opcional |

Si no existe precio fijo, se calcula proporcionalmente desde el precio base. Una
presentación vendida descuenta su cantidad convertida del stock base.

## `local_users`

Comienza con un único usuario local preconfigurado: el Administrador (dueño).
El alta de empleados adicionales se mantiene en la entrega de Expansión.

| Columna clave | Regla |
|---|---|
| `role` | `administrator` o `seller` |
| `pin_hash` | Hash opcional; nunca PIN en texto plano |
| `pin_salt` | Sal opcional asociada al hash |
| `pin_algorithm` | Identificador del algoritmo futuro |
| `auth_user_id` | Identidad Supabase individual vinculada; opcional offline |
| `is_active` | Estado local |

La interfaz permite crear, editar y desactivar empleados. La restricción de
tabla exige que hash, sal y algoritmo existan juntos. El PIN usa SHA-256
iterado y versionado; el vínculo Supabase es individual.

## `cash_sessions`

Una fila representa un turno de caja en un dispositivo.

| Columna clave | Regla |
|---|---|
| `responsible_user_id` | Usuario que abre el turno |
| `device_id` | Dispositivo de la caja |
| `status` | `open` o `closed` |
| `opening_cash_cents` | Fondo inicial |
| `cash_sales_cents` | Ventas en efectivo al cierre |
| `cash_income_cents` | Ingresos manuales al cierre |
| `cash_outflow_cents` | Salidas manuales al cierre |
| `expected_cash_cents` | Efectivo calculado |
| `counted_cash_cents` | Efectivo contado |
| `difference_cents` | Contado menos esperado |
| `opened_at`, `closed_at` | Fechas UTC |

Un índice único parcial sobre `(store_id, device_id)` cuando `status = open`
impide abrir simultáneamente dos cajas en el mismo dispositivo.

## `local_device_identity`

Guarda un único UUID generado en la primera ejecución del teléfono. El mismo
`device_id` se reutiliza después de reiniciar la aplicación y permite distinguir
operaciones de distintos dispositivos al sincronizar.

El efectivo esperado se calcula como:

`fondo inicial + ventas en efectivo + ingresos - salidas`

Yape, Plin y tarjeta no se incluyen.

## `cash_movements`

Registra ingresos y salidas manuales.

| Columna clave | Regla |
|---|---|
| `cash_session_id` | Caja abierta relacionada |
| `movement_type` | `income` o `outflow` |
| `amount_cents` | Monto entero positivo |
| `reason` | Motivo obligatorio |
| `actor_user_id`, `device_id` | Auditoría |

Una salida que excedería el efectivo esperado actual se rechaza.

## `sales`

Cabecera inmutable de una venta confirmada. La anulación no borra la venta: marca
`voided_at` y registra el evento en `sale_status_history`.

| Columna clave | Regla |
|---|---|
| `cash_session_id` | Turno de caja donde se originó |
| `receipt_number` | Comprobante interno único por tienda |
| `actor_user_id`, `device_id` | Auditoría |
| `status` | `confirmed` (la anulación no cambia esta columna) |
| `total_cents` | Total entero positivo |
| `voided_at` | `NULL` en venta vigente; marca de tiempo UTC al anular |
| `voided_by_user_id` | Usuario que anuló (auditoría) |
| `void_reason` | Motivo obligatorio de la anulación |

El estado lógico de la venta se deriva: `voided_at IS NULL` → `confirmed`;
`voided_at IS NOT NULL` → `voided`. Las consultas de caja y ventas recientes
excluyen las ventas anuladas mediante `voided_at IS NULL`.

El comprobante combina un sufijo estable del dispositivo con un contador local
persistente de seis dígitos.

## `sale_status_history`

Registro inmutable de transiciones de estado de una venta. Cada anulación inserta
una fila `confirmed → voided` con motivo, actor y dispositivo. UNUSED allowed:
es auditoría pura, no se elimina ni edita.

## Anulación de venta (RN-07)

`voidSale` ejecuta en una transacción exclusiva:

1. rechaza reanular si `voided_at` ya está presente (idempotencia por
   `operation_id = "void:<saleId>"` en outbox);
2. valida usuario activo y que exista caja abierta en el dispositivo;
3. exige que la caja abierta sea la misma donde se originó la venta;
4. actualiza `sales.voided_at/voided_by_user_id/void_reason` con control optimista
   por `version`;
5. inserta `sale_status_history` (confirmed → voided);
6. restaura stock de cada ítem con `inventory_movements` tipo `return` (delta
   positivo) y `UPDATE products` con control de versión;
7. encola operaciones idempotentes en outbox para cada movimiento y para el evento
   `sale.voided`.

El efectivo esperado de la caja excluye automáticamente la venta anulada porque
los sumarios filtran `voided_at IS NULL`. No se insertan movimientos de caja
compensatorios: la propia anulación reduce el esperado a la par que el cajero
devuelve el efectivo.

## `local_receipt_sequences`

Mantiene `next_number` por tienda y dispositivo. La reserva del número ocurre
dentro de la misma transacción de venta; un rollback también revierte el contador.

## `sale_items`

Cada ítem conserva los datos efectivos de la venta para que un cambio posterior de
catálogo no altere el comprobante.

Snapshots almacenados:

- nombre e identificador del producto;
- unidad base y cantidad entera;
- precio y `pricing_quantity`;
- costo y cantidad de costo;
- subtotal;
- identificador, nombre, tipo, conversión y número de presentaciones, cuando
  corresponda.

Para una presentación con precio fijo, el snapshot de precio usa ese precio y su
cantidad base como `pricing_quantity_snapshot`.

## `payments`

El modelo y la interfaz admiten varias filas por venta para pagos combinados.

| Columna clave | Regla |
|---|---|
| `payment_method` | `cash`, `yape`, `plin` o `card` |
| `amount_cents` | Parte pagada |
| `amount_received_cents` | Solo efectivo |
| `change_cents` | Recibido menos importe en efectivo |
| `reference` | Opcional para Yape, Plin o tarjeta |
| `actor_user_id`, `device_id` | Auditoría |

Yape y Plin usan una validación demo determinista. La tokenización y
confirmación real requieren un proveedor externo.

## `sale_returns` y `sale_return_items`

Una devolución parcial conserva cantidades e importes por ítem, restaura stock
y registra una salida cuando el reembolso es en efectivo. La suma acumulada no
puede superar la cantidad vendida; una venta con devoluciones parciales ya no
puede anularse por completo.

## Compras, lotes y conteos

`purchase_orders` y `purchase_order_items` conservan cantidades pedidas,
recibidas y costos enteros. La recepción actualiza stock y crea
`inventory_lots`. `physical_counts` registra esperado, contado y diferencia,
aplicando el ajuste en la misma transacción.

## Personal y preferencias

`role_permissions` limita módulos por rol; `work_shifts` y
`attendance_entries` mantienen programación y jornada. `app_preferences`
guarda densidad visual, reducción de movimiento y respuesta háptica por
operador. Son preferencias locales, no datos comerciales centrales.

## Revisión de diferencias de caja

`cash_difference_reviews` permite que un administrador apruebe u observe un
cierre con diferencia y justificación obligatoria. Cada revisión crea outbox y
se valida nuevamente en Supabase.

## `inventory_movements`

Cada variación usa la unidad base del producto. Las ventas generan movimientos
`sale` negativos con `reference_id = sales.id`. La actualización de stock, el
movimiento y su outbox se guardan juntos.

Las filas anteriores a v2 pueden tener auditoría nula porque esa información no
existía; las operaciones nuevas exigen usuario y dispositivo.

## `price_history`

Conserva precio anterior, precio nuevo, motivo, usuario y dispositivo. Repetir el
mismo precio no crea historial ni outbox.

## `delivery_zones`

Configura la cobertura comercial de delivery sin crear datos ficticios. Cada
zona pertenece a una tienda e incluye tarifa y pedido mínimo en céntimos,
un rango ETA en minutos, horario de atención, restricciones opcionales y baja
lógica mediante `is_active`.

Crear, editar, activar o desactivar una zona exige un operador administrador y
encola un evento `delivery_zone.*`. Los cambios recibidos por pull se aplican por
versión sin generar una nueva outbox.

## `customers` y `customer_addresses`

El registro interno reutiliza un cliente por teléfono dentro de la tienda. Una
dirección de delivery pertenece al cliente y referencia una zona activa; un
índice parcial permite una sola dirección predeterminada.

## Gestión local de productos

Crear un producto inserta de forma atómica su ficha, el movimiento de apertura
cuando existe stock inicial y un evento `product.created`. Editar metadatos usa
versión optimista y genera `product.updated`; precio y existencias mantienen sus
flujos auditados separados. El backend resuelve o crea la categoría de la misma
organización y conserva la idempotencia mediante `sync_operations`.

## `orders`, `order_items` y `order_status_history`

La cabecera del pedido conserva canal (`phone`, `whatsapp` u `online`),
modalidad, cliente, dirección, tarifa y totales estimados/finales en céntimos.
Los ítems guardan snapshots de producto, cantidad solicitada y preparada,
precio, subtotal y política de sustitución (`allow`, `contact` o `remove`).

La única secuencia válida es:

`received → confirmed → preparing → weight_review? → ready →
out_for_delivery|ready_for_pickup → delivered`

Administrador puede cancelar desde `received`, `confirmed` o `preparing`. Una
diferencia entre cantidad solicitada y preparada pasa conservadoramente a
`weight_review`, porque la tolerancia comercial aún no está aprobada. Cada
transición inserta historial y un evento idempotente en `sync_outbox`.

## Sesión individual y PIN offline

El PIN desbloquea exclusivamente al operador local y nunca se envía a Supabase.
La primera vinculación usa correo y contraseña de una cuenta individual; la
contraseña no se persiste. El refresh token queda separado por operador en Expo
SecureStore. Sin red, el operador continúa trabajando en SQLite y el push se
difiere.

La sincronización filtra la outbox por `actor_user_id`, de modo que una sesión
Supabase nunca envía operaciones creadas por otro operador.

## `sync_outbox`

Cada entrada guarda una carga JSON y estados `pending`, `syncing`, `synced` o
`error`. `UNIQUE (store_id, operation_id)` proporciona idempotencia local.

La venta usa su UUID como `operation_id`. Reintentar la confirmación con el mismo
identificador devuelve la venta existente y no vuelve a descontar stock ni crea
otra entrada. Las anulaciones generan un UUID de operación independiente.

La migración v5 añade `next_attempt_at`, `error_code`, `is_terminal` y el
resultado canónico del servidor. Los errores de transporte usan backoff y
continúan en la cola; los rechazos de dominio quedan visibles para intervención.

## `sync_inbox` y `local_sync_state`

`sync_inbox` conserva cada `sequence` recibido para que aplicar de nuevo una
página pull no duplique efectos. Producto, presentación y proyecciones de
precio/stock se aplican en la misma transacción que actualiza el cursor.

`local_sync_state` guarda `last_pull_cursor`, fechas de push/pull, último error,
fallos consecutivos y un lease recuperable. Solo un ciclo por tienda/dispositivo
puede ejecutarse a la vez.

## Confirmación atómica de una venta

`confirmSale` usa una sola transacción exclusiva:

1. devuelve el resultado existente si `operation_id` ya fue confirmado;
2. valida usuario y caja abierta en el dispositivo;
3. vuelve a leer productos, presentaciones y stock;
4. reserva el comprobante e inserta la venta;
5. inserta snapshots de ítems;
6. inserta el pago;
7. descuenta stock con control optimista;
8. inserta movimientos de inventario relacionados;
9. agrega las operaciones idempotentes al outbox.

Si falla cualquier paso se revierten venta, ítems, pago, contador, movimientos,
stock y outbox.

## Índices de consulta

Además de los índices de productos, precios, inventario, presentaciones y outbox,
v3 incorpora índices para:

- usuarios activos por tienda;
- caja por dispositivo, estado y fecha;
- movimientos por turno;
- ventas por turno y fecha;
- comprobantes;
- ítems por venta y producto;
- pagos por venta y método.

## Límites actuales

- La operación interna sigue escribiendo primero en SQLite por diseño.
- La vinculación real requiere cuentas, membresías y dispositivos
  aprovisionados en el proyecto Supabase de destino.
- Pagos tokenizados, SUNAT, mapas y logística automática requieren contratos,
  credenciales y servicios externos.
- El motor está implementado, pero la aceptación final exige probar el proyecto
  productivo con dos teléfonos y usuarios distintos.
- La emisión en tiendas necesita proyecto EAS, certificados y cuentas
  Apple/Google.

## Seguridad de dependencias

La auditoría del 27 de julio de 2026 reporta 31 alertas en el árbol considerado
de producción (11 moderadas y 20 altas), concentradas en Expo CLI, configuración,
Metro, Babel/Codegen y otras herramientas transitivas. `expo install --check`
confirma que las versiones instaladas son las compatibles con SDK 54. Las
correcciones ofrecidas por npm migran a Expo 57 o React Native 0.86, por lo que
no debe ejecutarse `npm audit fix --force`. La resolución corresponde a una
migración planificada de SDK con pruebas nativas completas.
