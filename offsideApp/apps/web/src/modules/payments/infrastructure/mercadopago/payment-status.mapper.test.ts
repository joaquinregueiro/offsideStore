import { describe, expect, it } from 'vitest';

import { isTerminal, mapMercadoPagoStatus } from './payment-status.mapper';

/**
 * Mapeo de estados MP -> Offside (DEC-035).
 *
 * Lo critico es que un estado desconocido NO produzca una transicion: adivinar
 * sobre dinero es peor que no moverse.
 */

describe('mapMercadoPagoStatus', () => {
  it.each([
    ['pending', 'PENDING'],
    ['in_process', 'IN_PROCESS'],
    ['authorized', 'IN_PROCESS'],
    ['approved', 'APPROVED'],
    ['rejected', 'REJECTED'],
    ['cancelled', 'CANCELLED'],
    ['refunded', 'REFUNDED'],
    ['charged_back', 'CHARGED_BACK'],
  ] as const)('mapea %s -> %s', (mp, offside) => {
    expect(mapMercadoPagoStatus(mp)).toEqual({ status: offside, unknown: false });
  });

  it('acepta el estado en mayusculas', () => {
    expect(mapMercadoPagoStatus('APPROVED').status).toBe('APPROVED');
  });

  it('cubre los nueve estados que documenta Mercado Pago', () => {
    // Lista oficial verificada el 2026-08-25. Ninguno puede quedar como
    // desconocido: si MP agrega uno, este test lo detecta al actualizarlo.
    const oficiales = [
      'approved',
      'authorized',
      'in_process',
      'pending',
      'cancelled',
      'refunded',
      'charged_back',
      'in_mediation',
      'rejected',
    ];

    for (const estado of oficiales) {
      expect(mapMercadoPagoStatus(estado).unknown).toBe(false);
    }
  });

  it('un approved con status_detail partially_refunded es PARTIALLY_REFUNDED', () => {
    // MP no tiene un `status` propio para el reembolso parcial: lo informa como
    // detalle de un pago aprobado. Sin esto, un webhook posterior a una
    // devolucion parcial devolveria el pago a APPROVED.
    expect(mapMercadoPagoStatus('approved', 'partially_refunded')).toEqual({
      status: 'PARTIALLY_REFUNDED',
      unknown: false,
    });
  });

  it('un approved con cualquier otro detalle sigue siendo APPROVED', () => {
    expect(mapMercadoPagoStatus('approved', 'accredited').status).toBe('APPROVED');
    expect(mapMercadoPagoStatus('approved', null).status).toBe('APPROVED');
  });

  it('NO mapea in_mediation: la disputa es otro ciclo de vida (DEC-034)', () => {
    // Conocido, pero deliberadamente sin mapeo: no es `unknown`.
    expect(mapMercadoPagoStatus('in_mediation')).toEqual({ status: null, unknown: false });
  });

  it('un estado desconocido no produce transicion', () => {
    expect(mapMercadoPagoStatus('estado_que_no_existe')).toEqual({ status: null, unknown: true });
  });

  it.each([null, undefined, ''])('un estado vacio (%s) no produce transicion', (valor) => {
    expect(mapMercadoPagoStatus(valor).status).toBeNull();
  });
});

describe('isTerminal', () => {
  it.each(['REJECTED', 'CANCELLED', 'CHARGED_BACK'] as const)('%s es terminal', (estado) => {
    expect(isTerminal(estado)).toBe(true);
  });

  it.each(['PENDING', 'IN_PROCESS', 'APPROVED'] as const)('%s no es terminal', (estado) => {
    expect(isTerminal(estado)).toBe(false);
  });
});
