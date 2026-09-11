import { describe, expect, it } from 'vitest';

import { acquireLock, releaseLock, withLock, type LockStore } from './lock';

/**
 * Lock distribuido: se prueba contra un doble en memoria que respeta `NX` y
 * `EX`, porque lo que importa es la SEMANTICA (quien lo tiene, quien lo
 * suelta), no Redis.
 */

function storeEnMemoria(): LockStore & { claves: Map<string, string> } {
  const claves = new Map<string, string>();

  return {
    claves,
    set: (key, value, _mode, _seconds, _flag) => {
      if (claves.has(key)) return Promise.resolve(null);
      claves.set(key, value);
      return Promise.resolve('OK');
    },
    get: (key) => Promise.resolve(claves.get(key) ?? null),
    del: (key) => Promise.resolve(claves.delete(key) ? 1 : 0),
  };
}

describe('acquireLock / releaseLock', () => {
  it('el segundo en pedir el mismo lock no lo consigue', async () => {
    const store = storeEnMemoria();

    const primero = await acquireLock('x', 60, store);
    const segundo = await acquireLock('x', 60, store);

    expect(primero).not.toBeNull();
    expect(segundo).toBeNull();
  });

  it('⚠️ NO suelta un lock que ya es de otro', async () => {
    // El TTL vencio, otro proceso lo tomo: el primero no puede borrarle el suyo.
    const store = storeEnMemoria();
    const viejo = await acquireLock('x', 60, store);
    store.claves.delete('x'); // simula el vencimiento por TTL
    const nuevo = await acquireLock('x', 60, store);

    await releaseLock(viejo!, store);

    expect(store.claves.get('x')).toBe(nuevo!.token);
  });

  it('rechaza un TTL que no sea un entero positivo', async () => {
    await expect(acquireLock('x', 0, storeEnMemoria())).rejects.toThrow(/ttlSeconds/);
  });
});

describe('withLock', () => {
  it('corre la funcion con el lock y lo libera al terminar', async () => {
    const store = storeEnMemoria();

    const resultado = await withLock('x', 60, () => Promise.resolve(42), store);

    expect(resultado).toEqual({ acquired: true, result: 42 });
    expect(store.claves.has('x')).toBe(false);
  });

  it('no corre la funcion si el lock esta tomado', async () => {
    const store = storeEnMemoria();
    await acquireLock('x', 60, store);
    let corrio = false;

    const resultado = await withLock(
      'x',
      60,
      () => {
        corrio = true;
        return Promise.resolve(1);
      },
      store,
    );

    expect(resultado).toEqual({ acquired: false });
    expect(corrio).toBe(false);
  });

  it('libera el lock aunque la funcion falle', async () => {
    const store = storeEnMemoria();

    await expect(withLock('x', 60, () => Promise.reject(new Error('boom')), store)).rejects.toThrow(
      'boom',
    );

    expect(store.claves.has('x')).toBe(false);
  });
});
