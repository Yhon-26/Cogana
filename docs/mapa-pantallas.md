# Mapa de interfaces y entregas de Coguana

## Propósito y criterios

Este documento conserva el mapa funcional completo de Coguana, pero lo organiza en entregas alcanzables para una sola persona. Es un roadmap de producto: una interfaz listada no se considera implementada hasta que su entrega haya sido desarrollada y validada.

Los únicos valores permitidos en **Tipo de interfaz** son:

- **Pantalla:** destino de navegación completo.
- **Modal:** acción breve que aparece sobre el contexto actual.
- **Sección:** bloque que forma parte de una pantalla mayor.
- **Estado:** variante informativa de una pantalla, sin ruta propia.
- **Integración externa:** experiencia dependiente de otro servicio o aplicación.

### Interfaces existentes

El prototipo local actual sirve como base visual y funcional para cinco interfaces:

| Código | Interfaz actual | Ruta |
|---|---|---|
| E1 | Panel administrador | `/` |
| E2 | Nueva venta | `/venta` |
| E3 | Inventario | `/inventario` |
| E4 | Pedidos | `/pedidos` |
| E5 | Actualización de precios | `/precios` |

La entrega asignada en este documento indica cuándo se completa la capacidad real de cada interfaz. Por ello, una base visual como E4 puede existir hoy aunque su flujo conectado corresponda a una entrega posterior.

## Arquitectura de datos

La arquitectura es **offline-first**, pero mantiene una única fuente central de verdad para toda operación real.

| Capa | Tecnología | Responsabilidad |
|---|---|---|
| Base central y oficial | PostgreSQL mediante Supabase | Consolidar usuarios, productos, precios, inventario, caja, ventas, pedidos y demás datos compartidos por toda la operación. |
| Base local por dispositivo | SQLite en cada teléfono | Permitir lectura y escritura sin internet, mantener una copia operativa local y guardar una cola de cambios pendientes. |
| Acceso seguro | API de Supabase, sesiones autenticadas, reglas RLS y funciones seguras | Autorizar qué datos puede leer o modificar cada usuario sin exponer credenciales privilegiadas. |
| Sincronización | Cola local y proceso de sincronización con Supabase | Enviar operaciones pendientes, recibir cambios centrales y resolver su estado de sincronización. |

### Reglas de arquitectura

- **PostgreSQL mediante Supabase es la fuente central y oficial.** La tienda online, restaurantes, clientes mayoristas y futuras sucursales utilizarán esta misma base central.
- **SQLite es la base local de cada teléfono para trabajar offline.** No reemplaza PostgreSQL ni debe tratarse como una base central compartida.
- Una demostración inicial puede funcionar en un solo dispositivo usando únicamente SQLite. Esta modalidad sirve para validar el flujo, pero no representa una operación multiusuario real.
- El piloto real con **Administrador**, **Vendedor esposo** y **Vendedora esposa** requiere PostgreSQL mediante Supabase y sincronización entre dispositivos.
- La aplicación nunca se conectará directamente con la contraseña de PostgreSQL. El cliente utilizará Supabase, sesiones autenticadas y reglas **Row Level Security (RLS)**; las operaciones privilegiadas se ejecutarán mediante funciones seguras. Ninguna contraseña de PostgreSQL ni clave con privilegios administrativos se incluirá en la aplicación.
- Toda operación creada offline tendrá un **identificador único generado en el dispositivo**. El servidor utilizará ese identificador como clave de idempotencia para aceptar cada venta o movimiento una sola vez y evitar duplicados durante reintentos de sincronización.
- La cola local distinguirá al menos los estados **pendiente**, **sincronizando**, **sincronizado** y **con error**, sin descartar una operación hasta recibir confirmación de Supabase.

## Resumen de entregas

| Entrega | Alcance | Interfaces |
|---|---|---:|
| 1. MVP interno | Caja, venta presencial, productos, precios, inventario y operación local resiliente | 22 |
| 2. Venta online minorista | Cuenta de cliente, catálogo, checkout, pedidos y seguimiento | 40 |
| 3. Restaurantes y mayoristas | Registro comercial, precios acordados, cotizaciones y compras por volumen | 15 |
| 4. Delivery propio y externo | Despacho, reparto, cobertura e integraciones logísticas | 14 |
| 5. Expansión | Operación avanzada, SUNAT, reportes, soporte, automatización y sucursales | 35 |
| **Total del roadmap** |  | **126** |

## 1. MVP interno

Esta entrega queda deliberadamente limitada a 22 interfaces. La demostración inicial puede funcionar con SQLite en un solo dispositivo; antes del piloto real multiusuario debe conectarse a Supabase/PostgreSQL y sincronizar las operaciones locales.

### Decisiones de alcance del MVP interno

- El MVP comienza con tres usuarios locales preconfigurados: **Administrador**, **Vendedor esposo** y **Vendedora esposa**. Los dos perfiles vendedores operan como cajeros. El alta, edición y administración dinámica de empleados se mantiene en **Expansión**.
- Las unidades **kg**, **gramo**, **unidad**, **paquete**, **caja** y **saco** estarán predefinidas. La creación de unidades adicionales y la configuración avanzada de conversiones se mantiene en **Expansión**.
- La pestaña existente **Pedidos** (E4, ruta `/pedidos`) no formará parte de la navegación activa del MVP interno. Su base se conserva para la entrega **Venta online minorista**.

| Nombre | Tipo de interfaz | Tipo de usuario | Objetivo | Se abre desde | Acción principal | Entrega | Reutilización |
|---|---|---|---|---|---|---|---|
| Acceso rápido de empleado | Pantalla | Cajero, almacén y administrador | Entrar al entorno interno mediante credencial o PIN | Inicio de la aplicación | Validar acceso | MVP interno | Parcial: cabecera de E1 |
| Apertura de caja | Modal | Cajero y administrador | Registrar responsable y fondo inicial del turno | Panel de caja | Abrir turno | MVP interno | Parcial: estado de caja de E1 |
| Panel de caja | Pantalla | Cajero y administrador | Ver turno activo, ventas y accesos operativos | Acceso rápido de empleado | Iniciar nueva venta | MVP interno | Sí: E1 adaptado al rol |
| Ventas del turno | Sección | Cajero y administrador | Consultar las operaciones recientes de la caja activa | Panel de caja | Abrir el detalle de una venta | MVP interno | Parcial: patrón de lista de E4 dentro del Panel de caja |
| Nueva venta presencial | Pantalla | Cajero y administrador | Vender por gramos, kilogramos o monto en soles | Panel de caja; E1 | Agregar productos y confirmar venta | MVP interno | Sí: E2 |
| Selección rápida de producto | Sección | Cajero | Buscar y elegir productos durante una venta | Nueva venta presencial | Seleccionar producto | MVP interno | Sí: selector de E2 y búsqueda de E3 |
| Resumen de venta | Sección | Cajero | Editar cantidades y revisar subtotales y total | Nueva venta presencial | Pasar al cobro | MVP interno | Sí: carrito de E2 |
| Cobro de venta | Modal | Cajero | Registrar el medio de pago y calcular vuelto cuando corresponda | Resumen de venta | Confirmar cobro | MVP interno | Parcial: confirmación de E2; sin pago real actual |
| Comprobante de venta | Modal | Cajero y cliente presencial | Mostrar el resumen y código de la operación | Cobro de venta | Cerrar o compartir comprobante | MVP interno | Parcial: confirmación de E2 |
| Movimiento de efectivo | Modal | Cajero y administrador | Registrar ingresos o salidas no asociados a una venta | Panel de caja | Guardar movimiento | MVP interno | Parcial: formulario de E2 |
| Arqueo y cierre de caja | Pantalla | Cajero y administrador | Comparar ventas con efectivo y cerrar el turno | Panel de caja | Cerrar caja | MVP interno | Parcial: métricas de E1 |
| Panel administrador | Pantalla | Administrador y propietario | Resumir caja, ventas, inventario y alertas | Acceso rápido de empleado | Abrir un módulo | MVP interno | Sí: E1 |
| Inventario general | Pantalla | Administrador y almacén | Consultar existencias y encontrar productos | E1; navegación interna | Buscar producto | MVP interno | Sí: E3 |
| Detalle de inventario | Pantalla | Administrador y almacén | Consultar stock, precio, unidad y movimientos de un producto | Inventario general | Abrir movimientos | MVP interno | Parcial: tarjetas de E3 |
| Crear producto | Pantalla | Administrador | Registrar datos, unidad, precio y stock inicial | Inventario general | Guardar producto | MVP interno | Parcial: campos y estilos de E5 |
| Editar producto | Pantalla | Administrador | Mantener los datos comerciales y operativos del producto | Detalle de inventario | Guardar cambios | MVP interno | Sí: formulario de Crear producto |
| Actualización de precios | Pantalla | Administrador | Cambiar el precio por kilogramo de cada producto | E1; Inventario general | Guardar precio | MVP interno | Sí: E5 |
| Movimientos de inventario | Pantalla | Administrador y almacén | Consultar entradas, salidas y ajustes con fecha y motivo | Detalle de inventario; Inventario general | Registrar movimiento | MVP interno | Parcial: lista de E3 y estados de E4 |
| Ajuste de stock | Modal | Administrador y almacén | Corregir stock por merma, conteo o incidencia | Movimientos de inventario | Guardar ajuste y motivo | MVP interno | Parcial: editor de E5 |
| Entrada de mercadería | Pantalla | Administrador y almacén | Aumentar existencias por una recepción de productos | Movimientos de inventario; Inventario general | Confirmar entrada | MVP interno | Parcial: formulario y carrito de E2 |
| Alertas de reposición | Estado | Administrador y almacén | Identificar productos que alcanzaron el mínimo configurado | E1; Inventario general | Revisar producto | MVP interno | Sí: indicadores de E1 y E3 |
| Almacenamiento local y sincronización | Estado | Personal interno | Confirmar el guardado en SQLite, informar la falta de conexión e identificar operaciones con ID único pendientes de sincronizar con Supabase | Cualquier acción de guardado o interfaz interna | Continuar sin conexión o reintentar sincronización | MVP interno | Parcial: estado local compartido y avisos de E1 |

## 2. Venta online minorista

Esta entrega añade la experiencia de compra del cliente y conecta el ciclo de pedido. Incluye el manejo posterior de diferencias entre el peso estimado y el peso final preparado.

| Nombre | Tipo de interfaz | Tipo de usuario | Objetivo | Se abre desde | Acción principal | Entrega | Reutilización |
|---|---|---|---|---|---|---|---|
| Bienvenida y selección de acceso | Pantalla | Todos | Presentar Coguana y dirigir al flujo de compra o acceso interno | Inicio de la aplicación | Elegir tipo de acceso | Venta online minorista | Parcial: identidad visual de E1 |
| Inicio de sesión de cliente | Pantalla | Cliente minorista y mayorista | Acceder a pedidos, direcciones y condiciones de cuenta | Bienvenida; Perfil | Iniciar sesión | Venta online minorista | No |
| Registro de cliente minorista | Pantalla | Cliente minorista | Crear una cuenta con datos básicos | Inicio de sesión | Crear cuenta | Venta online minorista | No |
| Verificación de cuenta | Pantalla | Cliente minorista y mayorista | Confirmar correo o teléfono | Registro; cambio de datos sensibles | Verificar código | Venta online minorista | No |
| Recuperación de acceso | Pantalla | Usuarios registrados | Recuperar una contraseña olvidada | Inicio de sesión | Solicitar enlace o código | Venta online minorista | No |
| Gestión de consentimiento | Sección | Cliente minorista y mayorista | Aceptar términos, privacidad y comunicaciones | Registro; Perfil | Guardar consentimientos | Venta online minorista | No |
| Inicio de tienda | Pantalla | Cliente minorista | Descubrir categorías, productos y promociones | Bienvenida; navegación principal | Explorar productos | Venta online minorista | Parcial: tarjetas de E1 |
| Catálogo de productos | Pantalla | Cliente minorista | Navegar y filtrar abarrotes, menestras y granos | Inicio de tienda; búsqueda | Seleccionar producto | Venta online minorista | Parcial: tarjetas de E2 y datos de E3 |
| Búsqueda de productos | Sección | Cliente minorista | Encontrar productos por nombre, categoría o presentación | Inicio de tienda; catálogo | Buscar y filtrar | Venta online minorista | Parcial: buscador de E3 |
| Detalle de producto | Pantalla | Cliente minorista | Consultar precio, disponibilidad y presentaciones | Catálogo; búsqueda; favoritos | Elegir cantidad | Venta online minorista | Parcial: selector y cálculo de E2 |
| Carrito minorista | Pantalla | Cliente minorista | Revisar pesos, cantidades, precios y subtotal | Detalle de producto; navegación principal | Continuar compra | Venta online minorista | Sí: resumen de E2 |
| Entrega o recojo | Pantalla | Cliente minorista | Elegir delivery, recojo y franja horaria | Carrito minorista | Confirmar modalidad | Venta online minorista | No |
| Dirección de entrega | Pantalla | Cliente minorista | Seleccionar o registrar el destino | Entrega o recojo | Confirmar dirección | Venta online minorista | No |
| Resumen y confirmación del pedido | Pantalla | Cliente minorista | Revisar productos, datos, entrega y total estimado | Dirección de entrega; carrito | Confirmar pedido | Venta online minorista | Parcial: resumen de E2 |
| Selección de medio de pago | Sección | Cliente minorista | Elegir efectivo, transferencia u otro medio habilitado | Resumen del pedido | Elegir medio | Venta online minorista | Parcial: cierre de E2; sin pago real actual |
| Resultado del pedido | Estado | Cliente minorista | Mostrar código y estado inicial del pedido | Confirmación del pedido | Ver seguimiento | Venta online minorista | Parcial: confirmación de E2 |
| Seguimiento de pedido | Pantalla | Cliente minorista | Consultar preparación, despacho y entrega | Resultado; Mis pedidos | Revisar estado | Venta online minorista | Parcial: estados de E4 |
| Mis pedidos | Pantalla | Cliente minorista | Consultar pedidos activos y anteriores | Perfil; navegación principal | Abrir pedido | Venta online minorista | Sí: lista y filtros de E4 |
| Repetir compra | Modal | Cliente minorista | Volver a cargar productos de un pedido anterior | Detalle de pedido; Mis pedidos | Agregar al carrito | Venta online minorista | Parcial: carrito de E2 |
| Favoritos | Pantalla | Cliente minorista | Guardar productos frecuentes | Inicio; catálogo; detalle de producto | Agregar al carrito | Venta online minorista | Parcial: catálogo minorista |
| Promociones y cupones | Sección | Cliente minorista | Consultar y aplicar beneficios vigentes | Inicio; carrito | Aplicar promoción | Venta online minorista | Parcial: tarjetas de E1 |
| Bandeja unificada de pedidos | Pantalla | Administrador, preparación y caja | Consultar pedidos online y reservas | E1; navegación interna | Abrir pedido | Venta online minorista | Sí: E4 |
| Detalle de pedido | Pantalla | Personal interno y cliente correspondiente | Consultar productos, cliente, entrega y cronología | Bandeja; Mis pedidos; seguimiento | Gestionar o consultar pedido | Venta online minorista | Parcial: E4 y resumen de E2 |
| Preparación de pedido | Pantalla | Personal de preparación | Marcar productos recogidos, faltantes y sustituciones | Detalle de pedido | Completar preparación | Venta online minorista | Parcial: E4 con lista comprobable |
| Empaque y peso final | Pantalla | Preparación y caja | Confirmar cantidades reales de productos vendidos por peso | Preparación de pedido | Confirmar peso final | Venta online minorista | Sí: cálculo de E2 adaptado |
| Diferencia por peso final | Estado | Cliente, preparación y caja | Mostrar variación entre peso estimado, peso preparado y total final | Empaque y peso final; seguimiento | Aceptar o revisar diferencia | Venta online minorista | Parcial: resultados de cálculo de E2 |
| Cambio de estado | Modal | Administrador y preparación | Mover un pedido por pendiente, preparando, listo y entregado | E4; Detalle de pedido | Confirmar siguiente estado | Venta online minorista | Sí: E4 |
| Asignación de responsable | Modal | Administrador | Designar preparador o repartidor | Detalle de pedido; bandeja | Asignar empleado | Venta online minorista | Parcial: acción de E4 |
| Pedidos programados | Pantalla | Administrador y preparación | Consultar pedidos futuros por día y horario | Bandeja de pedidos | Abrir agenda | Venta online minorista | Parcial: filtros de E4 |
| Sustitución de producto | Modal | Preparación y cliente | Proponer y aprobar un reemplazo por falta de stock | Preparación; seguimiento | Aceptar sustitución | Venta online minorista | Parcial: Detalle de pedido |
| Cancelación de pedido | Modal | Cliente y administrador | Cancelar un pedido válido indicando el motivo | Detalle; seguimiento | Confirmar cancelación | Venta online minorista | No |
| Historial y búsqueda avanzada | Sección | Administrador | Encontrar pedidos por fecha, estado, tipo o cliente | Bandeja de pedidos | Aplicar filtros | Venta online minorista | Sí: E4 y buscador de E3 |
| Incidencias de pedido | Modal | Administrador y soporte | Registrar faltantes, errores o reclamos | Detalle de pedido | Crear incidencia | Venta online minorista | Parcial: formulario de E2 |
| Perfil personal | Pantalla | Usuarios registrados | Consultar y editar nombre, teléfono y correo | Navegación principal; menú de cuenta | Guardar perfil | Venta online minorista | No |
| Direcciones guardadas | Pantalla | Cliente minorista y mayorista | Administrar destinos frecuentes | Perfil; Entrega o recojo | Crear o editar dirección | Venta online minorista | Sí: Dirección de entrega |
| Preferencias de notificación | Sección | Usuarios registrados | Elegir avisos de pedidos y promociones | Perfil; Configuración | Guardar preferencias | Venta online minorista | No |
| Seguridad y acceso | Pantalla | Usuarios registrados | Cambiar contraseña o cerrar otras sesiones | Perfil; Configuración | Actualizar credenciales | Venta online minorista | Parcial: interfaces de acceso |
| Medios de pago guardados | Integración externa | Cliente minorista y mayorista | Administrar métodos tokenizados por un proveedor seguro | Perfil; checkout | Agregar medio de pago | Venta online minorista | No; requiere proveedor de pagos |
| Términos y privacidad | Pantalla | Todos | Consultar condiciones legales y tratamiento de datos | Registro; Perfil; Configuración | Leer documento | Venta online minorista | No |
| Cerrar sesión | Modal | Usuarios registrados | Finalizar de forma segura la sesión actual | Perfil; Configuración | Confirmar salida | Venta online minorista | No |

## 3. Restaurantes y mayoristas

Esta entrega reutiliza la cuenta, el catálogo, el carrito y el ciclo de pedidos minorista, agregando condiciones y flujos comerciales propios.

| Nombre | Tipo de interfaz | Tipo de usuario | Objetivo | Se abre desde | Acción principal | Entrega | Reutilización |
|---|---|---|---|---|---|---|---|
| Registro de negocio | Pantalla | Restaurante o mayorista | Solicitar cuenta comercial con RUC y contacto | Inicio de sesión; Bienvenida | Enviar solicitud | Restaurantes y mayoristas | No |
| Selección de perfil o negocio | Pantalla | Usuario con más de un perfil | Elegir la cuenta personal, negocio o local con el que operará | Inicio de sesión | Seleccionar perfil | Restaurantes y mayoristas | No |
| Inicio mayorista | Pantalla | Restaurante o mayorista | Resumir pedidos, precios y accesos frecuentes | Inicio de sesión; navegación principal | Crear pedido mayorista | Restaurantes y mayoristas | Sí: E1 |
| Estado de cuenta comercial | Estado | Restaurante o mayorista | Consultar aprobación y condiciones del negocio | Inicio mayorista; Perfil de negocio | Completar información | Restaurantes y mayoristas | No |
| Catálogo mayorista | Pantalla | Restaurante o mayorista | Comprar por volumen con mínimos comerciales | Inicio mayorista | Seleccionar productos | Restaurantes y mayoristas | Parcial: E2 y E3 |
| Lista de precios acordados | Pantalla | Restaurante o mayorista | Consultar precios específicos, vigencia y escalas | Inicio mayorista; catálogo | Revisar condiciones | Restaurantes y mayoristas | Sí: E5 en modo consulta |
| Carrito mayorista | Pantalla | Restaurante o mayorista | Consolidar sacos, kilos, unidades y grandes cantidades | Catálogo mayorista; cotización | Continuar pedido | Restaurantes y mayoristas | Sí: resumen de E2 adaptado |
| Solicitud de cotización | Pantalla | Restaurante o mayorista | Pedir propuesta para productos o volúmenes especiales | Catálogo mayorista; carrito | Enviar solicitud | Restaurantes y mayoristas | Parcial: formulario de E2 |
| Detalle de cotización | Pantalla | Mayorista y administrador | Revisar precios, vigencia y observaciones | Mis cotizaciones; pedidos administrativos | Aceptar o responder | Restaurantes y mayoristas | Parcial: Detalle de pedido |
| Mis cotizaciones | Pantalla | Restaurante o mayorista | Consultar solicitudes pendientes, aceptadas o vencidas | Inicio mayorista; Perfil | Abrir cotización | Restaurantes y mayoristas | Sí: lista y filtros de E4 |
| Programación de abastecimiento | Pantalla | Restaurante o mayorista | Elegir fecha, horario y recurrencia de entregas | Carrito mayorista; detalle | Programar entrega | Restaurantes y mayoristas | No |
| Pedido recurrente | Modal | Restaurante o mayorista | Configurar una lista de compra repetitiva | Pedido anterior; programación | Activar recurrencia | Restaurantes y mayoristas | Parcial: repetir compra y E4 |
| Crédito y condiciones de pago | Pantalla | Mayorista aprobado | Consultar línea, vencimientos y plazos | Inicio mayorista; Perfil de negocio | Revisar o solicitar crédito | Restaurantes y mayoristas | No |
| Comprobantes y documentos | Pantalla | Restaurante o mayorista | Consultar comprobantes, cotizaciones y estados de cuenta | Perfil; Detalle de pedido | Descargar documento | Restaurantes y mayoristas | No |
| Perfil de negocio | Pantalla | Restaurante, mayorista y propietario | Mantener razón social, RUC, contacto y direcciones | Inicio mayorista; Configuración | Guardar negocio | Restaurantes y mayoristas | Sí: formulario de Registro de negocio |

## 4. Delivery propio y externo

Primero se habilita el reparto propio y la selección manual de operadores. La asignación y el rastreo automáticos con empresas externas quedan identificados como integración posterior dentro de esta entrega.

| Nombre | Tipo de interfaz | Tipo de usuario | Objetivo | Se abre desde | Acción principal | Entrega | Reutilización |
|---|---|---|---|---|---|---|---|
| Panel de despachos | Pantalla | Administrador y coordinador | Ver pedidos listos, asignados y en ruta | E1; Bandeja de pedidos | Asignar despacho | Delivery propio y externo | Sí: estructura de E4 |
| Asignación de repartidor | Modal | Administrador y coordinador | Vincular un pedido con un repartidor propio | Panel de despachos; Detalle de pedido | Confirmar asignación | Delivery propio y externo | Parcial: acción de E4 |
| Inicio del repartidor | Pantalla | Repartidor propio | Consultar entregas y resumen de ruta | Acceso rápido de empleado | Iniciar reparto | Delivery propio y externo | Sí: E1 adaptado al rol |
| Lista de entregas | Pantalla | Repartidor propio | Ordenar y revisar pedidos del recorrido | Inicio del repartidor | Abrir entrega | Delivery propio y externo | Sí: lista de E4 |
| Detalle de entrega | Pantalla | Repartidor propio | Consultar dirección, contacto, cobro y notas | Lista de entregas | Iniciar navegación o entrega | Delivery propio y externo | Parcial: Detalle de pedido |
| Navegación a destino | Integración externa | Repartidor propio | Abrir la ubicación en una aplicación de mapas | Detalle de entrega | Abrir mapa | Delivery propio y externo | No; integración con mapas |
| Confirmación de entrega | Modal | Repartidor propio | Registrar recepción, hora, nombre y observación | Detalle de entrega | Marcar entregado | Delivery propio y externo | Parcial: cambio de estado de E4 |
| Evidencia de entrega | Modal | Repartidor propio | Adjuntar foto, firma o código de recepción | Confirmación de entrega | Guardar evidencia | Delivery propio y externo | No |
| Incidencia de delivery | Modal | Repartidor, administrador y soporte | Informar dirección incorrecta, ausencia o rechazo | Detalle de entrega | Reportar incidencia | Delivery propio y externo | Parcial: Incidencias de pedido |
| Zonas y tarifas | Pantalla | Administrador | Definir cobertura, costo y mínimos por zona | Configuración de tienda; Delivery | Guardar zona | Delivery propio y externo | No |
| Cotización de delivery externo | Integración externa | Administrador y cliente | Consultar costo y disponibilidad de un operador | Entrega o recojo; Panel de despachos | Elegir operador | Delivery propio y externo | No; integración externa |
| Seguimiento externo | Integración externa | Cliente y administrador | Consultar estado y enlace de rastreo del proveedor | Seguimiento de pedido; Panel de despachos | Abrir rastreo | Delivery propio y externo | Parcial: Seguimiento de pedido |
| Configuración de operadores externos | Pantalla | Administrador | Gestionar credenciales, reglas y prioridades logísticas | Configuración de tienda | Guardar operador | Delivery propio y externo | No |
| Integración automática con empresas de delivery | Integración externa | Administrador y coordinador | Cotizar, asignar, cancelar y actualizar estados sin operación manual | Panel de despachos; configuración de operadores | Activar automatización | Delivery propio y externo, fase posterior | No; APIs de operadores externos |

## 5. Expansión

Esta entrega agrupa funciones que no son necesarias para validar la operación inicial: control interno avanzado, SUNAT, analítica, soporte, automatización y múltiples locales.

| Nombre | Tipo de interfaz | Tipo de usuario | Objetivo | Se abre desde | Acción principal | Entrega | Reutilización |
|---|---|---|---|---|---|---|---|
| Bloqueo por inactividad | Estado | Personal interno | Proteger una sesión interna sin cerrarla | Cualquier interfaz tras inactividad | Desbloquear con PIN | Expansión | Parcial: Acceso rápido de empleado |
| Búsqueda de ventas | Pantalla | Cajero y administrador | Localizar operaciones por código, fecha o cliente | Panel de caja; Reportes | Abrir venta | Expansión | Sí: patrón de E4 |
| Detalle de venta | Pantalla | Cajero y administrador | Consultar productos, importes, responsable y medio | Búsqueda de ventas; reportes | Revisar operación | Expansión | Parcial: resumen de E2 |
| Anulación o devolución | Modal | Administrador y cajero autorizado | Revertir total o parcialmente una venta con motivo | Detalle de venta | Confirmar reversión | Expansión | No |
| Diferencias de caja | Pantalla | Administrador | Revisar faltantes, sobrantes y justificaciones | Arqueo y cierre; reportes | Aprobar observación | Expansión | Parcial: Detalle de venta |
| Categorías y presentaciones | Pantalla | Administrador | Organizar catálogo y presentaciones comerciales | Productos; Configuración de tienda | Crear o editar categoría | Expansión | Parcial: lista de E5 |
| Unidades y conversiones | Sección | Administrador y almacén | Configurar unidades adicionales y conversiones avanzadas más allá de kg, gramo, unidad, paquete, caja y saco | Editar producto; Configuración | Guardar unidad o equivalencia | Expansión | Sí: lógica y selector de E2 |
| Historial de precios | Pantalla | Administrador | Auditar precio anterior, nuevo, fecha y responsable | E5; Detalle de inventario | Consultar cambio | Expansión | Parcial: lista de E4 |
| Conteo físico | Pantalla | Administrador y almacén | Comparar cantidades físicas contra el sistema | Inventario general | Finalizar conteo | Expansión | Parcial: lista de E3 |
| Proveedores | Pantalla | Administrador | Administrar datos, contacto y productos suministrados | Inventario; Administración | Crear o editar proveedor | Expansión | Parcial: listas de E3 |
| Órdenes de compra | Pantalla | Administrador y almacén | Solicitar mercadería y controlar su recepción | Proveedores; Alertas de reposición | Emitir orden | Expansión | Parcial: estructura de E4 |
| Lotes y vencimientos | Pantalla | Administrador y almacén | Controlar lotes, vencimientos y rotación | Entrada de mercadería; Detalle de inventario | Registrar lote | Expansión | Parcial: Detalle de inventario |
| Escaneo de código | Integración externa | Cajero y almacén | Encontrar productos mediante cámara o lector | Nueva venta; inventario; recepción | Escanear código | Expansión | Parcial: entrada para E2 o E3 |
| Empleados | Pantalla | Administrador | Administrar dinámicamente el personal, sus roles y estados de acceso después de los tres usuarios locales del MVP | E1; Configuración | Abrir empleado | Expansión | Parcial: lista de E3 |
| Alta y edición de empleado | Pantalla | Administrador | Registrar datos, rol, permisos y PIN | Empleados | Guardar empleado | Expansión | Parcial: formulario de productos |
| Roles y permisos | Pantalla | Propietario y administrador autorizado | Definir módulos y acciones disponibles por rol | Empleados; Configuración | Guardar permisos | Expansión | No |
| Turnos y asistencia | Pantalla | Administrador y empleado | Programar horarios y registrar jornada | Empleados; Perfil del empleado | Registrar turno | Expansión | Parcial: apertura y cierre de caja |
| Resumen de ventas | Pantalla | Administrador y propietario | Consultar ventas, ticket promedio y evolución | E1; Reportes | Cambiar periodo | Expansión | Sí: métricas de E1 |
| Reporte de caja | Pantalla | Administrador y propietario | Revisar turnos, medios y diferencias | Reportes; cierre de caja | Abrir cierre | Expansión | Parcial: Panel de caja y Detalle de venta |
| Reporte de inventario | Pantalla | Administrador y propietario | Analizar stock, valorización, mermas y rotación | Reportes; E3 | Filtrar productos | Expansión | Sí: E3 ampliado |
| Reporte de productos vendidos | Pantalla | Administrador y propietario | Identificar productos y categorías con mayor salida | Reportes | Cambiar periodo o categoría | Expansión | Parcial: E1 y E3 |
| Reporte de márgenes | Pantalla | Propietario | Comparar costos, ventas y utilidad estimada | Reportes | Consultar rentabilidad | Expansión | Parcial: Resumen de ventas |
| Reporte de clientes | Pantalla | Administrador y propietario | Analizar recurrencia, ticket y segmentos | Reportes | Abrir segmento | Expansión | Parcial: lista de E4 |
| Exportación de reportes | Integración externa | Administrador y propietario | Generar archivos compartibles con datos filtrados | Cualquier reporte | Exportar archivo | Expansión | No |
| Auditoría de operaciones | Pantalla | Propietario y administrador autorizado | Consultar cambios sensibles, usuario, fecha y motivo | Configuración; detalles operativos | Revisar evento | Expansión | Parcial: historial de E4 |
| Promociones y reglas comerciales | Pantalla | Administrador | Crear descuentos, vigencias y condiciones | Administración; Productos | Publicar promoción | Expansión | Parcial: editor de E5 |
| Sucursales y almacenes | Pantalla | Propietario | Administrar múltiples locales, stock y responsables | Configuración de tienda | Seleccionar o editar local | Expansión | Parcial: E1 y E3 por local |
| Configuración de tienda | Pantalla | Administrador y propietario | Definir datos del local, horarios, moneda y comprobantes | E1; Configuración | Guardar configuración | Expansión | Parcial: estructura de E5 |
| Preferencias de la aplicación | Sección | Todos | Elegir opciones visuales, idioma y comportamiento | Perfil; Configuración | Guardar preferencias | Expansión | No |
| Centro de ayuda | Pantalla | Todos | Consultar respuestas sobre compra, pedidos y operación | Perfil; menú de ayuda | Buscar respuesta | Expansión | Parcial: buscador de E3 |
| Contacto y soporte | Pantalla | Todos | Comunicarse con la tienda o soporte | Centro de ayuda; Detalle de pedido | Iniciar contacto | Expansión | No |
| Crear solicitud de soporte | Pantalla | Cliente, empleado o administrador | Documentar un problema y adjuntar evidencia | Contacto; incidencia | Enviar solicitud | Expansión | Parcial: formulario de incidencias |
| Mis solicitudes de soporte | Pantalla | Usuario solicitante | Consultar estado y respuestas de soporte | Perfil; Centro de ayuda | Abrir solicitud | Expansión | Sí: lista y estados de E4 |
| Acerca de Coguana | Pantalla | Todos | Mostrar versión, tienda y canales oficiales | Perfil; Configuración | Consultar información | Expansión | Parcial: identidad visual de E1 |
| Facturación electrónica y SUNAT | Integración externa | Administrador y propietario | Emitir, consultar y anular comprobantes electrónicos según SUNAT | Cobro de venta; Detalle de venta; Configuración de tienda | Emitir comprobante electrónico | Expansión | Parcial: Comprobante de venta; requiere proveedor o API SUNAT |

## Orden recomendado de construcción

1. Completar el **MVP interno** primero como demostración SQLite de un dispositivo y después habilitar Supabase/PostgreSQL y sincronización como requisito de entrada al piloto real.
2. Construir **Venta online minorista** sobre el catálogo y los cálculos ya validados, incluyendo el ajuste por peso final.
3. Reutilizar esa base para **Restaurantes y mayoristas**, evitando duplicar catálogo, carrito y pedidos.
4. Añadir **Delivery propio** antes de automatizar operadores externos.
5. Incorporar la **Expansión** cuando la operación principal genere datos suficientes para justificar SUNAT, reportes avanzados, soporte y múltiples sucursales.

Ninguna entrega posterior debe ampliar el MVP interno antes de que sus 22 interfaces funcionen como un recorrido completo y recuperable.
