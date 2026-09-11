import { randomUUID } from 'node:crypto';

import { getDatabase, schema } from '@offside/database';
import { eq, gt, inArray, like, ne } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type * as AuthService from '../auth/services/auth.service';
import type * as SettingsController from './controllers/settings.controller';
import type * as Store from './services/setting-store.service';
import type * as Registry from './services/settings-registry';

/**
 * `/api/admin/settings` — el BORDE HTTP generico del Config Store.
 *
 * ⚠️ Se prueba el CONTROLLER, no el servicio: que `setSetting` valide y
 * versione ya lo cubre `setting-store.integration.test.ts`. Aca importa que un
 * `Request` armado a mano no pueda cambiar la configuracion sin la capacidad,
 * y que un valor malo sea 422 y no 500.
 *
 * Integracion contra PostgreSQL REAL. Sufijo `@cfgstoreapi.offside`.
 */

const SUFIJO = '@cfgstoreapi.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';
const URL_ENDPOINT = 'https://offside.test/api/admin/settings';

let authService: typeof AuthService;
let controller: typeof SettingsController;
let store: typeof Store;
let registry: typeof Registry;
let cookieName: string;
let tierId: string;

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');
  loadRootEnv(import.meta.dirname);
  resetEnvCache();

  authService = await import('../auth/services/auth.service');
  controller = await import('./controllers/settings.controller');
  store = await import('./services/setting-store.service');
  registry = await import('./services/settings-registry');
  ({ SESSION_COOKIE_NAME: cookieName } = await import('@/lib/session-cookie'));

  const [tier] = await getDatabase()
    .select({ id: schema.sellerTiers.id })
    .from(schema.sellerTiers)
    .where(eq(schema.sellerTiers.code, 'INICIAL'))
    .limit(1);
  if (!tier) throw new Error('Falta el tier INICIAL: corre las migraciones (0010 lo siembra).');
  tierId = tier.id;

  await limpiar();
  await restaurar();
});

beforeEach(async () => {
  await restaurar();
});

afterAll(async () => {
  await restaurar();
  await limpiar();

  const { closeDatabase } = await import('@offside/database');
  await closeDatabase();

  const { closeRedisConnections } = await import('@offside/jobs');
  await closeRedisConnections();
});

/** Solo versiones 1 y solo globales, como las dejaron las migraciones. */
async function restaurar(): Promise<void> {
  const db = getDatabase();
  await db.delete(schema.appSettings).where(gt(schema.appSettings.version, 1));
  await db.delete(schema.appSettings).where(ne(schema.appSettings.scope, 'global'));
}

async function limpiar(): Promise<void> {
  const db = getDatabase();
  const usuarios = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(like(schema.users.email, `%${SUFIJO}`));
  if (usuarios.length === 0) return;
  const ids = usuarios.map((u) => u.id);

  await db
    .update(schema.appSettings)
    .set({ updatedBy: null })
    .where(inArray(schema.appSettings.updatedBy, ids));

  await db.delete(schema.auditLog).where(inArray(schema.auditLog.actorId, ids));
  await db.delete(schema.userHistoryEvents).where(inArray(schema.userHistoryEvents.userId, ids));
  await db.delete(schema.sessions).where(inArray(schema.sessions.userId, ids));
  await db
    .delete(schema.emailVerificationTokens)
    .where(inArray(schema.emailVerificationTokens.userId, ids));
  await db.delete(schema.users).where(inArray(schema.users.id, ids));
}

function get(token: string | null): Request {
  return new Request(URL_ENDPOINT, {
    headers: token === null ? {} : { cookie: `${cookieName}=${token}` },
  });
}

function put(token: string | null, body: unknown): Request {
  return new Request(URL_ENDPOINT, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { cookie: `${cookieName}=${token}` }),
    },
    body: JSON.stringify(body),
  });
}

async function conSesion(
  nombre: string,
  adminRole?: string,
): Promise<{ id: string; token: string }> {
  const { emailVerificationToken } = await authService.register({
    email: email(nombre),
    password: PASSWORD,
    acceptedTerms: true,
  });
  const user = await authService.verifyEmail(emailVerificationToken);

  if (adminRole !== undefined) {
    await getDatabase()
      .update(schema.users)
      .set({ adminRole: adminRole as 'ADMIN' })
      .where(eq(schema.users.id, user.id));
  }

  const { sessionToken } = await authService.login({ email: email(nombre), password: PASSWORD });

  return { id: user.id, token: sessionToken };
}

/* -------------------------------------------------------------------------- */

describe('GET /api/admin/settings', () => {
  it('un ADMIN ve todas las claves del registro con valor, version y definicion', async () => {
    const { token } = await conSesion('get-admin', 'ADMIN');

    const respuesta = await controller.listSettings(get(token));
    expect(respuesta.status).toBe(200);

    const cuerpo = (await respuesta.json()) as {
      settings: { key: string; value: unknown; version: number | null; source: string }[];
    };

    expect(cuerpo.settings.map((s) => s.key)).toEqual([...registry.SETTING_KEYS]);
    expect(cuerpo.settings.find((s) => s.key === 'payment_window_minutes')).toMatchObject({
      value: 2_880,
      version: 1,
      source: 'global',
    });
  });

  it('sin sesion: 401; usuario comun: 403; MODERATOR: 403', async () => {
    expect((await controller.listSettings(get(null))).status).toBe(401);

    const comun = await conSesion('get-comun');
    expect((await controller.listSettings(get(comun.token))).status).toBe(403);

    const moderador = await conSesion('get-moderador', 'MODERATOR');
    expect((await controller.listSettings(get(moderador.token))).status).toBe(403);
  });
});

describe('PUT /api/admin/settings', () => {
  it('un ADMIN cambia una clave global y queda persistida como version nueva', async () => {
    const admin = await conSesion('put-admin', 'ADMIN');

    const respuesta = await controller.updateSetting(
      put(admin.token, { key: 'payment_window_minutes', value: 1_440 }),
    );
    expect(respuesta.status).toBe(200);

    const cuerpo = (await respuesta.json()) as {
      setting: { key: string; value: unknown; scope: string; version: number; updatedBy: string };
    };
    expect(cuerpo.setting).toMatchObject({
      key: 'payment_window_minutes',
      value: 1_440,
      scope: 'global',
      version: 2,
      updatedBy: admin.id,
    });

    expect(await store.getPaymentWindowMinutes()).toBe(1_440);
  });

  it('un ADMIN escribe un override por tier', async () => {
    const admin = await conSesion('put-tier', 'ADMIN');

    const respuesta = await controller.updateSetting(
      put(admin.token, {
        key: 'dispatch_deadline_hours',
        value: 48,
        scope: 'seller_tier',
        scopeId: tierId,
      }),
    );
    expect(respuesta.status).toBe(200);

    expect(await store.resolve('dispatch_deadline_hours', { sellerTierId: tierId })).toBe(48);
    expect(await store.getDispatchDeadlineHours()).toBe(72);
  });

  it('⚠️ un valor invalido es error del CLIENTE (422) y nada cambia', async () => {
    const admin = await conSesion('put-invalido', 'ADMIN');

    for (const body of [
      { key: 'payment_window_minutes', value: -1 },
      { key: 'payment_window_minutes', value: '1440' },
      { key: 'feature_cart', value: 'true' },
      { key: 'user_level_thresholds', value: { CONFIABLE: 9, DESTACADO: 5, COLECCIONISTA: 1 } },
    ]) {
      const respuesta = await controller.updateSetting(put(admin.token, body));
      expect(respuesta.status, JSON.stringify(body)).toBe(422);
    }

    expect(await store.getPaymentWindowMinutes()).toBe(2_880);
    expect(await store.isFeatureEnabled('cart')).toBe(true);
  });

  it('clave desconocida, ambito no admitido o scope_id inconsistente: 422', async () => {
    const admin = await conSesion('put-forma', 'ADMIN');

    for (const body of [
      { key: 'no_existe', value: 1 },
      { key: 'payment_window_minutes', value: 60, scope: 'seller_tier', scopeId: tierId },
      { key: 'dispatch_deadline_hours', value: 48, scope: 'seller_tier' },
      { key: 'dispatch_deadline_hours', value: 48, scope: 'global', scopeId: tierId },
      { key: 'dispatch_deadline_hours', value: 48, scope: 'seller_tier', scopeId: randomUUID() },
      { key: 'dispatch_deadline_hours', value: 48, updatedBy: admin.id },
    ]) {
      const respuesta = await controller.updateSetting(put(admin.token, body));
      expect(respuesta.status, JSON.stringify(body)).toBe(422);
    }
  });

  it('sin sesion 401, usuario comun 403, MODERATOR 403: y nada cambia', async () => {
    expect(
      (await controller.updateSetting(put(null, { key: 'payment_window_minutes', value: 60 })))
        .status,
    ).toBe(401);

    const comun = await conSesion('put-comun');
    expect(
      (
        await controller.updateSetting(
          put(comun.token, { key: 'payment_window_minutes', value: 60 }),
        )
      ).status,
    ).toBe(403);

    const moderador = await conSesion('put-moderador', 'MODERATOR');
    expect(
      (
        await controller.updateSetting(
          put(moderador.token, { key: 'payment_window_minutes', value: 60 }),
        )
      ).status,
    ).toBe(403);

    expect(await store.getPaymentWindowMinutes()).toBe(2_880);
  });
});
