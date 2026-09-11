import { describe, expect, it } from 'vitest';

import type { UserLevelThresholds } from './reputation-settings.service';
import {
  decideLevelChange,
  LEVEL_EVENT_TYPES,
  levelForOperations,
  levelRank,
  NEW_SELLER_SALES_THRESHOLD,
  reputationLabel,
  USER_LEVELS,
} from './user-level-rules';

/**
 * Nivel de usuario (DEC-020). Los umbrales son los sembrados por la migración
 * 0010, pero llegan por parámetro: la regla no los conoce.
 */

const UMBRALES: UserLevelThresholds = { CONFIABLE: 5, DESTACADO: 10, COLECCIONISTA: 20 };

describe('levelForOperations', () => {
  it('NUEVO por debajo del primer umbral', () => {
    expect(levelForOperations(0, UMBRALES)).toBe('NUEVO');
    expect(levelForOperations(4, UMBRALES)).toBe('NUEVO');
  });

  it('cada umbral, alcanzado justo, da su nivel', () => {
    expect(levelForOperations(5, UMBRALES)).toBe('CONFIABLE');
    expect(levelForOperations(9, UMBRALES)).toBe('CONFIABLE');
    expect(levelForOperations(10, UMBRALES)).toBe('DESTACADO');
    expect(levelForOperations(20, UMBRALES)).toBe('COLECCIONISTA');
  });

  it('⚠️ TIENDA nunca sale de un umbral', () => {
    expect(levelForOperations(1_000_000, UMBRALES)).toBe('COLECCIONISTA');
  });
});

describe('decideLevelChange', () => {
  it('sube al cruzar un umbral', () => {
    expect(decideLevelChange('NUEVO', 5, UMBRALES)).toEqual({
      from: 'NUEVO',
      to: 'CONFIABLE',
      changed: true,
      reason: 'umbral_alcanzado',
    });
  });

  it('salta niveles si las operaciones ya lo justifican', () => {
    expect(decideLevelChange('NUEVO', 20, UMBRALES).to).toBe('COLECCIONISTA');
  });

  it('no escribe nada si ya está en el nivel que corresponde', () => {
    expect(decideLevelChange('CONFIABLE', 7, UMBRALES)).toMatchObject({
      changed: false,
      reason: 'sin_cambio',
    });
  });

  it('⚠️ nunca baja solo, aunque los umbrales hayan subido', () => {
    const decision = decideLevelChange('DESTACADO', 3, UMBRALES);
    expect(decision).toMatchObject({
      from: 'DESTACADO',
      to: 'DESTACADO',
      changed: false,
      reason: 'no_baja',
    });
  });

  it('⚠️ TIENDA no se evalúa: la puso una persona', () => {
    expect(decideLevelChange('TIENDA', 0, UMBRALES)).toMatchObject({
      to: 'TIENDA',
      changed: false,
      reason: 'tienda_manual',
    });
  });
});

describe('etiqueta de reputación (TS-021)', () => {
  it('"Nuevo" con pocas ventas, sin importar el nivel de usuario', () => {
    expect(reputationLabel(0, 'COLECCIONISTA')).toBe('Nuevo');
    expect(reputationLabel(NEW_SELLER_SALES_THRESHOLD - 1, 'CONFIABLE')).toBe('Nuevo');
  });

  it('después, el nombre del nivel de DEC-020, con tilde donde va', () => {
    expect(reputationLabel(NEW_SELLER_SALES_THRESHOLD, 'NUEVO')).toBe('Nuevo');
    expect(reputationLabel(3, 'CONFIABLE')).toBe('Confiable');
    expect(reputationLabel(50, 'COLECCIONISTA')).toBe('Coleccionista');
    expect(reputationLabel(50, 'TIENDA')).toBe('Tienda');
  });
});

describe('invariantes', () => {
  it('la progresión es la de DEC-020, en orden', () => {
    expect(USER_LEVELS).toEqual(['NUEVO', 'CONFIABLE', 'DESTACADO', 'COLECCIONISTA', 'TIENDA']);
    expect(levelRank('NUEVO')).toBeLessThan(levelRank('TIENDA'));
  });

  it('para el nivel cuentan compras y ventas COMPLETED, y nada más (asumido, TS-046)', () => {
    expect([...LEVEL_EVENT_TYPES].sort()).toEqual(['PURCHASE_COMPLETED', 'SALE_COMPLETED']);
  });
});
