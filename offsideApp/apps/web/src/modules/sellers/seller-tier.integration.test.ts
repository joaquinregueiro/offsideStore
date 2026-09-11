import { randomUUID } from 'node:crypto';

import { getDatabase, schema } from '@offside/database';
import { and, eq, inArray, like, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type * as Jobs from '@offside/jobs';

import type * as SettingRepo from '../config/repositories/app-setting.repository';
import type * as OrderEmails from '../notifications/services/order-emails.service';
import type * as TierService from './services/seller-tier.service';

/**
 * SELLER_TIER — integracion contra PostgreSQL y Redis REALES.
 *
 * Lo que hay que demostrar son propiedades de la BASE: que solo cuentan las
 * ordenes `COMPLETED` (BR-051), que un refund `COMPLETED` las descuenta, que
 * la ventana se mide sobre `completed_at`, que el UPDATE condicionado no
 * audita cambios que no hizo, y que la tasa que se resuelve es la que esta en
 * `seller_tiers` / `app_settings` y no un numero del codigo.
 *
 * Los valores sembrados por la migracion `0010` (INICIAL 0 / AVANZADO 10 /
 * PROFESIONAL 50, 6/5/4 %) se usan como estan: cambiarlos desde Admin es
 * exactamente lo que estos tests no deben impedir, y por eso las perillas se
 * tocan insertando una VERSION nueva y borrandola al final.
 *
 * LIMPIEZA: usuarios con sufijo `@tiertest.offside`, ordenes `TIERTEST-*`,
 * tiers `ZZTEST_*`, versiones de settings posteriores a la sembrada.
 */

const SUFIJO = '@tiertest.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PREFIJO_ORDEN = 'TIERTEST-';
const PREFIJO_TIER = 'ZZTEST_';

let tierService: typeof TierService;
let settingRepo: typeof SettingRepo;
let orderEmails: typeof OrderEmails;
let getQueue: typeof Jobs.getQueue;
let queueName: string;
let closeQueues: () => Promise<void>;
let closeRedis: () => Promise<void>;

let compradorId: string;
let adminId: string;
const jobsEncolados = new Set<string>();

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');
  loadRootEnv(import.meta.dirname);
  resetEnvCache();

  tierService = await import('./services/seller-tier.service');
  settingRepo = await import('../config/repositories/app-setting.repository');
  orderEmails = await import('../notifications/services/order-emails.service');

  const jobs = await import('@offside/jobs');
  getQueue = jobs.getQueue;
  queueName = jobs.QUEUE_NAMES.NOTIFICATIONS_SEND;
  closeQueues = jobs.closeQueues;
  closeRedis = jobs.closeRedisConnections;

  await limpiar();

  const db = getDatabase();
  const [comprador] = await db
    .insert(schema.users)
    .values({ email: email('comprador') })
    .returning({ id: schema.users.id });
  compradorId = comprador!.id;

  const [admin] = await db
    .insert(schema.users)
    .values({ email: email('admin'), adminRole: 'ADMIN' })
    .returning({ id: schema.users.id });
  adminId = admin!.id;
});

afterAll(async () => {
  await limpiar();

  const cola = getQueue(queueName);
  for (const id of jobsEncolados) {
    try {
      await (await cola.getJob(id))?.remove();
    } catch {
      // Bloqueado por el worker del servidor de desarrollo: lo borra
      // `removeOnComplete`.
    }
  }

  await closeQueues();
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
  const ids = usuarios.map((u) => u.id);

  if (ids.length > 0) {
    const perfiles = await db
      .select({ id: schema.sellerProfiles.id })
      .from(schema.sellerProfiles)
      .where(inArray(schema.sellerProfiles.userId, ids));
    const sellerIds = perfiles.map((p) => p.id);

    const ordenes = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(like(schema.orders.orderNumber, `${PREFIJO_ORDEN}%`));
    const orderIds = ordenes.map((o) => o.id);

    if (orderIds.length > 0) {
      await db.delete(schema.refunds).where(inArray(schema.refunds.orderId, orderIds));
      await db.delete(schema.payments).where(inArray(schema.payments.orderId, orderIds));
      await db.delete(schema.orders).where(inArray(schema.orders.id, orderIds));
    }

    await db
      .delete(schema.auditLog)
      .where(
        or(
          inArray(schema.auditLog.actorId, ids),
          sellerIds.length > 0 ? inArray(schema.auditLog.entityId, sellerIds) : undefined,
        ),
      );
    await db.delete(schema.sellerProfiles).where(inArray(schema.sellerProfiles.userId, ids));
    await db.delete(schema.users).where(inArray(schema.users.id, ids));
  }

  // Despues de los perfiles: `seller_tier_id` es RESTRICT.
  await db.delete(schema.sellerTiers).where(like(schema.sellerTiers.code, `${PREFIJO_TIER}%`));
}

/* ------------------------------------------------------------------ fixtures */

/** El `jobId` del email de nivel, tal como lo calcula `notifications`. */
function idDeAviso(to: string, codigo: string): string {
  return orderEmails.jobIdDe({
    kind: 'seller_tier_updated',
    to,
    nombre: null,
    nivel: { codigo, nombre: codigo, comisionBasisPoints: null },
  });
}

async function vendedor(nombre: string): Promise<{ sellerId: string; email: string }> {
  const db = getDatabase();
  const [user] = await db
    .insert(schema.users)
    .values({ email: email(nombre), displayName: nombre, emailVerifiedAt: new Date() })
    .returning({ id: schema.users.id });
  const [perfil] = await db
    .insert(schema.sellerProfiles)
    .values({ userId: user!.id, displayName: `Tienda ${nombre}`, status: 'approved' })
    .returning({ id: schema.sellerProfiles.id });

  return { sellerId: perfil!.id, email: email(nombre) };
}

type EstadoDeOrden = (typeof schema.orders.$inferInsert)['status'];

/** `cantidad` ordenes del vendedor en `status`, completadas en `completedAt`. */
async function ordenes(
  sellerId: string,
  cantidad: number,
  opciones: { status?: EstadoDeOrden; completedAt?: Date } = {},
): Promise<string[]> {
  const status = opciones.status ?? 'COMPLETED';
  const filas = Array.from({ length: cantidad }, () => ({
    orderNumber: `${PREFIJO_ORDEN}${randomUUID()}`,
    buyerId: compradorId,
    sellerId,
    status,
    productAmount: 100_000n,
    totalAmount: 100_000n,
    shippingAddress: {},
    completedAt: status === 'COMPLETED' ? (opciones.completedAt ?? new Date()) : null,
  }));

  const creadas = await getDatabase()
    .insert(schema.orders)
    .values(filas)
    .returning({ id: schema.orders.id });

  return creadas.map((o) => o.id);
}

async function refund(
  orderId: string,
  status: (typeof schema.refunds.$inferInsert)['status'] = 'COMPLETED',
): Promise<void> {
  const db = getDatabase();
  const [pago] = await db
    .insert(schema.payments)
    .values({ orderId, amount: 100_000n, checkoutType: 'pro', status: 'APPROVED' })
    .returning({ id: schema.payments.id });

  await db.insert(schema.refunds).values({
    orderId,
    paymentId: pago!.id,
    type: 'FULL',
    status,
    amount: 100_000n,
  });
}

/** Cambia una clave insertando una version nueva y la borra al terminar. */
async function conSetting<T>(
  key: string,
  value: unknown,
  valueType: string,
  fn: () => Promise<T>,
): Promise<T> {
  const fila = await settingRepo.insertNextVersion({ key, value, valueType });
  try {
    return await fn();
  } finally {
    await getDatabase().delete(schema.appSettings).where(eq(schema.appSettings.id, fila.id));
  }
}

/**
 * Borra un tier creado por un test, desenganchando antes los perfiles que lo
 * apuntan (RESTRICT). Si quedara vivo, seria "el proximo tier" de todos los
 * tests que siguen.
 */
async function borrarTierTemporal(tierId: string): Promise<void> {
  const db = getDatabase();
  await db
    .update(schema.sellerProfiles)
    .set({ sellerTierId: null })
    .where(eq(schema.sellerProfiles.sellerTierId, tierId));
  await db.delete(schema.sellerTiers).where(eq(schema.sellerTiers.id, tierId));
}

async function tierDelPerfil(sellerId: string): Promise<string | null> {
  const [fila] = await getDatabase()
    .select({ code: schema.sellerTiers.code })
    .from(schema.sellerProfiles)
    .leftJoin(schema.sellerTiers, eq(schema.sellerTiers.id, schema.sellerProfiles.sellerTierId))
    .where(eq(schema.sellerProfiles.id, sellerId));

  return fila?.code ?? null;
}

async function cambiosAuditados(sellerId: string) {
  return getDatabase()
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.action, tierService.AUDIT_ACTION_TIER_CHANGED),
        eq(schema.auditLog.entityId, sellerId),
      ),
    )
    .orderBy(schema.auditLog.createdAt);
}

/* --------------------------------------------------------------------------- */

describe('resolveCommissionBasisPoints — la tasa con la que `orders` crea la orden', () => {
  it('sin tier, rige la global de `app_settings` (DEC-043)', async () => {
    const { sellerId } = await vendedor('sin-tier');

    expect(await tierService.resolveCommissionBasisPoints(sellerId)).toEqual({
      basisPoints: 600,
      tierCode: null,
      source: 'default',
    });
  });

  it('con tier, la tasa del tier, convertida de numeric(6,4) a basis points', async () => {
    const { sellerId } = await vendedor('con-tier');
    await tierService.assignTierManually(sellerId, 'AVANZADO', adminId, 'motivo de prueba');
    jobsEncolados.add(idDeAviso(email('con-tier'), 'AVANZADO'));

    expect(await tierService.resolveCommissionBasisPoints(sellerId)).toEqual({
      basisPoints: 500,
      tierCode: 'AVANZADO',
      source: 'seller_tier',
    });
  });

  it('⚠️ un tier con `commission_rate` NULL no pisa la global, pero deja su code', async () => {
    // Umbral inalcanzable para que la evaluacion por ventas nunca lo elija.
    const [tier] = await getDatabase()
      .insert(schema.sellerTiers)
      .values({
        code: `${PREFIJO_TIER}SIN_TASA`,
        name: 'Sin tasa propia',
        commissionRate: null,
        limits: { minCompletedSales: 1_000_000 },
        isActive: true,
      })
      .returning({ id: schema.sellerTiers.id, code: schema.sellerTiers.code });
    const { sellerId } = await vendedor('tier-sin-tasa');
    await tierService.assignTierManually(sellerId, tier!.code, adminId, 'motivo de prueba');
    jobsEncolados.add(idDeAviso(email('tier-sin-tasa'), tier!.code));

    expect(await tierService.resolveCommissionBasisPoints(sellerId)).toEqual({
      basisPoints: 600,
      tierCode: tier!.code,
      source: 'default',
    });

    // Y sigue a la global si esta cambia: no hay ningun numero congelado.
    await conSetting('commission_rate_default', 700, 'rate', async () => {
      expect((await tierService.resolveCommissionBasisPoints(sellerId)).basisPoints).toBe(700);
    });

    await borrarTierTemporal(tier!.id);
  });

  it('un tier INACTIVO no cobra: desactivarlo desde Admin surte efecto en el acto', async () => {
    const [tier] = await getDatabase()
      .insert(schema.sellerTiers)
      .values({
        code: `${PREFIJO_TIER}INACTIVO`,
        name: 'Inactivo',
        commissionRate: '0.0100',
        limits: { minCompletedSales: 1_000_000 },
        isActive: true,
      })
      .returning({ id: schema.sellerTiers.id, code: schema.sellerTiers.code });
    const { sellerId } = await vendedor('tier-inactivo');
    await tierService.assignTierManually(sellerId, tier!.code, adminId, 'motivo de prueba');
    jobsEncolados.add(idDeAviso(email('tier-inactivo'), tier!.code));

    expect((await tierService.resolveCommissionBasisPoints(sellerId)).basisPoints).toBe(100);

    await getDatabase()
      .update(schema.sellerTiers)
      .set({ isActive: false })
      .where(eq(schema.sellerTiers.id, tier!.id));

    expect(await tierService.resolveCommissionBasisPoints(sellerId)).toEqual({
      basisPoints: 600,
      tierCode: null,
      source: 'default',
    });
  });

  it('sin perfil, lanza', async () => {
    await expect(
      tierService.resolveCommissionBasisPoints('00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrowError(/perfil de vendedor/);
  });
});

describe('assignInitialTier — el tier de arranque, al aprobar', () => {
  it('asigna el de menor umbral y es idempotente', async () => {
    const { sellerId } = await vendedor('inicial');

    expect(await tierService.assignInitialTier(sellerId)).toEqual({
      tierCode: 'INICIAL',
      assigned: true,
    });
    expect(await tierService.assignInitialTier(sellerId)).toEqual({
      tierCode: 'INICIAL',
      assigned: false,
    });
    expect(await tierDelPerfil(sellerId)).toBe('INICIAL');
    expect(await cambiosAuditados(sellerId)).toHaveLength(1);
  });

  it('no pisa un tier que ya estaba, sea cual sea', async () => {
    const { sellerId } = await vendedor('ya-avanzado');
    await tierService.assignTierManually(sellerId, 'AVANZADO', adminId, 'motivo de prueba');
    jobsEncolados.add(idDeAviso(email('ya-avanzado'), 'AVANZADO'));

    expect(await tierService.assignInitialTier(sellerId)).toEqual({
      tierCode: 'AVANZADO',
      assigned: false,
    });
  });

  it('asignar el inicial no cambia lo que paga: coincide con la global', async () => {
    const { sellerId } = await vendedor('paga-lo-mismo');
    const antes = await tierService.resolveCommissionBasisPoints(sellerId);
    await tierService.assignInitialTier(sellerId);
    const despues = await tierService.resolveCommissionBasisPoints(sellerId);

    expect(despues.basisPoints).toBe(antes.basisPoints);
    expect(despues.tierCode).toBe('INICIAL');
  });

  it('con `seller_tier_auto_assign` apagado no asigna nada', async () => {
    const { sellerId } = await vendedor('sin-auto-assign');

    await conSetting('seller_tier_auto_assign', false, 'bool', async () => {
      expect(await tierService.assignInitialTier(sellerId)).toEqual({
        tierCode: null,
        assigned: false,
      });
    });
    expect(await tierDelPerfil(sellerId)).toBeNull();
  });

  it('el cambio queda auditado como del sistema, con antes y despues', async () => {
    const { sellerId } = await vendedor('auditado');
    await tierService.assignInitialTier(sellerId);

    const [fila] = await cambiosAuditados(sellerId);

    expect(fila).toMatchObject({
      actorType: 'system',
      actorId: null,
      entityType: 'seller_profile',
      before: { sellerTierCode: null },
      after: { sellerTierCode: 'INICIAL' },
    });
  });
});

describe('evaluateSellerTier — el tier que corresponde por ventas COMPLETED', () => {
  it('con 10 ventas completadas alcanza AVANZADO, y lo avisa por email', async () => {
    const { sellerId, email: destino } = await vendedor('diez-ventas');
    await ordenes(sellerId, 10);

    const resultado = await tierService.evaluateSellerTier(sellerId);

    expect(resultado).toMatchObject({
      completedSales: 10,
      windowDays: 365,
      previousTierCode: null,
      tierCode: 'AVANZADO',
      changed: true,
      reason: 'assigned',
      tier: { code: 'AVANZADO', basisPoints: 500 },
    });
    expect(await tierDelPerfil(sellerId)).toBe('AVANZADO');

    // El email sale DESPUES de commitear, con la tasa propia del tier.
    const jobId = idDeAviso(destino, 'AVANZADO');
    jobsEncolados.add(jobId);
    const job = await getQueue<{ nivel: { codigo: string; comisionBasisPoints: number } }>(
      queueName,
    ).getJob(jobId);
    expect(job?.data.nivel).toEqual({
      codigo: 'AVANZADO',
      nombre: 'Vendedor avanzado',
      comisionBasisPoints: 500,
    });
  });

  it('es idempotente: la segunda evaluacion no cambia ni audita', async () => {
    const { sellerId } = await vendedor('idempotente');
    await ordenes(sellerId, 10);
    jobsEncolados.add(idDeAviso(email('idempotente'), 'AVANZADO'));

    await tierService.evaluateSellerTier(sellerId);
    const segunda = await tierService.evaluateSellerTier(sellerId);

    expect(segunda).toMatchObject({ changed: false, reason: 'unchanged', tierCode: 'AVANZADO' });
    expect(await cambiosAuditados(sellerId)).toHaveLength(1);
  });

  it('sin ventas, corresponde el tier de umbral cero', async () => {
    const { sellerId } = await vendedor('cero-ventas');

    const resultado = await tierService.evaluateSellerTier(sellerId);

    expect(resultado).toMatchObject({ completedSales: 0, tierCode: 'INICIAL', reason: 'assigned' });
    jobsEncolados.add(idDeAviso(email('cero-ventas'), 'INICIAL'));
  });

  it('⚠️ una orden PAID no es una venta: solo cuentan las COMPLETED (BR-033)', async () => {
    const { sellerId } = await vendedor('pagadas');
    await ordenes(sellerId, 9);
    await ordenes(sellerId, 10, { status: 'PAID' });
    await ordenes(sellerId, 3, { status: 'CANCELLED' });
    jobsEncolados.add(idDeAviso(email('pagadas'), 'INICIAL'));

    const resultado = await tierService.evaluateSellerTier(sellerId);

    expect(resultado.completedSales).toBe(9);
    expect(resultado.tierCode).toBe('INICIAL');
  });

  it('⚠️ una venta con refund COMPLETED no cuenta (BR-051); un refund pedido, si', async () => {
    const { sellerId } = await vendedor('reembolsada');
    const ids = await ordenes(sellerId, 11);
    await refund(ids[0]!, 'COMPLETED');
    await refund(ids[1]!, 'REQUESTED');
    jobsEncolados.add(idDeAviso(email('reembolsada'), 'AVANZADO'));

    const resultado = await tierService.evaluateSellerTier(sellerId);

    expect(resultado.completedSales).toBe(10);
    expect(resultado.tierCode).toBe('AVANZADO');
  });

  it('la ventana se mide sobre `completed_at`: lo viejo no cuenta, salvo sin ventana', async () => {
    const { sellerId } = await vendedor('ventana');
    const hace400Dias = new Date(Date.now() - 400 * 86_400_000);
    await ordenes(sellerId, 10, { completedAt: hace400Dias });
    jobsEncolados.add(idDeAviso(email('ventana'), 'INICIAL'));
    jobsEncolados.add(idDeAviso(email('ventana'), 'AVANZADO'));

    const conVentana = await tierService.evaluateSellerTier(sellerId);
    expect(conVentana).toMatchObject({ completedSales: 0, windowDays: 365, tierCode: 'INICIAL' });

    await conSetting('seller_tier_sales_window_days', 0, 'number', async () => {
      const sinVentana = await tierService.evaluateSellerTier(sellerId);
      expect(sinVentana).toMatchObject({
        completedSales: 10,
        windowDays: null,
        tierCode: 'AVANZADO',
        reason: 'upgraded',
      });
    });
  });

  it('⚠️ NO BAJA con `seller_tier_auto_downgrade` apagado; baja con la perilla encendida', async () => {
    // Bajar es cobrarle mas a alguien: lo decide una persona, salvo que Admin
    // encienda la perilla.
    const { sellerId } = await vendedor('baja');
    const ids = await ordenes(sellerId, 10);
    jobsEncolados.add(idDeAviso(email('baja'), 'AVANZADO'));
    jobsEncolados.add(idDeAviso(email('baja'), 'INICIAL'));
    await tierService.evaluateSellerTier(sellerId);
    expect(await tierDelPerfil(sellerId)).toBe('AVANZADO');

    await refund(ids[0]!, 'COMPLETED');

    const apagada = await tierService.evaluateSellerTier(sellerId);
    expect(apagada).toMatchObject({
      completedSales: 9,
      changed: false,
      reason: 'downgrade_disabled',
      tierCode: 'AVANZADO',
    });
    expect(await tierDelPerfil(sellerId)).toBe('AVANZADO');

    await conSetting('seller_tier_auto_downgrade', true, 'bool', async () => {
      const encendida = await tierService.evaluateSellerTier(sellerId);
      expect(encendida).toMatchObject({ changed: true, reason: 'downgraded', tierCode: 'INICIAL' });
    });
    expect(await tierDelPerfil(sellerId)).toBe('INICIAL');
    expect((await cambiosAuditados(sellerId)).map((f) => f.metadata)).toEqual([
      expect.objectContaining({ kind: 'assign' }),
      expect.objectContaining({ kind: 'downgrade' }),
    ]);
  });

  it('con `seller_tier_auto_assign` apagado informa y no escribe', async () => {
    const { sellerId } = await vendedor('sin-auto');
    await ordenes(sellerId, 10);

    await conSetting('seller_tier_auto_assign', false, 'bool', async () => {
      const resultado = await tierService.evaluateSellerTier(sellerId);
      expect(resultado).toMatchObject({
        completedSales: 10,
        changed: false,
        reason: 'auto_assign_disabled',
        tierCode: null,
      });
    });
    expect(await tierDelPerfil(sellerId)).toBeNull();
    expect(await cambiosAuditados(sellerId)).toHaveLength(0);
  });

  it('salta directo al mayor umbral alcanzado', async () => {
    const { sellerId } = await vendedor('cincuenta');
    await ordenes(sellerId, 50);
    jobsEncolados.add(idDeAviso(email('cincuenta'), 'PROFESIONAL'));

    const resultado = await tierService.evaluateSellerTier(sellerId);

    expect(resultado).toMatchObject({ completedSales: 50, tierCode: 'PROFESIONAL' });
    expect((await tierService.resolveCommissionBasisPoints(sellerId)).basisPoints).toBe(400);
  });

  it('las ventas de OTRO vendedor no cuentan', async () => {
    const a = await vendedor('vecino-a');
    const b = await vendedor('vecino-b');
    await ordenes(a.sellerId, 10);
    jobsEncolados.add(idDeAviso(a.email, 'AVANZADO'));
    jobsEncolados.add(idDeAviso(b.email, 'INICIAL'));

    expect((await tierService.evaluateSellerTier(b.sellerId)).completedSales).toBe(0);
    expect((await tierService.evaluateSellerTier(a.sellerId)).completedSales).toBe(10);
  });

  it('dentro de una transaccion ajena no manda el email: lo hace quien commitea', async () => {
    const { sellerId, email: destino } = await vendedor('tx-ajena');
    await ordenes(sellerId, 10);
    const jobId = idDeAviso(destino, 'AVANZADO');
    jobsEncolados.add(jobId);

    const resultado = await getDatabase().transaction((tx) =>
      tierService.evaluateSellerTier(sellerId, tx),
    );

    expect(resultado.changed).toBe(true);
    expect(await getQueue(queueName).getJob(jobId)).toBeUndefined();

    expect(await tierService.notifyTierChange(sellerId, resultado.tier!)).toBe(jobId);
    expect(await getQueue(queueName).getJob(jobId)).toBeDefined();
  });
});

describe('assignTierManually — una persona del back-office', () => {
  it('asigna, audita con su id, y repetirlo no cambia nada', async () => {
    const { sellerId } = await vendedor('manual');
    jobsEncolados.add(idDeAviso(email('manual'), 'PROFESIONAL'));

    const primera = await tierService.assignTierManually(
      sellerId,
      'PROFESIONAL',
      adminId,
      'motivo de prueba',
    );
    const segunda = await tierService.assignTierManually(
      sellerId,
      'PROFESIONAL',
      adminId,
      'motivo de prueba',
    );

    expect(primera).toMatchObject({
      previousTierCode: null,
      tierCode: 'PROFESIONAL',
      changed: true,
    });
    expect(segunda).toMatchObject({ tierCode: 'PROFESIONAL', changed: false });

    const [fila] = await cambiosAuditados(sellerId);
    expect(fila).toMatchObject({
      actorType: 'admin',
      actorId: adminId,
      metadata: { kind: 'manual' },
    });
  });

  it('acepta bajar: la decision es de una persona y queda con su nombre', async () => {
    const { sellerId } = await vendedor('manual-baja');
    jobsEncolados.add(idDeAviso(email('manual-baja'), 'AVANZADO'));
    jobsEncolados.add(idDeAviso(email('manual-baja'), 'INICIAL'));
    await tierService.assignTierManually(sellerId, 'AVANZADO', adminId, 'motivo de prueba');

    const baja = await tierService.assignTierManually(
      sellerId,
      'INICIAL',
      adminId,
      'motivo de prueba',
    );

    expect(baja).toMatchObject({
      previousTierCode: 'AVANZADO',
      tierCode: 'INICIAL',
      changed: true,
    });
  });

  it('rechaza un code inexistente', async () => {
    const { sellerId } = await vendedor('manual-inexistente');

    await expect(
      tierService.assignTierManually(sellerId, 'NO_EXISTE', adminId, 'motivo de prueba'),
    ).rejects.toThrowError(/no existe/);
  });
});

describe('listTiers y getTierProgress — lo que ven las pantallas', () => {
  it('lista los tres sembrados del umbral mas bajo al mas alto, con tasa legible', async () => {
    const tiers = await tierService.listTiers();
    const sembrados = tiers.filter((t) => !t.code.startsWith(PREFIJO_TIER));

    expect(sembrados.map((t) => t.code)).toEqual(['INICIAL', 'AVANZADO', 'PROFESIONAL']);
    expect(sembrados.map((t) => t.rateLabel)).toEqual(['6%', '5%', '4%']);
    expect(sembrados.map((t) => t.minCompletedSales)).toEqual([0, 10, 50]);
    expect(sembrados.every((t) => !t.usesGlobalRate)).toBe(true);
    expect(sembrados.every((t) => t.description !== null)).toBe(true);
  });

  it('un tier sin tasa propia muestra la global y lo dice', async () => {
    const [tier] = await getDatabase()
      .insert(schema.sellerTiers)
      .values({
        code: `${PREFIJO_TIER}LISTA`,
        name: 'Con la global',
        commissionRate: null,
        limits: { minCompletedSales: 1_000_000 },
        benefits: { description: '   ' },
        isActive: true,
      })
      .returning({ id: schema.sellerTiers.id, code: schema.sellerTiers.code });

    const listado = (await tierService.listTiers()).find((t) => t.code === tier!.code);

    expect(listado).toMatchObject({
      basisPoints: 600,
      rateLabel: '6%',
      usesGlobalRate: true,
      description: null,
    });

    await getDatabase().delete(schema.sellerTiers).where(eq(schema.sellerTiers.id, tier!.id));
  });

  it('progreso: tier actual, ventas, cuantas faltan, las dos tasas y la lista', async () => {
    const { sellerId } = await vendedor('progreso');
    await ordenes(sellerId, 3);
    await tierService.assignInitialTier(sellerId);

    const progreso = await tierService.getTierProgress(sellerId);

    expect(progreso).toMatchObject({
      currentTier: { code: 'INICIAL', basisPoints: 600, rateLabel: '6%' },
      currentBasisPoints: 600,
      currentRateLabel: '6%',
      completedSales: 3,
      windowDays: 365,
      nextTier: { code: 'AVANZADO', basisPoints: 500, rateLabel: '5%', remainingSales: 7 },
      autoAssign: true,
    });
    expect(
      progreso.tiers.filter((t) => !t.code.startsWith(PREFIJO_TIER)).map((t) => t.code),
    ).toEqual(['INICIAL', 'AVANZADO', 'PROFESIONAL']);
  });

  it('sin tier: paga la global y el proximo es el de umbral cero, con cero faltantes', async () => {
    const { sellerId } = await vendedor('progreso-sin-tier');

    const progreso = await tierService.getTierProgress(sellerId);

    expect(progreso.currentTier).toBeNull();
    expect(progreso.currentBasisPoints).toBe(600);
    expect(progreso.nextTier).toMatchObject({ code: 'INICIAL', remainingSales: 0 });
  });

  it('en el tier mas alto no hay proximo, y las faltantes nunca son negativas', async () => {
    const { sellerId } = await vendedor('progreso-tope');
    await ordenes(sellerId, 60);
    jobsEncolados.add(idDeAviso(email('progreso-tope'), 'PROFESIONAL'));
    await tierService.evaluateSellerTier(sellerId);

    const progreso = await tierService.getTierProgress(sellerId);

    expect(progreso.currentTier?.code).toBe('PROFESIONAL');
    expect(progreso.nextTier).toBeNull();
    expect(progreso.completedSales).toBe(60);
  });

  it('"proximo" es el siguiente por umbral respecto del tier ACTUAL, no de las ventas', async () => {
    // 12 ventas y todavia en INICIAL porque nadie evaluo: el proximo es
    // AVANZADO con 0 faltantes, no PROFESIONAL. Mostrar otra cosa prometeria
    // un salto que la evaluacion no da.
    const { sellerId } = await vendedor('progreso-atrasado');
    await tierService.assignInitialTier(sellerId);
    await ordenes(sellerId, 12);

    const progreso = await tierService.getTierProgress(sellerId);

    expect(progreso.currentTier?.code).toBe('INICIAL');
    expect(progreso.nextTier).toMatchObject({ code: 'AVANZADO', remainingSales: 0 });
  });

  it('getTierProgress NO escribe: refrescar el panel no asigna nada', async () => {
    const { sellerId } = await vendedor('solo-lectura');
    await ordenes(sellerId, 10);

    await tierService.getTierProgress(sellerId);
    await tierService.getTierProgress(sellerId);

    expect(await tierDelPerfil(sellerId)).toBeNull();
    expect(await cambiosAuditados(sellerId)).toHaveLength(0);
  });
});
