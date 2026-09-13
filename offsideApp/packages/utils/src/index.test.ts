import { describe, expect, it } from 'vitest';

import {
  assertNever,
  esUuid,
  exponentialBackoff,
  isDefined,
  TimeoutError,
  withTimeout,
} from './index';

describe('esUuid', () => {
  it('acepta un UUID en minusculas y en mayusculas', () => {
    expect(esUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(esUuid('123E4567-E89B-12D3-A456-426614174000')).toBe(true);
  });

  it('rechaza lo que PostgreSQL no puede castear a uuid', () => {
    // El caso real: `/p/<basura>` llegaba a una columna `uuid` y la consulta
    // fallaba con `invalid input syntax for type uuid` en vez de dar 404.
    expect(esUuid('no-existe-id-invalido')).toBe(false);
    expect(esUuid('')).toBe(false);
    // Bien formado pero incompleto, y con un caracter no hexadecimal.
    expect(esUuid('123e4567-e89b-12d3-a456')).toBe(false);
    expect(esUuid('123e4567-e89b-12d3-a456-42661417400g')).toBe(false);
  });

  it('rechaza un UUID con espacios alrededor', () => {
    // Sin anclas, un `.test()` daria true y el espacio llegaria a la base.
    expect(esUuid(' 123e4567-e89b-12d3-a456-426614174000 ')).toBe(false);
  });
});

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
