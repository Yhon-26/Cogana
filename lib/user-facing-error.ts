type ErrorRecord = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

function readError(error: unknown) {
  if (error instanceof Error) {
    const record = error as Error & ErrorRecord;
    return {
      message: error.message.trim(),
      code: typeof record.code === 'string' ? record.code : '',
      status:
        typeof record.status === 'number'
          ? record.status
          : typeof record.statusCode === 'number'
            ? record.statusCode
            : 0,
    };
  }
  if (error && typeof error === 'object') {
    const record = error as ErrorRecord;
    return {
      message: typeof record.message === 'string' ? record.message.trim() : '',
      code: typeof record.code === 'string' ? record.code : '',
      status:
        typeof record.status === 'number'
          ? record.status
          : typeof record.statusCode === 'number'
            ? record.statusCode
            : 0,
    };
  }
  return {
    message: typeof error === 'string' ? error.trim() : '',
    code: '',
    status: 0,
  };
}

export function getUserFacingErrorMessage(
  error: unknown,
  fallback = 'No pudimos completar la operación. Inténtalo nuevamente.'
) {
  const { message, code, status } = readError(error);
  const searchable = `${code} ${message}`;

  if (
    /network request failed|failed to fetch|fetch failed|networkerror|load failed|connection (?:failed|refused)|offline/i.test(
      searchable
    )
  ) {
    return 'No pudimos conectarnos. Revisa tu conexión a internet e inténtalo nuevamente.';
  }
  if (/timed? out|timeout|aborterror|request aborted/i.test(searchable)) {
    return 'La operación tardó demasiado. Inténtalo nuevamente.';
  }
  if (
    status === 401 ||
    /jwt expired|invalid jwt|not authenticated|authentication required/i.test(searchable)
  ) {
    return 'Tu sesión venció. Inicia sesión nuevamente.';
  }
  if (
    status === 403 ||
    /row-level security|violates row-level security|permission denied|not authorized|42501/i.test(
      searchable
    )
  ) {
    return 'No tienes permiso para realizar esta acción.';
  }
  if (status === 409 || /conflict|version conflict|optimistic/i.test(searchable)) {
    return 'Los datos cambiaron mientras trabajabas. Actualiza e inténtalo nuevamente.';
  }
  if (status === 429 || /rate limit|too many requests/i.test(searchable)) {
    return 'Hay demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
  }
  if (
    status >= 500 ||
    /service unavailable|bad gateway|gateway timeout|internal server error/i.test(searchable)
  ) {
    return 'El servicio no está disponible temporalmente. Inténtalo más tarde.';
  }

  return fallback;
}

const SAFE_OPERATIONAL_MESSAGE =
  /^(Administrar |Agrega |Cada |Configura |Describe |No |La |El |Los |Las |Ingresa |Inicia |Selecciona |Indica |Debes |Debe |Registra |Revisa |Solo |Uno |Una |Ya |Esta |Este |Stock |Caja |Venta |Pedido |Producto |Proveedor |Cantidad |Monto |Motivo |Fecha |Turno |Usuario )/i;
const INTERNAL_DETAIL =
  /\b(sql|select|insert|update|delete|constraint|column|relation|schema|postgres|supabase|rpc|service_role|stack trace|https?:\/\/)\b/i;

export function getOperatorErrorMessage(error: unknown, fallback: string) {
  const infrastructureMessage = getUserFacingErrorMessage(error, '');
  if (infrastructureMessage) return infrastructureMessage;

  const { message } = readError(error);
  if (
    message.length > 0 &&
    message.length <= 240 &&
    SAFE_OPERATIONAL_MESSAGE.test(message) &&
    !INTERNAL_DETAIL.test(message)
  ) {
    return message;
  }

  return fallback;
}
