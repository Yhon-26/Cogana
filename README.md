# Cogana

Aplicación móvil online-first con resiliencia offline para POS, inventario,
pedidos, venta online, mayoristas y delivery. Usa React Native con Expo
SDK 54, SQLite por dispositivo y Supabase/PostgreSQL como fuente central de
verdad.

## Estado funcional

- POS presencial: caja, pagos combinados, comprobante, anulaciones y
  devoluciones parciales.
- Inventario: productos, presentaciones, precios, movimientos, proveedores,
  compras, lotes, conteo físico y escáner.
- Pedidos: minorista online, preparación, peso final, incidencias,
  sustituciones, asignación y seguimiento.
- Negocios: registro comercial, precios acordados, cotizaciones, recurrencia y
  crédito.
- Delivery: zonas, reparto propio, evidencia y configuración de operadores.
- Expansión: empleados, roles, turnos, asistencia, reportes CSV, soporte,
  promociones, configuración, revisión de caja y administración de sucursales.
- Backend: 32 migraciones Supabase con RLS, Storage privado y pruebas pgTAP.
- Base local: 19 versiones de esquema y 105 pruebas automatizadas.

## Sincronización online-first con resiliencia offline

Cogana opera **online-first**: el backend central es la fuente de verdad y la
conexión es el modo principal. La app escribe primero en SQLite y registra
operaciones en `sync_outbox` para sostener la continuidad ante cortes de red.
`runSyncCycle` drena lotes idempotentes, renueva su lease y aplica el
`change_log` incremental dentro de transacciones SQLite. La sincronización corre
al iniciar, volver a primer plano y periódicamente (≈30 s); la interfaz de
diagnóstico muestra pendientes, errores, reintentos, cursor y última
sincronización. El comportamiento offline no es una alternativa de operación,
sino resiliencia temporal hasta reconectar.

Configura únicamente las credenciales públicas:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

Nunca se debe incluir `service_role`, secretos SUNAT, claves de pagos ni
credenciales logísticas en la aplicación.

Cada operador vincula su propia cuenta Supabase después de desbloquear el PIN.
El PIN nunca sale de SQLite. La contraseña no se persiste y el refresh token se
guarda por operador mediante Expo SecureStore. La sesión de cliente online es
independiente.

## Inicio

```bash
npm install
copy .env.example .env.local
npx expo start
```

Completa `.env.local` antes de probar el backend. Expo Go sirve para recorridos
compatibles; cámara, permisos y distribución deben validarse también con una
compilación nativa.

## Verificación

```bash
npm run lint
npm run typecheck
npm run test:database
# o todo junto:
npm run check
# diagnóstico local sin bloquear por avisos externos:
npm run preflight
# cierre estricto antes de publicar:
npm run preflight:release
```

Las pruebas pgTAP necesitan Docker, Supabase CLI y PostgreSQL local; consulta
[`supabase/README.md`](supabase/README.md).

`preflight:release` también comprueba el remoto y estado de Git, herramientas
de entrega, credenciales públicas configuradas, pagos demostrativos y activos
de marca provisionales. Falla mientras exista cualquier bloqueo de publicación.

## Despliegue

Los perfiles `preview` y `production` están definidos en `eas.json`. La guía
completa, incluida la separación de secretos y acciones que requieren cuentas
externas, está en [`docs/despliegue.md`](docs/despliegue.md).

```bash
npm run build:preview
npm run build:production
npm run submit:production
```

Estos comandos requieren una sesión EAS y, para producción, certificados y
cuentas de las tiendas.

## Documentación

- [`docs/mapa-pantallas.md`](docs/mapa-pantallas.md): roadmap e interfaces.
- [`docs/modelo-datos.md`](docs/modelo-datos.md): modelo SQLite y convenciones.
- [`docs/decisiones-operativas.md`](docs/decisiones-operativas.md): políticas
  cerradas de caja, pagos, correcciones, pedidos y delivery.
- [`docs/autenticacion-operadores.md`](docs/autenticacion-operadores.md):
  PIN local y sesión Supabase individual.
- [`docs/autenticacion-clientes.md`](docs/autenticacion-clientes.md):
  cuenta minorista.
- [`supabase/README.md`](supabase/README.md): backend, orden de migraciones y
  pgTAP.
