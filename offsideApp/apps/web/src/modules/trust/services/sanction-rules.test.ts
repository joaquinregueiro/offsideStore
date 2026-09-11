import { describe, expect, it } from 'vitest';

import {
  algunaBloqueaVenta,
  bloqueaVenta,
  estadoDelVendedorPara,
  rige,
  validarVentana,
  vencida,
} from './sanction-rules';
import type { SanctionRow } from '../repositories/sanction.repository';

/**
 * Reglas de sanciones (ERD §16.2).
 *
 * Lo que se fija acá es QUÉ saca a un vendedor de la vitrina y qué no. Un
 * aviso que bloqueara la venta sería indistinguible de una suspensión.
 */

const AHORA = new Date('2026-09-10T12:00:00.000Z');
const AYER = new Date('2026-09-09T12:00:00.000Z');
const MANANA = new Date('2026-09-11T12:00:00.000Z');

function sancion(overrides: Partial<SanctionRow> = {}): SanctionRow {
  return {
    id: 'sancion-1',
    sellerId: 'vendedor-1',
    type: 'warning',
    reason: null,
    disputeId: null,
    limitations: null,
    appliedBy: null,
    startsAt: AYER,
    endsAt: null,
    status: 'active',
    createdAt: AYER,
    ...overrides,
  };
}

describe('qué bloquea la venta', () => {
  it('suspensión y expulsión sí', () => {
    expect(bloqueaVenta('suspension')).toBe(true);
    expect(bloqueaVenta('expulsion')).toBe(true);
  });

  it('⚠️ aviso, penalización y limitación NO', () => {
    // Afectan reputación y riesgo, no la capacidad de vender. `limited` existe
    // en el enum pero la doc no define qué limita: no se inventa.
    expect(bloqueaVenta('warning')).toBe(false);
    expect(bloqueaVenta('penalty')).toBe(false);
    expect(bloqueaVenta('limitation')).toBe(false);
  });

  it('el estado del perfil sólo cambia con suspensión y expulsión', () => {
    expect(estadoDelVendedorPara('suspension')).toBe('suspended');
    expect(estadoDelVendedorPara('expulsion')).toBe('expelled');
    expect(estadoDelVendedorPara('warning')).toBeNull();
    expect(estadoDelVendedorPara('penalty')).toBeNull();
    expect(estadoDelVendedorPara('limitation')).toBeNull();
  });
});

describe('vigencia', () => {
  it('activa y sin vencimiento rige', () => {
    expect(rige(sancion(), AHORA)).toBe(true);
  });

  it('activa con vencimiento futuro rige; con vencimiento pasado no', () => {
    expect(rige(sancion({ endsAt: MANANA }), AHORA)).toBe(true);
    expect(rige(sancion({ endsAt: AYER }), AHORA)).toBe(false);
  });

  it('levantada o expirada no rige, aunque la ventana la incluya', () => {
    expect(rige(sancion({ status: 'lifted' }), AHORA)).toBe(false);
    expect(rige(sancion({ status: 'expired' }), AHORA)).toBe(false);
  });

  it('una sanción futura todavía no rige', () => {
    expect(rige(sancion({ startsAt: MANANA }), AHORA)).toBe(false);
  });

  it('vencida = activa con ends_at pasado', () => {
    expect(vencida(sancion({ endsAt: AYER }), AHORA)).toBe(true);
    expect(vencida(sancion({ endsAt: MANANA }), AHORA)).toBe(false);
    expect(vencida(sancion({ endsAt: AYER, status: 'lifted' }), AHORA)).toBe(false);
    expect(vencida(sancion(), AHORA)).toBe(false);
  });
});

describe('algunaBloqueaVenta', () => {
  it('un aviso vigente no bloquea', () => {
    expect(algunaBloqueaVenta([sancion({ type: 'warning' })], AHORA)).toBe(false);
  });

  it('una suspensión vigente bloquea', () => {
    expect(
      algunaBloqueaVenta([sancion({ type: 'warning' }), sancion({ type: 'suspension' })], AHORA),
    ).toBe(true);
  });

  it('una suspensión vencida o levantada no bloquea', () => {
    expect(algunaBloqueaVenta([sancion({ type: 'suspension', endsAt: AYER })], AHORA)).toBe(false);
    expect(algunaBloqueaVenta([sancion({ type: 'suspension', status: 'lifted' })], AHORA)).toBe(
      false,
    );
  });

  it('sin sanciones no bloquea', () => {
    expect(algunaBloqueaVenta([], AHORA)).toBe(false);
  });
});

describe('validarVentana', () => {
  it('sin fin = indefinida, desde ahora', () => {
    expect(validarVentana(AHORA, null)).toEqual({
      ok: true,
      ventana: { startsAt: AHORA, endsAt: null },
    });
    expect(validarVentana(AHORA, undefined)).toEqual({
      ok: true,
      ventana: { startsAt: AHORA, endsAt: null },
    });
  });

  it('con fin futuro, lo respeta', () => {
    expect(validarVentana(AHORA, MANANA)).toEqual({
      ok: true,
      ventana: { startsAt: AHORA, endsAt: MANANA },
    });
  });

  it('⚠️ rechaza una sanción que nace vencida', () => {
    expect(validarVentana(AHORA, AYER).ok).toBe(false);
    expect(validarVentana(AHORA, AHORA).ok).toBe(false);
  });

  it('rechaza una fecha inválida', () => {
    expect(validarVentana(AHORA, new Date('no es fecha')).ok).toBe(false);
  });
});
