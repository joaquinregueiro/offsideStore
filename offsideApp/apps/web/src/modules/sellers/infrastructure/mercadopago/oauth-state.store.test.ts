import { describe, expect, it } from 'vitest';

import {
  consumeState,
  saveState,
  type OAuthStateContext,
  type OAuthStateStore,
} from './oauth-state.store';

/**
 * Store del contexto OAuth (mercadopago-oauth-spec.md §6).
 *
 * Se testea con un doble en memoria, igual que `lib/rate-limit.ts`: lo que
 * importa verificar es el CONTRATO —clave, TTL, `NX`, `GETDEL`— y eso no
 * necesita un Redis real. La integracion con Redis de verdad se cubre en
 * `mercadopago-oauth.integration.test.ts`.
 */

interface Llamada {
  key: string;
  value: string;
  mode: string;
  seconds: number;
  flag: string;
}

function fakeStore(): OAuthStateStore & { llamadas: Llamada[]; datos: Map<string, string> } {
  const datos = new Map<string, string>();
  const llamadas: Llamada[] = [];

  return {
    datos,
    llamadas,
    set(key, value, mode, seconds, flag) {
      llamadas.push({ key, value, mode, seconds, flag });
      // `NX`: no pisa una clave existente.
      if (datos.has(key)) return Promise.resolve(null);
      datos.set(key, value);
      return Promise.resolve('OK' as const);
    },
    getdel(key) {
      const value = datos.get(key) ?? null;
      datos.delete(key);
      return Promise.resolve(value);
    },
  };
}

const contexto: OAuthStateContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  sellerId: '22222222-2222-4222-8222-222222222222',
  codeVerifier: 'verificador-de-prueba-generado-en-el-test',
  createdAt: '2026-08-24T12:00:00.000Z',
};

describe('saveState', () => {
  it('guarda bajo la clave mp:oauth:state:{state} con TTL de 600 segundos y NX', async () => {
    const store = fakeStore();

    await saveState('un-state', contexto, store);

    expect(store.llamadas[0]).toEqual({
      key: 'mp:oauth:state:un-state',
      value: JSON.stringify(contexto),
      mode: 'EX',
      seconds: 600,
      flag: 'NX',
    });
  });

  it('guarda el contexto completo en UNA sola clave', async () => {
    // Dos claves separadas podrian desincronizarse si una expira antes.
    const store = fakeStore();

    await saveState('un-state', contexto, store);

    expect(store.datos.size).toBe(1);
    expect(JSON.parse(store.datos.get('mp:oauth:state:un-state')!)).toEqual(contexto);
  });

  it('devuelve false si el state ya existia, sin sobrescribirlo', async () => {
    const store = fakeStore();
    await saveState('un-state', contexto, store);

    const otro = { ...contexto, userId: 'otro-usuario' };

    expect(await saveState('un-state', otro, store)).toBe(false);
    expect(JSON.parse(store.datos.get('mp:oauth:state:un-state')!).userId).toBe(contexto.userId);
  });
});

describe('consumeState', () => {
  it('devuelve el contexto guardado', async () => {
    const store = fakeStore();
    await saveState('un-state', contexto, store);

    expect(await consumeState('un-state', store)).toEqual(contexto);
  });

  it('borra el state al consumirlo: el segundo intento no encuentra nada', async () => {
    // Esto es lo que hace que un replay del callback no tenga efecto (spec §15).
    const store = fakeStore();
    await saveState('un-state', contexto, store);

    expect(await consumeState('un-state', store)).not.toBeNull();
    expect(await consumeState('un-state', store)).toBeNull();
  });

  it('devuelve null ante un state desconocido', async () => {
    expect(await consumeState('no-existe', fakeStore())).toBeNull();
  });

  it('devuelve null ante un contexto ilegible, sin propagar la excepcion', async () => {
    const store = fakeStore();
    store.datos.set('mp:oauth:state:roto', 'esto-no-es-json');

    expect(await consumeState('roto', store)).toBeNull();
  });
});
