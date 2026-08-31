import { getDatabase, schema } from '@offside/database';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type * as AuthService from './services/auth.service';
import type { PublicUser } from './services/auth.service';
import type * as SellerService from '../sellers/services/seller.service';
import type * as Guard from '@/lib/auth-guard';
import { CAPABILITIES } from '@/lib/permissions';

/**
 * DEC-023 — autorizacion en el BORDE HTTP.
 *
 * ⚠️ POR QUE ESTE ARCHIVO EXISTE. Los tests de rol que ya habia verificaban el
 * dominio: que `adminRole` se resolviera bien. Eso NO prueba lo que importa,
 * que es que un `Request` hecho a mano —sin pasar por ningun frontend— no pueda
 * saltear el guard. La seguridad vive en el borde y ahi hay que probarla.
 *
 * Cada caso arma un `Request` real con su cookie de sesion y lo pasa por el
 * guard, igual que haria el Route Handler.
 *
 * Integracion contra PostgreSQL REAL. Sufijo `@authztest.offside`.
 */

const SUFIJO = '@authztest.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';

let authService: typeof AuthService;
let sellerService: typeof SellerService;
let guard: typeof Guard;
let cookieName: string;

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');

  // El guard alcanza a `sellers`, que llega a `token-cipher`. Igual que en el
  // resto de los tests de integracion: clave inventada, local y por corrida.
  const { randomBytes } = await import('node:crypto');
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');

  loadRootEnv(import.meta.dirname);
  resetEnvCache();

  authService = await import('./services/auth.service');
  sellerService = await import('../sellers/services/seller.service');
  guard = await import('@/lib/auth-guard');

  ({ SESSION_COOKIE_NAME: cookieName } = await import('@/lib/session-cookie'));

  await limpiar();
});

afterAll(async () => {
  await limpiar();

  const { closeDatabase } = await import('@offside/database');
  await closeDatabase();

  const { closeRedisConnections } = await import('@offside/jobs');
  await closeRedisConnections();
});

async function limpiar(): Promise<void> {
  const db = getDatabase();
  const usuarios = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(like(schema.users.email, `%${SUFIJO}`));
  if (usuarios.length === 0) return;
  const ids = usuarios.map((u) => u.id);

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

/** Request con la cookie de sesion, tal como llegaria de un cliente real. */
function pedido(sessionToken: string | null): Request {
  return new Request('https://offside.test/api/payments/x/refunds', {
    method: 'POST',
    headers: sessionToken === null ? {} : { cookie: `${cookieName}=${sessionToken}` },
  });
}

/** Usuario verificado + su token de sesion. */
async function conSesion(
  nombre: string,
  opciones: { adminRole?: string; vendedor?: boolean } = {},
): Promise<{ user: PublicUser; token: string }> {
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

  return { user, token: sessionToken };
}

/* -------------------------------------------------------------------------- */

describe('requireCapability en el borde', () => {
  it('⚠️ SIN SESION: 401, no 403', async () => {
    // Un anonimo no debe poder distinguir "no existe" de "no podes": un 403
    // le confirmaria que el recurso existe.
    await expect(
      guard.requireCapability(pedido(null), CAPABILITIES.PAYMENTS_REFUND),
    ).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
  });

  it('⚠️ USUARIO COMUN llamando DIRECTO a la API: 403', async () => {
    // El caso que importa: no hay frontend en el medio, el Request se arma a
    // mano. Igual lo frena.
    const { token } = await conSesion('comun');

    await expect(
      guard.requireCapability(pedido(token), CAPABILITIES.PAYMENTS_REFUND),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('⚠️ VENDEDOR llamando DIRECTO a la API: 403', async () => {
    // Ser vendedor no acerca a ser administrador.
    const { token } = await conSesion('vendedor', { vendedor: true });

    await expect(
      guard.requireCapability(pedido(token), CAPABILITIES.PAYMENTS_REFUND),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('ADMIN con la capacidad: pasa', async () => {
    const { user, token } = await conSesion('admin-ok', { adminRole: 'ADMIN' });

    const autorizado = await guard.requireCapability(pedido(token), CAPABILITIES.PAYMENTS_REFUND);

    expect(autorizado.id).toBe(user.id);
    expect(autorizado.adminRole).toBe('ADMIN');
  });

  it('⚠️ MODERATOR es admin pero NO tiene la capacidad: 403', async () => {
    // Tener un rol administrativo no alcanza: se autoriza por capacidad.
    const { token } = await conSesion('moderador', { adminRole: 'MODERATOR' });

    await expect(
      guard.requireCapability(pedido(token), CAPABILITIES.PAYMENTS_REFUND),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('FINANCE reembolsa pero NO configura', async () => {
    const { token } = await conSesion('finanzas', { adminRole: 'FINANCE' });

    await expect(
      guard.requireCapability(pedido(token), CAPABILITIES.PAYMENTS_REFUND),
    ).resolves.toBeDefined();

    await expect(
      guard.requireCapability(pedido(token), CAPABILITIES.SYSTEM_CONFIG_MANAGE),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('⚠️ una sesion cerrada deja de autorizar', async () => {
    // Quitar el rol no basta si la sesion sigue viva: el guard resuelve el
    // usuario en CADA request, no confia en lo que se guardo al loguearse.
    const { user, token } = await conSesion('revocado', { adminRole: 'ADMIN' });

    await expect(
      guard.requireCapability(pedido(token), CAPABILITIES.PAYMENTS_REFUND),
    ).resolves.toBeDefined();

    await getDatabase()
      .update(schema.users)
      .set({ adminRole: null })
      .where(eq(schema.users.id, user.id));

    await expect(
      guard.requireCapability(pedido(token), CAPABILITIES.PAYMENTS_REFUND),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('un token de sesion inventado no autoriza', async () => {
    await expect(
      guard.requireCapability(pedido('token-que-no-existe'), CAPABILITIES.PAYMENTS_REFUND),
    ).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
  });
});

describe('requireSeller en el borde', () => {
  it('un vendedor pasa', async () => {
    const { user, token } = await conSesion('vend-ok', { vendedor: true });

    expect((await guard.requireSeller(pedido(token))).id).toBe(user.id);
  });

  it('un usuario sin perfil de vendedor: 403', async () => {
    const { token } = await conSesion('sin-perfil');

    await expect(guard.requireSeller(pedido(token))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('⚠️ un ADMIN sin perfil de vendedor tampoco pasa', async () => {
    // Los ejes son independientes: ser administrador no vuelve vendedor a
    // nadie. Confundirlos dejaria a un admin publicando sin cuenta de cobro.
    const { token } = await conSesion('admin-no-vendedor', { adminRole: 'SUPER_ADMIN' });

    await expect(guard.requireSeller(pedido(token))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('sin sesion: 401', async () => {
    await expect(guard.requireSeller(pedido(null))).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
    });
  });
});
