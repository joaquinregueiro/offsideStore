import { randomBytes } from 'node:crypto';

import { getDatabase, schema } from '@offside/database';
import { desc, eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type * as AuthService from '../auth/services/auth.service';
import type { PublicUser } from '../auth/services/auth.service';
import type * as RefreshService from './services/mercadopago-refresh.service';
import type * as SellerService from './services/seller.service';
import {
  MercadoPagoOAuthError,
  type EncryptedMercadoPagoCredentials,
  type MercadoPagoOAuthPort,
} from './infrastructure/mercadopago/mercadopago-oauth.port';

/**
 * Renovacion de tokens de Mercado Pago (spec §10).
 *
 * ⚠️ LO QUE IMPORTA ACA ES LA ROTACION Y EL LOCK. Mercado Pago devuelve un
 * `refresh_token` NUEVO en cada renovacion y descarta el anterior: si dos
 * procesos renuevan a la vez, el segundo pisa al primero y la conexion queda
 * con un token que Mercado Pago ya no acepta. Los tests de concurrencia son la
 * razon de ser de este archivo.
 *
 * Integracion contra PostgreSQL y Redis REALES. Sufijo `@mprefresh.offside`.
 */

const SUFIJO = '@mprefresh.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';
const DIA = 24 * 60 * 60 * 1000;

let authService: typeof AuthService;
let sellerService: typeof SellerService;
let refreshService: typeof RefreshService;
let encryptToken: (plaintext: string) => string;
let decryptToken: (payload: string) => string;
let closeRedis: () => Promise<void>;
let secuencia = 0;

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');

  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  loadRootEnv(import.meta.dirname);
  resetEnvCache();

  authService = await import('../auth/services/auth.service');
  sellerService = await import('./services/seller.service');
  refreshService = await import('./services/mercadopago-refresh.service');

  const cipher = await import('./infrastructure/mercadopago/token-cipher');
  cipher.resetTokenCipherCache();
  encryptToken = cipher.encryptToken;
  decryptToken = cipher.decryptToken;

  ({ closeRedisConnections: closeRedis } = await import('@offside/jobs'));

  await limpiar();
});

beforeEach(async () => {
  // Los locks viven en Redis y sobreviven entre tests: si uno quedara tomado,
  // el siguiente devolveria `locked` y el fallo seria desconcertante.
  const { getRedisClient } = await import('@offside/jobs');
  const claves = await getRedisClient().keys('mp:refresh:lock:*');
  if (claves.length > 0) await getRedisClient().del(...claves);
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
    await db.delete(schema.mercadopagoAccounts).where(
      inArray(
        schema.mercadopagoAccounts.sellerId,
        perfiles.map((p) => p.id),
      ),
    );
  }

  await db
    .delete(schema.identityVerifications)
    .where(inArray(schema.identityVerifications.userId, ids));
  await db.delete(schema.auditLog).where(inArray(schema.auditLog.actorId, ids));
  await db.delete(schema.sellerProfiles).where(inArray(schema.sellerProfiles.userId, ids));
  await db.delete(schema.userHistoryEvents).where(inArray(schema.userHistoryEvents.userId, ids));
  await db.delete(schema.sessions).where(inArray(schema.sessions.userId, ids));
  await db
    .delete(schema.emailVerificationTokens)
    .where(inArray(schema.emailVerificationTokens.userId, ids));
  await db.delete(schema.users).where(inArray(schema.users.id, ids));
}

async function usuario(nombre: string): Promise<PublicUser> {
  const { emailVerificationToken } = await authService.register({
    email: email(nombre),
    password: PASSWORD,
    acceptedTerms: true,
  });

  return authService.verifyEmail(emailVerificationToken);
}

/**
 * Vendedor con Mercado Pago conectado y un vencimiento a medida.
 * Se escribe directo: el OAuth de conexion tiene sus propios tests.
 */
async function vendedorConectado(
  nombre: string,
  opciones: {
    venceEnDias: number;
    status?: 'connected' | 'disconnected';
    refreshToken?: string | null;
  },
): Promise<string> {
  const db = getDatabase();
  secuencia += 1;

  const user = await usuario(nombre);
  const perfil = await sellerService.createSellerProfile(user, {
    displayName: `Tienda ${nombre}`,
    acceptedSellerTerms: true,
  });

  const refresh = opciones.refreshToken === undefined ? 'refresh-viejo' : opciones.refreshToken;

  await db.insert(schema.mercadopagoAccounts).values({
    sellerId: perfil.id,
    mpUserId: `6000000${secuencia}`,
    status: opciones.status ?? 'connected',
    accessTokenEncrypted: encryptToken('access-viejo'),
    refreshTokenEncrypted: refresh === null ? null : encryptToken(refresh),
    connectedAt: new Date(Date.now() - 100 * DIA),
    tokenExpiresAt: new Date(Date.now() + opciones.venceEnDias * DIA),
  });

  return perfil.id;
}

async function cuenta(sellerId: string) {
  const [row] = await getDatabase()
    .select()
    .from(schema.mercadopagoAccounts)
    .where(eq(schema.mercadopagoAccounts.sellerId, sellerId));

  return row;
}

/** Puerto falso que registra que `refresh_token` recibio y cuantas veces. */
function puertoFalso(
  opciones: { fallar?: 'rechazo' | 'red'; nuevoRefresh?: string | null } = {},
): MercadoPagoOAuthPort & { llamadas: () => number; refreshRecibido: () => string | null } {
  let llamadas = 0;
  let refreshRecibido: string | null = null;

  return {
    llamadas: () => llamadas,
    refreshRecibido: () => refreshRecibido,

    buildAuthorizationUrl: () => 'https://auth.mercadopago.com/authorization',
    exchangeAuthorizationCode: () => Promise.reject(new Error('no se usa aca')),

    refreshAccessToken({ encryptedRefreshToken }): Promise<EncryptedMercadoPagoCredentials> {
      llamadas += 1;
      // ⚠️ Llega CIFRADO. Se descifra aca solo para verificar que el servicio
      // paso el token correcto sin haberlo visto nunca en claro.
      refreshRecibido = decryptToken(encryptedRefreshToken);

      if (opciones.fallar === 'rechazo') {
        return Promise.reject(
          new MercadoPagoOAuthError('refresh_rejected', 'rechazado en el test', 400),
        );
      }

      if (opciones.fallar === 'red') {
        return Promise.reject(new MercadoPagoOAuthError('unreachable', 'sin red en el test'));
      }

      const nuevoRefresh =
        opciones.nuevoRefresh === undefined ? 'refresh-nuevo' : opciones.nuevoRefresh;

      return Promise.resolve({
        mpUserId: '60000001',
        encryptedAccessToken: encryptToken('access-nuevo'),
        encryptedRefreshToken: nuevoRefresh === null ? null : encryptToken(nuevoRefresh),
        expiresAt: new Date(Date.now() + 180 * DIA),
        scopes: ['offline_access'],
        publicKey: 'PUBLIC-KEY',
        liveMode: false,
      });
    },
  };
}

/* -------------------------------------------------------------------------- */

describe('renovacion de un vendedor', () => {
  it('renueva y GUARDA EL REFRESH TOKEN NUEVO', async () => {
    // La rotacion es lo critico: si se guardara el viejo, la conexion no se
    // podria renovar nunca mas.
    const sellerId = await vendedorConectado('rota', { venceEnDias: 5 });
    const puerto = puertoFalso();

    expect(await refreshService.refreshSeller(sellerId, puerto)).toBe('refreshed');

    const fila = await cuenta(sellerId);
    expect(decryptToken(fila!.refreshTokenEncrypted!)).toBe('refresh-nuevo');
    expect(decryptToken(fila!.accessTokenEncrypted!)).toBe('access-nuevo');
    expect(fila!.lastRefreshedAt).not.toBeNull();
    expect(puerto.refreshRecibido()).toBe('refresh-viejo');
  });

  it('renovar NO es reconectar: conserva connected_at y mp_user_id', async () => {
    const sellerId = await vendedorConectado('conserva', { venceEnDias: 5 });
    const antes = await cuenta(sellerId);

    await refreshService.refreshSeller(sellerId, puertoFalso());

    const despues = await cuenta(sellerId);
    expect(despues!.connectedAt?.getTime()).toBe(antes!.connectedAt?.getTime());
    expect(despues!.mpUserId).toBe(antes!.mpUserId);
  });

  it('deja rastro en audit_log sin tokens', async () => {
    const sellerId = await vendedorConectado('auditoria', { venceEnDias: 5 });

    await refreshService.refreshSeller(sellerId, puertoFalso());

    const [evento] = await getDatabase()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, sellerId))
      // ⚠️ SIN `ORDER BY` NO HAY ORDEN. Crear el vendedor ya deja un
      // SELLER_TERMS_ACCEPTED con el mismo entity_id, y sin esto la fila que
      // llega primero depende del orden fisico de la tabla: en PostgreSQL 17
      // salia la de la renovacion; en 18, la del alta. Es el mismo defecto que
      // se arreglo en tres repositorios el 2026-09-10.
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(1);

    expect(evento?.action).toBe('MP_TOKEN_REFRESHED');
    expect(JSON.stringify(evento?.metadata)).not.toContain('refresh-nuevo');
    expect(JSON.stringify(evento?.metadata)).not.toContain('access-nuevo');
  });

  it('no renueva una conexion que todavia esta lejos de vencer', async () => {
    const sellerId = await vendedorConectado('lejos', { venceEnDias: 120 });
    const puerto = puertoFalso();

    expect(await refreshService.refreshSeller(sellerId, puerto)).toBe('skipped');
    expect(puerto.llamadas()).toBe(0);
  });

  it('no renueva una conexion desconectada', async () => {
    const sellerId = await vendedorConectado('desconectado', {
      venceEnDias: 5,
      status: 'disconnected',
    });
    const puerto = puertoFalso();

    expect(await refreshService.refreshSeller(sellerId, puerto)).toBe('skipped');
    expect(puerto.llamadas()).toBe(0);
  });

  it('renueva una que YA VENCIO: el refresh_token puede seguir sirviendo', async () => {
    const sellerId = await vendedorConectado('vencida', { venceEnDias: -3 });

    expect(await refreshService.refreshSeller(sellerId, puertoFalso())).toBe('refreshed');
  });
});

describe('fallos', () => {
  it('⚠️ un RECHAZO de Mercado Pago deja la conexion `expired`', async () => {
    // El refresh_token dejo de servir: el vendedor tiene que reconectar.
    const sellerId = await vendedorConectado('rechazada', { venceEnDias: 5 });

    expect(await refreshService.refreshSeller(sellerId, puertoFalso({ fallar: 'rechazo' }))).toBe(
      'rejected',
    );

    expect((await cuenta(sellerId))?.status).toBe('expired');
  });

  it('⚠️ una CAIDA DE RED NO marca la conexion', async () => {
    // El token probablemente siga bien; marcarla romperia una conexion sana
    // por un problema de red.
    const sellerId = await vendedorConectado('sin-red', { venceEnDias: 5 });

    expect(await refreshService.refreshSeller(sellerId, puertoFalso({ fallar: 'red' }))).toBe(
      'unreachable',
    );

    expect((await cuenta(sellerId))?.status).toBe('connected');
  });

  it('el fallo queda auditado sin el cuerpo del error', async () => {
    const sellerId = await vendedorConectado('fallo-auditado', { venceEnDias: 5 });

    await refreshService.refreshSeller(sellerId, puertoFalso({ fallar: 'rechazo' }));

    const [evento] = await getDatabase()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, sellerId))
      // ⚠️ SIN `ORDER BY` NO HAY ORDEN. Crear el vendedor ya deja un
      // SELLER_TERMS_ACCEPTED con el mismo entity_id, y sin esto la fila que
      // llega primero depende del orden fisico de la tabla: en PostgreSQL 17
      // salia la de la renovacion; en 18, la del alta. Es el mismo defecto que
      // se arreglo en tres repositorios el 2026-09-10.
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(1);

    expect(evento?.action).toBe('MP_TOKEN_REFRESH_FAILED');
    expect(evento?.metadata).toMatchObject({ failure: 'refresh_rejected', expired: true });
  });
});

describe('concurrencia (spec §10)', () => {
  it('⚠️ DOS RENOVACIONES SIMULTANEAS: solo una llama a Mercado Pago', async () => {
    // El corazon del lock. Sin el, las dos renovarian y la segunda guardaria un
    // refresh_token que Mercado Pago ya reemplazo, dejando la conexion muerta.
    const sellerId = await vendedorConectado('concurrente', { venceEnDias: 5 });
    const puerto = puertoFalso();

    const [a, b] = await Promise.all([
      refreshService.refreshSeller(sellerId, puerto),
      refreshService.refreshSeller(sellerId, puerto),
    ]);

    expect([a, b].filter((r) => r === 'refreshed')).toHaveLength(1);
    expect([a, b].filter((r) => r === 'locked')).toHaveLength(1);
    expect(puerto.llamadas()).toBe(1);
  });

  it('el lock se libera aunque el refresh falle', async () => {
    // Si no se liberara, ese vendedor quedaria trabado hasta el TTL.
    const sellerId = await vendedorConectado('libera', { venceEnDias: 5 });

    await refreshService.refreshSeller(sellerId, puertoFalso({ fallar: 'red' }));

    // El segundo intento entra: el lock no quedo tomado.
    expect(await refreshService.refreshSeller(sellerId, puertoFalso())).toBe('refreshed');
  });

  it('⚠️ desconectarse DURANTE el refresh no reactiva la conexion', async () => {
    // La condicion va en el WHERE del UPDATE. Un refresh en vuelo no puede
    // resucitar una conexion que el vendedor dio de baja.
    const sellerId = await vendedorConectado('baja-en-vuelo', { venceEnDias: 5 });
    const db = getDatabase();

    const puertoLento: MercadoPagoOAuthPort = {
      buildAuthorizationUrl: () => '',
      exchangeAuthorizationCode: () => Promise.reject(new Error('no se usa')),
      async refreshAccessToken() {
        // El vendedor se desconecta mientras Mercado Pago "responde".
        await db
          .update(schema.mercadopagoAccounts)
          .set({ status: 'disconnected' })
          .where(eq(schema.mercadopagoAccounts.sellerId, sellerId));

        return {
          mpUserId: '60000099',
          encryptedAccessToken: encryptToken('access-nuevo'),
          encryptedRefreshToken: encryptToken('refresh-nuevo'),
          expiresAt: new Date(Date.now() + 180 * DIA),
          scopes: ['offline_access'],
          publicKey: null,
          liveMode: false,
        };
      },
    };

    expect(await refreshService.refreshSeller(sellerId, puertoLento)).toBe('skipped');

    const fila = await cuenta(sellerId);
    expect(fila?.status).toBe('disconnected');
    // Y no se escribieron las credenciales nuevas.
    expect(decryptToken(fila!.accessTokenEncrypted!)).toBe('access-viejo');
  });
});

describe('barrido', () => {
  it('renueva las que vencen y deja las demas', async () => {
    const porVencer = await vendedorConectado('barrido-cerca', { venceEnDias: 3 });
    const lejana = await vendedorConectado('barrido-lejos', { venceEnDias: 150 });

    const resumen = await refreshService.refreshExpiring(puertoFalso());

    expect(resumen.renovadas).toBeGreaterThanOrEqual(1);
    expect(decryptToken((await cuenta(porVencer))!.refreshTokenEncrypted!)).toBe('refresh-nuevo');
    expect(decryptToken((await cuenta(lejana))!.refreshTokenEncrypted!)).toBe('refresh-viejo');
  });

  it('⚠️ un vendedor que falla no frena a los demas', async () => {
    // Un refresh_token revocado no puede bloquear la renovacion del resto.
    const bueno = await vendedorConectado('barrido-ok', { venceEnDias: 3 });
    const malo = await vendedorConectado('barrido-mal', { venceEnDias: 3 });

    let primera = true;
    const puertoIntermitente: MercadoPagoOAuthPort = {
      buildAuthorizationUrl: () => '',
      exchangeAuthorizationCode: () => Promise.reject(new Error('no se usa')),
      refreshAccessToken() {
        if (primera) {
          primera = false;
          return Promise.reject(new MercadoPagoOAuthError('refresh_rejected', 'rechazado', 400));
        }

        return Promise.resolve({
          mpUserId: '60000098',
          encryptedAccessToken: encryptToken('access-nuevo'),
          encryptedRefreshToken: encryptToken('refresh-nuevo'),
          expiresAt: new Date(Date.now() + 180 * DIA),
          scopes: ['offline_access'],
          publicKey: null,
          liveMode: false,
        });
      },
    };

    const resumen = await refreshService.refreshExpiring(puertoIntermitente);

    expect(resumen.rechazadas).toBe(1);
    expect(resumen.renovadas).toBeGreaterThanOrEqual(1);

    const estados = [(await cuenta(bueno))?.status, (await cuenta(malo))?.status];
    expect(estados).toContain('expired');
    expect(estados).toContain('connected');
  });

  it('ignora las conexiones sin refresh_token', async () => {
    // Sin token que rotar no hay nada que renovar: traerlas solo produciria
    // fallos garantizados en cada barrido.
    const sinToken = await vendedorConectado('sin-refresh', {
      venceEnDias: 3,
      refreshToken: null,
    });
    const puerto = puertoFalso();

    await refreshService.refreshExpiring(puerto);

    expect((await cuenta(sinToken))?.status).toBe('connected');
  });
});
