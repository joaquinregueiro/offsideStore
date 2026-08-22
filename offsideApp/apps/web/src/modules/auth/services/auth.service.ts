import { getEnv } from '@offside/config';
import { getDatabase } from '@offside/database';

import { recordUserRegistered } from '../../users/services/user-history.service';
import * as errors from '../auth.errors';
import type { LoginInput, RegisterInput } from '../auth.schemas';
import * as sessionRepo from '../repositories/session.repository';
import { emailVerificationTokens, passwordResetTokens } from '../repositories/token.repository';
import * as userRepo from '../repositories/user.repository';
import { hashPassword, verifyPassword } from './password.service';
import { expiresInHours, generateToken, hashToken } from './token.service';

/**
 * Logica de negocio de autenticacion.
 *
 * No conoce HTTP: no recibe `Request` ni devuelve `Response` (CLAUDE.md §8).
 * El Controller traduce sus errores de dominio a codigos de estado.
 */

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  status: 'active' | 'suspended' | 'deleted';
  userLevel: 'NUEVO' | 'CONFIABLE' | 'DESTACADO' | 'COLECCIONISTA' | 'TIENDA';
  riskLevel: 'NORMAL' | 'RIESGO' | 'RESTRINGIDO' | 'SUSPENDIDO';
  adminRole: 'SUPER_ADMIN' | 'ADMIN' | 'MODERATOR' | 'SUPPORT' | 'FINANCE' | null;
  emailVerified: boolean;
}

/** Proyeccion publica: NUNCA expone `password_hash`. */
export function toPublicUser(row: userRepo.UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    userLevel: row.userLevel,
    riskLevel: row.riskLevel,
    adminRole: row.adminRole,
    emailVerified: row.emailVerifiedAt !== null,
  };
}

export interface RegisterResult {
  user: PublicUser;
  /**
   * Token de verificacion EN CLARO. Se devuelve para que el llamador lo envie
   * por email.
   *
   * ⚠️ Todavia no hay modulo de notificaciones ni proveedor de email
   * configurado. Hasta que exista, el Controller solo lo expone fuera de
   * produccion. Ver `docs-implementation/auth-module.md`.
   */
  emailVerificationToken: string;
}

/**
 * Registro (BS-001, BS-002).
 *
 * El usuario nace SIN email verificado: BR-001 exige verificarlo antes de
 * operar. Todo ocurre en una transaccion — si el historial falla, no queda un
 * usuario a medio crear.
 */
export async function register(input: RegisterInput): Promise<RegisterResult> {
  const env = getEnv();

  // Chequeo temprano para dar un error claro. La garantia REAL es el UNIQUE de
  // la base, que se maneja abajo: entre este SELECT y el INSERT puede colarse
  // otro registro concurrente.
  const existing = await userRepo.findByEmail(input.email);
  if (existing) throw errors.emailAlreadyRegistered();

  const passwordHash = await hashPassword(input.password);
  const token = generateToken();

  try {
    return await getDatabase().transaction(async (tx) => {
      const user = await userRepo.insertUser(
        { email: input.email, passwordHash, displayName: input.displayName },
        tx,
      );

      await emailVerificationTokens.insert(
        {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: expiresInHours(env.AUTH_EMAIL_TOKEN_TTL_HOURS),
        },
        tx,
      );

      // BS-002: queda registrado como hecho en el historial (ERD §6.3).
      await recordUserRegistered({ userId: user.id, acceptedTermsAt: new Date() }, tx);

      return { user: toPublicUser(user), emailVerificationToken: token };
    });
  } catch (error) {
    if (isUniqueViolation(error, 'users_email_key')) throw errors.emailAlreadyRegistered();
    throw error;
  }
}

/** Detecta un choque de UNIQUE de PostgreSQL (Drizzle envuelve el error en `cause`). */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: { code?: string; constraint_name?: string } })?.cause;
  return cause?.code === '23505' && cause?.constraint_name === constraint;
}

export interface LoginResult {
  user: PublicUser;
  sessionToken: string;
  expiresAt: Date;
}

/**
 * Login (BS-010).
 *
 * Orden deliberado de las comprobaciones:
 *  1. credenciales — con error generico, para no permitir enumerar cuentas;
 *  2. estado de la cuenta — un suspendido no entra (BR-004 / DEC-021);
 *  3. email verificado — BR-001.
 *
 * Se verifica la password incluso cuando el usuario no existe, con un hash
 * ficticio, para que el tiempo de respuesta no delate si el email existe.
 */
export async function login(
  input: LoginInput,
  context: { userAgent?: string | undefined; ip?: string | undefined } = {},
): Promise<LoginResult> {
  const env = getEnv();
  const user = await userRepo.findByEmail(input.email);

  if (!user?.passwordHash) {
    // Coste artificial equivalente: evita el canal lateral por temporizacion.
    await hashPassword(input.password);
    throw errors.invalidCredentials();
  }

  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) throw errors.invalidCredentials();

  if (user.status !== 'active') throw errors.accountNotActive();
  if (user.emailVerifiedAt === null) throw errors.emailNotVerified();

  const token = generateToken();
  const expiresAt = expiresInHours(env.AUTH_SESSION_TTL_HOURS);

  await sessionRepo.insertSession({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: context.userAgent,
    ip: context.ip,
  });

  return { user: toPublicUser(user), sessionToken: token, expiresAt };
}

/** Cierra la sesion. Idempotente: si el token ya no existe, devuelve `false`. */
export async function logout(sessionToken: string): Promise<boolean> {
  return (await sessionRepo.deleteByTokenHash(hashToken(sessionToken))) > 0;
}

/**
 * Resuelve el usuario autenticado a partir del token de sesion.
 *
 * Devuelve `null` en vez de lanzar: distinguir "no autenticado" de "error" es
 * responsabilidad del guard, no de esta funcion.
 */
export async function resolveSession(sessionToken: string): Promise<PublicUser | null> {
  const session = await sessionRepo.findValidByTokenHash(hashToken(sessionToken));
  if (!session) return null;

  const user = await userRepo.findById(session.userId);
  if (user?.status !== 'active') return null;

  return toPublicUser(user);
}

/** Verificacion de email (BR-001). El token se consume de forma atomica. */
export async function verifyEmail(token: string): Promise<PublicUser> {
  const found = await emailVerificationTokens.findUsable(hashToken(token));
  if (!found) throw errors.invalidToken();

  return await getDatabase().transaction(async (tx) => {
    const consumed = await emailVerificationTokens.consume(found.id, tx);
    if (!consumed) throw errors.invalidToken();

    await userRepo.markEmailVerified(found.userId, tx);

    const user = await userRepo.findById(found.userId, tx);
    if (!user) throw errors.invalidToken();

    return toPublicUser(user);
  });
}

/**
 * Inicia la recuperacion de contrasena (BS-011).
 *
 * ⚠️ NO revela si el email existe: devuelve el token solo cuando hay usuario, y
 * el Controller responde siempre lo mismo. Si no, seria un enumerador de
 * cuentas.
 */
export async function requestPasswordReset(email: string): Promise<string | null> {
  const env = getEnv();
  const user = await userRepo.findByEmail(email);
  if (!user) return null;

  const token = generateToken();
  await passwordResetTokens.insert({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: expiresInHours(env.AUTH_PASSWORD_RESET_TTL_HOURS),
  });

  return token;
}

/**
 * Completa la recuperacion (BS-011).
 *
 * Cierra TODAS las sesiones del usuario: si la password se cambio porque la
 * cuenta estaba comprometida, dejar sesiones vivas anularia el remedio.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const found = await passwordResetTokens.findUsable(hashToken(token));
  if (!found) throw errors.invalidToken();

  const passwordHash = await hashPassword(newPassword);

  await getDatabase().transaction(async (tx) => {
    const consumed = await passwordResetTokens.consume(found.id, tx);
    if (!consumed) throw errors.invalidToken();

    await userRepo.updatePasswordHash(found.userId, passwordHash, tx);
    await sessionRepo.deleteAllForUser(found.userId, tx);
  });
}
