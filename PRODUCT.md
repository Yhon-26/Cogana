# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

El usuario principal es el personal de la tienda: administradores y vendedores que operan Cogana desde el teléfono para atender ventas, controlar existencias y coordinar la operación diaria.

Las audiencias secundarias son clientes minoristas, restaurantes o compradores mayoristas y personal de reparto. Estas audiencias participan en los flujos de catálogo, pedidos, compra y entrega, pero la experiencia operativa del personal de tienda tiene prioridad.

## Product Purpose

Cogana digitaliza la operación y venta de abarrotes pesables desde el teléfono y unifica POS, inventario, pedidos y reparto en tiempo real.

El producto reemplaza procesos manuales y mantiene una única visión compartida de productos, cantidades y operaciones entre la tienda y sus usuarios. El éxito exige que los cambios realizados por un usuario estén disponibles para los demás en tiempo real y que la cantidad vendible mostrada corresponda al inventario central vigente.

## Positioning

Cogana reúne en una sola operación móvil el comercio de abarrotes pesables —incluidos cálculos por peso, presentación o importe—, el POS, el inventario compartido, los pedidos y el reparto. Su diferencia central es conservar estas áreas conectadas en tiempo real, con el personal de tienda como usuario prioritario.

## Operating Context

- La operación inicial corresponde a una tienda en Santa Anita, Lima, Perú.
- El teléfono es el dispositivo principal del personal; Android tiene prioridad para la operación interna.
- La experiencia para clientes debe funcionar en Android y iPhone y adaptar sus patrones a cada plataforma.
- El sistema opera **online-first**: la conexión a internet es el modo de operación principal y la sincronización con el backend central es el camino real de la operación.
- Ante cortes breves o inestabilidad de red, la app conserva una copia operativa local y sincroniza al reconectar; el modo offline no es un flujo alternativo aprobado, sino resiliencia temporal ante interrupciones.
- La base central y el inventario compartido se actualizan con la latencia del ciclo de sincronización (≈30 s en línea) entre la tienda y los usuarios.
- El idioma del producto es español peruano, con lenguaje claro para tareas rápidas de venta y administración.

## Capabilities and Constraints

- POS para ventas presenciales de productos pesables y productos por unidad o presentación.
- Inventario y precios compartidos, con cantidades centrales visibles para los usuarios autorizados.
- Catálogo, carrito, pedidos minoristas y seguimiento.
- Flujos comerciales para restaurantes y compradores mayoristas.
- Preparación, asignación y confirmación de reparto.
- Acceso Inteligente Unificado: la pantalla principal de acceso detecta automáticamente si el usuario es dueño/personal o cliente, dirigiéndolo a la interfaz correcta (panel o tienda).
- Sesión Permanente: la operación en los dispositivos principales retiene la sesión activa y omite el ingreso del PIN y bloqueos de inactividad.
- Supabase/PostgreSQL es la infraestructura central presente en el proyecto y debe sostener la verdad compartida en tiempo real.
- La disponibilidad de internet es un requisito de operación; la interfaz debe explicar y recuperar de forma segura los estados de conexión o sincronización fallida, sin presentar el modo offline como alternativa de operación.
- La copia local (SQLite) y la cola de sincronización (outbox) son resiliencia aprobada ante cortes de red, no una capacidad de operación paralela del producto.
- Las cantidades pesables, precios, totales e inventario deben conservar precisión y unidades explícitas.
- La operación inicial parte de Santa Anita, pero el modelo contempla crecimiento a más tiendas y ubicaciones.

### Arquitectura aprobada: online-first con resiliencia offline

Cogana opera **online-first**: la fuente de verdad es Supabase/PostgreSQL y la
operación real requiere conexión. Para sostener la continuidad ante cortes de
red, la app mantiene una copia operativa local (SQLite), registra cambios en
`sync_outbox` y los sincroniza de forma idempotente e incremental
(`change_log`, pull por cursor). La interfaz explica el estado de conexión y
sincronización, y los cambios quedan disponibles para los demás dispositivos
con la latencia del ciclo de sincronización (≈30 s en línea; más si no hay
red).

Esta decisión reemplaza el alineamiento pendiente: el comportamiento offline
no es un flujo alternativo del producto, es resiliencia temporal para no
interrumpir la operación durante cortes de red. La visión compartida del
negocio se cumple con el ciclo de sincronización; no se promete sincronía
estricta por suscripción en tiempo real.

## Brand Commitments

- Nombre oficial: Cogana.
- La marca cuenta con un logotipo oficial y sus colores pueden utilizarse en la interfaz.
- La identidad del logotipo está confirmada como oficial. Se facilitó `C:\Users\Yhon\Downloads\logo_oficial.jpg` como referencia visual, pero permanece fuera del repositorio y contiene marcas de agua visibles; debe sustituirse por un maestro limpio y autorizado antes de publicarse.
- Los archivos actuales `assets/images/icon.png` y `assets/images/splash-icon.png` son marcadores genéricos de Expo y no deben tratarse como la identidad oficial.
- El producto se comunica en español peruano.
- La marca debe servir primero a una operación de tienda clara y confiable, sin perder cercanía con clientes locales.

## Evidence on Hand

- `PRD_Cogana_v1.0.docx`: alcance, usuarios, venta por peso y expansión prevista. Sus afirmaciones sobre operación offline y logo provisional están reemplazadas por este registro confirmado.
- `TRD_Cogana_v1.0.docx`: arquitectura técnica histórica; requiere revisión por su dependencia de un enfoque offline-first.
- `Flujo_App_Cogana_v1.0.docx` y `docs/mapa-pantallas.md`: flujos, roles y mapa de interfaces.
- `UI_UX_Design_Brief_Cogana_v1.0.docx`: contexto operativo, lenguaje y requisitos de uso; su nota de logo provisional ya no está vigente.
- `README.md`, `database/`, `sync/` y las pruebas actuales documentan la implementación existente de la arquitectura online-first con resiliencia offline aprobada.
- `supabase/` contiene el backend central, migraciones, RLS y pruebas pgTAP existentes.
- El logotipo oficial fue facilitado como referencia en `C:\Users\Yhon\Downloads\logo_oficial.jpg` (741 × 742 px). Su maestro limpio y su ubicación definitiva dentro del proyecto siguen pendientes de incorporación.
- No se han confirmado testimonios, métricas productivas, fotografías de catálogo, acuerdos con proveedores externos ni otras pruebas comerciales; no deben inventarse en trabajo futuro.

## Product Principles

1. **Una verdad compartida en tiempo real.** Productos, inventario y operaciones deben reflejar el estado central vigente para todos los usuarios autorizados.
2. **Primero el personal de tienda.** Las decisiones de producto deben priorizar la velocidad, claridad y control que necesitan administradores y vendedores.
3. **Cantidades sin ambigüedad.** Peso, unidad, presentación, precio de referencia y total deben conservar significado y precisión a lo largo de cada flujo.
4. **Una operación conectada.** POS, inventario, pedidos y reparto deben funcionar como partes del mismo sistema, no como módulos aislados.
5. **Crecer sin fragmentar.** La experiencia debe admitir nuevas audiencias, tiendas y ubicaciones manteniendo roles, datos y reglas coherentes.

## Accessibility & Inclusion

La interfaz debe admitir distintos niveles de experiencia digital, controles táctiles cómodos, texto legible, contraste suficiente, etiquetas explícitas y estados que no dependan solo del color. Debe conservar claridad con tamaños de texto ampliados y patrones nativos de Android e iOS.
