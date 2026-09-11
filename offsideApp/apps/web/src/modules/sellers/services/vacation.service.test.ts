import { describe, expect, it } from 'vitest';

import { isOnVacationAt } from './vacation.service';

/**
 * Modo vacaciones — el predicado, aislado.
 *
 * Es la unica regla del modulo y la comparten `listings` (para esconder las
 * publicaciones) y el panel del vendedor (para avisar): tiene que dar lo
 * mismo en los dos lados.
 */
describe('isOnVacationAt', () => {
  const ahora = new Date('2026-09-11T12:00:00Z');

  it('sin fecha, no esta de vacaciones', () => {
    expect(isOnVacationAt(null, ahora)).toBe(false);
  });

  it('con fecha futura, esta ausente', () => {
    expect(isOnVacationAt(new Date('2026-09-20T00:00:00Z'), ahora)).toBe(true);
    expect(isOnVacationAt(new Date('2026-09-11T12:00:01Z'), ahora)).toBe(true);
  });

  it('⚠️ una fecha pasada equivale a no tener fecha: vuelve solo, sin limpiar nada', () => {
    // Es lo que hace que sea un predicado y no un estado: al vencer no hay
    // nada que reactivar.
    expect(isOnVacationAt(new Date('2026-09-01T00:00:00Z'), ahora)).toBe(false);
  });

  it('el instante exacto de regreso ya cuenta como de vuelta', () => {
    expect(isOnVacationAt(new Date(ahora.getTime()), ahora)).toBe(false);
  });

  it('usa el reloj real cuando no se le pasa uno', () => {
    expect(isOnVacationAt(new Date(Date.now() + 60_000))).toBe(true);
    expect(isOnVacationAt(new Date(Date.now() - 60_000))).toBe(false);
  });
});
