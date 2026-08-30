const NETWORK_ERROR_PATTERN =
  /network request failed|failed to fetch|fetch failed|networkerror|load failed|timed? out|timeout|connection (?:failed|refused)|aborted/i;

const SAFE_VALIDATION_PATTERNS = [
  /^Ingresa /i,
  /^Acepta /i,
  /^Configura Supabase/i,
  /^Inicia sesión/i,
  /correo válido/i,
  /teléfono válido/i,
  /contraseña debe tener al menos 8 caracteres/i,
];

function readErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === 'string') return error.trim();
  return '';
}

export function isCustomerEmailConfirmationRequired(error: unknown) {
  return /email not confirmed|correo no confirmado/i.test(readErrorMessage(error));
}

export function getCustomerAuthErrorMessage(error: unknown) {
  const message = readErrorMessage(error);

  if (NETWORK_ERROR_PATTERN.test(message)) {
    return 'No pudimos conectarnos. Revisa tu conexión a internet e inténtalo nuevamente.';
  }
  if (/invalid login credentials|invalid email or password/i.test(message)) {
    return 'El correo o la contraseña no son correctos.';
  }
  if (/user already registered|already been registered|email already exists/i.test(message)) {
    return 'Ya existe una cuenta con este correo. Intenta iniciar sesión.';
  }
  if (/rate limit|too many requests|email rate limit exceeded/i.test(message)) {
    return 'Realizaste varios intentos. Espera unos minutos y vuelve a intentarlo.';
  }
  if (/password should be at least|weak password/i.test(message)) {
    return 'La contraseña debe tener al menos 8 caracteres.';
  }
  if (isCustomerEmailConfirmationRequired(error)) {
    return 'Confirma tu correo antes de iniciar sesión.';
  }
  if (SAFE_VALIDATION_PATTERNS.some((pattern) => pattern.test(message))) {
    return message;
  }

  return 'No se pudo completar la autenticación. Inténtalo nuevamente.';
}

export const getSupabaseAuthErrorMessage = getCustomerAuthErrorMessage;
