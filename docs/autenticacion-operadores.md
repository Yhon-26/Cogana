# Autenticación de operadores

DT-03 usa una sesión Supabase individual por operador y mantiene el PIN como
credencial exclusivamente local.

## Provisionamiento

1. Crear cada cuenta interna en Supabase Auth con correo individual. No guardar
   contraseñas en SQL, seeds, variables públicas ni Git.
2. Confirmar que el trigger de B1 creó su fila en `profiles`.
3. Crear una membresía activa en `store_memberships`:
   - administrador local → `owner` o `admin`;
   - vendedor local → `seller`.
4. Autorizar el dispositivo en `devices` para la misma tienda.
5. Configurar en la app:

   ```bash
   EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
   ```

La tienda demo usa el UUID `00000000-0000-4000-8000-000000000001` tanto en
SQLite como en `supabase/seed.sql`.

## Flujo en el dispositivo

1. El operador selecciona su usuario e ingresa o crea su PIN local.
2. En línea, pulsa **Vincular** e ingresa una vez su correo y contraseña
   Supabase.
3. La app valida con `get_my_operator_context` que identidad, tienda y rol
   coincidan.
4. La contraseña se descarta. Solo el refresh token queda en Expo SecureStore,
   separado por operador.
5. Al volver a usar el PIN, la app intenta renovar su sesión. Si no hay red,
   habilita la operación SQLite y deja la sincronización pendiente.

## Autoría de sincronización

`sync_outbox.actor_user_id` identifica al operador local que creó cada evento.
Una sesión Supabase solo selecciona y empuja la outbox de ese operador. Esto
evita que cambiar de usuario atribuya ventas o movimientos pendientes a la
cuenta equivocada.

Cuando existen dependencias entre operadores, se sincronizan en orden causal.
Por ejemplo, si el administrador abrió la caja y un vendedor registró ventas,
primero debe sincronizarse la apertura con la cuenta del administrador.

## Seguridad

- El PIN, su hash y su sal nunca salen de SQLite.
- El cliente móvil usa únicamente la publishable key.
- `service_role` está prohibida en la app.
- El vínculo seguro se habilita en Android/iOS; no persiste refresh tokens en
  almacenamiento web.
- Revocar una membresía o un dispositivo bloquea los RPC aunque el teléfono aún
  conserve datos offline.
