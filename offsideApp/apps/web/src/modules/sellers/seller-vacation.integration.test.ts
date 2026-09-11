import { getDatabase, schema } from '@offside/database';
import { and, eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PublicUser } from '../auth/services/auth.service';
import type * as VacationService from './services/vacation.service';

/**
 * Modo vacaciones — integracion contra PostgreSQL REAL.
 *
 * Lo que se demuestra: que la fecha se guarda y se lee, que NO se toca ningun
 * `status`, que queda auditado en la misma transaccion, y que el perfil se
 * resuelve por el usuario autenticado y no por un id del request.
 *
 * LIMPIEZA: sufijo `@vactest.offside`.
 */

const SUFIJO = '@vactest.offside';
const email = (n: string) => `${n}${SUFIJO}`;

let vacationService: typeof VacationService;

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');
  loadRootEnv(import.meta.dirname);
  resetEnvCache();

  vacationService = await import('./services/vacation.service');

  await limpiar();
});

afterAll(async () => {
  await limpiar();

  const { closeDatabase } = await import('@offside/database');
  await closeDatabase();
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
  await db.delete(schema.sellerProfiles).where(inArray(schema.sellerProfiles.userId, ids));
  await db.delete(schema.users).where(inArray(schema.users.id, ids));
}

/** Usuario con perfil de vendedor, escrito directo: el alta tiene sus propios tests. */
async function vendedor(nombre: string): Promise<{ user: PublicUser; sellerId: string }> {
  const db = getDatabase();

  const [user] = await db
    .insert(schema.users)
    .values({ email: email(nombre), displayName: nombre, emailVerifiedAt: new Date() })
    .returning();
  const [perfil] = await db
    .insert(schema.sellerProfiles)
    .values({ userId: user!.id, displayName: `Tienda ${nombre}`, status: 'approved' })
    .returning({ id: schema.sellerProfiles.id });

  return {
    user: {
      id: user!.id,
      email: user!.email,
      displayName: user!.displayName,
      status: user!.status,
      userLevel: user!.userLevel,
      riskLevel: user!.riskLevel,
      adminRole: user!.adminRole,
      emailVerified: true,
    },
    sellerId: perfil!.id,
  };
}

const enUnaSemana = () => new Date(Date.now() + 7 * 86_400_000);

describe('setVacation / getVacation / isOnVacation', () => {
  it('sin fecha, no esta de vacaciones', async () => {
    const { user, sellerId } = await vendedor('sin-fecha');

    expect(await vacationService.getVacation(user)).toEqual({
      onVacation: false,
      vacationUntil: null,
    });
    expect(await vacationService.isOnVacation(sellerId)).toBe(false);
  });

  it('marca la ausencia hasta una fecha futura y la lee igual por los tres caminos', async () => {
    const { user, sellerId } = await vendedor('ausente');
    const hasta = enUnaSemana();

    const estado = await vacationService.setVacation(user, hasta);

    expect(estado).toEqual({ onVacation: true, vacationUntil: hasta.toISOString() });
    expect(await vacationService.getVacation(user)).toEqual(estado);
    expect(await vacationService.isOnVacation(sellerId)).toBe(true);
  });

  it('⚠️ NO toca el estado del perfil: es un predicado, no un estado', async () => {
    const { user, sellerId } = await vendedor('predicado');

    await vacationService.setVacation(user, enUnaSemana());

    const [perfil] = await getDatabase()
      .select({ status: schema.sellerProfiles.status })
      .from(schema.sellerProfiles)
      .where(eq(schema.sellerProfiles.id, sellerId));

    expect(perfil?.status).toBe('approved');
  });

  it('levanta la ausencia con null', async () => {
    const { user, sellerId } = await vendedor('vuelve');
    await vacationService.setVacation(user, enUnaSemana());

    const estado = await vacationService.setVacation(user, null);

    expect(estado).toEqual({ onVacation: false, vacationUntil: null });
    expect(await vacationService.isOnVacation(sellerId)).toBe(false);
  });

  it('rechaza una fecha pasada y una invalida, sin escribir nada', async () => {
    const { user, sellerId } = await vendedor('pasado');

    await expect(
      vacationService.setVacation(user, new Date(Date.now() - 60_000)),
    ).rejects.toThrowError(/posterior a hoy/);
    await expect(vacationService.setVacation(user, new Date('no es fecha'))).rejects.toThrowError(
      /posterior a hoy/,
    );

    expect(await vacationService.isOnVacation(sellerId)).toBe(false);
  });

  it('⚠️ una fecha ya vencida en la base equivale a "no esta": vuelve solo', async () => {
    // Nadie limpia `vacation_until`: al pasar la fecha, el predicado da false.
    const { user, sellerId } = await vendedor('vencida');
    await getDatabase()
      .update(schema.sellerProfiles)
      .set({ vacationUntil: new Date(Date.now() - 86_400_000) })
      .where(eq(schema.sellerProfiles.id, sellerId));

    expect(await vacationService.isOnVacation(sellerId)).toBe(false);
    expect(await vacationService.getVacation(user)).toEqual({
      onVacation: false,
      vacationUntil: null,
    });
  });

  it('queda auditado con el vendedor como actor, al marcar y al levantar', async () => {
    const { user, sellerId } = await vendedor('auditado');
    const hasta = enUnaSemana();

    await vacationService.setVacation(user, hasta);
    await vacationService.setVacation(user, null);

    const filas = await getDatabase()
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.actorId, user.id), eq(schema.auditLog.entityId, sellerId)))
      .orderBy(schema.auditLog.createdAt);

    expect(filas.map((f) => f.action)).toEqual([
      vacationService.AUDIT_ACTION_VACATION_SET,
      vacationService.AUDIT_ACTION_VACATION_CLEARED,
    ]);
    expect(filas[0]?.after).toEqual({ vacationUntil: hasta.toISOString() });
    expect(filas[1]?.before).toEqual({ vacationUntil: hasta.toISOString() });
    expect(filas[1]?.after).toEqual({ vacationUntil: null });
  });

  it('el perfil se resuelve por el usuario autenticado: sin perfil, no hay vacaciones', async () => {
    const [user] = await getDatabase()
      .insert(schema.users)
      .values({ email: email('sin-perfil') })
      .returning();

    const sinPerfil: PublicUser = {
      id: user!.id,
      email: user!.email,
      displayName: null,
      status: 'active',
      userLevel: 'NUEVO',
      riskLevel: 'NORMAL',
      adminRole: null,
      emailVerified: false,
    };

    await expect(vacationService.setVacation(sinPerfil, enUnaSemana())).rejects.toThrowError(
      /perfil de vendedor/,
    );
    await expect(vacationService.getVacation(sinPerfil)).rejects.toThrowError(/perfil de vendedor/);
  });

  it('un perfil inexistente no esta de vacaciones', async () => {
    expect(await vacationService.isOnVacation('00000000-0000-4000-8000-000000000000')).toBe(false);
  });
});
