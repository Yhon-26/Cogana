# Despliegue de Coguana

Este documento separa la preparación reproducible incluida en el repositorio de
las acciones que requieren cuentas, credenciales o infraestructura externa.

## 1. Verificación local

Desde la raíz del proyecto:

```bash
npm install
npm run check
npm run export:android
npm run export:web
```

No se debe continuar si alguna comprobación falla.

## 2. Proyecto Supabase

1. Crear los entornos `development`, `staging` y `production`.
2. Instalar Supabase CLI y Docker en una estación de desarrollo.
3. Ejecutar `supabase start` y aplicar en orden todas las migraciones de
   `supabase/migrations/`.
4. Ejecutar todos los archivos pgTAP de `supabase/tests/`.
5. Enlazar el proyecto productivo con `supabase link --project-ref <ref>`.
6. Aplicar las migraciones con `supabase db push` después de revisar el diff.
7. Crear los usuarios internos, sus membresías y dispositivos autorizados.
8. Desplegar `delete-account` desde `supabase/functions/`; sus secretos
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` deben
   permanecer exclusivamente en el entorno de Edge Functions.
9. Configurar en EAS únicamente las variables públicas:

   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

La clave `service_role`, credenciales SUNAT, secretos de pagos y claves de
operadores logísticos pertenecen al backend; nunca a la app ni al repositorio.

## 3. Proyecto EAS

El archivo `eas.json` incluye un APK interno de prueba y builds de producción
con incremento automático. Antes del primer build:

```bash
npx eas-cli login
npx eas-cli build:configure
```

`build:configure` valida o vuelve a vincular el proyecto EAS configurado.

iOS y Android usan `com.yhonq.coguanaapp`; antes de publicar hay que confirmar
que será el identificador definitivo, porque no puede cambiarse después de crear
las fichas en las tiendas. Para iOS también se necesita una cuenta Apple
Developer.

La exportación web usa SQLite WASM. El host debe conservar los encabezados
`Cross-Origin-Opener-Policy: same-origin` y
`Cross-Origin-Embedder-Policy: credentialless` definidos en `public/_headers`.

## 4. Compilaciones

Build interno instalable:

```bash
npm run build:preview
```

Builds para tiendas:

```bash
npm run build:production
```

La compilación de producción necesita certificados de Apple y una clave de
firma Android. EAS puede administrarlos durante el flujo autenticado.

## 5. Validación previa a tiendas

- Probar instalación limpia y actualización desde una versión anterior.
- Probar operación offline, cierre forzado y recuperación.
- Probar push/pull con dos dispositivos y dos usuarios Supabase distintos.
- Confirmar RLS con cuentas `owner`, `admin`, `seller`, `driver` y cliente.
- Confirmar que una outbox rechazada sea visible y recuperable.
- Probar el permiso de cámara con una compilación nativa.
- Validar políticas de privacidad, términos, datos de contacto y eliminación
  de cuenta.
- Confirmar textos, precios, zonas, horarios y canales oficiales reales.

## 6. Publicación

Después de crear las fichas y cargar metadatos en App Store Connect y Google
Play Console:

```bash
npm run submit:production
```

La revisión y liberación final se realizan en las consolas de cada tienda. EAS
Submit no crea por sí solo todos los metadatos legales ni sustituye la revisión
de Apple o Google.

## 7. Integraciones externas pendientes de credenciales

- SUNAT o proveedor de facturación: URL, token, certificado y ambiente.
- Pasarela de pagos/tokenización: cuenta comercial, webhooks y claves.
- Mapas/ruteo: proveedor, clave y límites de uso.
- Operador logístico automático: contrato, API, webhooks y credenciales.

La base de configuración y los límites de seguridad ya están implementados. La
activación real debe hacerse con secretos del entorno productivo y pruebas de
aceptación del proveedor.
