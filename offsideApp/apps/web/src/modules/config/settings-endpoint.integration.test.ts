import { getDatabase, schema } from '@offside/database';
import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type * as AuthService from '../auth/services/auth.service';
import type * as SellerService from '../sellers/services/seller.service';
import type * as SettingsController from './controllers/settings.controller';
import type * as SettingsService from './services/settings.service';

/**
 * `/api/admin/settings/commission` — el BORDE HTTP del Config Store.
 *
 * ⚠️ Se prueba el CONTROLLER, no el servicio. Que `setCommissionRateBasisPoints`
 * valide bien ya lo cubre `config.integration.test.ts`; lo que hay que probar
 * aca es que un `Request` armado a mano —sin frontend en el medio— no pueda
 * cambiar la comision sin autorizacion.
 *
 * Integracion contra PostgreSQL REAL. Sufijo `@cfgapi.offside`.
 */

const SUFIJO = '@cfgapi.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';
const URL_ENDPOINT = 'https://offside.test/api/admin/settings/commission';

let authService: typeof AuthService;
let sellerService: typeof SellerService;
let settingsService: typeof SettingsService;
let controller: typeof SettingsController;
let cookieName: string;

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');

  const { randomBytes } = await import('node:crypto');
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');

  loadRootEnv(import.meta.dirname);
  resetEnvCache();

  authService = await import('../auth/services/auth.service');
  sellerService = await import('../sellers/services/seller.service');
  settingsService = await import('./services/settings.service');
  controller = await import('./controllers/settings.controller');

  ({ SESSION_COOKIE_NAME: cookieName } = await import('@/lib/session-cookie'));

  await limpiar();
});

beforeEach(async () => {
  await restaurarTasa();
});

afterAll(async () => {
  await limpiar();
  await restaurarTasa();

  const { closeDatabase } = await import('@offside/database');
  await closeDatabase();

  const { closeRedisConnections } = await import('@offside/jobs');
  await closeRedisConnections();
});

/** Deja la comision como la dejo la migracion: una sola version, 600 bp. */
async function restaurarTasa(): Promise<void> {
  const db = getDatabase();

  await db
    .delete(schema.appSettings)
    .where(
      and(
        eq(schema.appSettings.scope, 'global'),
        isNull(schema.appSettings.scopeId),
        eq(schema.appSettings.key, 'commission_rate_default'),
      ),
    );

  await db.insert(schema.appSettings).values({
    scope: 'global',
    scopeId: null,
    key: 'commission_rate_default',
    value: 600,
    valueType: 'rate',
    version: 1,
  });
}

async function limpiar(): Promise<void> {
  const db = getDatabase();
  const usuarios = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(like(schema.users.email, `%${SUFIJO}`));
  if (usuarios.length === 0) return;
  const ids = usuarios.map((u) => u.id);

  // `app_settings.updated_by` es FK a `users`: hay que soltarla antes de borrar.
  await db
    .update(schema.appSettings)
    .set({ updatedBy: null })
    .where(inArray(schema.appSettings.updatedBy, ids));

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
  opciones: { adminRole?: string; vendedor?: boolean } = {},
): Promise<{ id: string; token: string }> {
  const { emailVerificationToken } = await authService.register({
    email: email(nombre),
    password: PASSWORD,
    acceptedTerms: true,
  });
  const user = await authService.verifyEmail(emailVerificationToken);

  if (opciones.vendedor === true) {
    await sellerService.createSellerProfile(user, {
      displayName: `Tienda ${nombre}`,
      acceptedSellerTerms: true,
    });
  }

  if (opciones.adminRole !== undefined) {
    await getDatabase()
      .update(schema.users)
      .set({ adminRole: opciones.adminRole as 'ADMIN' })
      .where(eq(schema.users.id, user.id));
  }

  const { sessionToken } = await authService.login({ email: email(nombre), password: PASSWORD });

  return { id: user.id, token: sessionToken };
}

/* -------------------------------------------------------------------------- */

describe('GET /api/admin/settings/commission', () => {
  it('un ADMIN ve la comision vigente', async () => {
    const { token } = await conSesion('get-admin', { adminRole: 'ADMIN' });

    const respuesta = await controller.getCommission(get(token));
    expect(respuesta.status).toBe(200);

    const cuerpo = (await respuesta.json()) as {
      commission: { basisPoints: number; percent: string; version: number; key: string };
    };

    expect(cuerpo.commission.basisPoints).toBe(600);
    expect(cuerpo.commission.percent).toBe('6%');
    expect(cuerpo.commission.key).toBe('commission_rate_default');
    expect(cuerpo.commission.version).toBe(1);
  });

  it('sin sesion: 401', async () => {
    expect((await controller.getCommission(get(null))).status).toBe(401);
  });

  it('usuario comun: 403', async () => {
    const { token } = await conSesion('get-comun');

    expect((await controller.getCommission(get(token))).status).toBe(403);
  });

  it('⚠️ VENDEDOR: 403', async () => {
    const { token } = await conSesion('get-vendedor', { vendedor: true });

    expect((await controller.getCommission(get(token))).status).toBe(403);
  });

  it('⚠️ FINANCE puede reembolsar pero NO ver la configuracion: 403', async () => {
    // El mapa de DEC-023 no le da `system_config:manage`.
    const { token } = await conSesion('get-finance', { adminRole: 'FINANCE' });

    expect((await controller.getCommission(get(token))).status).toBe(403);
  });
});

describe('PUT /api/admin/settings/commission', () => {
  it('un ADMIN cambia la comision y queda persistida', async () => {
    const { token } = await conSesion('put-admin', { adminRole: 'ADMIN' });

    const respuesta = await controller.updateCommission(put(token, { basisPoints: 700 }));
    expect(respuesta.status).toBe(200);

    const cuerpo = (await respuesta.json()) as {
      commission: { basisPoints: number; percent: string; version: number };
    };
    expect(cuerpo.commission.basisPoints).toBe(700);
    expect(cuerpo.commission.percent).toBe('7%');
    expect(cuerpo.commission.version).toBe(2);

    // Y de verdad quedo en la base, no solo en la respuesta.
    expect(await settingsService.getCommissionRateBasisPoints()).toBe(700);
  });

  it('SUPER_ADMIN tambien puede', async () => {
    const { token } = await conSesion('put-super', { adminRole: 'SUPER_ADMIN' });

    expect((await controller.updateCommission(put(token, { basisPoints: 650 }))).status).toBe(200);
    expect(await settingsService.getCommissionRateBasisPoints()).toBe(650);
  });

  it('⚠️ updatedBy sale de la SESION, no del cuerpo', async () => {
    const admin = await conSesion('put-autor', { adminRole: 'ADMIN' });
    const otro = await conSesion('put-otro', { adminRole: 'ADMIN' });

    // Se intenta declarar a otro usuario como autor del cambio.
    const respuesta = await controller.updateCommission(
      put(admin.token, { basisPoints: 800, updatedBy: otro.id }),
    );

    // El schema es `.strict()`: el campo de mas se rechaza en vez de ignorarse
    // en silencio, asi queda claro que no se acepta.
    expect(respuesta.status).toBe(422);

    // Y la comision no se movio.
    expect(await settingsService.getCommissionRateBasisPoints()).toBe(600);
  });

  it('el autor registrado es el administrador autenticado', async () => {
    const admin = await conSesion('put-registro', { adminRole: 'ADMIN' });

    await controller.updateCommission(put(admin.token, { basisPoints: 750 }));

    const fila = await settingsService.findCurrentCommissionSetting();

    expect(fila?.updatedBy).toBe(admin.id);
    expect(fila?.value).toBe(750);
  });

  it('sin sesion: 401 y la comision NO cambia', async () => {
    const respuesta = await controller.updateCommission(put(null, { basisPoints: 900 }));

    expect(respuesta.status).toBe(401);
    expect(await settingsService.getCommissionRateBasisPoints()).toBe(600);
  });

  it('⚠️ usuario comun llamando DIRECTO a la API: 403 y la comision NO cambia', async () => {
    const { token } = await conSesion('put-comun');

    const respuesta = await controller.updateCommission(put(token, { basisPoints: 900 }));

    expect(respuesta.status).toBe(403);
    expect(await settingsService.getCommissionRateBasisPoints()).toBe(600);
  });

  it('⚠️ VENDEDOR llamando DIRECTO a la API: 403 y la comision NO cambia', async () => {
    const { token } = await conSesion('put-vendedor', { vendedor: true });

    const respuesta = await controller.updateCommission(put(token, { basisPoints: 900 }));

    expect(respuesta.status).toBe(403);
    expect(await settingsService.getCommissionRateBasisPoints()).toBe(600);
  });

  it('⚠️ MODERATOR es admin pero no tiene la capacidad: 403', async () => {
    const { token } = await conSesion('put-moderador', { adminRole: 'MODERATOR' });

    expect((await controller.updateCommission(put(token, { basisPoints: 900 }))).status).toBe(403);
    expect(await settingsService.getCommissionRateBasisPoints()).toBe(600);
  });

  it('⚠️ un valor invalido es error del CLIENTE (422), no del servidor', async () => {
    // Un administrador que se equivoca escribiendo tiene que recibir un 422
    // que se lo explique, no un 500 que parezca un bug nuestro.
    const { token } = await conSesion('put-invalido', { adminRole: 'ADMIN' });

    for (const valor of [10_001, -1, 6.5]) {
      const respuesta = await controller.updateCommission(put(token, { basisPoints: valor }));
      expect(respuesta.status).toBe(422);
    }

    expect(await settingsService.getCommissionRateBasisPoints()).toBe(600);
  });

  it('acepta los extremos validos', async () => {
    const { token } = await conSesion('put-extremos', { adminRole: 'ADMIN' });

    expect((await controller.updateCommission(put(token, { basisPoints: 0 }))).status).toBe(200);
    expect((await controller.updateCommission(put(token, { basisPoints: 10_000 }))).status).toBe(
      200,
    );
  });
});

describe('el valor configurado llega al calculo', () => {
  it('⚠️ cambiar por la API afecta a las ordenes NUEVAS, no a las viejas', async () => {
    // La propiedad que hace utilizable al Config Store sin romper la
    // contabilidad. El caso ya se cubre a nivel de servicio; aca se verifica
    // que tambien valga cuando el cambio entra POR EL ENDPOINT.
    const { token } = await conSesion('calc-admin', { adminRole: 'ADMIN' });
    const orderService = await import('../orders/services/order.service');

    expect(await settingsService.getCommissionRateBasisPoints()).toBe(600);
    const antes = orderService.calculateCommission(
      10_000_000n,
      await settingsService.getCommissionRateBasisPoints(),
    );
    expect(antes).toBe(600_000n);

    await controller.updateCommission(put(token, { basisPoints: 700 }));

    const despues = orderService.calculateCommission(
      10_000_000n,
      await settingsService.getCommissionRateBasisPoints(),
    );
    expect(despues).toBe(700_000n);

    // El snapshot de una orden creada antes seguiria siendo 600_000n: eso lo
    // verifica `config.integration.test.ts` contra ordenes reales.
    expect(antes).toBe(600_000n);
  });
});
