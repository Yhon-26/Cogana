import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DemoPaymentValidationAdapter } from '../database/payment-validation';

test('mock aprueba Yape y normaliza espacios o guiones', async () => {
  const adapter = new DemoPaymentValidationAdapter();
  const result = await adapter.validate({
    method: 'yape',
    amountCents: 1250,
    reference: '123-456 789',
  });

  assert.equal(result.status, 'approved');
  assert.equal(result.provider, 'demo');
  assert.equal(result.normalizedReference, '123456789');
  assert.match(result.validationId, /^DEMO-YAPE-123456789-1250$/);
});

test('mock rechaza referencias terminadas en 000 de forma determinista', async () => {
  const adapter = new DemoPaymentValidationAdapter();
  const result = await adapter.validate({
    method: 'plin',
    amountCents: 500,
    reference: '654321000',
  });

  assert.equal(result.status, 'rejected');
  assert.match(result.message, /rechazó/);
});

test('mock rechaza monto o referencia inválidos antes de simular', async () => {
  const adapter = new DemoPaymentValidationAdapter();
  await assert.rejects(
    adapter.validate({ method: 'yape', amountCents: 0, reference: '123456' }),
    /mayor que cero/
  );
  await assert.rejects(
    adapter.validate({ method: 'plin', amountCents: 100, reference: 'ABC' }),
    /6 y 12 dígitos/
  );
});
