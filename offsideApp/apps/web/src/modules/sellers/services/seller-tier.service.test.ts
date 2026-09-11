import { describe, expect, it } from 'vitest';

import {
  decideTierChange,
  pickTierForSales,
  rateToBasisPoints,
  toTierDefinition,
  type TierDefinition,
} from './seller-tier.service';
import type { SellerTierRow } from '../repositories/seller-tier.repository';

/**
 * SELLER_TIER — las reglas puras (SS-014 / DEC-015 / DEC-037).
 *
 * Lo que se fija aca es DINERO: que tier le toca a quien, y por lo tanto que
 * comision paga. Los umbrales y las tasas son ⚙️ y vienen de la base; estas
 * funciones no conocen ningun numero, y los tests lo demuestran usando
 * valores distintos de los sembrados.
 */

function tier(code: string, minCompletedSales: number, basisPoints: number | null = null) {
  return {
    id: `id-${code}`,
    code,
    name: `Nivel ${code}`,
    basisPoints,
    minCompletedSales,
    isActive: true,
  } satisfies TierDefinition;
}

const INICIAL = tier('INICIAL', 0, 600);
const AVANZADO = tier('AVANZADO', 10, 500);
const PROFESIONAL = tier('PROFESIONAL', 50, 400);
const TIERS = [INICIAL, AVANZADO, PROFESIONAL];

describe('rateToBasisPoints — numeric(6,4) a basis points sin punto flotante', () => {
  it('convierte la fraccion que guarda `seller_tiers.commission_rate`', () => {
    expect(rateToBasisPoints('0.0600')).toBe(600);
    expect(rateToBasisPoints('0.0500')).toBe(500);
    expect(rateToBasisPoints('0.0400')).toBe(400);
    expect(rateToBasisPoints('0.0425')).toBe(425);
    expect(rateToBasisPoints('0')).toBe(0);
    expect(rateToBasisPoints('1')).toBe(10_000);
    expect(rateToBasisPoints('1.0000')).toBe(10_000);
  });

  it('tolera menos de cuatro decimales y espacios', () => {
    expect(rateToBasisPoints('0.05')).toBe(500);
    expect(rateToBasisPoints(' 0.06 ')).toBe(600);
    expect(rateToBasisPoints('.06')).toBeUndefined();
  });

  it('⚠️ no pasa por double: 0.0575 es 575, no 574', () => {
    // `Number('0.0575') * 10000` da 574.9999999999999. Truncado seria una
    // comision distinta de la configurada; redondeado depende del valor.
    expect(rateToBasisPoints('0.0575')).toBe(575);
    expect(rateToBasisPoints('0.0001')).toBe(1);
  });

  it('rechaza lo que no es una fraccion entre 0 y 1', () => {
    expect(rateToBasisPoints('1.0001')).toBeUndefined();
    expect(rateToBasisPoints('2')).toBeUndefined();
    expect(rateToBasisPoints('-0.01')).toBeUndefined();
    expect(rateToBasisPoints('0.06001')).toBeUndefined();
    expect(rateToBasisPoints('abc')).toBeUndefined();
    expect(rateToBasisPoints('')).toBeUndefined();
    expect(rateToBasisPoints('600')).toBeUndefined();
  });
});

describe('toTierDefinition — la forma de una fila', () => {
  const fila = (extra: Partial<SellerTierRow>): SellerTierRow => ({
    id: 'id-x',
    code: 'X',
    name: 'Nivel X',
    commissionRate: '0.0500',
    limits: { minCompletedSales: 10 },
    benefits: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: null,
    ...extra,
  });

  it('lee tasa y umbral', () => {
    expect(toTierDefinition(fila({}))).toMatchObject({
      code: 'X',
      basisPoints: 500,
      minCompletedSales: 10,
      isActive: true,
    });
  });

  it('una tasa NULL es "no pisa la global", no un cero', () => {
    expect(toTierDefinition(fila({ commissionRate: null })).basisPoints).toBeNull();
  });

  it('rechaza un `limits` sin umbral', () => {
    expect(() => toTierDefinition(fila({ limits: null }))).toThrowError(/mal configurado/);
    expect(() => toTierDefinition(fila({ limits: {} }))).toThrowError(/minCompletedSales/);
    expect(() => toTierDefinition(fila({ limits: { minCompletedSales: -1 } }))).toThrowError(
      /mal configurado/,
    );
    expect(() => toTierDefinition(fila({ limits: { minCompletedSales: 1.5 } }))).toThrowError(
      /mal configurado/,
    );
  });

  it('rechaza una tasa que no es una fraccion', () => {
    expect(() => toTierDefinition(fila({ commissionRate: '600' }))).toThrowError(/fracción/);
  });

  it('el error nombra el code, nunca el JSON crudo', () => {
    expect(() =>
      toTierDefinition(fila({ code: 'ROTO', limits: { secreto: 'no-debe-salir' } })),
    ).toThrowError(/"ROTO"/);
    expect(() =>
      toTierDefinition(fila({ code: 'ROTO', limits: { secreto: 'no-debe-salir' } })),
    ).not.toThrowError(/no-debe-salir/);
  });
});

describe('pickTierForSales — el mayor umbral alcanzado', () => {
  it.each([
    [0, 'INICIAL'],
    [1, 'INICIAL'],
    [9, 'INICIAL'],
    [10, 'AVANZADO'],
    [11, 'AVANZADO'],
    [49, 'AVANZADO'],
    [50, 'PROFESIONAL'],
    [1_000, 'PROFESIONAL'],
  ])('con %i ventas corresponde %s', (ventas, esperado) => {
    expect(pickTierForSales(TIERS, ventas)?.code).toBe(esperado);
  });

  it('el umbral es inclusivo: la venta numero 10 ya alcanza AVANZADO', () => {
    expect(pickTierForSales(TIERS, 10)?.code).toBe('AVANZADO');
    expect(pickTierForSales(TIERS, 9)?.code).toBe('INICIAL');
  });

  it('sin ningun umbral alcanzado no hay tier', () => {
    expect(pickTierForSales([AVANZADO, PROFESIONAL], 3)).toBeUndefined();
    expect(pickTierForSales([], 100)).toBeUndefined();
  });

  it('no depende del orden de entrada', () => {
    expect(pickTierForSales([PROFESIONAL, INICIAL, AVANZADO], 12)?.code).toBe('AVANZADO');
    expect(pickTierForSales([AVANZADO, PROFESIONAL, INICIAL], 60)?.code).toBe('PROFESIONAL');
  });

  it('no muta la lista que recibe', () => {
    const entrada = [PROFESIONAL, INICIAL, AVANZADO];
    pickTierForSales(entrada, 12);

    expect(entrada.map((t) => t.code)).toEqual(['PROFESIONAL', 'INICIAL', 'AVANZADO']);
  });

  it('empate de umbral: gana el ultimo por `code`, en cualquier orden de entrada', () => {
    // Una configuracion ambigua no deberia existir, pero si existe la
    // eleccion tiene que ser DETERMINISTA: dos evaluaciones seguidas no pueden
    // alternar entre dos tiers y auditar cambios fantasma.
    const a = tier('A_EMPATE', 10, 500);
    const b = tier('B_EMPATE', 10, 450);

    expect(pickTierForSales([INICIAL, a, b], 10)?.code).toBe('B_EMPATE');
    expect(pickTierForSales([b, a, INICIAL], 10)?.code).toBe('B_EMPATE');
  });

  it('no conoce los umbrales sembrados: cualquier lista sirve', () => {
    const otros = [tier('BRONCE', 0), tier('PLATA', 3), tier('ORO', 7)];

    expect(pickTierForSales(otros, 6)?.code).toBe('PLATA');
    expect(pickTierForSales(otros, 7)?.code).toBe('ORO');
  });
});

describe('decideTierChange — que hacer con el tier actual', () => {
  it('sin tier actual, asigna el candidato', () => {
    expect(decideTierChange(null, INICIAL, false)).toEqual({ kind: 'assign', to: INICIAL });
    expect(decideTierChange(null, PROFESIONAL, false)).toEqual({
      kind: 'assign',
      to: PROFESIONAL,
    });
  });

  it('sin candidato, no hace nada', () => {
    expect(decideTierChange(null, undefined, true)).toEqual({
      kind: 'none',
      reason: 'no_candidate',
    });
    expect(decideTierChange(AVANZADO, undefined, true)).toEqual({
      kind: 'none',
      reason: 'no_candidate',
    });
  });

  it('el mismo tier es "sin cambio", no una reasignacion', () => {
    expect(decideTierChange(AVANZADO, AVANZADO, true)).toEqual({
      kind: 'none',
      reason: 'same_tier',
    });
  });

  it('sube cuando el candidato tiene mayor umbral', () => {
    expect(decideTierChange(INICIAL, AVANZADO, false)).toEqual({ kind: 'upgrade', to: AVANZADO });
    expect(decideTierChange(INICIAL, PROFESIONAL, false)).toEqual({
      kind: 'upgrade',
      to: PROFESIONAL,
    });
  });

  it('⚠️ NO BAJA con `seller_tier_auto_downgrade` apagado', () => {
    // Bajar de tier es cobrarle mas a alguien. La perilla arranca apagada y
    // mientras siga asi el tier solo sube; bajar lo decide una persona.
    expect(decideTierChange(PROFESIONAL, AVANZADO, false)).toEqual({
      kind: 'none',
      reason: 'downgrade_disabled',
    });
    expect(decideTierChange(AVANZADO, INICIAL, false)).toEqual({
      kind: 'none',
      reason: 'downgrade_disabled',
    });
  });

  it('baja solo con la perilla encendida', () => {
    expect(decideTierChange(PROFESIONAL, AVANZADO, true)).toEqual({
      kind: 'downgrade',
      to: AVANZADO,
    });
    expect(decideTierChange(PROFESIONAL, INICIAL, true)).toEqual({
      kind: 'downgrade',
      to: INICIAL,
    });
  });

  it('la perilla de bajar no afecta subir ni asignar', () => {
    expect(decideTierChange(INICIAL, AVANZADO, true).kind).toBe('upgrade');
    expect(decideTierChange(null, INICIAL, true).kind).toBe('assign');
  });

  it('dos tiers distintos con el mismo umbral no son ni subir ni bajar', () => {
    const otro = tier('OTRO', AVANZADO.minCompletedSales, 450);

    expect(decideTierChange(AVANZADO, otro, true)).toEqual({ kind: 'none', reason: 'same_tier' });
  });
});
