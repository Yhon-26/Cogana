export type CustomerSignUpInput = {
  name: string;
  phone: string;
  email: string;
  password: string;
  acceptedTerms: boolean;
};

export type ValidCustomerSignUpInput = Omit<
  CustomerSignUpInput,
  'acceptedTerms'
> & {
  acceptedTerms: true;
};

export function normalizeCustomerEmail(value: string) {
  const email = value.trim().toLocaleLowerCase('en-US');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Ingresa un correo válido.');
  }
  return email;
}

export function normalizeCustomerPhone(value: string) {
  const phone = value.trim().replace(/[^\d+]/g, '');
  if (!/^\+?\d{7,15}$/.test(phone)) {
    throw new Error('Ingresa un teléfono válido.');
  }
  return phone;
}

export function validateCustomerSignUp(
  input: CustomerSignUpInput
): ValidCustomerSignUpInput {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2) {
    throw new Error('Ingresa tu nombre completo.');
  }
  if (input.password.length < 8) {
    throw new Error('La contraseña debe tener al menos 8 caracteres.');
  }
  if (!input.acceptedTerms) {
    throw new Error('Debes aceptar los términos y la política de privacidad.');
  }
  return {
    name,
    phone: normalizeCustomerPhone(input.phone),
    email: normalizeCustomerEmail(input.email),
    password: input.password,
    acceptedTerms: true,
  };
}
