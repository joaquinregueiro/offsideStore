import { getDatabase, schema } from '@offside/database';
import { and, eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type * as AuthService from '../auth/services/auth.service';
import type { PublicUser } from '../auth/services/auth.service';
import type * as ProfileService from './services/profile.service';

/**
 * Nombre visible de la cuenta (ERD §2).
 *
 * Integracion contra PostgreSQL REAL, porque lo que hay que probar no es la
 * normalizacion —eso es puro y se prueba aparte— sino que el cambio QUEDE
 * GUARDADO y que quede AUDITADO. Un test con doble de `audit` no habria visto
 * la fila que este mira.
 *
 * Limpia todo lo que crea: sufijo `@perfiltest.offside`.
 */

const SUFIJO = '@perfiltest.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';

let authService: typeof AuthService;
let profileService: typeof ProfileService;
let closeRedis: () => Promise<void>;

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');
  loadRootEnv(import.meta.dirname);
  resetEnvCache();

  authService = await import('../auth/services/auth.service');
  profileService = await import('./services/profile.service');

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

  await db.delete(schema.auditLog).where(inArray(schema.auditLog.actorId, ids));
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

/** Lo que quedo guardado de verdad en la columna. */
async function nombreGuardado(userId: string): Promise<string | null> {
  const [fila] = await getDatabase()
    .select({ displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.id, userId));

  return fila?.displayName ?? null;
}

async function auditorias(userId: string) {
  return getDatabase()
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.actorId, userId),
        eq(schema.auditLog.action, 'USER_DISPLAY_NAME_UPDATED'),
      ),
    );
}

describe('nombre visible de la cuenta', () => {
  it('lo guarda y lo deja auditado', async () => {
    const user = await usuarioVerificado('guarda');

    const nuevo = await profileService.updateDisplayName(user, 'Joaquín Regueiro');

    expect(nuevo).toBe('Joaquín Regueiro');
    expect(await nombreGuardado(user.id)).toBe('Joaquín Regueiro');

    const filas = await auditorias(user.id);
    expect(filas).toHaveLength(1);
    expect(filas[0]?.before).toEqual({ displayName: null });
    expect(filas[0]?.after).toEqual({ displayName: 'Joaquín Regueiro' });
  });

  it('⚠️ vaciarlo lo borra: es una operacion valida, no un error', async () => {
    // Quien cargo su nombre real y se arrepiente tiene que poder sacarlo.
    // Obligarlo a dejar algo lo empuja a poner un nombre falso, que es peor
    // para quien tiene que despachar.
    const user = await usuarioVerificado('vacia');
    await profileService.updateDisplayName(user, 'Para borrar');

    const conNombre = { ...user, displayName: 'Para borrar' };
    expect(await profileService.updateDisplayName(conNombre, '   ')).toBeNull();
    expect(await nombreGuardado(user.id)).toBeNull();
  });

  it('normaliza los espacios de mas', async () => {
    const user = await usuarioVerificado('espacios');

    await profileService.updateDisplayName(user, '  Juan   Carlos  ');

    expect(await nombreGuardado(user.id)).toBe('Juan Carlos');
  });

  it('recorta al tope en vez de rechazar', async () => {
    const user = await usuarioVerificado('largo');
    const largo = 'a'.repeat(profileService.TOPE_NOMBRE_VISIBLE + 40);

    await profileService.updateDisplayName(user, largo);

    expect(await nombreGuardado(user.id)).toHaveLength(profileService.TOPE_NOMBRE_VISIBLE);
  });

  it('una sola letra se rechaza', async () => {
    const user = await usuarioVerificado('corto');

    await expect(profileService.updateDisplayName(user, 'a')).rejects.toThrow();
    expect(await nombreGuardado(user.id)).toBeNull();
  });

  it('⚠️ guardar lo mismo NO escribe una fila de auditoria', async () => {
    // `audit_log` es append-only: si cada «Guardar» sin cambios dejara rastro,
    // la historia real del nombre quedaria enterrada entre filas identicas.
    const user = await usuarioVerificado('sincambio');
    await profileService.updateDisplayName(user, 'Igual');

    const conNombre = { ...user, displayName: 'Igual' };
    await profileService.updateDisplayName(conNombre, 'Igual');
    await profileService.updateDisplayName(conNombre, '  Igual  ');

    expect(await auditorias(user.id)).toHaveLength(1);
  });

  it('⚠️ NO toca el email ni el estado de verificacion', async () => {
    // El nombre visible y la credencial de ingreso son dos cosas distintas
    // sobre la misma tabla. Un UPDATE que se lleve puesto `email_verified_at`
    // dejaria a la persona sin poder operar (BR-001).
    const user = await usuarioVerificado('intacto');

    await profileService.updateDisplayName(user, 'Otro nombre');

    const [fila] = await getDatabase()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, user.id));

    expect(fila?.email).toBe(email('intacto'));
    expect(fila?.emailVerifiedAt).not.toBeNull();
    expect(fila?.passwordHash).not.toBeNull();
    expect(fila?.updatedAt).not.toBeNull();
  });
});
