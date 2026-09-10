import { randomBytes } from 'node:crypto';

import { getDatabase, schema } from '@offside/database';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type * as AuthService from '../auth/services/auth.service';
import type { PublicUser } from '../auth/services/auth.service';
import type * as ApprovalService from './services/seller-approval.service';
import type * as IdentityService from '../users/services/identity.service';
import type * as SellerService from './services/seller.service';
import type * as TaxService from './services/seller-tax-profile.service';

/**
 * TS-001 / TS-010 — identidad y aprobacion del vendedor.
 * Integracion contra PostgreSQL REAL. Requiere `docker compose up -d`.
 *
 * Limpia todo lo que crea: sufijo `@apvtest.offside`.
 */

const SUFIJO = '@apvtest.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';

/** CUIT valido: pasa digito verificador. */
const CUIT_VALIDO = '20-12345678-6';

let authService: typeof AuthService;
let sellerService: typeof SellerService;
let taxService: typeof TaxService;
let approvalService: typeof ApprovalService;
let identityService: typeof IdentityService;
let encryptToken: (plaintext: string) => string;
let closeRedis: () => Promise<void>;
let secuencia = 0;

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');

  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  loadRootEnv(import.meta.dirname);
  resetEnvCache();

  authService = await import('../auth/services/auth.service');
  sellerService = await import('./services/seller.service');
  taxService = await import('./services/seller-tax-profile.service');
  approvalService = await import('./services/seller-approval.service');
  identityService = await import('../users/services/identity.service');

  const cipher = await import('./infrastructure/mercadopago/token-cipher');
  cipher.resetTokenCipherCache();
  encryptToken = cipher.encryptToken;

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
      .delete(schema.sellerTaxProfiles)
      .where(inArray(schema.sellerTaxProfiles.sellerId, sellerIds));
    await db
      .delete(schema.mercadopagoAccounts)
      .where(inArray(schema.mercadopagoAccounts.sellerId, sellerIds));
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

async function usuarioVerificado(nombre: string): Promise<PublicUser> {
  const { emailVerificationToken } = await authService.register({
    email: email(nombre),
    password: PASSWORD,
    acceptedTerms: true,
  });

  return authService.verifyEmail(emailVerificationToken);
}

/** Usuario con perfil de vendedor, sin fiscal ni Mercado Pago. */
async function vendedorPendiente(nombre: string): Promise<PublicUser> {
  const user = await usuarioVerificado(nombre);

  await sellerService.createSellerProfile(user, {
    displayName: `Tienda ${nombre}`,
    acceptedSellerTerms: true,
  });

  return user;
}

/** Conecta Mercado Pago escribiendo directo: el OAuth tiene sus propios tests. */
async function conectarMp(user: PublicUser): Promise<void> {
  const db = getDatabase();
  secuencia += 1;

  const [perfil] = await db
    .select()
    .from(schema.sellerProfiles)
    .where(eq(schema.sellerProfiles.userId, user.id))
    .limit(1);

  await db.insert(schema.mercadopagoAccounts).values({
    sellerId: perfil!.id,
    mpUserId: `5000000${secuencia}`,
    status: 'connected',
    accessTokenEncrypted: encryptToken('token-de-prueba'),
    refreshTokenEncrypted: encryptToken('refresh-de-prueba'),
    connectedAt: new Date(),
    tokenExpiresAt: new Date(Date.now() + 86_400_000),
  });
}

/* -------------------------------------------------------------------------- */

describe('TS-001 — la regla, aislada', () => {
  it('exige las TRES senales juntas', () => {
    const todas = {
      emailVerified: true,
      fiscalIdentityDeclared: true,
      mercadoPagoConnected: true,
    };

    expect(identityService.isVerified(todas)).toBe(true);

    // Ninguna sola alcanza, y ninguna reemplaza a otra: la documentacion dice
    // que son "mecanismos que suman, no equivalen entre si".
    for (const clave of Object.keys(todas) as (keyof typeof todas)[]) {
      expect(identityService.isVerified({ ...todas, [clave]: false })).toBe(false);
    }
  });

  it('nombra lo que falta', () => {
    expect(
      identityService.missingSignals({
        emailVerified: true,
        fiscalIdentityDeclared: false,
        mercadoPagoConnected: false,
      }),
    ).toEqual(['fiscal_identity', 'mercadopago_connected']);
  });
});

describe('TS-010 — aprobacion', () => {
  it('un vendedor sin fiscal ni Mercado Pago NO se aprueba', async () => {
    const user = await vendedorPendiente('solo-perfil');

    const estado = await approvalService.evaluate(user);

    expect(estado.sellerStatus).toBe('pending');
    expect(estado.identityVerified).toBe(false);
    expect(estado.missing).toEqual(['fiscal_identity', 'mercadopago_connected']);
  });

  it('con fiscal pero sin Mercado Pago, tampoco', async () => {
    const user = await vendedorPendiente('sin-mp');
    await taxService.submitTaxIdentity(user, { taxIdType: 'CUIT', taxId: CUIT_VALIDO });

    const estado = await approvalService.evaluate(user);

    expect(estado.sellerStatus).toBe('pending');
    expect(estado.missing).toEqual(['mercadopago_connected']);
  });

  it('⚠️ con las tres senales, se aprueba SOLO', async () => {
    // El desbloqueo de TS-001: hasta hoy esto exigia un UPDATE a mano.
    const user = await vendedorPendiente('completo');
    await taxService.submitTaxIdentity(user, { taxIdType: 'CUIT', taxId: CUIT_VALIDO });
    await conectarMp(user);

    const estado = await approvalService.evaluate(user);

    expect(estado.identityVerified).toBe(true);
    expect(estado.sellerStatus).toBe('approved');
    expect(estado.missing).toEqual([]);
    expect(estado.approvedAt).not.toBeNull();
  });

  it('es idempotente: reevaluar no cambia nada ni re-aprueba', async () => {
    const user = await vendedorPendiente('idem');
    await taxService.submitTaxIdentity(user, { taxIdType: 'CUIT', taxId: CUIT_VALIDO });
    await conectarMp(user);

    const primera = await approvalService.evaluate(user);
    const segunda = await approvalService.evaluate(user);

    expect(segunda.sellerStatus).toBe('approved');
    expect(segunda.approvedAt).toBe(primera.approvedAt);

    const aprobaciones = await getDatabase()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'SELLER_APPROVED'));

    const mias = aprobaciones.filter(
      (a) => (a.metadata as { userId?: string } | null)?.userId === user.id,
    );

    expect(mias).toHaveLength(1);
  });

  it('⚠️ un usuario RESTRINGIDO no se aprueba aunque tenga las tres senales', async () => {
    const user = await vendedorPendiente('restringido');
    await taxService.submitTaxIdentity(user, { taxIdType: 'CUIT', taxId: CUIT_VALIDO });
    await conectarMp(user);

    await getDatabase()
      .update(schema.users)
      .set({ riskLevel: 'RESTRINGIDO' })
      .where(eq(schema.users.id, user.id));

    const estado = await approvalService.evaluate(user);

    expect(estado.identityVerified).toBe(true);
    expect(estado.sellerStatus).toBe('pending');
    expect(estado.missing).toContain('risk_level');
  });

  it('deja constancia de CADA evaluacion, apruebe o no', async () => {
    // Hay que poder reconstruir por que un vendedor NO fue aprobado.
    const user = await vendedorPendiente('rastro');

    await approvalService.evaluate(user);

    const verificacion = await identityService.findLatest(user.id);

    expect(verificacion?.status).toBe('unverified');
    expect(verificacion?.method).toBe(identityService.IDENTITY_METHOD);
    // ⚠️ Guarda booleanos, NUNCA el CUIT ni el email.
    expect(JSON.stringify(verificacion?.data)).not.toContain(CUIT_VALIDO);
  });

  it('registra la aceptacion de terminos al crear el perfil (TS-010 punto 3)', async () => {
    const user = await vendedorPendiente('terminos');

    const filas = await getDatabase()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorId, user.id));

    expect(filas.map((f) => f.action)).toContain('SELLER_TERMS_ACCEPTED');
  });
});

describe('el onboarding se completa solo', () => {
  it('⚠️ declarar el CUIT despues de conectar MP dispara la aprobacion', async () => {
    // El orden de los pasos no esta fijado: la evaluacion corre en los dos
    // puntos justamente para cubrir las dos secuencias.
    const user = await vendedorPendiente('orden-inverso');
    await conectarMp(user);

    expect((await approvalService.getStatus(user)).sellerStatus).toBe('pending');

    await taxService.submitTaxIdentity(user, { taxIdType: 'CUIT', taxId: CUIT_VALIDO });

    expect((await approvalService.getStatus(user)).sellerStatus).toBe('approved');
  });

  it('getStatus NO escribe verificaciones', async () => {
    // Refrescar la pantalla no puede dejar una fila por vez.
    const user = await vendedorPendiente('solo-lectura');

    await approvalService.getStatus(user);
    await approvalService.getStatus(user);

    expect(await identityService.findLatest(user.id)).toBeUndefined();
  });
});
