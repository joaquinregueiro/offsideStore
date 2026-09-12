import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ⚠️ SE MOCKEA `next/headers` Y NO SE IMPORTA EL MODULO REAL DE COOKIES. Fuera
 * de una request de Next, `cookies()` lanza; el almacen falso de acá es la
 * unica forma de probar la LOGICA —que es lo que tiene reglas— sin levantar un
 * servidor. Lo que se prueba no es que Next guarde cookies: es que una cookie
 * inventada no rompa la pagina y que "auto" borre en vez de guardar.
 */
const almacen = new Map<string, string>();

vi.mock('next/headers', () => ({
  /*
   * ⚠️ DEVUELVE UNA PROMESA HECHA A MANO Y NO ES UNA FUNCION `async`. En Next
   * 16 `cookies()` es asincrona, asi que el doble tambien tiene que serlo; pero
   * escribirla `async` sin ningun `await` adentro es exactamente lo que marca
   * `require-await`. `Promise.resolve` dice lo mismo sin la marca.
   */
  cookies: () =>
    Promise.resolve({
      get: (nombre: string) =>
        almacen.has(nombre) ? { name: nombre, value: almacen.get(nombre) } : undefined,
      set: (nombre: string, valor: string) => {
        almacen.set(nombre, valor);
      },
      delete: (nombre: string) => {
        almacen.delete(nombre);
      },
    }),
}));

const { COOKIE_DE_TEMA, atributoDeTema, guardarTema, temaElegido } = await import('./tema');

describe('preferencia de tema', () => {
  beforeEach(() => {
    almacen.clear();
  });

  /**
   * ⚠️ EL DEFAULT ES OSCURO, NO `auto`, por decision del dueño. Con `auto`,
   * quien llega con el sistema en claro —la mayoria de los escritorios— no se
   * enteraria nunca de que hay un modo oscuro.
   */
  it('sin cookie, el tema es oscuro', async () => {
    await expect(temaElegido()).resolves.toBe('oscuro');
    await expect(atributoDeTema()).resolves.toEqual({ 'data-tema': 'oscuro' });
  });

  it('devuelve el tema guardado', async () => {
    await guardarTema('oscuro');

    await expect(temaElegido()).resolves.toBe('oscuro');
    expect(almacen.get(COOKIE_DE_TEMA)).toBe('oscuro');
  });

  /**
   * ⚠️ ESTE ES EL TEST QUE IMPORTA. La cookie la edita cualquiera desde su
   * propio navegador, asi que su contenido es entrada de borde. Un valor
   * desconocido tiene que caer en `auto` en silencio: romper la pagina entera
   * por una cookie mal escrita seria convertir un capricho en una caida.
   */
  it.each(['negro', 'DARK', '', 'oscuro ', '<script>', '1'])(
    'un valor invalido (%j) cae en el default',
    async (basura) => {
      almacen.set(COOKIE_DE_TEMA, basura);

      await expect(temaElegido()).resolves.toBe('oscuro');
    },
  );

  /**
   * ⚠️ "AUTOMATICO" SE GUARDA, NO BORRA, Y ESTE TEST FIJA EXACTAMENTE ESO.
   * Mientras el default fue `auto`, borrar la cookie y elegir automatico eran
   * lo mismo. Con el default en oscuro dejaron de serlo: si `auto` borrara,
   * quien pide seguir al sistema quedaria en oscuro fijo, que es lo contrario
   * de lo que pidio.
   */
  it('elegir automatico se guarda y no vuelve al default', async () => {
    await guardarTema('claro');
    await guardarTema('auto');

    expect(almacen.get(COOKIE_DE_TEMA)).toBe('auto');
    await expect(temaElegido()).resolves.toBe('auto');
    await expect(atributoDeTema()).resolves.toEqual({});
  });

  /**
   * ⚠️ `auto` NO ESCRIBE ATRIBUTO, y es lo que lo hace automatico de verdad: sin
   * `data-tema`, el unico que decide es el `@media (prefers-color-scheme)`. Si
   * escribiera `data-tema="auto"`, el `:root:not([data-tema='claro'])` seguiria
   * funcionando hoy, pero invitaria a que manana alguien escriba un selector
   * para ese valor y duplique a mano la logica del sistema operativo.
   */
  it('automatico no escribe atributo y los otros dos si', async () => {
    await guardarTema('auto');
    await expect(atributoDeTema()).resolves.toEqual({});

    await guardarTema('oscuro');
    await expect(atributoDeTema()).resolves.toEqual({ 'data-tema': 'oscuro' });

    await guardarTema('claro');
    await expect(atributoDeTema()).resolves.toEqual({ 'data-tema': 'claro' });
  });
});
