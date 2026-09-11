import { describe, expect, it } from 'vitest';

import type { AppSettingRow, SettingScope } from '../repositories/app-setting.repository';
import {
  SCOPE_PRECEDENCE,
  featureKey,
  pickByPrecedence,
  scopesToQuery,
  trackingUrlFor,
} from './setting-store.service';

/**
 * Las partes PURAS del store: que ambitos se consultan y cual gana. La
 * resolucion contra la base la cubre `setting-store.integration.test.ts`;
 * aca se fija la regla sin PostgreSQL.
 */

const TIER = '11111111-1111-4111-8111-111111111111';
const CATEGORIA = '22222222-2222-4222-8222-222222222222';

function fila(scope: SettingScope, value: unknown, scopeId: string | null = null): AppSettingRow {
  return {
    id: `id-${scope}`,
    scope,
    scopeId,
    key: 'listing_max_images',
    value,
    valueType: 'number',
    version: 1,
    updatedBy: null,
    createdAt: new Date('2026-09-11T00:00:00Z'),
    updatedAt: null,
  };
}

describe('SCOPE_PRECEDENCE', () => {
  it('va de lo especifico a lo general y termina en global', () => {
    expect(SCOPE_PRECEDENCE).toEqual(['seller_tier', 'category', 'global']);
    expect(SCOPE_PRECEDENCE.at(-1)).toBe('global');
  });
});

describe('scopesToQuery', () => {
  it('sin contexto consulta solo la global', () => {
    expect(scopesToQuery('dispatch_deadline_hours', {})).toEqual([{ scope: 'global' }]);
  });

  it('agrega el tier cuando la clave lo admite', () => {
    expect(scopesToQuery('dispatch_deadline_hours', { sellerTierId: TIER })).toEqual([
      { scope: 'seller_tier', scopeId: TIER },
      { scope: 'global' },
    ]);
  });

  it('⚠️ IGNORA el tier cuando la clave no lo admite, aunque venga en el contexto', () => {
    // Una fila de tier colada a mano para una clave de plataforma no puede
    // cambiar lo que lee todo el mundo.
    expect(scopesToQuery('payment_window_minutes', { sellerTierId: TIER })).toEqual([
      { scope: 'global' },
    ]);
  });

  it('agrega la categoria solo a las claves que la admiten', () => {
    expect(scopesToQuery('listing_max_images', { categoryId: CATEGORIA })).toEqual([
      { scope: 'category', scopeId: CATEGORIA },
      { scope: 'global' },
    ]);
    expect(scopesToQuery('dispatch_deadline_hours', { categoryId: CATEGORIA })).toEqual([
      { scope: 'global' },
    ]);
  });

  it('con los dos ids consulta los tres ambitos', () => {
    expect(
      scopesToQuery('listing_max_images', { sellerTierId: TIER, categoryId: CATEGORIA }),
    ).toEqual([
      { scope: 'seller_tier', scopeId: TIER },
      { scope: 'category', scopeId: CATEGORIA },
      { scope: 'global' },
    ]);
  });

  it('null y undefined no son ids: `seller_tier_id` nullable se pasa tal cual', () => {
    expect(
      scopesToQuery('listing_max_images', { sellerTierId: null, categoryId: undefined }),
    ).toEqual([{ scope: 'global' }]);
  });
});

describe('pickByPrecedence', () => {
  it('el tier le gana a la categoria y la categoria a la global', () => {
    const vigentes = new Map<SettingScope, AppSettingRow>([
      ['global', fila('global', 8)],
      ['category', fila('category', 12, CATEGORIA)],
      ['seller_tier', fila('seller_tier', 10, TIER)],
    ]);

    expect(pickByPrecedence(vigentes)?.value).toBe(10);

    vigentes.delete('seller_tier');
    expect(pickByPrecedence(vigentes)?.value).toBe(12);

    vigentes.delete('category');
    expect(pickByPrecedence(vigentes)?.value).toBe(8);
  });

  it('sin filas no hay ganador', () => {
    expect(pickByPrecedence(new Map())).toBeUndefined();
  });
});

describe('featureKey', () => {
  it('arma la clave del flag a partir del nombre visible', () => {
    expect(featureKey('promotions')).toBe('feature_promotions');
    expect(featureKey('cart')).toBe('feature_cart');
  });
});

describe('trackingUrlFor', () => {
  const andreani = {
    code: 'andreani',
    name: 'Andreani',
    trackingUrlTemplate: 'https://seguimiento.test/envio/{tracking}',
  };

  it('reemplaza el marcador por el numero', () => {
    expect(trackingUrlFor(andreani, 'AB123')).toBe('https://seguimiento.test/envio/AB123');
  });

  it('⚠️ codifica el numero: lo escribio el vendedor y termina en un href', () => {
    expect(trackingUrlFor(andreani, ' a/b?c=1&d ')).toBe(
      'https://seguimiento.test/envio/a%2Fb%3Fc%3D1%26d',
    );
  });

  it('sin plantilla no hay enlace', () => {
    expect(trackingUrlFor({ ...andreani, trackingUrlTemplate: null }, 'AB123')).toBeNull();
  });

  it('reemplaza todas las apariciones del marcador', () => {
    expect(
      trackingUrlFor(
        { ...andreani, trackingUrlTemplate: 'https://s.test/{tracking}?n={tracking}' },
        'X',
      ),
    ).toBe('https://s.test/X?n=X');
  });
});
