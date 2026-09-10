import { randomBytes } from 'node:crypto';

import { resetEnvCache } from '@offside/config';
import { decryptSecret } from '@offside/utils';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createMercadoPagoOAuthClient } from './mercadopago-oauth.client';
import { MercadoPagoOAuthError } from './mercadopago-oauth.port';
import { resetTokenCipherCache } from './token-cipher';

/**
 * Adapter OAuth de Mercado Pago (mercadopago-oauth-spec.md §4, §8 y §20).
 *
 * NO sale a la red: `fetch` se reemplaza por un doble. Lo que se verifica es el
 * contrato con Mercado Pago —parametros que se mandan, campos que se leen— y
 * sobre todo LA FRONTERA DE SECRETOS: que los tokens crucen cifrados.
 *
 * ⚠️ Ningun valor de este archivo es una credencial real. La clave de cifrado
 * se genera al vuelo y las credenciales son cadenas inventadas para el test.
 */

/** Clave de prueba, aleatoria y local. Nunca se persiste. */
const CLAVE_DE_PRUEBA = randomBytes(32).toString('base64');

const CLIENT_ID = 'client-id-de-prueba';
const REDIRECT_URI = 'https://offside.test/api/sellers/mercadopago/callback';

/** Valores ficticios que hacen de "tokens" en las respuestas simuladas. */
const ACCESS_TOKEN_FALSO = 'valor-que-simula-un-access-token';
const REFRESH_TOKEN_FALSO = 'valor-que-simula-un-refresh-token';

beforeAll(() => {
  // Mismo patron que `lib/rate-limit.test.ts`: `getEnv()` valida el objeto
  // completo aunque el test no toque la base ni Redis.
  process.env.DATABASE_URL ??= 'postgresql://unit:unit@localhost:5432/unit';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.MERCADOPAGO_CLIENT_ID = CLIENT_ID;
  process.env.MERCADOPAGO_CLIENT_SECRET = 'secreto-de-prueba';
  process.env.MERCADOPAGO_REDIRECT_URI = REDIRECT_URI;
  process.env.TOKEN_ENCRYPTION_KEY = CLAVE_DE_PRUEBA;

  resetEnvCache();
  resetTokenCipherCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Respuesta con la forma que documenta Mercado Pago (spec §20). */
function respuestaDeToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: ACCESS_TOKEN_FALSO,
    token_type: 'bearer',
    expires_in: 15_552_000,
    scope: 'offline_access read write',
    user_id: 123456789,
    refresh_token: REFRESH_TOKEN_FALSO,
    public_key: 'PUBLIC-KEY-DE-PRUEBA',
    live_mode: false,
    ...overrides,
  };
}

function stubFetch(response: {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
}): ReturnType<typeof vi.fn> {
  const fake = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: response.json ?? (() => Promise.resolve(respuestaDeToken())),
  });

  vi.stubGlobal('fetch', fake);
  return fake;
}

describe('buildAuthorizationUrl', () => {
  const url = (): URL =>
    new URL(
      createMercadoPagoOAuthClient().buildAuthorizationUrl({
        state: 'state-de-prueba',
        codeChallenge: 'challenge-de-prueba',
      }),
    );

  it('apunta a la URL de autorizacion oficial de Mercado Pago', () => {
    expect(url().origin + url().pathname).toBe('https://auth.mercadopago.com/authorization');
  });

  it('envia los parametros de la spec §4', () => {
    const params = url().searchParams;

    expect(Object.fromEntries(params)).toEqual({
      client_id: CLIENT_ID,
      response_type: 'code',
      platform_id: 'mp',
      redirect_uri: REDIRECT_URI,
      state: 'state-de-prueba',
      code_challenge: 'challenge-de-prueba',
      code_challenge_method: 'S256',
      scope: 'offline_access',
    });
  });

  it('usa S256 y nunca Plain (MP-OAUTH-002)', () => {
    expect(url().searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('pide offline_access, sin el cual no se puede renovar (MP-OAUTH-006)', () => {
    expect(url().searchParams.get('scope')).toBe('offline_access');
  });

  it('no filtra el client_secret en la URL', () => {
    expect(url().toString()).not.toContain('secreto-de-prueba');
  });
});

describe('exchangeAuthorizationCode', () => {
  const intercambiar = () =>
    createMercadoPagoOAuthClient().exchangeAuthorizationCode({
      code: 'code-de-prueba',
      codeVerifier: 'verifier-de-prueba',
    });

  it('hace POST al endpoint oficial de token', async () => {
    const fetchFalso = stubFetch({});

    await intercambiar();

    expect(fetchFalso).toHaveBeenCalledOnce();
    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mercadopago.com/oauth/token');
    expect(init.method).toBe('POST');
  });

  it('manda grant_type, code, code_verifier y redirect_uri', async () => {
    const fetchFalso = stubFetch({});

    await intercambiar();

    const [, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      client_id: CLIENT_ID,
      client_secret: 'secreto-de-prueba',
      code: 'code-de-prueba',
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      code_verifier: 'verifier-de-prueba',
    });
  });

  it('DEVUELVE LOS TOKENS CIFRADOS, nunca en claro', async () => {
    // Esta es la frontera de la spec §8: el dominio no puede filtrar un secreto
    // que nunca recibe.
    stubFetch({});

    const credenciales = await intercambiar();

    expect(credenciales.encryptedAccessToken).not.toContain(ACCESS_TOKEN_FALSO);
    expect(credenciales.encryptedRefreshToken).not.toContain(REFRESH_TOKEN_FALSO);
    expect(JSON.stringify(credenciales)).not.toContain(ACCESS_TOKEN_FALSO);
    expect(JSON.stringify(credenciales)).not.toContain(REFRESH_TOKEN_FALSO);
  });

  it('cifra con TOKEN_ENCRYPTION_KEY, de forma reversible', async () => {
    stubFetch({});
    const clave = Buffer.from(CLAVE_DE_PRUEBA, 'base64');

    const credenciales = await intercambiar();

    expect(decryptSecret(credenciales.encryptedAccessToken, clave)).toBe(ACCESS_TOKEN_FALSO);
    expect(decryptSecret(credenciales.encryptedRefreshToken!, clave)).toBe(REFRESH_TOKEN_FALSO);
  });

  it('normaliza user_id numerico a texto', async () => {
    stubFetch({});

    expect((await intercambiar()).mpUserId).toBe('123456789');
  });

  it('acepta user_id como string', async () => {
    stubFetch({ json: () => Promise.resolve(respuestaDeToken({ user_id: '987654321' })) });

    expect((await intercambiar()).mpUserId).toBe('987654321');
  });

  it('parte scope en la lista de scopes', async () => {
    stubFetch({});

    expect((await intercambiar()).scopes).toEqual(['offline_access', 'read', 'write']);
  });

  it('calcula expiresAt a partir de expires_in', async () => {
    stubFetch({});
    const antes = Date.now();

    const { expiresAt } = await intercambiar();

    // 15.552.000 segundos = 180 dias.
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(antes + 15_552_000 * 1000);
  });

  it('conserva public_key sin cifrar: es publica por diseno', async () => {
    stubFetch({});

    expect((await intercambiar()).publicKey).toBe('PUBLIC-KEY-DE-PRUEBA');
  });

  it('acepta una respuesta sin refresh_token', async () => {
    stubFetch({ json: () => Promise.resolve(respuestaDeToken({ refresh_token: undefined })) });

    expect((await intercambiar()).encryptedRefreshToken).toBeNull();
  });

  it('clasifica un rechazo de Mercado Pago como exchange_rejected', async () => {
    stubFetch({ ok: false, status: 400 });

    await expect(intercambiar()).rejects.toMatchObject({
      name: 'MercadoPagoOAuthError',
      failure: 'exchange_rejected',
      httpStatus: 400,
    });
  });

  it('no lee ni propaga el cuerpo de una respuesta de error', async () => {
    // Los codigos exactos de Mercado Pago estan 🔵 pendientes: mapearlos seria
    // inventarlos. Ademas el cuerpo puede arrastrar datos de la request.
    const json = vi.fn().mockResolvedValue({ error: 'invalid_grant' });
    stubFetch({ ok: false, status: 400, json });

    await expect(intercambiar()).rejects.toBeInstanceOf(MercadoPagoOAuthError);
    expect(json).not.toHaveBeenCalled();
  });

  it('clasifica un fallo de red como unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' })),
    );

    await expect(intercambiar()).rejects.toMatchObject({ failure: 'unreachable' });
  });

  it('rechaza una respuesta sin access_token', async () => {
    stubFetch({ json: () => Promise.resolve(respuestaDeToken({ access_token: undefined })) });

    await expect(intercambiar()).rejects.toMatchObject({ failure: 'invalid_response' });
  });

  it('rechaza una respuesta sin user_id en vez de inventar un fallback', async () => {
    // MP-OAUTH-007 preve un fallback contra "un endpoint autenticado de MP",
    // pero la spec NO dice cual y ese endpoint no se inventa (CLAUDE.md §16).
    stubFetch({ json: () => Promise.resolve(respuestaDeToken({ user_id: undefined })) });

    await expect(intercambiar()).rejects.toMatchObject({ failure: 'invalid_response' });
  });

  it('rechaza una respuesta sin expires_in en vez de suponer 180 dias', async () => {
    stubFetch({ json: () => Promise.resolve(respuestaDeToken({ expires_in: undefined })) });

    await expect(intercambiar()).rejects.toMatchObject({ failure: 'invalid_response' });
  });

  it('rechaza un cuerpo que no es JSON', async () => {
    stubFetch({ json: () => Promise.reject(new Error('no es json')) });

    await expect(intercambiar()).rejects.toMatchObject({ failure: 'invalid_response' });
  });

  it('nunca incluye credenciales en el mensaje de error', async () => {
    stubFetch({ ok: false, status: 401 });

    await expect(intercambiar()).rejects.toSatisfy((error: Error) => {
      const mensaje = `${error.message}${JSON.stringify(error)}`;
      return (
        !mensaje.includes('code-de-prueba') &&
        !mensaje.includes('verifier-de-prueba') &&
        !mensaje.includes('secreto-de-prueba')
      );
    });
  });
});
