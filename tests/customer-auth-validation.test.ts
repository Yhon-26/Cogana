import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  validateCustomerSignUp,
} from '../auth/customer-auth-validation';
import {
  getCustomerAuthErrorMessage,
  getSupabaseAuthErrorMessage,
  isCustomerEmailConfirmationRequired,
} from '../auth/customer-auth-error';

test('normaliza el correo y el teléfono del cliente', () => {
  assert.equal(
    normalizeCustomerEmail('  CLIENTE@COGUANA.PE '),
    'cliente@coguana.pe'
  );
  assert.equal(normalizeCustomerPhone('(+51) 999-888-777'), '+51999888777');
});

test('valida y limpia los datos del registro minorista', () => {
  const result = validateCustomerSignUp({
    name: '  Ana   Torres  ',
    phone: '999 888 777',
    email: 'ANA@EXAMPLE.COM',
    password: 'segura-123',
    acceptedTerms: true,
  });

  assert.deepEqual(result, {
    name: 'Ana Torres',
    phone: '999888777',
    email: 'ana@example.com',
    password: 'segura-123',
    acceptedTerms: true,
  });
});

test('rechaza correo, teléfono y contraseña inválidos', () => {
  assert.throws(() => normalizeCustomerEmail('correo-invalido'), /correo válido/);
  assert.throws(() => normalizeCustomerPhone('123'), /teléfono válido/);
  assert.throws(
    () =>
      validateCustomerSignUp({
        name: 'Ana Torres',
        phone: '999888777',
        email: 'ana@example.com',
        password: 'corta',
        acceptedTerms: true,
      }),
    /8 caracteres/
  );
});

test('exige consentimiento explícito para crear la cuenta', () => {
  assert.throws(
    () =>
      validateCustomerSignUp({
        name: 'Ana Torres',
        phone: '999888777',
        email: 'ana@example.com',
        password: 'segura-123',
        acceptedTerms: false,
      }),
    /aceptar los términos/
  );
});

test('traduce fallos de red sin exponer el mensaje técnico', () => {
  assert.equal(
    getCustomerAuthErrorMessage(new Error('Network request failed')),
    'No pudimos conectarnos. Revisa tu conexión a internet e inténtalo nuevamente.'
  );
});

test('traduce errores frecuentes de Supabase', () => {
  assert.equal(
    getCustomerAuthErrorMessage(new Error('Invalid login credentials')),
    'El correo o la contraseña no son correctos.'
  );
  assert.equal(
    getCustomerAuthErrorMessage(new Error('User already registered')),
    'Ya existe una cuenta con este correo. Intenta iniciar sesión.'
  );
});

test('protege también los errores de acceso de operadores', () => {
  assert.equal(
    getSupabaseAuthErrorMessage(new Error('Invalid login credentials')),
    'El correo o la contraseña no son correctos.'
  );
  assert.equal(
    getSupabaseAuthErrorMessage(new Error('relation memberships does not exist')),
    'No se pudo completar la autenticación. Inténtalo nuevamente.'
  );
});

test('conserva validaciones locales y oculta errores desconocidos', () => {
  assert.equal(
    getCustomerAuthErrorMessage(new Error('Ingresa tu contraseña.')),
    'Ingresa tu contraseña.'
  );
  assert.equal(
    getCustomerAuthErrorMessage(new Error('internal database detail')),
    'No se pudo completar la autenticación. Inténtalo nuevamente.'
  );
});

test('detecta el estado de correo pendiente de confirmación', () => {
  assert.equal(
    isCustomerEmailConfirmationRequired(new Error('Email not confirmed')),
    true
  );
});
