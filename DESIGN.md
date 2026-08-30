---
version: alpha
name: Coguana
description: Sistema móvil cálido y operativo para vender, controlar y repartir abarrotes pesables en tiempo real.
colors:
  ink: "#132019"
  ink-soft: "#1D2D23"
  green: "#2E7546"
  green-dark: "#1D5634"
  green-mid: "#D4E8D8"
  green-light: "#E8F3EA"
  gold: "#F0B43C"
  gold-dark: "#9B6912"
  gold-light: "#FFF2CD"
  cream: "#F8F6EF"
  sand: "#EFE9DC"
  white: "#FFFFFF"
  surface-muted: "#F0F2ED"
  text: "#17231B"
  muted: "#5F6B62"
  muted-light: "#8A948C"
  line: "#E1E5DE"
  line-strong: "#CBD2CA"
  danger: "#A23F37"
  danger-light: "#FBEAE7"
  warning: "#836115"
  success: "#237142"
typography:
  display:
    fontSize: "34px"
    fontWeight: 800
    lineHeight: "40px"
  h1:
    fontSize: "28px"
    fontWeight: 800
    lineHeight: "34px"
  h2:
    fontSize: "22px"
    fontWeight: 800
    lineHeight: "28px"
  h3:
    fontSize: "18px"
    fontWeight: 700
    lineHeight: "24px"
  body-large:
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  body:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "21px"
  label:
    fontSize: "13px"
    fontWeight: 700
    lineHeight: "18px"
  caption:
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
  overline:
    fontSize: "11px"
    fontWeight: 800
    lineHeight: "14px"
    letterSpacing: "1.4px"
rounded:
  sm: "10px"
  md: "14px"
  lg: "18px"
  xl: "24px"
  round: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  xxl: "32px"
  xxxl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "56px"
  button-accent:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "56px"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.green-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "56px"
  button-ghost:
    backgroundColor: "{colors.green-light}"
    textColor: "{colors.green-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "56px"
  button-compact:
    backgroundColor: "{colors.green}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "48px"
  card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input-default:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text}"
    rounded: "13px"
    padding: "0 13px"
    height: "48px"
  pill-green:
    backgroundColor: "{colors.green-light}"
    textColor: "{colors.green-dark}"
    typography: "{typography.caption}"
    rounded: "{rounded.round}"
    padding: "5px 10px"
  pill-gold:
    backgroundColor: "{colors.gold-light}"
    textColor: "{colors.warning}"
    typography: "{typography.caption}"
    rounded: "{rounded.round}"
    padding: "5px 10px"
  pill-danger:
    backgroundColor: "{colors.danger-light}"
    textColor: "{colors.danger}"
    typography: "{typography.caption}"
    rounded: "{rounded.round}"
    padding: "5px 10px"
  pill-neutral:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.round}"
    padding: "5px 10px"
  navigation-item-active:
    backgroundColor: "{colors.green-light}"
    textColor: "{colors.green-dark}"
    rounded: "16px"
    height: "58px"
  quantity-stepper:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "4px"
    height: "48px"
  product-visual-default:
    backgroundColor: "{colors.green-light}"
    textColor: "{colors.green}"
    rounded: "19px"
    size: "64px"
---

# Design System: Coguana

## Overview

**Creative North Star: "La Despensa Viva"**

La Despensa Viva convierte el ritmo de una tienda de abarrotes en una interfaz cálida y precisa: fondos crema como espacio de trabajo, superficies blancas para contener tareas, verdes de cosecha para la acción y dorados de grano para el énfasis comercial. Debe sentirse natural, cálida, confiable, ágil y ordenada; nunca fría o corporativa, rústica o improvisada, ni intercambiable con un SaaS genérico.

La densidad cambia con la audiencia. La operación interna es compacta y orientada a cifras; la experiencia de compra respira más, pero ambas comparten geometría suave, tipografía de sistema, iconos consistentes y estados cromáticos inequívocos. El logo oficial aporta hojas, grano, lima, dorado y una base oscura; la interfaz actual traduce esa energía a un verde bosque más sobrio y reserva la caligrafía para la marca, no para controles.

Este documento carboniza el sistema compartido que existe en constants/theme.ts y en los componentes comunes. Las variantes locales de tamaño, peso, radio y espaciado que aparecen en pantallas antiguas son deuda de consolidación, no nuevos tokens. El logo oficial facilitado sigue fuera del repositorio y la app aún muestra un brote genérico como marca temporal.

**Key Characteristics:**

- Lienzo cálido y claro con superficies blancas de trabajo.
- Verde de cosecha para acciones, verde pálido para selección y oro para énfasis comercial selectivo.
- Tipografía nativa de sistema con jerarquía operativa firme.
- Geometría suave y controles táctiles de 48–56 px.
- Capas tonales con elevación estructural escasa.

## Colors

La paleta Cosecha equilibra naturalidad y control: verdes confiables dirigen la operación, el oro llama la atención con moderación y los neutros cálidos reducen la fatiga visual.

### Primary

- **Verde Cosecha** (green, #2E7546): acción primaria, controles activos y énfasis de marca funcional.
- **Verde Profundo** (green-dark, #1D5634): cabeceras operativas, iconos destacados y texto sobre selecciones claras.
- **Verde Cosecha Medio** (green-mid, #D4E8D8): apoyo tonal ocasional y transiciones suaves dentro de la familia verde.
- **Rocío Verde** (green-light, #E8F3EA): selecciones, estados positivos suaves, chips y fondos de navegación activa.

### Secondary

- **Oro Grano** (gold, #F0B43C): llamadas comerciales, insignias de carrito y énfasis excepcional.
- **Oro Tostado** (gold-dark, #9B6912): iconos y texto sobre fondos dorados claros.
- **Luz de Grano** (gold-light, #FFF2CD): advertencias no destructivas y superficies de atención.

### Neutral

- **Tinta Semilla** (ink, #132019) y **Tinta Semilla Suave** (ink-soft, #1D2D23): profundidad oscura, overlays y contenido de alto contraste.
- **Crema Saco** (cream, #F8F6EF): lienzo principal de la aplicación.
- **Arena de Yute** (sand, #EFE9DC): superficie cálida alternativa y visuales de producto.
- **Blanco Mostrador** (white, #FFFFFF): tarjetas, campos, docks y controles elevados.
- **Superficie Hoja** (surface-muted, #F0F2ED): controles secundarios, stepper y estados neutros.
- **Texto Semilla** (text, #17231B): texto principal; **Verde Ceniza** (muted, #5F6B62) y **Ceniza Suave** (muted-light, #8A948C): texto secundario.
- **Línea Hoja** (line, #E1E5DE) y **Línea Firme** (line-strong, #CBD2CA): divisores, bordes y separación estructural.
- **Rojo Corrección** (danger, #A23F37), **Rubor de Error** (danger-light, #FBEAE7), **Ocre Alerta** (warning, #836115) y **Verde Confirmación** (success, #237142): estados semánticos que siempre conservan texto o icono explicativo.

**The Harvest Hierarchy Rule.** El verde dirige la tarea; el oro destaca una oportunidad, total o advertencia. No deben competir como dos acciones primarias en el mismo bloque.

**The Logo Accent Rule.** El lima luminoso y los acabados tridimensionales pertenecen hoy al logo oficial. No se convierten en colores o efectos generales de interfaz sin una actualización deliberada de los tokens.

## Typography

**Display Font:** fuente sans-serif nativa del sistema — Roboto en Android, SF Pro en iOS y system-ui en web.

**Body Font:** la misma fuente sans-serif nativa para reducir carga, mantener rendimiento y respetar convenciones de plataforma.

**Character:** directa, legible y firme. La jerarquía depende de tamaño, peso y espacio, no de mezclar familias; la caligrafía del logotipo queda reservada al activo de marca.

### Hierarchy

- **Display** (800, 34/40 px): bienvenida, total dominante o mensaje excepcional.
- **H1** (800, 28/34 px): título principal de pantalla.
- **H2** (800, 22/28 px): encabezado mayor dentro de una superficie.
- **H3** (700, 18/24 px): título de sección o tarjeta destacada.
- **Body Large** (400, 16/24 px): introducciones y mensajes de orientación.
- **Body** (400, 14/21 px): lectura y formularios.
- **Label** (700, 13/18 px): botones, valores breves y acciones.
- **Caption** (500, 12/16 px): metadatos, ayudas y estados secundarios.
- **Overline** (800, 11/14 px, tracking 1.4 px): contexto breve en mayúsculas sobre títulos.

La escala declarada llega hasta peso 800. Los pesos 900 y textos de 7–10 px presentes en rutas locales son variantes heredadas y no deben propagarse a componentes nuevos.

**The Wordmark Boundary Rule.** La caligrafía de Coguana vive dentro del logo; toda interfaz, cifra, etiqueta y navegación usa tipografía de sistema.

**The Numbers First Rule.** Peso, unidad, precio y total mantienen tamaño y contraste suficientes para decidir de un vistazo; el texto auxiliar nunca desplaza la cifra operativa.

## Layout

El sistema parte de una retícula de 4 px y usa con mayor frecuencia 8, 12, 16, 20 y 24 px. Las pantallas son fluidas, centradas y de una sola columna: hasta 840 px para operación interna, 720 px para comercio y 760 px para bienvenida. En móvil, los márgenes habituales son 16–20 px y las agrupaciones repiten el mismo valor como gap e inset para conservar ritmo.

La aplicación prioriza retrato y usa tres clases de ancho compartidas: compacta hasta 599 px, media entre 600 y 1023 px y expandida desde 1024 px. En compacta, la navegación principal permanece abajo; en expandida cambia a rail lateral y conserva los límites de 840 px para operación y 720 px para comercio. Safe areas laterales y del sistema se respetan también en paisaje, mientras las rejillas envuelven o apilan contenido con `flexBasis` y anchos mínimos en vez de estirar tarjetas indefinidamente.

El modo cómodo usa 20 px de padding y separación en la superficie administrativa; el modo compacto baja ambos a 12 px. La experiencia del cliente conserva más aire. Las acciones principales deben permanecer alcanzables y los controles nuevos deben usar 48 px como mínimo táctil, reservando 56 px para la acción dominante.

**The One-Hand Rhythm Rule.** La tarea principal y sus cifras caben en una lectura vertical predecible; las acciones críticas no se esconden detrás de densidad decorativa.

## Elevation & Depth

La profundidad combina capas tonales con elevación estructural. Crema, blanco, verde claro y líneas finas crean la mayor parte de la jerarquía; una tarjeta ordinaria permanece casi plana. Las sombras aparecen únicamente cuando un elemento debe separarse del flujo o mantenerse físicamente sobre él.

### Shadow Vocabulary

- **Ambient Card** (0 2px 10px rgba(19, 32, 25, 0.06)): elevación opcional para un dato o tarjeta que merece una capa adicional.
- **Dock Upward** (0 -3px 12px rgba(19, 32, 25, 0.08)): pie fijo o acción persistente sobre contenido desplazable.
- **Tab Upward** (0 -3px 10px rgba(19, 32, 25, 0.07)): navegación inferior del personal.

**The Structural Shadow Rule.** Una sombra explica superposición o persistencia; nunca se añade solo para adornar una tarjeta.

**The Tonal First Rule.** Antes de elevar, separar con crema, blanco, verde pálido, borde o espacio.

## Shapes

La forma es amable y táctil: 10 px para controles compactos, 14 px para botones y campos compartidos, 18 px para tarjetas, 24 px para cabeceras o superficies protagonistas y 999 px para píldoras. Los bordes son finos y neutros; la geometría evita tanto la rigidez corporativa como la ornamentación rústica.

Los visuales de producto usan bloques de color pastel, esquinas cercanas al 30 % de su tamaño y un pequeño círculo desplazado que aporta energía. Las variaciones locales de 11, 12, 13, 15, 16, 17, 20 y 22 px reflejan drift de implementación; un componente nuevo debe elegir el token más cercano salvo una razón funcional documentada.

**The Soft Utility Rule.** Las curvas facilitan exploración y tacto, pero nunca convierten datos operativos en burbujas decorativas.

## Components

### Buttons

Los botones son táctiles y confiados: etiqueta firme, área amplia y una sola intención visible.

- **Shape:** altura dominante de 56 px, compacta de 48 px, radio de 14 px y padding horizontal de 20 px.
- **Primary:** Verde Cosecha con texto blanco; se reserva para la siguiente acción real.
- **Accent:** Oro Grano con Tinta Semilla; se usa para compra, total o énfasis comercial, no como segundo primario.
- **Secondary:** blanco con borde Verde Cosecha y texto Verde Profundo.
- **Ghost:** Rocío Verde con texto Verde Profundo.
- **Pressed / Disabled:** presión mediante opacidad y escala 0.99; deshabilitado mediante opacidad cercana a 0.4 y estado accesible.

### Chips

- **Style:** píldoras completas con 10 px horizontales, 5 px verticales y Caption reforzada.
- **State:** verde para progreso o selección, oro para revisión, rojo para error o cancelación y neutro para estados cerrados. Texto e icono acompañan siempre al color.

### Cards / Containers

- **Corner Style:** radio de 18 px.
- **Background:** Blanco Mostrador sobre Crema Saco.
- **Shadow Strategy:** planas por defecto; Ambient Card solo para información destacada.
- **Border:** línea neutra de 1 px.
- **Internal Padding:** 16 px, con 12 px en contextos compactos.

### Inputs / Fields

- **Style:** altura mínima de 48 px, radio observado de 13 px, superficie blanca, borde neutro de 1 px y padding horizontal de 13 px.
- **Focus:** `ThemedTextInput` migra el borde a Verde Cosecha y añade un contorno visible sin alterar el tamaño del control.
- **Placeholder:** usa Verde Ceniza (`muted`) para conservar contraste AA; Ceniza Suave (`muted-light`) queda reservada para elementos visuales inactivos, no texto de campo.
- **Error / Disabled:** error en Rojo Corrección con ayuda textual; deshabilitado sobre gris verdoso claro y texto muted.

### Navigation

La navegación inferior usa una superficie blanca con borde superior y elevación ascendente. Los destinos activos reciben Rocío Verde, icono Verde Profundo y etiqueta reforzada; los inactivos permanecen en Verde Ceniza. El personal usa hasta cinco destinos y el cliente tres. Iconos y etiquetas permanecen juntos.

### Quantity Stepper

Un contenedor de 48 px en Superficie Hoja contiene botones blancos de 40 × 40 px, radio de 10 px y un valor centrado. Aumentar y disminuir tienen nombres accesibles y estados deshabilitados independientes.

### Product Visual

El visual de producto reemplaza fotografías ausentes con una ficha pastel por categoría, un icono Material Community y un acento circular translúcido. No simula una foto real ni mezcla estilos de iconografía.

### Modal Surface

`ModalSurface` es el contenedor estándar para diálogos y hojas inferiores: aplica el overlay semántico, respeta las cuatro safe areas, evita que el teclado cubra el contenido y limita el ancho del diálogo. El fondo puede cerrar solo mientras no exista una operación en curso; toda acción asíncrona bloquea el doble envío y comunica su estado ocupado. Con Reducir movimiento activo, la transición del modal se desactiva.

### Operational Lists

Inventario, pedidos y ventas usan tarjetas bordeadas o filas con divisores. Identidad y estado aparecen primero; unidad, cantidad, precio y acción siguen un orden estable. El estado seleccionado pasa a Rocío Verde con borde Verde Cosecha.

## Do's and Don'ts

### Do:

- **Do** usar Verde Cosecha para la siguiente acción real y Oro Grano para énfasis comercial selectivo.
- **Do** mantener peso, unidad, precio de referencia y total visibles como un conjunto.
- **Do** construir componentes nuevos con la escala declarada de color, espacio, radio y tipografía.
- **Do** mantener controles táctiles de al menos 48 px y comunicar estados con texto, icono y color.
- **Do** usar el logo oficial solo desde un archivo maestro limpio, autorizado y almacenado dentro del proyecto.
- **Do** respetar safe areas y la preferencia de reducción de movimiento en toda interacción nueva.

### Don't:

- **Don't** usar la caligrafía del logotipo como tipografía de interfaz.
- **Don't** convertir el lima brillante o los relieves 3D del logo en efectos generales sin actualizar primero los tokens.
- **Don't** añadir sombras a tarjetas planas que ya se separan mediante tono, borde o espacio.
- **Don't** crear nuevos tamaños de 7–10 px, pesos 900 o radios intermedios para resolver jerarquía.
- **Don't** presentar un modo oscuro: la implementación actual es únicamente clara.
- **Don't** publicar el JPG de referencia suministrado mientras conserve marcas de agua visibles.
