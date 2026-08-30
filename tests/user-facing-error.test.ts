import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getOperatorErrorMessage,
  getUserFacingErrorMessage,
} from '../lib/user-facing-error';

test('conserva instrucciones operativas y bloquea infraestructura', () => {
  assert.equal(
    getOperatorErrorMessage(
      new Error('Agrega productos a la orden.'),
      'No se pudo crear la orden.'
    ),
    'Agrega productos a la orden.'
  );
  assert.equal(
    getOperatorErrorMessage(
      new Error('Registra un código de recepción o una foto de evidencia.'),
      'No se pudo confirmar la entrega.'
    ),
    'Registra un código de recepción o una foto de evidencia.'
  );
  assert.equal(
    getOperatorErrorMessage(
      new Error('Configura Supabase con https://internal.example y service_role.'),
      'No se pudo cargar la configuración.'
    ),
    'No se pudo cargar la configuración.'
  );
});

test('traduce fallos de red y tiempo de espera', () => {
  assert.equal(
    getUserFacingErrorMessage(new Error('Network request failed')),
    'No pudimos conectarnos. Revisa tu conexión a internet e inténtalo nuevamente.'
  );
  assert.equal(
    getUserFacingErrorMessage(new Error('Request timed out')),
    'La operación tardó demasiado. Inténtalo nuevamente.'
  );
});

test('traduce sesión vencida y permisos RLS', () => {
  assert.equal(
    getUserFacingErrorMessage({ message: 'JWT expired', status: 401 }),
    'Tu sesión venció. Inicia sesión nuevamente.'
  );
  assert.equal(
    getUserFacingErrorMessage({ code: '42501', message: 'permission denied' }),
    'No tienes permiso para realizar esta acción.'
  );
});

test('traduce conflictos y exceso de solicitudes', () => {
  assert.equal(
    getUserFacingErrorMessage({ message: 'Conflict', status: 409 }),
    'Los datos cambiaron mientras trabajabas. Actualiza e inténtalo nuevamente.'
  );
  assert.equal(
    getUserFacingErrorMessage({ message: 'Too many requests', status: 429 }),
    'Hay demasiados intentos. Espera unos minutos y vuelve a intentarlo.'
  );
});

test('traduce indisponibilidad y oculta errores desconocidos', () => {
  assert.equal(
    getUserFacingErrorMessage({ message: 'Internal server error', status: 500 }),
    'El servicio no está disponible temporalmente. Inténtalo más tarde.'
  );
  assert.equal(
    getUserFacingErrorMessage(
      new Error('duplicate key value violates unique constraint customers_email_key'),
      'No se pudo guardar.'
    ),
    'No se pudo guardar.'
  );
});

test('conserva validaciones operativas en español', () => {
  assert.equal(
    getOperatorErrorMessage(
      new Error('No hay stock suficiente para completar la venta.'),
      'No se pudo registrar la venta.'
    ),
    'No hay stock suficiente para completar la venta.'
  );
});

test('oculta detalles internos incluso si el mensaje empieza en español', () => {
  assert.equal(
    getOperatorErrorMessage(
      new Error('La constraint sales_store_id_fkey falló en PostgreSQL.'),
      'No se pudo registrar la venta.'
    ),
    'No se pudo registrar la venta.'
  );
});
