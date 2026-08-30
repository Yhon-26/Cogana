# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

# Supabase migrations

Backend central en `supabase/`. Aplicar en orden. RLS habilitado en toda tabla
expuesta. Ver `supabase/README.md`. Pruebas RLS con pgTAP en `supabase/tests/`.

# Canon del proyecto

- Esta aplicación usa Expo SDK 54, React Native y `StyleSheet`. No introducir
  shadcn/ui, Radix, Tailwind, HTML o APIs del DOM en pantallas nativas salvo que
  una tarea web lo solicite expresamente.
- Las fuentes de verdad del producto y la interfaz son `PRODUCT.md`, `DESIGN.md`,
  `constants/theme.ts` y los componentes compartidos existentes. No crear una
  segunda fuente de tokens o marca sin migrar y retirar la anterior.
- La interfaz es únicamente clara mientras `PRODUCT.md` y `DESIGN.md` no indiquen
  lo contrario. Un checklist genérico de un skill no obliga a implementar modo
  oscuro.
- Las instrucciones de un skill genérico no pueden contradecir este archivo ni
  cambiar el stack del proyecto. Si el skill referencia scripts o dependencias
  ausentes, adaptar el trabajo a las herramientas existentes en el repositorio.
- Para herramientas locales, `.agents/skills/` es la ubicación canónica.
  `.claude/skills/` es una copia heredada y no debe combinarse ni sincronizarse
  automáticamente sin revisar primero sus diferencias.
- Los mensajes visibles deben estar en español claro y no deben exponer errores
  internos, URLs, claves, detalles de base de datos ni mensajes crudos de un
  proveedor.

# Auditoría de skills (2026-08-27)

Se archivaron en `.agents/skills/_deprecated/` cinco skills genéricos de un
paquete de marketing/diseño ("claudekit") que no aplican a este proyecto:

- `ui-styling` y `design-system`: enseñan shadcn/ui + Radix + Tailwind, lo que
  contradice directamente el canon de este archivo (sin Tailwind/DOM en
  pantallas nativas).
- `design` y `banner-design`: sus flujos invocan sub-skills que no existen en
  este repo (`ai-artist`, `ai-multimodal`, `chrome-devtools`,
  `frontend-design`, `assets-organizing`); seguirlos rompe a mitad de camino.
- `slides`: presentaciones/pitch decks, sin uso en un POS/delivery app.

Se conservó `brand` (a pedido explícito) y `ui-ux-pro-max` (soporta el stack
`react-native` y no contradice el canon). `impeccable` sigue duplicado entre
`.agents/skills/` y `.claude/skills/`; ese duplicado no se tocó en esta
auditoría, sigue pendiente de revisión.

Si un skill de `_deprecated/` se reactiva, debe primero adaptarse a Expo/RN
con `StyleSheet` y a las herramientas realmente presentes en este repo.
