import type { LocalUserRecord } from '../database/models';
import type { RolePermission } from '../database/repositories/personnel-operations-repository';

export const DEFAULT_SELLER_MODULES = new Set([
  'venta',
  'inventario',
  'pedidos',
  'repartos',
  'scanner',
  'sincronizacion',
  'soporte',
  'mas',
]);

export function operatorModuleFromPath(pathname: string) {
  return pathname.split('/').filter(Boolean)[0] ?? 'panel';
}

export function canAccessOperatorRoute(
  user: LocalUserRecord | null,
  pathname: string,
  permissions: readonly RolePermission[]
) {
  const module = operatorModuleFromPath(pathname);
  if (module === 'panel') return true;
  if (!user) return false;
  if (user.role === 'administrator') return true;
  const configured = permissions.find(
    (permission) =>
      permission.role === user.role && permission.module === module
  );
  return configured?.canView ?? DEFAULT_SELLER_MODULES.has(module);
}
