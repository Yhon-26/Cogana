import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canAccessOperatorRoute } from '../auth/operator-route-access';
import type { LocalUserRecord } from '../database/models';

const baseUser: LocalUserRecord = {
  id: 'user-1',
  storeId: 'store-1',
  authUserId: 'auth-1',
  displayName: 'Operador',
  role: 'seller',
  hasPin: true,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
};

test('solo panel queda disponible sin operador desbloqueado', () => {
  assert.equal(canAccessOperatorRoute(null, '/panel', []), true);
  assert.equal(canAccessOperatorRoute(null, '/reportes', []), false);
});

test('el vendedor usa defaults y respeta denegaciones explicitas', () => {
  assert.equal(canAccessOperatorRoute(baseUser, '/venta', []), true);
  assert.equal(canAccessOperatorRoute(baseUser, '/reportes', []), false);
  assert.equal(
    canAccessOperatorRoute(baseUser, '/venta', [
      {
        id: 'permission-1',
        role: 'seller',
        module: 'venta',
        canView: false,
        canManage: false,
        version: 1,
      },
    ]),
    false
  );
});

test('el administrador puede abrir cualquier modulo interno', () => {
  assert.equal(
    canAccessOperatorRoute(
      { ...baseUser, role: 'administrator' },
      '/configuracion',
      []
    ),
    true
  );
});
