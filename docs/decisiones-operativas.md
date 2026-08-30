# Decisiones operativas de Coguana

Este registro cierra las decisiones abiertas de PRD, TRD, flujo y esquema
backend. Cambiarlas requiere una nueva decisión de producto, migración cuando
corresponda y pruebas de regresión.

## Caja

- Una sesión de caja pertenece a una tienda y a un dispositivo.
- Solo puede existir una sesión abierta por `(store_id, device_id)`.
- Una caja cerrada es inmutable y no se reabre.
- Las correcciones se realizan mediante anulación, devolución, movimiento
  compensatorio o revisión administrativa de la diferencia.
- Todo faltante o sobrante distinto de cero requiere decisión
  `approved` o `requires_action` y una justificación.

Esta política evita reescribir cierres históricos y conserva trazabilidad.

## Dinero, peso y redondeo

- Dinero se almacena en céntimos enteros.
- Peso se almacena en gramos enteros.
- Unidades contables solo admiten cantidades enteras.
- Toda proporción usa `BigInt` y redondeo mitad hacia arriba.
- Un pedido con cualquier diferencia entre cantidad solicitada y preparada
  pasa a `weight_review`. No existe una tolerancia silenciosa.

La tienda puede definir una tolerancia comercial futura; mientras no exista,
la revisión explícita es la opción conservadora.

## Pagos

- Una venta admite uno o varios tramos de pago.
- La suma de los tramos debe coincidir exactamente con el total.
- Un medio no se repite dentro de la misma venta.
- Solo el tramo en efectivo afecta la caja y calcula vuelto.
- Yape y Plin exigen referencia validada; la validación demo es determinista y
  no representa confirmación financiera real.
- Tarjeta y medios guardados requieren tokenización de un proveedor. La app
  nunca almacena datos sensibles de tarjeta.

## Anulaciones y devoluciones

- Una venta confirmada nunca se borra.
- La anulación total exige administrador, motivo, caja abierta en el dispositivo
  original y ausencia de devoluciones parciales.
- La devolución parcial no puede superar la cantidad vendida acumulada.
- Ambas correcciones restauran stock con movimientos trazables.
- Un reembolso en efectivo crea la salida correspondiente en la caja abierta.

## Pedidos

- La secuencia de estados se valida en dominio y backend.
- Preparación con diferencia de peso pasa a revisión.
- Sustituciones se proponen y aceptan/rechazan explícitamente.
- Cancelación solo se permite en estados tempranos y con motivo.
- Incidencias no alteran por sí solas el estado financiero del pedido.

## Delivery

- Se implementa primero reparto propio y asignación manual.
- Evidencia válida: foto, código de confirmación y datos de recepción; una firma
  podrá añadirse si la política legal lo exige.
- Zonas, tarifas, mínimos y horarios se configuran con datos reales de la
  tienda; no se inventan valores de producción.
- Mapas y operadores externos se activan solo tras validar cobertura, SLA,
  tarifas, privacidad, contrato y API.
- Si un operador externo falla, la operación manual permanece disponible.

## Identidad y seguridad

- Cada operador usa PIN local y una identidad Supabase individual.
- El PIN nunca se sincroniza.
- La outbox se filtra por actor; una sesión no envía operaciones de otro
  operador.
- La sesión interna se bloquea después de cinco minutos de inactividad.
- RLS permanece habilitado en toda tabla pública.
- `service_role` y secretos de proveedores existen solo en backend o CI
  protegido.

## Sucursales

- PostgreSQL/Supabase es la fuente central de las sucursales.
- Un administrador puede consultar sucursales de su organización.
- Solo un propietario crea sucursales nuevas.
- Una edición no puede mover una sucursal a otra organización.
- Cambiar el contexto operativo de un dispositivo requiere aprovisionarlo y
  descargar antes la base local de la sucursal.

## Integraciones externas

SUNAT, pagos tokenizados, mapas, notificaciones push y logística automática se
consideran activados únicamente cuando existen proveedor, credenciales,
ambiente de pruebas, webhooks y criterios de aceptación. Tener una pantalla de
configuración o un adaptador no equivale a tener el servicio productivo.
