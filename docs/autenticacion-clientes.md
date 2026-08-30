# Autenticación de clientes

La venta online usa una sesión Supabase separada de la sesión del operador. Una
cuenta minorista no desbloquea el POS y una cuenta interna no se reutiliza
automáticamente como cliente.

## Flujo implementado

1. La bienvenida dirige al acceso de compra o al panel interno.
2. El cliente inicia sesión o se registra con nombre, teléfono, correo,
   contraseña y consentimiento explícito.
3. Si el proyecto exige confirmar el correo, la app espera esa confirmación
   antes de crear el perfil comercial.
4. `claim_customer_account` vincula el `auth.uid()` con `customers`, o reclama
   un cliente invitado preexistente de la misma tienda por teléfono.
5. En Android/iOS solo se persiste el refresh token mediante Expo SecureStore.
   La contraseña nunca se guarda.
6. La ruta `/tienda` queda protegida hasta tener una sesión y un perfil de
   cliente válidos.

## Configuración

La app requiere únicamente variables públicas:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

El proveedor de correo de Supabase debe tener configuradas las URL de
confirmación del entorno antes de probar registros con verificación obligatoria.
La clave `service_role` no debe incluirse en la app.

## Seguridad

- La app no puede elegir el `auth_user_id`: el RPC siempre usa `auth.uid()`.
- Solo una cuenta autenticada con metadato `account_type=customer` puede crear
  su primer perfil minorista.
- `anon` no tiene permiso de ejecución sobre `claim_customer_account`.
- La unicidad por tienda evita vincular dos perfiles al mismo usuario.
- La sesión web queda solo en memoria; no se guarda el refresh token en
  almacenamiento web durante este corte.

## Alcance del corte

Este corte implementa bienvenida, elección de acceso, inicio de sesión,
registro, consentimiento, verificación por correo y cierre de sesión. Catálogo,
búsqueda, recuperación de contraseña y checkout pertenecen a los siguientes
cortes de venta online.
