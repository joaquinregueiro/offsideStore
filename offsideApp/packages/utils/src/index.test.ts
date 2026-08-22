import { describe, expect, it } from 'vitest';

import { assertNever, exponentialBackoff, isDefined, TimeoutError, withTimeout } from './index';

describe('isDefined', () => {
  it('filtra null y undefined', () => {
    const input = [1, null, 2, undefined, 3];

    expect(input.filter(isDefined)).toEqual([1, 2, 3]);
  });
});

describe('assertNever', () => {
  it('lanza al recibir un caso no contemplado', () => {
    expect(() => assertNever('inesperado' as never)).toThrowError(/Caso no contemplado/);
  });
});

describe('withTimeout', () => {
  it('devuelve el valor si resuelve a tiempo', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('rechaza con TimeoutError si la promesa nunca resuelve', async () => {
    // Reproduce el fallo real: ioredis con `maxRetriesPerRequest: null` encola
    // los comandos para siempre en vez de rechazarlos.
    const nuncaResuelve = new Promise<string>(() => undefined);

    await expect(withTimeout(nuncaResuelve, 20)).rejects.toBeInstanceOf(TimeoutError);
  });

  it('propaga el error original si la promesa falla antes del plazo', async () => {
    const fallo = Promise.reject(new Error('ECONNREFUSED'));

    await expect(withTimeout(fallo, 1000)).rejects.toThrowError(/ECONNREFUSED/);
  });

  it('incluye un mensaje accionable', async () => {
    const nuncaResuelve = new Promise<string>(() => undefined);

    await expect(withTimeout(nuncaResuelve, 20, 'Redis no respondio')).rejects.toThrowError(
      /Redis no respondio/,
    );
  });
});

describe('exponentialBackoff', () => {
  it('crece con cada intento y respeta el techo', () => {
    const primero = exponentialBackoff(0, { baseMs: 1000, maxMs: 10_000 });
    const tercero = exponentialBackoff(3, { baseMs: 1000, maxMs: 10_000 });

    expect(primero).toBeLessThanOrEqual(1000);
    expect(tercero).toBeGreaterThan(primero);
    expect(exponentialBackoff(50, { baseMs: 1000, maxMs: 10_000 })).toBeLessThanOrEqual(10_000);
  });
});
