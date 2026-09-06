// Formateadores singleton: `new Intl.DateTimeFormat` es costoso y antes se
// reconstruía dentro de .map por cada fila en cada render. Estos se crean una
// sola vez por proceso y se reutilizan.

const shortDateTimeFormatter = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const fullDateTimeFormatter = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const longDateFormatter = new Intl.DateTimeFormat("es-PE", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const compactDateFormatter = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function formatDateShort(value: string | number | Date): string {
  return shortDateTimeFormatter.format(new Date(value));
}

export function formatDateTime(value: string | number | Date): string {
  return fullDateTimeFormatter.format(new Date(value));
}

export function formatDateLong(value: string | number | Date): string {
  return longDateFormatter.format(new Date(value));
}

export function formatDateCompact(value: string | number | Date): string {
  return compactDateFormatter.format(new Date(value));
}
