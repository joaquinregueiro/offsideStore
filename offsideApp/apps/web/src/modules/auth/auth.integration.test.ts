import { getDatabase, schema } from '@offside/database';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as errors from './auth.errors';
import type * as AuthService from './services/auth.service';
import type * as SellerService from '../sellers/services/seller.service';

/**
 * Tests de integracion contra PostgreSQL REAL.
 *
 * Requieren `docker compose up -d`. Se ejecutan con:
 *   npm test -- --project=integration
 *
 * LIMPIEZA: todos los usuarios de prueba usan el sufijo `@itest.offside` y se
 * borran en `afterAll`. No queda ningun dato de negocio persistido.
 */

const SUFIJO = '@itest.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';

// Se importan de forma diferida en `beforeAll`: los Services leen el entorno al
// cargarse, y el `.env` se resuelve recien ahi.
let authService: typeof AuthService;
let sellerService: typeof SellerService;

beforeAll(async () => {
  const { loadRootEnv } = await import('@offside/config');
  loadRootEnv(import.meta.dirname);

  authService = await import('./services/auth.service');
  sellerService = await import('../sellers/services/seller.service');

  await limpiar();
});

afterAll(async () => {
  await limpiar();
  const { closeDatabase } = await import('@offside/database');
  await closeDatabase();
});

/** Borra en orden inverso a las FK (RESTRICT no perdona). */
async function limpiar(): Promise<void> {
  const db = getDatabase();
  const usuarios = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(like(schema.users.email, `%${SUFIJO}`));

  if (usuarios.length === 0) return;
  const ids = usuarios.map((u) => u.id);

  await db.delete(schema.sellerProfiles).where(inArray(schema.sellerProfiles.userId, ids));
  await db.delete(schema.userHistoryEvents).where(inArray(schema.userHistoryEvents.userId, ids));
  await db.delete(schema.sessions).where(inArray(schema.sessions.userId, ids));
  await db
    .delete(schema.emailVerificationTokens)
    .where(inArray(schema.emailVerificationTokens.userId, ids));
  await db
    .delete(schema.passwordResetTokens)
    .where(inArray(schema.passwordResetTokens.userId, ids));
  await db.delete(schema.users).where(inArray(schema.users.id, ids));
}

/**
 * Registra y verifica el email, que es el estado normal para operar (BR-001).
 *
 * Devuelve el usuario YA VERIFICADO (el que retorna `verifyEmail`), no el del
 * registro: ese todavia tiene `emailVerified: false`.
 */
async function usuarioVerificado(nombre: string) {
  const { emailVerificationToken } = await authService.register({
    email: email(nombre),
    password: PASSWORD,
    acceptedTerms: true,
  });
  return authService.verifyEmail(emailVerificationToken);
}

describe('registro', () => {
  it('crea el usuario con los defaults del ERD y sin verificar', async () => {
    const { user } = await authService.register({
      email: email('registro-ok'),
      password: PASSWORD,
      displayName: 'Alguien',
      acceptedTerms: true,
    });

    expect(user.status).toBe('active');
    expect(user.userLevel).toBe('NUEVO');
    expect(user.riskLevel).toBe('NORMAL');
    expect(user.adminRole).toBeNull();
    expect(user.emailVerified).toBe(false); // BR-001
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('registra el alta como hecho en user_history_events (ERD §6.3)', async () => {
    const { user } = await authService.register({
      email: email('registro-historial'),
      password: PASSWORD,
      acceptedTerms: true,
    });

    const eventos = await getDatabase()
      .select()
      .from(schema.userHistoryEvents)
      .where(eq(schema.userHistoryEvents.userId, user.id));

    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.eventType).toBe('USER_REGISTERED');
    // BS-002: la aceptacion de terminos queda registrada en el payload del hecho.
    expect(eventos[0]!.data).toHaveProperty('acceptedTermsAt');
  });

  it('rechaza un email duplicado', async () => {
    await authService.register({
      email: email('duplicado'),
      password: PASSWORD,
      acceptedTerms: true,
    });

    await expect(
      authService.register({ email: email('duplicado'), password: PASSWORD, acceptedTerms: true }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
  });

  it('detecta el duplicado aunque cambie el case (citext)', async () => {
    await authService.register({
      email: email('CaseSensible'),
      password: PASSWORD,
      acceptedTerms: true,
    });

    await expect(
      authService.register({
        email: email('casesensible').toUpperCase(),
        password: PASSWORD,
        acceptedTerms: true,
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
  });
});

describe('verificacion de email', () => {
  it('marca el email como verificado', async () => {
    const { emailVerificationToken } = await authService.register({
      email: email('verificar'),
      password: PASSWORD,
      acceptedTerms: true,
    });

    const verificado = await authService.verifyEmail(emailVerificationToken);
    expect(verificado.emailVerified).toBe(true);
  });

  it('no permite reutilizar el token', async () => {
    const { emailVerificationToken } = await authService.register({
      email: email('token-reuso'),
      password: PASSWORD,
      acceptedTerms: true,
    });

    await authService.verifyEmail(emailVerificationToken);
    await expect(authService.verifyEmail(emailVerificationToken)).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });

  it('rechaza un token inexistente', async () => {
    await expect(authService.verifyEmail('token-que-no-existe')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });
});

describe('login', () => {
  it('inicia sesion y devuelve un token con expiracion', async () => {
    await usuarioVerificado('login-ok');

    const r = await authService.login({ email: email('login-ok'), password: PASSWORD });

    expect(r.sessionToken).toBeTruthy();
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(r.user.emailVerified).toBe(true);
  });

  it('guarda el hash del token, nunca el token en claro', async () => {
    await usuarioVerificado('login-hash');
    const r = await authService.login({ email: email('login-hash'), password: PASSWORD });

    const sesiones = await getDatabase()
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, r.user.id));

    expect(sesiones).toHaveLength(1);
    expect(sesiones[0]!.tokenHash).not.toBe(r.sessionToken);
    expect(sesiones[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rechaza password incorrecta con error generico', async () => {
    await usuarioVerificado('login-mala-password');

    await expect(
      authService.login({ email: email('login-mala-password'), password: 'otra-password-larga' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('usa el MISMO error para un email inexistente (no permite enumerar cuentas)', async () => {
    await expect(
      authService.login({ email: email('no-existe'), password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('bloquea el login si el email no esta verificado (BR-001)', async () => {
    await authService.register({
      email: email('sin-verificar'),
      password: PASSWORD,
      acceptedTerms: true,
    });

    await expect(
      authService.login({ email: email('sin-verificar'), password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('bloquea el login de una cuenta suspendida', async () => {
    const user = await usuarioVerificado('suspendido');
    await getDatabase()
      .update(schema.users)
      .set({ status: 'suspended' })
      .where(eq(schema.users.id, user.id));

    await expect(
      authService.login({ email: email('suspendido'), password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE' });
  });
});

describe('sesion', () => {
  it('resuelve el usuario a partir de un token valido', async () => {
    const user = await usuarioVerificado('sesion-valida');
    const { sessionToken } = await authService.login({
      email: email('sesion-valida'),
      password: PASSWORD,
    });

    const resuelto = await authService.resolveSession(sessionToken);
    expect(resuelto?.id).toBe(user.id);
  });

  it('devuelve null ante un token invalido', async () => {
    await expect(authService.resolveSession('token-inventado')).resolves.toBeNull();
  });

  it('devuelve null si la sesion expiro', async () => {
    const user = await usuarioVerificado('sesion-expirada');
    const { sessionToken } = await authService.login({
      email: email('sesion-expirada'),
      password: PASSWORD,
    });

    // Se fuerza el vencimiento en la base: el filtro esta en SQL.
    await getDatabase()
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sessions.userId, user.id));

    await expect(authService.resolveSession(sessionToken)).resolves.toBeNull();
  });

  it('deja de resolver si el usuario se suspende con la sesion abierta', async () => {
    const user = await usuarioVerificado('sesion-suspendida');
    const { sessionToken } = await authService.login({
      email: email('sesion-suspendida'),
      password: PASSWORD,
    });

    await getDatabase()
      .update(schema.users)
      .set({ status: 'suspended' })
      .where(eq(schema.users.id, user.id));

    await expect(authService.resolveSession(sessionToken)).resolves.toBeNull();
  });
});

describe('logout', () => {
  it('invalida la sesion y borra la fila (efimera, ERD §20.10)', async () => {
    const user = await usuarioVerificado('logout');
    const { sessionToken } = await authService.login({
      email: email('logout'),
      password: PASSWORD,
    });

    await expect(authService.logout(sessionToken)).resolves.toBe(true);
    await expect(authService.resolveSession(sessionToken)).resolves.toBeNull();

    const sesiones = await getDatabase()
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user.id));
    expect(sesiones).toHaveLength(0);
  });

  it('es idempotente: cerrar dos veces no falla', async () => {
    await usuarioVerificado('logout-doble');
    const { sessionToken } = await authService.login({
      email: email('logout-doble'),
      password: PASSWORD,
    });

    await authService.logout(sessionToken);
    await expect(authService.logout(sessionToken)).resolves.toBe(false);
  });
});

describe('recuperacion de contrasena', () => {
  it('permite cambiarla y cierra todas las sesiones abiertas', async () => {
    const user = await usuarioVerificado('reset');
    await authService.login({ email: email('reset'), password: PASSWORD });

    const token = await authService.requestPasswordReset(email('reset'));
    expect(token).toBeTruthy();

    const nueva = 'nueva-password-larga';
    await authService.resetPassword(token!, nueva);

    // Sesiones cerradas: si la cuenta estaba comprometida, dejarlas vivas
    // anularia el remedio.
    const sesiones = await getDatabase()
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user.id));
    expect(sesiones).toHaveLength(0);

    await expect(
      authService.login({ email: email('reset'), password: nueva }),
    ).resolves.toBeTruthy();
    await expect(
      authService.login({ email: email('reset'), password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('devuelve null para un email inexistente (no permite enumerar cuentas)', async () => {
    await expect(authService.requestPasswordReset(email('inexistente'))).resolves.toBeNull();
  });

  it('no permite reutilizar el token de reset', async () => {
    await usuarioVerificado('reset-reuso');
    const token = await authService.requestPasswordReset(email('reset-reuso'));

    await authService.resetPassword(token!, 'password-nueva-uno');
    await expect(authService.resetPassword(token!, 'password-nueva-dos')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });
});

describe('perfil de vendedor (SS-001/SS-002)', () => {
  const alta = { displayName: 'Mi Tienda', acceptedSellerTerms: true as const };

  it('lo crea en pending y sin tier (DEC-037 sin definir)', async () => {
    const user = await usuarioVerificado('vendedor-ok');

    const perfil = await sellerService.createSellerProfile(user, alta);

    expect(perfil.status).toBe('pending'); // aprobar requiere TS-001, pendiente
    expect(perfil.sellerTierId).toBeNull();
    expect(perfil.approvedAt).toBeNull();
    expect(perfil.userId).toBe(user.id);
  });

  it('no permite dos perfiles para el mismo usuario', async () => {
    const user = await usuarioVerificado('vendedor-duplicado');
    await sellerService.createSellerProfile(user, alta);

    await expect(sellerService.createSellerProfile(user, alta)).rejects.toMatchObject({
      code: 'SELLER_PROFILE_ALREADY_EXISTS',
    });
  });

  it('exige email verificado (BR-001)', async () => {
    const { user } = await authService.register({
      email: email('vendedor-sin-verificar'),
      password: PASSWORD,
      acceptedTerms: true,
    });

    await expect(sellerService.createSellerProfile(user, alta)).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
    });
  });

  it('el mismo usuario es comprador y vendedor, no una cuenta nueva (BS-021)', async () => {
    const user = await usuarioVerificado('vendedor-mismo-usuario');
    const perfil = await sellerService.createSellerProfile(user, alta);

    expect(perfil.userId).toBe(user.id);
    await expect(sellerService.getMySellerProfile(user.id)).resolves.toMatchObject({
      id: perfil.id,
    });
  });

  it('devuelve null si el usuario nunca solicito ser vendedor', async () => {
    const user = await usuarioVerificado('nunca-vendedor');

    await expect(sellerService.getMySellerProfile(user.id)).resolves.toBeNull();
  });
});

describe('constraints e integridad', () => {
  it('la FK seller_profiles.user_id rechaza un usuario inexistente', async () => {
    const { insertSellerProfile } = await import('../sellers/repositories/seller.repository');

    await expect(
      insertSellerProfile({
        userId: '00000000-0000-0000-0000-000000000000',
        displayName: 'Fantasma',
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('el UNIQUE de seller_profiles.user_id impide dos perfiles en la base', async () => {
    const user = await usuarioVerificado('unique-seller');
    const { insertSellerProfile } = await import('../sellers/repositories/seller.repository');

    await insertSellerProfile({ userId: user.id, displayName: 'Una' });
    await expect(
      insertSellerProfile({ userId: user.id, displayName: 'Otra' }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it('borrar un usuario con sesiones abiertas las borra en cascada', async () => {
    const user = await usuarioVerificado('cascade-sesiones');
    await authService.login({ email: email('cascade-sesiones'), password: PASSWORD });

    const db = getDatabase();
    // El historial es RESTRICT (los hechos sobreviven): hay que sacarlo primero.
    await db.delete(schema.userHistoryEvents).where(eq(schema.userHistoryEvents.userId, user.id));
    await db
      .delete(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.userId, user.id));
    await db.delete(schema.users).where(eq(schema.users.id, user.id));

    const sesiones = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user.id));
    expect(sesiones).toHaveLength(0);
  });

  it('user_history_events es RESTRICT: protege los hechos del borrado del usuario', async () => {
    const user = await usuarioVerificado('restrict-historial');
    const db = getDatabase();

    await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    await db
      .delete(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.userId, user.id));

    await expect(db.delete(schema.users).where(eq(schema.users.id, user.id))).rejects.toMatchObject(
      { cause: { code: '23503' } },
    );
  });
});

describe('autorizacion por rol (DEC-023)', () => {
  it('un usuario comun no tiene rol administrativo', async () => {
    const user = await usuarioVerificado('rol-comun');

    expect(user.adminRole).toBeNull();
  });

  it('resuelve el rol administrativo cuando esta asignado', async () => {
    const user = await usuarioVerificado('rol-admin');
    await getDatabase()
      .update(schema.users)
      .set({ adminRole: 'MODERATOR' })
      .where(eq(schema.users.id, user.id));

    const { sessionToken } = await authService.login({
      email: email('rol-admin'),
      password: PASSWORD,
    });
    const resuelto = await authService.resolveSession(sessionToken);

    expect(resuelto?.adminRole).toBe('MODERATOR');
  });

  it('errores de dominio: FORBIDDEN es distinto de NOT_AUTHENTICATED', () => {
    // 403 y 401 no son lo mismo: uno es "no sos vos", el otro "no podes".
    expect(errors.forbidden().code).toBe('FORBIDDEN');
    expect(errors.notAuthenticated().code).toBe('NOT_AUTHENTICATED');
  });
});
