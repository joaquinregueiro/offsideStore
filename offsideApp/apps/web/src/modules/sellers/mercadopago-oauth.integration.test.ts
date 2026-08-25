import { randomBytes } from 'node:crypto';

import { getDatabase, schema } from '@offside/database';
import { and, eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type * as AuthService from '../auth/services/auth.service';
import type { PublicUser } from '../auth/services/auth.service';
import type * as MpService from './services/mercadopago-connection.service';
import type * as SellerService from './services/seller.service';
import type {
  EncryptedMercadoPagoCredentials,
  MercadoPagoOAuthPort,
} from './infrastructure/mercadopago/mercadopago-oauth.port';

/**
 * Conexion con Mercado Pago — integracion contra PostgreSQL y Redis REALES.
 * Requiere `docker compose up -d`.
 *
 *   npm test -- --project=integration
 *
 * NO sale a internet: el puerto OAuth se inyecta. Lo que se verifica es todo lo
 * que pasa de este lado —Redis, PostgreSQL, `audit_log`, cifrado y las reglas
 * de conflicto de la spec §9—, que es donde estan los errores caros.
 *
 * ⚠️ Ningun valor de este archivo es una credencial real: la clave de cifrado
 * se genera al vuelo y los "tokens" son cadenas inventadas.
 *
 * Limpia todo lo que crea: sufijo `@mpitest.offside`.
 */

const SUFIJO = '@mpitest.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';

/** Valores ficticios que hacen de credenciales de Mercado Pago. */
const ACCESS_TOKEN_FALSO = 'valor-que-simula-un-access-token';
const REFRESH_TOKEN_FALSO = 'valor-que-simula-un-refresh-token';

let authService: typeof AuthService;
let sellerService: typeof SellerService;
let mpService: typeof MpService;
let encryptToken: (plaintext: string) => string;
let decryptToken: (payload: string) => string;
let closeRedis: () => Promise<void>;

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');

  // Clave de cifrado propia del test, definida ANTES de cargar el `.env` (que
  // respeta lo que ya esta en el entorno). Asi el test no depende de que el
  // desarrollador tenga una clave configurada, y nunca usa una real.
  //
  // Las credenciales de Mercado Pago NO se definen a proposito: el puerto OAuth
  // se inyecta, y nada de este archivo debe poder llamar a Mercado Pago. Si
  // alguien quitara la inyeccion, el test fallaria en vez de salir a la red.
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');

  loadRootEnv(import.meta.dirname);
  resetEnvCache();

  authService = await import('./../auth/services/auth.service');
  sellerService = await import('./services/seller.service');
  mpService = await import('./services/mercadopago-connection.service');

  const cipher = await import('./infrastructure/mercadopago/token-cipher');
  cipher.resetTokenCipherCache();
  encryptToken = cipher.encryptToken;
  decryptToken = cipher.decryptToken;

  ({ closeRedisConnections: closeRedis } = await import('@offside/jobs'));

  await limpiar();
});

afterAll(async () => {
  await limpiar();

  const { closeDatabase } = await import('@offside/database');
  await closeDatabase();
  await closeRedis();
});

async function limpiar(): Promise<void> {
  const db = getDatabase();
  const usuarios = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(like(schema.users.email, `%${SUFIJO}`));
  if (usuarios.length === 0) return;
  const ids = usuarios.map((u) => u.id);

  const perfiles = await db
    .select({ id: schema.sellerProfiles.id })
    .from(schema.sellerProfiles)
    .where(inArray(schema.sellerProfiles.userId, ids));

  if (perfiles.length > 0) {
    const sellerIds = perfiles.map((p) => p.id);
    await db
      .delete(schema.mercadopagoAccounts)
      .where(inArray(schema.mercadopagoAccounts.sellerId, sellerIds));
  }

  await db.delete(schema.auditLog).where(inArray(schema.auditLog.actorId, ids));
  await db.delete(schema.sellerProfiles).where(inArray(schema.sellerProfiles.userId, ids));
  await db.delete(schema.userHistoryEvents).where(inArray(schema.userHistoryEvents.userId, ids));
  await db.delete(schema.sessions).where(inArray(schema.sessions.userId, ids));
  await db
    .delete(schema.emailVerificationTokens)
    .where(inArray(schema.emailVerificationTokens.userId, ids));
  await db.delete(schema.users).where(inArray(schema.users.id, ids));
}

/**
 * Vendedor APROBADO.
 *
 * ⚠️ El `status` se escribe DIRECTO EN LA BASE. No existe flujo de aprobacion y
 * no se fabrica uno para el test: la aprobacion depende de TS-001, que sigue 🟡
 * PENDIENTE (spec §4 paso 5). Inventar un endpoint de aprobacion para que el
 * test pase seria inventar la decision de negocio que falta.
 */
async function vendedorAprobado(nombre: string): Promise<{ user: PublicUser; sellerId: string }> {
  const { emailVerificationToken } = await authService.register({
    email: email(nombre),
    password: PASSWORD,
    acceptedTerms: true,
  });
  const user = await authService.verifyEmail(emailVerificationToken);
  const perfil = await sellerService.createSellerProfile(user, {
    displayName: `Tienda ${nombre}`,
    acceptedSellerTerms: true,
  });

  await getDatabase()
    .update(schema.sellerProfiles)
    .set({ status: 'approved', approvedAt: new Date() })
    .where(eq(schema.sellerProfiles.id, perfil.id));

  return { user, sellerId: perfil.id };
}

/** Vendedor sin aprobar: nace `pending` y ahi se queda. */
async function vendedorPendiente(nombre: string): Promise<PublicUser> {
  const { emailVerificationToken } = await authService.register({
    email: email(nombre),
    password: PASSWORD,
    acceptedTerms: true,
  });
  const user = await authService.verifyEmail(emailVerificationToken);
  await sellerService.createSellerProfile(user, {
    displayName: `Tienda ${nombre}`,
    acceptedSellerTerms: true,
  });

  return user;
}

/** Usuario sin perfil de vendedor. */
async function usuarioSinPerfil(nombre: string): Promise<PublicUser> {
  const { emailVerificationToken } = await authService.register({
    email: email(nombre),
    password: PASSWORD,
    acceptedTerms: true,
  });

  return authService.verifyEmail(emailVerificationToken);
}

/**
 * Doble del puerto OAuth. Captura el `state` que viaja en la URL de
 * autorizacion y devuelve credenciales YA CIFRADAS, igual que el adapter real:
 * el Service nunca ve un token en claro (spec §2 y §8).
 */
function puertoFalso(
  opciones: {
    mpUserId?: string;
    fallar?: boolean;
    accessToken?: string;
  } = {},
): MercadoPagoOAuthPort & { ultimoState: () => string; codeVerifierRecibido: () => string } {
  let ultimoState = '';
  let codeVerifierRecibido = '';

  return {
    ultimoState: () => ultimoState,
    codeVerifierRecibido: () => codeVerifierRecibido,

    buildAuthorizationUrl({ state, codeChallenge }) {
      ultimoState = state;
      return `https://auth.mercadopago.com/authorization?state=${state}&code_challenge=${codeChallenge}`;
    },

    exchangeAuthorizationCode({ codeVerifier }): Promise<EncryptedMercadoPagoCredentials> {
      codeVerifierRecibido = codeVerifier;

      if (opciones.fallar === true) {
        return Promise.reject(new Error('Mercado Pago rechazo el intercambio'));
      }

      return Promise.resolve({
        mpUserId: opciones.mpUserId ?? '100000001',
        encryptedAccessToken: encryptToken(opciones.accessToken ?? ACCESS_TOKEN_FALSO),
        encryptedRefreshToken: encryptToken(REFRESH_TOKEN_FALSO),
        expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        scopes: ['offline_access'],
        publicKey: 'PUBLIC-KEY-DE-PRUEBA',
        liveMode: false,
      });
    },
  };
}

/** Conecta de punta a punta y devuelve el `mp_user_id` usado. */
async function conectar(user: PublicUser, mpUserId: string): Promise<void> {
  const puerto = puertoFalso({ mpUserId });
  await mpService.startConnection(user, puerto);
  await mpService.completeConnection(
    user,
    { code: 'code-de-prueba', state: puerto.ultimoState() },
    puerto,
  );
}

async function auditoria(userId: string, action: string) {
  return getDatabase()
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.actorId, userId), eq(schema.auditLog.action, action)));
}

async function cuenta(sellerId: string) {
  const [row] = await getDatabase()
    .select()
    .from(schema.mercadopagoAccounts)
    .where(eq(schema.mercadopagoAccounts.sellerId, sellerId));

  return row;
}

/* -------------------------------------------------------------------------- */

describe('inicio de la conexion', () => {
  it('devuelve la URL de autorizacion con el state generado', async () => {
    const { user } = await vendedorAprobado('inicio-ok');
    const puerto = puertoFalso();

    const { authorizationUrl } = await mpService.startConnection(user, puerto);

    expect(authorizationUrl).toContain('auth.mercadopago.com');
    expect(authorizationUrl).toContain(puerto.ultimoState());
  });

  it('guarda el contexto en Redis con TTL de 600 segundos', async () => {
    const { user } = await vendedorAprobado('inicio-redis');
    const puerto = puertoFalso();

    await mpService.startConnection(user, puerto);

    const { getRedisClient } = await import('@offside/jobs');
    const ttl = await getRedisClient().ttl(`mp:oauth:state:${puerto.ultimoState()}`);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it('audita MP_CONNECTION_STARTED', async () => {
    const { user, sellerId } = await vendedorAprobado('inicio-audit');

    await mpService.startConnection(user, puertoFalso());

    const filas = await auditoria(user.id, 'MP_CONNECTION_STARTED');
    expect(filas).toHaveLength(1);
    expect(filas[0]!.entityType).toBe('mercadopago_account');
    expect(filas[0]!.entityId).toBe(sellerId);
    expect(filas[0]!.actorType).toBe('user');
  });

  it('RECHAZA a un vendedor que no esta aprobado', async () => {
    // Spec §4 paso 5. Hoy le pasa a todos los vendedores: la aprobacion
    // depende de TS-001 (🟡).
    const user = await vendedorPendiente('inicio-pending');

    await expect(mpService.startConnection(user, puertoFalso())).rejects.toMatchObject({
      code: 'MP_SELLER_NOT_APPROVED',
    });
  });

  it('rechaza a un usuario sin perfil de vendedor', async () => {
    const user = await usuarioSinPerfil('inicio-sin-perfil');

    await expect(mpService.startConnection(user, puertoFalso())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rechaza iniciar otra conexion si ya hay una activa', async () => {
    const { user } = await vendedorAprobado('inicio-duplicado');
    await conectar(user, '100000010');

    await expect(mpService.startConnection(user, puertoFalso())).rejects.toMatchObject({
      code: 'MP_ALREADY_CONNECTED',
    });
  });

  it('no crea ninguna fila en mercadopago_accounts al iniciar', async () => {
    // La fila nace recien con las credenciales: antes no se conoce el
    // `mp_user_id`, que es `NOT NULL`.
    const { user, sellerId } = await vendedorAprobado('inicio-sin-fila');

    await mpService.startConnection(user, puertoFalso());

    expect(await cuenta(sellerId)).toBeUndefined();
  });
});

describe('callback: conexion completada', () => {
  it('persiste la conexion como connected', async () => {
    const { user, sellerId } = await vendedorAprobado('callback-ok');

    await conectar(user, '100000100');

    const fila = await cuenta(sellerId);
    expect(fila?.status).toBe('connected');
    expect(fila?.mpUserId).toBe('100000100');
    expect(fila?.connectedAt).not.toBeNull();
    expect(fila?.scopes).toEqual(['offline_access']);
    expect(fila?.publicKey).toBe('PUBLIC-KEY-DE-PRUEBA');
    expect(fila?.tokenExpiresAt).not.toBeNull();
  });

  it('GUARDA LOS TOKENS CIFRADOS, nunca en claro', async () => {
    const { user, sellerId } = await vendedorAprobado('callback-cifrado');

    await conectar(user, '100000101');

    const fila = await cuenta(sellerId);
    expect(fila?.accessTokenEncrypted).not.toContain(ACCESS_TOKEN_FALSO);
    expect(fila?.refreshTokenEncrypted).not.toContain(REFRESH_TOKEN_FALSO);
    // Y son recuperables: cifrado, no destruido.
    expect(decryptToken(fila!.accessTokenEncrypted!)).toBe(ACCESS_TOKEN_FALSO);
    expect(decryptToken(fila!.refreshTokenEncrypted!)).toBe(REFRESH_TOKEN_FALSO);
  });

  it('le pasa a infraestructura el code_verifier que se guardo en Redis', async () => {
    const { user } = await vendedorAprobado('callback-pkce');
    const puerto = puertoFalso({ mpUserId: '100000102' });

    await mpService.startConnection(user, puerto);
    await mpService.completeConnection(
      user,
      { code: 'code-de-prueba', state: puerto.ultimoState() },
      puerto,
    );

    expect(puerto.codeVerifierRecibido()).toHaveLength(86);
  });

  it('audita MP_CONNECTION_SUCCEEDED sin ningun token', async () => {
    const { user, sellerId } = await vendedorAprobado('callback-audit');

    await conectar(user, '100000103');

    const filas = await auditoria(user.id, 'MP_CONNECTION_SUCCEEDED');
    expect(filas).toHaveLength(1);
    expect(filas[0]!.entityId).toBe(sellerId);

    const metadata = filas[0]!.metadata as Record<string, unknown>;
    expect(metadata.mpUserId).toBe('100000103');
    expect(metadata.liveMode).toBe(false);
    expect(JSON.stringify(metadata)).not.toContain(ACCESS_TOKEN_FALSO);
    expect(JSON.stringify(metadata)).not.toContain(REFRESH_TOKEN_FALSO);
  });

  it('devuelve canSell verdadero', async () => {
    const { user } = await vendedorAprobado('callback-cansell');
    const puerto = puertoFalso({ mpUserId: '100000104' });

    await mpService.startConnection(user, puerto);
    const resultado = await mpService.completeConnection(
      user,
      { code: 'code-de-prueba', state: puerto.ultimoState() },
      puerto,
    );

    expect(resultado.canSell).toBe(true);
    expect(resultado).not.toHaveProperty('accessToken');
  });
});

describe('callback: state', () => {
  it('un state ya usado no sirve una segunda vez', async () => {
    // GETDEL atomico: el replay del callback no encuentra nada (spec §15).
    const { user } = await vendedorAprobado('state-replay');
    const puerto = puertoFalso({ mpUserId: '100000200' });

    await mpService.startConnection(user, puerto);
    await mpService.completeConnection(
      user,
      { code: 'code-de-prueba', state: puerto.ultimoState() },
      puerto,
    );

    await expect(
      mpService.completeConnection(
        user,
        { code: 'code-de-prueba', state: puerto.ultimoState() },
        puerto,
      ),
    ).rejects.toMatchObject({ code: 'MP_INVALID_STATE' });
  });

  it('rechaza un state desconocido y lo audita', async () => {
    const { user } = await vendedorAprobado('state-desconocido');

    await expect(
      mpService.completeConnection(
        user,
        { code: 'code-de-prueba', state: 'inventado' },
        puertoFalso(),
      ),
    ).rejects.toMatchObject({ code: 'MP_INVALID_STATE' });

    const filas = await auditoria(user.id, 'MP_CONNECTION_FAILED');
    expect(filas).toHaveLength(1);
    expect((filas[0]!.metadata as Record<string, unknown>).reason).toBe('state_invalid');
  });

  it('RECHAZA el state de OTRO usuario', async () => {
    // Account takeover: sin esto, quien complete el callback con el state ajeno
    // vincularia una cuenta de Mercado Pago a la sesion equivocada (spec §15).
    const { user: victima } = await vendedorAprobado('state-victima');
    const { user: atacante } = await vendedorAprobado('state-atacante');
    const puerto = puertoFalso({ mpUserId: '100000201' });

    await mpService.startConnection(victima, puerto);

    await expect(
      mpService.completeConnection(
        atacante,
        { code: 'code-de-prueba', state: puerto.ultimoState() },
        puerto,
      ),
    ).rejects.toMatchObject({ code: 'MP_INVALID_STATE' });
  });

  it('descartar un state pendiente lo invalida', async () => {
    const { user } = await vendedorAprobado('state-descartado');
    const puerto = puertoFalso();

    await mpService.startConnection(user, puerto);
    await mpService.discardPendingState(puerto.ultimoState());

    await expect(
      mpService.completeConnection(
        user,
        { code: 'code-de-prueba', state: puerto.ultimoState() },
        puerto,
      ),
    ).rejects.toMatchObject({ code: 'MP_INVALID_STATE' });
  });
});

describe('callback: intercambio fallido', () => {
  it('no persiste nada y audita el motivo', async () => {
    const { user, sellerId } = await vendedorAprobado('exchange-falla');
    const puerto = puertoFalso({ fallar: true });

    await mpService.startConnection(user, puerto);

    await expect(
      mpService.completeConnection(
        user,
        { code: 'code-de-prueba', state: puerto.ultimoState() },
        puerto,
      ),
    ).rejects.toMatchObject({ code: 'MP_EXCHANGE_FAILED' });

    expect(await cuenta(sellerId)).toBeUndefined();

    const filas = await auditoria(user.id, 'MP_CONNECTION_FAILED');
    expect((filas[0]!.metadata as Record<string, unknown>).reason).toBe('exchange_failed');
  });
});

describe('conflictos de cuenta (spec §9)', () => {
  it('caso B: reconectar la MISMA cuenta actualiza la fila existente', async () => {
    const { user, sellerId } = await vendedorAprobado('caso-b');
    await conectar(user, '100000300');
    await mpService.disconnect(user);

    await conectar(user, '100000300');

    const fila = await cuenta(sellerId);
    expect(fila?.status).toBe('connected');
    expect(fila?.mpUserId).toBe('100000300');

    // `UNIQUE(seller_id)`: sigue habiendo UNA sola conexion.
    const todas = await getDatabase()
      .select()
      .from(schema.mercadopagoAccounts)
      .where(eq(schema.mercadopagoAccounts.sellerId, sellerId));
    expect(todas).toHaveLength(1);
  });

  it('caso C: cambiar a OTRA cuenta propia se permite y se audita', async () => {
    const { user, sellerId } = await vendedorAprobado('caso-c');
    await conectar(user, '100000301');
    await mpService.disconnect(user);

    await conectar(user, '100000302');

    expect((await cuenta(sellerId))?.mpUserId).toBe('100000302');

    const filas = await auditoria(user.id, 'MP_ACCOUNT_CONFLICT');
    expect(filas).toHaveLength(1);
    const metadata = filas[0]!.metadata as Record<string, unknown>;
    expect(metadata.previousMpUserId).toBe('100000301');
    expect(metadata.mpUserId).toBe('100000302');
  });

  it('caso D: una cuenta ya vinculada a OTRO vendedor se rechaza', async () => {
    const { user: primero, sellerId: sellerPrimero } = await vendedorAprobado('caso-d-uno');
    const { user: segundo, sellerId: sellerSegundo } = await vendedorAprobado('caso-d-dos');

    await conectar(primero, '100000400');

    const puerto = puertoFalso({ mpUserId: '100000400' });
    await mpService.startConnection(segundo, puerto);

    await expect(
      mpService.completeConnection(
        segundo,
        { code: 'code-de-prueba', state: puerto.ultimoState() },
        puerto,
      ),
    ).rejects.toMatchObject({ code: 'MP_ACCOUNT_CONFLICT' });

    // El segundo vendedor no queda con conexion...
    expect(await cuenta(sellerSegundo)).toBeUndefined();
    // ...y la del primero queda intacta.
    expect((await cuenta(sellerPrimero))?.status).toBe('connected');

    const filas = await auditoria(segundo.id, 'MP_ACCOUNT_CONFLICT');
    expect(filas).toHaveLength(1);
  });

  it('el mensaje de error no revela que la cuenta pertenece a otro vendedor', async () => {
    // Spec §14: decirlo permitiria descubrir que cuentas estan registradas.
    const { user: primero } = await vendedorAprobado('caso-d-fuga-uno');
    const { user: segundo } = await vendedorAprobado('caso-d-fuga-dos');

    await conectar(primero, '100000401');

    const puerto = puertoFalso({ mpUserId: '100000401' });
    await mpService.startConnection(segundo, puerto);

    await expect(
      mpService.completeConnection(
        segundo,
        { code: 'code-de-prueba', state: puerto.ultimoState() },
        puerto,
      ),
    ).rejects.toSatisfy(
      (error: Error) => !/otro vendedor|another seller|100000401/i.test(error.message),
    );
  });
});

describe('estado de la conexion', () => {
  it('devuelve null y canSell falso cuando nunca se conecto', async () => {
    const { user } = await vendedorAprobado('status-vacio');

    expect(await mpService.getConnectionStatus(user)).toMatchObject({
      status: null,
      mpUserId: null,
      canSell: false,
    });
  });

  it('nunca devuelve tokens', async () => {
    const { user } = await vendedorAprobado('status-sin-tokens');
    await conectar(user, '100000500');

    const estado = await mpService.getConnectionStatus(user);

    expect(JSON.stringify(estado)).not.toContain(ACCESS_TOKEN_FALSO);
    expect(JSON.stringify(estado)).not.toContain(REFRESH_TOKEN_FALSO);
    expect(Object.keys(estado)).toEqual([
      'status',
      'connectedAt',
      'expiresAt',
      'mpUserId',
      'canSell',
    ]);
  });

  it('canSell es falso para un vendedor pendiente aunque la conexion exista', async () => {
    const { user, sellerId } = await vendedorAprobado('status-degradado');
    await conectar(user, '100000501');

    // Se revoca la aprobacion (TS-011): `pending` + `connected` es alcanzable.
    await getDatabase()
      .update(schema.sellerProfiles)
      .set({ status: 'pending' })
      .where(eq(schema.sellerProfiles.id, sellerId));

    expect(await mpService.getConnectionStatus(user)).toMatchObject({
      status: 'connected',
      canSell: false,
    });
  });
});

describe('desvinculacion', () => {
  it('marca disconnected, audita y deja canSell en falso', async () => {
    const { user, sellerId } = await vendedorAprobado('disconnect-ok');
    await conectar(user, '100000600');

    const resultado = await mpService.disconnect(user);

    expect(resultado.status).toBe('disconnected');
    expect(resultado.canSell).toBe(false);
    expect((await cuenta(sellerId))?.status).toBe('disconnected');

    const filas = await auditoria(user.id, 'MP_DISCONNECTED');
    expect(filas).toHaveLength(1);
    expect(filas[0]!.before).toEqual({ status: 'connected' });
    expect(filas[0]!.after).toEqual({ status: 'disconnected' });
  });

  it('NO toca el estado del vendedor: son dos maquinas de estado independientes', async () => {
    const { user, sellerId } = await vendedorAprobado('disconnect-seller');
    await conectar(user, '100000601');

    await mpService.disconnect(user);

    const [perfil] = await getDatabase()
      .select()
      .from(schema.sellerProfiles)
      .where(eq(schema.sellerProfiles.id, sellerId));

    expect(perfil?.status).toBe('approved');
  });

  it('conserva las credenciales cifradas para permitir reconectar', async () => {
    const { user, sellerId } = await vendedorAprobado('disconnect-credenciales');
    await conectar(user, '100000602');

    await mpService.disconnect(user);

    expect((await cuenta(sellerId))?.accessTokenEncrypted).not.toBeNull();
  });

  it('falla si no hay ninguna conexion', async () => {
    const { user } = await vendedorAprobado('disconnect-vacio');

    await expect(mpService.disconnect(user)).rejects.toMatchObject({ code: 'MP_NOT_CONNECTED' });
  });
});

describe('barrido de credenciales', () => {
  it('ninguna fila de audit_log escrita por el flujo contiene un token', async () => {
    // Spec §16: los tokens no pueden aparecer en `audit_log` ni truncados.
    const { user } = await vendedorAprobado('barrido');
    await conectar(user, '100000700');
    await mpService.disconnect(user);

    const filas = await getDatabase()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorId, user.id));

    expect(filas.length).toBeGreaterThan(0);
    const volcado = JSON.stringify(filas);

    expect(volcado).not.toContain(ACCESS_TOKEN_FALSO);
    expect(volcado).not.toContain(REFRESH_TOKEN_FALSO);
    expect(volcado).not.toContain('code-de-prueba');
    expect(volcado).not.toContain('secreto-de-prueba');
  });

  it('el servicio de auditoria rechaza cualquier campo que sea una credencial', async () => {
    const audit = await import('../audit/services/audit.service');

    await expect(
      audit.record({
        actorType: 'system',
        action: 'PRUEBA',
        entityType: 'mercadopago_account',
        metadata: { access_token: 'no-deberia-poder-guardarse' },
      }),
    ).rejects.toThrowError(/access_token/);
  });
});
