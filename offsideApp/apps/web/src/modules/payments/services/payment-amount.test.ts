import { describe, expect, it } from 'vitest';

import { importeDeLaPreferencia, verificarImporte } from './payment-amount';

const items = [
  { unitPriceAmount: 4_000_000n, quantity: 2, currency: 'ARS' },
  { unitPriceAmount: 2_000_000n, quantity: 1, currency: 'ARS' },
];

describe('importeDeLaPreferencia', () => {
  it('suma precio × cantidad de cada item', () => {
    expect(importeDeLaPreferencia(items)).toBe(10_000_000n);
  });
});

describe('verificarImporte', () => {
  it('acepta el pago que cubre exactamente lo cobrado', () => {
    expect(verificarImporte({ amountCents: 10_000_000n, currency: 'ARS' }, items, 'ARS')).toEqual({
      ok: true,
    });
  });

  it('⚠️ RECHAZA un pago menor: un cobro de $1 no paga una orden de $100.000', () => {
    expect(verificarImporte({ amountCents: 100n, currency: 'ARS' }, items, 'ARS')).toEqual({
      ok: false,
      motivo: 'importe_distinto',
      esperado: 10_000_000n,
      recibido: 100n,
    });
  });

  it('rechaza tambien un importe mayor: la preferencia fija el monto exacto', () => {
    expect(verificarImporte({ amountCents: 10_000_100n, currency: 'ARS' }, items, 'ARS').ok).toBe(
      false,
    );
  });

  it('⚠️ RECHAZA otra moneda aunque el numero coincida', () => {
    const r = verificarImporte({ amountCents: 10_000_000n, currency: 'USD' }, items, 'ARS');
    expect(r).toMatchObject({ ok: false, motivo: 'moneda_distinta' });
  });

  it('falla CERRADO sin importe o sin moneda informados', () => {
    expect(verificarImporte({ amountCents: null, currency: 'ARS' }, items, 'ARS')).toMatchObject({
      ok: false,
      motivo: 'importe_desconocido',
    });
    expect(
      verificarImporte({ amountCents: 10_000_000n, currency: null }, items, 'ARS'),
    ).toMatchObject({ ok: false, motivo: 'moneda_distinta' });
  });

  it('no distingue mayusculas en la moneda', () => {
    expect(verificarImporte({ amountCents: 10_000_000n, currency: 'ars' }, items, 'ARS').ok).toBe(
      true,
    );
  });
});
