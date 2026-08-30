export function formatSoles(cents: number): string {
  return `S/ ${(cents / 100).toFixed(2)}`;
}

export function formatSolesInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
