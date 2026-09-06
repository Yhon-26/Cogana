import { useEffect, useState } from "react";

/**
 * Devuelve el valor retrasado `delay` ms. El estado que consume el valor
 * (filtros de listas, búsquedas) solo se recalcula cuando el usuario deja de
 * escribir, evitando un render completo por carácter.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
