import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkAccountLimit,
  clientIp,
  consume,
  consumeAccountLimit,
  consumeIpLimit,
  consumeIpLimitFor,
  consumeUserLimit,
  registerFailedAttempt,
  type RateLimitStore,
} from './rate-limit';

/**
 * Tests del limitador. No tocan Redis: el store se inyecta.
 *
 * Se testea el ALGORITMO, que es donde estan los errores caros: que la ventana
 * no se renueve sola (bloqueo eterno), que el limite por cuenta no lo consuma
 * un login exitoso (DoS contra la victima) y que un Redis caido deje pasar.
 */

/** Store en memoria con la misma semantica que INCR / EXPIRE / TTL / GET. */
function fakeStore(): RateLimitStore & { expireCalls: number } {
  const counters = new Map<string, number>();
  const ttls = new Map<string, number>();

  return {
    expireCalls: 0,
    incr(key) {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return Promise.resolve(next);
    },
    expire(key, seconds) {
      this.expireCalls += 1;
      ttls.set(key, seconds);
      return Promise.resolve(1);
    },
    ttl(key) {
      // Semantica de Redis: -2 si la clave no existe.
      return Promise.resolve(counters.has(key) ? (ttls.get(key) ?? -1) : -2);
    },
    get(key) {
      const value = counters.get(key);
      return Promise.resolve(value === undefined ? null : String(value));
    },
  };
}

/** Store que siempre falla, para el escenario "Redis caido". */
const brokenStore: RateLimitStore = {
  incr: () => Promise.reject(new Error('ECONNREFUSED')),
  expire: () => Promise.reject(new Error('ECONNREFUSED')),
  ttl: () => Promise.reject(new Error('ECONNREFUSED')),
  get: () => Promise.reject(new Error('ECONNREFUSED')),
};

describe('consume', () => {
  it('deja pasar hasta el limite y rechaza a partir de ahi', async () => {
    const store = fakeStore();

    for (let i = 0; i < 3; i += 1) {
      expect((await consume(store, 'k', 3, 60)).allowed).toBe(true);
    }

    const rechazado = await consume(store, 'k', 3, 60);
    expect(rechazado.allowed).toBe(false);
    expect(rechazado.retryAfterSeconds).toBe(60);
  });

  it('pone vencimiento SOLO en el primer intento de la ventana', async () => {
    const store = fakeStore();

    await consume(store, 'k', 5, 60);
    await consume(store, 'k', 5, 60);
    await consume(store, 'k', 5, 60);

    // Si se renovara en cada intento, la ventana nunca cerraria y el bloqueo
    // seria permanente.
    expect(store.expireCalls).toBe(1);
  });

  it('cuenta cada clave por separado', async () => {
    const store = fakeStore();

    await consume(store, 'ip:a', 1, 60);
    expect((await consume(store, 'ip:a', 1, 60)).allowed).toBe(false);
    expect((await consume(store, 'ip:b', 1, 60)).allowed).toBe(true);
  });

  it('falla ABIERTO si el store no responde, y lo registra', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Con Redis caido, fallar cerrado dejaria a todos sin poder entrar.
    expect((await consume(brokenStore, 'k', 1, 60)).allowed).toBe(true);
    expect(error).toHaveBeenCalled();

    error.mockRestore();
  });
});

describe('limite por cuenta', () => {
  const EMAIL = 'alguien@offside.test';

  beforeEach(() => {
    // Estos tests no tocan la base ni Redis, pero `getEnv()` valida el entorno
    // completo. Se rellena lo minimo y solo si falta, para no pisar un `.env`
    // real cuando lo haya.
    process.env.DATABASE_URL ??= 'postgresql://unit:unit@localhost:5432/unit';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.AUTH_SESSION_SECRET ??= 'pepper-solo-para-tests';
  });

  it('no consume cupo al comprobarlo', async () => {
    const store = fakeStore();

    // Muchas comprobaciones seguidas no deben bloquear a nadie: si consumieran,
    // cualquiera podria dejar afuera a un usuario legitimo mandando intentos
    // con su email.
    for (let i = 0; i < 50; i += 1) {
      expect((await checkAccountLimit(EMAIL, store)).allowed).toBe(true);
    }
  });

  it('bloquea recien cuando se acumulan fallos', async () => {
    const store = fakeStore();
    const max = Number(process.env.AUTH_RATE_LIMIT_MAX_PER_ACCOUNT ?? 5);

    for (let i = 0; i < max; i += 1) {
      expect((await checkAccountLimit(EMAIL, store)).allowed).toBe(true);
      await registerFailedAttempt(EMAIL, store);
    }

    expect((await checkAccountLimit(EMAIL, store)).allowed).toBe(false);
  });

  it('no escribe el email en claro en la clave', async () => {
    const store = fakeStore();
    const incr = vi.spyOn(store, 'incr');

    await registerFailedAttempt(EMAIL, store);

    // El email es un dato personal y Redis no es su almacen: se guarda su HMAC.
    expect(incr.mock.calls[0]?.[0]).not.toContain(EMAIL);
  });
});

describe('limite por cuenta que SI consume (envio de emails)', () => {
  const EMAIL = 'victima@offside.test';

  beforeEach(() => {
    process.env.DATABASE_URL ??= 'postgresql://unit:unit@localhost:5432/unit';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.AUTH_SESSION_SECRET ??= 'pepper-solo-para-tests';
  });

  it('⚠️ bloquea aunque TODOS los intentos sean exitosos', async () => {
    // Es la diferencia con `checkAccountLimit`. Aca el intento exitoso ES el
    // dano: cada uno manda un email real. Sin esto, el reenvio de verificacion
    // inunda la casilla de un tercero.
    const store = fakeStore();
    const max = Number(process.env.AUTH_RATE_LIMIT_MAX_PER_ACCOUNT ?? 5);

    for (let i = 0; i < max; i += 1) {
      expect((await consumeAccountLimit('verify-resend', EMAIL, store)).allowed).toBe(true);
    }

    expect((await consumeAccountLimit('verify-resend', EMAIL, store)).allowed).toBe(false);
  });

  it('no comparte contador con el login ni entre scopes', async () => {
    // Si compartieran clave, pedir reenvios dejaria a la victima sin poder
    // iniciar sesion: un DoS contra su propia cuenta.
    const store = fakeStore();
    const max = Number(process.env.AUTH_RATE_LIMIT_MAX_PER_ACCOUNT ?? 5);

    for (let i = 0; i < max + 1; i += 1) {
      await consumeAccountLimit('verify-resend', EMAIL, store);
    }

    expect((await consumeAccountLimit('password-forgot', EMAIL, store)).allowed).toBe(true);
    expect((await checkAccountLimit(EMAIL, store)).allowed).toBe(true);
  });

  it('no escribe el email en claro en la clave', async () => {
    const store = fakeStore();
    const incr = vi.spyOn(store, 'incr');

    await consumeAccountLimit('verify-resend', EMAIL, store);

    expect(incr.mock.calls[0]?.[0]).not.toContain(EMAIL);
  });
});

describe('el limite por IP es el MISMO para la API y para las Server Actions', () => {
  const IP = '203.0.113.7';

  beforeEach(() => {
    process.env.DATABASE_URL ??= 'postgresql://unit:unit@localhost:5432/unit';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.AUTH_SESSION_SECRET ??= 'pepper-solo-para-tests';
  });

  it('⚠️ comparten la clave de Redis', async () => {
    // ES EL INVARIANTE QUE HACE QUE EL LIMITE VALGA ALGO. Un Route Handler
    // resuelve la IP desde `Request` y una Server Action desde `headers()`. Si
    // cada camino contara en su propia clave, un atacante bloqueado por la API
    // seguiria libre por la pantalla —y al reves—, que es exactamente el
    // agujero que este trabajo vino a cerrar.
    const store = fakeStore();
    const incr = vi.spyOn(store, 'incr');

    const request = new Request('https://offside.com.ar/api/auth/login', {
      headers: { 'x-forwarded-for': IP },
    });

    await consumeIpLimit(request, 'login', store);
    await consumeIpLimitFor(IP, 'login', store);

    expect(incr.mock.calls[0]?.[0]).toBe(incr.mock.calls[1]?.[0]);
  });

  it('el conteo se acumula entre los dos caminos', async () => {
    const store = fakeStore();
    const max = Number(process.env.AUTH_RATE_LIMIT_MAX_PER_IP ?? 20);

    const request = new Request('https://offside.com.ar/api/auth/login', {
      headers: { 'x-forwarded-for': IP },
    });

    // Se gasta el cupo entero por la API...
    for (let i = 0; i < max; i += 1) {
      expect((await consumeIpLimit(request, 'login', store)).allowed).toBe(true);
    }

    // ...y la pantalla ya no puede intentar.
    expect((await consumeIpLimitFor(IP, 'login', store)).allowed).toBe(false);
  });

  it('scopes distintos no se pisan', async () => {
    const store = fakeStore();
    const max = Number(process.env.AUTH_RATE_LIMIT_MAX_PER_IP ?? 20);

    for (let i = 0; i < max + 1; i += 1) {
      await consumeIpLimitFor(IP, 'login', store);
    }

    expect((await consumeIpLimitFor(IP, 'register', store)).allowed).toBe(true);
  });
});

describe('limite por USUARIO de las operaciones autenticadas', () => {
  const USUARIO = '11111111-1111-4111-8111-111111111111';
  const OTRO = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    process.env.DATABASE_URL ??= 'postgresql://unit:unit@localhost:5432/unit';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.AUTH_SESSION_SECRET ??= 'pepper-solo-para-tests';
  });

  it('⚠️ NO usa el presupuesto de auth', async () => {
    // ES LA RAZON DE QUE EXISTA UN SEGUNDO JUEGO DE VARIABLES. Los numeros de
    // auth estan calibrados contra adivinar una password (5 por cuenta, 20 por
    // IP): son bajos a proposito. Si publicar los heredara, un vendedor que
    // sube su catalogo un domingo a la tarde quedaria bloqueado a la sexta
    // prenda. Esto verifica que la sexta pasa.
    const store = fakeStore();

    for (let i = 0; i < 25; i += 1) {
      expect((await consumeUserLimit('listing-create', USUARIO, store)).allowed).toBe(true);
    }
  });

  it('bloquea al pasarse del techo', async () => {
    const store = fakeStore();
    const techo = 60;

    for (let i = 0; i < techo; i += 1) {
      expect((await consumeUserLimit('listing-image', USUARIO, store)).allowed).toBe(true);
    }

    // Subir fotos es la operacion mas cara del sistema —cada una se decodifica
    // y se reescribe en tres tamaños—, asi que el techo tiene que existir de
    // verdad, no solo ser alto.
    expect((await consumeUserLimit('listing-image', USUARIO, store)).allowed).toBe(false);
  });

  it('no mezcla usuarios: bloquear a uno no toca al otro', async () => {
    // Es la ventaja concreta sobre contar por IP. Detras de un NAT —una
    // oficina, la red movil de una operadora— muchisima gente comparte una
    // sola IP, y contando por IP el abuso de un desconocido dejaria sin
    // publicar al resto.
    const store = fakeStore();

    for (let i = 0; i < 61; i += 1) {
      await consumeUserLimit('listing-create', USUARIO, store);
    }

    expect((await consumeUserLimit('listing-create', USUARIO, store)).allowed).toBe(false);
    expect((await consumeUserLimit('listing-create', OTRO, store)).allowed).toBe(true);
  });

  it('cada familia de operaciones cuenta aparte', async () => {
    // Si compartieran contador, ordenar el catalogo dejaria sin poder comprar,
    // que no tiene nada que ver con lo otro.
    const store = fakeStore();

    for (let i = 0; i < 61; i += 1) {
      await consumeUserLimit('listing-update', USUARIO, store);
    }

    expect((await consumeUserLimit('listing-update', USUARIO, store)).allowed).toBe(false);
    expect((await consumeUserLimit('listing-create', USUARIO, store)).allowed).toBe(true);
    expect((await consumeUserLimit('order-create', USUARIO, store)).allowed).toBe(true);
  });

  it('⚠️ la pantalla y la API caen en la MISMA clave', async () => {
    // Mismo invariante que el limite por IP, y por el mismo motivo: la Server
    // Action y el Route Handler llaman los dos a `consumeUserLimit`, asi que un
    // atacante bloqueado por un camino no puede seguir por el otro.
    const store = fakeStore();
    const incr = vi.spyOn(store, 'incr');

    await consumeUserLimit('checkout', USUARIO, store);
    await consumeUserLimit('checkout', USUARIO, store);

    const claves = new Set(incr.mock.calls.map(([clave]) => clave));

    expect(claves.size).toBe(1);
    expect([...claves][0]).toBe(`rl:checkout:user:${USUARIO}`);
  });

  it('falla ABIERTO si Redis no responde', async () => {
    // Mismo criterio que el resto del limitador: con Redis caido, fallar
    // cerrado dejaria a TODOS sin poder operar, que es un incidente peor.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect((await consumeUserLimit('refund', USUARIO, brokenStore)).allowed).toBe(true);
  });
});

describe('clientIp', () => {
  it('toma el primer valor de x-forwarded-for', () => {
    const request = new Request('http://localhost/api/auth/login', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1, 10.0.0.2' },
    });

    expect(clientIp(request)).toBe('203.0.113.9');
  });

  it('degrada a un valor conocido cuando no hay cabecera', () => {
    expect(clientIp(new Request('http://localhost/api/auth/login'))).toBe('desconocida');
  });
});
