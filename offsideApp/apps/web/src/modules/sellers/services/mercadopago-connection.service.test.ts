import { describe, expect, it } from 'vitest';

import { canSell } from './mercadopago-connection.service';

/**
 * Predicado `can_sell` (mercadopago-oauth-spec.md §3).
 *
 * Se testea aparte porque es PURO y porque es la regla que decide si un
 * vendedor puede operar: equivocarse aca habilita a vender a quien no debe, o
 * bloquea a quien si puede.
 */

describe('canSell', () => {
  it('es verdadero solo con vendedor aprobado y conexion activa', () => {
    expect(canSell('approved', 'connected')).toBe(true);
  });

  it.each([
    ['pending', null],
    ['pending', 'connected'],
    ['approved', null],
    ['approved', 'expired'],
    ['approved', 'revoked'],
    ['approved', 'disconnected'],
    ['suspended', 'connected'],
    ['expelled', 'connected'],
  ] as const)('es falso para vendedor %s con conexion %s', (seller, mp) => {
    expect(canSell(seller, mp)).toBe(false);
  });

  it('NO habilita a vender a un vendedor `limited`, aunque tenga la conexion viva', () => {
    // El enum incluye `limited` pero la documentacion no define QUE limita
    // (spec §3, 🟡). Suponerlo seria inventar una regla de negocio; hasta que se
    // decida, `limited` no entra al predicado.
    expect(canSell('limited', 'connected')).toBe(false);
  });

  it('`pending` + `connected` no es un error, simplemente no habilita', () => {
    // Es alcanzable: la aprobacion puede revocarse despues de conectar (TS-011).
    expect(canSell('pending', 'connected')).toBe(false);
  });
});
