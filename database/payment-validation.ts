import type { PaymentMethod } from './models';

export type DigitalPaymentMethod = Extract<PaymentMethod, 'yape' | 'plin'>;

export type PaymentValidationInput = {
  method: DigitalPaymentMethod;
  amountCents: number;
  reference: string;
};

export type PaymentValidationResult = {
  status: 'approved' | 'rejected';
  provider: 'demo';
  normalizedReference: string;
  validationId: string;
  validatedAt: string;
  message: string;
};

export interface PaymentValidationAdapter {
  validate(input: PaymentValidationInput): Promise<PaymentValidationResult>;
}

function normalizeReference(reference: string) {
  return reference.replace(/[\s-]/g, '');
}

export class DemoPaymentValidationAdapter implements PaymentValidationAdapter {
  async validate(input: PaymentValidationInput): Promise<PaymentValidationResult> {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error('El monto a validar debe ser mayor que cero.');
    }

    const normalizedReference = normalizeReference(input.reference);
    if (!/^\d{6,12}$/.test(normalizedReference)) {
      throw new Error('El código de operación debe contener entre 6 y 12 dígitos.');
    }

    const rejected = normalizedReference.endsWith('000');
    return {
      status: rejected ? 'rejected' : 'approved',
      provider: 'demo',
      normalizedReference,
      validationId: `DEMO-${input.method.toUpperCase()}-${normalizedReference}-${input.amountCents}`,
      validatedAt: new Date().toISOString(),
      message: rejected
        ? 'La simulación rechazó el código. Usa uno que no termine en 000.'
        : `Pago ${input.method === 'yape' ? 'Yape' : 'Plin'} aprobado en modo demostración.`,
    };
  }
}

export const demoPaymentValidationAdapter = new DemoPaymentValidationAdapter();
