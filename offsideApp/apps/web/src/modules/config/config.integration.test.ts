import { randomBytes } from 'node:crypto';

import { getDatabase, schema } from '@offside/database';
import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AuthService from '../auth/services/auth.service';
import type { PublicUser } from '../auth/services/auth.service';
import type * as ListingService from '../listings/services/listing.service';
import type * as OrderService from '../orders/services/order.service';
import type * as PaymentService from '../payments/services/payment.service';
import type * as SellerService from '../sellers/services/seller.service';
import type * as SettingsService from './services/settings.service';
import type * as MpConnectionService from '../sellers/services/mercadopago-connection.service';

/**
 * Config Store — integracion contra PostgreSQL REAL.
 * Requiere `docker compose up -d`.
 *
 * Lo que se verifica es la propiedad que hace configurable a la comision **sin
 * romper la contabilidad**: la tasa sale de `app_settings` al crear la orden y
 * se CONGELA ahi (DEC-030). Cambiarla despues no puede tocar lo ya cobrado.
 *
 * Limpia todo lo que crea: sufijo `@cfgtest.offside`.
 */

const requestAsSeller = vi.hoisted(() => vi.fn());

vi.mock('../sellers/services/mercadopago-connection.service', async (importOriginal) => {
  const original = await importOriginal<typeof MpConnectionService>();

  return { ...original, requestAsSeller };
});

const SUFIJO = '@cfgtest.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';

/** $50.000 en centavos. */
const PRECIO = 5_000_000n;

let authService: typeof AuthService;
let sellerService: typeof SellerService;
let listingService: typeof ListingService;
let orderService: typeof OrderService;
let paymentService: typeof PaymentService;
let settingsService: typeof SettingsService;
let encryptToken: (plaintext: string) => string;
let closeRedis: () => Promise<void>;
let secuencia = 0;

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');

  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  loadRootEnv(import.meta.dirname);
  resetEnvCache();

  authService = await import('../auth/services/auth.service');
  sellerService = await import('../sellers/services/seller.service');
  listingService = await import('../listings/services/listing.service');
  orderService = await import('../orders/services/order.service');
  paymentService = await import('../payments/services/payment.service');
  settingsService = await import('./services/settings.service');

  const cipher = await import('../sellers/infrastructure/mercadopago/token-cipher');
  cipher.resetTokenCipherCache();
  encryptToken = cipher.encryptToken;

  ({ closeRedisConnections: closeRedis } = await import('@offside/jobs'));

  await limpiar();
});

beforeEach(async () => {
  requestAsSeller.mockReset();
  await restaurarTasa();
});

afterAll(async () => {
  await limpiar();
  await restaurarTasa();

  const { closeDatabase } = await import('@offside/database');
  await closeDatabase();
  await closeRedis();
});

/**
 * Deja la tasa como la dejo la migracion: una sola version, 600 bp.
 *
 * Se borra y se reinserta en vez de agregar una version mas, para que cada test
 * arranque del mismo estado sin depender del orden en que corrieron los otros.
 */
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

  const ordenes = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(inArray(schema.orders.buyerId, ids));
  const orderIds = ordenes.map((o) => o.id);

  if (orderIds.length > 0) {
    const pagos = await db
      .select({ id: schema.payments.id })
      .from(schema.payments)
      .where(inArray(schema.payments.orderId, orderIds));

    if (pagos.length > 0) {
      await db.delete(schema.paymentSplits).where(
        inArray(
          schema.paymentSplits.paymentId,
          pagos.map((p) => p.id),
        ),
      );
    }

    await db.delete(schema.payments).where(inArray(schema.payments.orderId, orderIds));
    await db
      .delete(schema.orderStatusHistory)
      .where(inArray(schema.orderStatusHistory.orderId, orderIds));
    await db.delete(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds));
    await db.delete(schema.orders).where(inArray(schema.orders.id, orderIds));
  }

  const perfiles = await db
    .select({ id: schema.sellerProfiles.id })
    .from(schema.sellerProfiles)
    .where(inArray(schema.sellerProfiles.userId, ids));

  if (perfiles.length > 0) {
    const sellerIds = perfiles.map((p) => p.id);
    await db.delete(schema.listings).where(inArray(schema.listings.sellerId, sellerIds));
    await db
      .delete(schema.mercadopagoAccounts)
      .where(inArray(schema.mercadopagoAccounts.sellerId, sellerIds));
  }

  await db.delete(schema.auditLog).where(inArray(schema.auditLog.actorId, ids));
  await db.delete(schema.sellerProfiles).where(inArray(schema.sellerProfiles.userId, ids));
  await db.delete(schema.userHistoryEvents).where(inArray(schema.userHistoryEvents.userId, ids));
  await db.delete(schema.sessions).where(inArray(schema.sessions.userId, ids));
  await db
    .delete(schema.emailVerificationTokens)
    .where(inArray(schema.emailVerificationTokens.userId, ids));
  await db.delete(schema.users).where(inArray(schema.users.id, ids));

  await db.delete(schema.categories).where(eq(schema.categories.slug, 'camisetas-cfgtest'));
}

async function usuario(nombre: string): Promise<PublicUser> {
  const { emailVerificationToken } = await authService.register({
    email: email(nombre),
    password: PASSWORD,
    acceptedTerms: true,
  });

  return authService.verifyEmail(emailVerificationToken);
}

async function categoria(): Promise<string> {
  const db = getDatabase();
  const [existente] = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.slug, 'camisetas-cfgtest'))
    .limit(1);

  if (existente) return existente.id;

  const [creada] = await db
    .insert(schema.categories)
    .values({
      name: 'Camisetas (config test)',
      slug: 'camisetas-cfgtest',
      code: 'camiseta',
      isActive: true,
    })
    .returning();

  return creada!.id;
}

/** Vendedor aprobado y con Mercado Pago conectado (se escribe directo). */
async function vendedor(nombre: string): Promise<PublicUser> {
  const db = getDatabase();
  secuencia += 1;

  const user = await usuario(`${nombre}-seller`);
  const perfil = await sellerService.createSellerProfile(user, {
    displayName: `Tienda ${nombre}`,
    acceptedSellerTerms: true,
  });

  await db
    .update(schema.sellerProfiles)
    .set({ status: 'approved', approvedAt: new Date() })
    .where(eq(schema.sellerProfiles.id, perfil.id));

  await db.insert(schema.mercadopagoAccounts).values({
    sellerId: perfil.id,
    mpUserId: `4000000${secuencia}`,
    status: 'connected',
    accessTokenEncrypted: encryptToken('token-de-prueba'),
    refreshTokenEncrypted: encryptToken('refresh-de-prueba'),
    connectedAt: new Date(),
    tokenExpiresAt: new Date(Date.now() + 86_400_000),
  });

  return user;
}

async function publicacion(nombre: string) {
  const seller = await vendedor(nombre);

  return listingService.publishListing(seller, {
    categoryId: await categoria(),
    title: 'Camiseta de prueba',
    description: null,
    priceAmount: PRECIO,
    stock: 5,
    sizeValue: 'L',
    condition: 'NUEVO',
    kitType: 'home',
    sleeve: 'short',
  });
}

/* -------------------------------------------------------------------------- */

describe('Config Store', () => {
  it('devuelve 600 bp: el seed de la migracion esta cargado', async () => {
    expect(await settingsService.getCommissionRateBasisPoints()).toBe(600);
  });

  it('600 bp se snapshotea como 0.0600 en la orden', () => {
    expect(settingsService.basisPointsToRateSnapshot(600)).toBe('0.0600');
    expect(settingsService.basisPointsToRateSnapshot(700)).toBe('0.0700');
    expect(settingsService.basisPointsToRateSnapshot(1_250)).toBe('0.1250');
  });

  it('cambiar la tasa inserta una VERSION nueva, no pisa la anterior', async () => {
    await settingsService.setCommissionRateBasisPoints(700);

    const versiones = await getDatabase()
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, 'commission_rate_default'));

    expect(versiones.length).toBeGreaterThanOrEqual(2);
    expect(await settingsService.getCommissionRateBasisPoints()).toBe(700);
  });

  describe('validacion', () => {
    it('rechaza una tasa negativa', async () => {
      await expect(settingsService.setCommissionRateBasisPoints(-1)).rejects.toMatchObject({
        code: 'SETTING_INVALID',
      });
    });

    it('rechaza una comision mayor al 100%', async () => {
      // Haria que marketplace_fee > total, cosa que Mercado Pago rechaza.
      await expect(settingsService.setCommissionRateBasisPoints(10_001)).rejects.toMatchObject({
        code: 'SETTING_INVALID',
      });
    });

    it('rechaza un valor no entero', async () => {
      await expect(settingsService.setCommissionRateBasisPoints(600.5)).rejects.toMatchObject({
        code: 'SETTING_INVALID',
      });
    });

    it('acepta los extremos validos: 0 y 10000', async () => {
      expect(await settingsService.setCommissionRateBasisPoints(0)).toBe(0);
      expect(await settingsService.setCommissionRateBasisPoints(10_000)).toBe(10_000);
    });
  });
});

describe('la comision de una orden sale del Config Store', () => {
  it('usa el valor configurado (600 bp) y lo congela', async () => {
    const listing = await publicacion('base');
    const comprador = await usuario('base-buyer');

    const orden = await orderService.createOrder(comprador, {
      listingId: listing.id,
      quantity: 1,
      shippingAddress: { calle: 'Falsa 123' },
    });

    // 6% de $50.000 = $3.000
    expect(orden.commissionAmount).toBe('300000');

    const [fila] = await getDatabase()
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orden.id));
    expect(fila?.commissionRateAtTransaction).toBe('0.0600');
  });

  it('cambiar a 700 bp afecta a las ordenes NUEVAS', async () => {
    const listing = await publicacion('sube');
    const comprador = await usuario('sube-buyer');

    await settingsService.setCommissionRateBasisPoints(700);

    const orden = await orderService.createOrder(comprador, {
      listingId: listing.id,
      quantity: 1,
      shippingAddress: { calle: 'Falsa 123' },
    });

    // 7% de $50.000 = $3.500
    expect(orden.commissionAmount).toBe('350000');
  });

  it('⚠️ una orden EXISTENTE conserva su comision cuando cambia la tasa', async () => {
    // Es la garantia de DEC-030 y la razon de ser del snapshot: la
    // configuracion nueva no puede reescribir lo que ya se cobro.
    const listing = await publicacion('congela');
    const comprador = await usuario('congela-buyer');

    const orden = await orderService.createOrder(comprador, {
      listingId: listing.id,
      quantity: 1,
      shippingAddress: { calle: 'Falsa 123' },
    });
    expect(orden.commissionAmount).toBe('300000');

    await settingsService.setCommissionRateBasisPoints(700);

    const [despues] = await getDatabase()
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orden.id));

    expect(despues?.commissionAmount).toBe(300_000n);
    expect(despues?.commissionRateAtTransaction).toBe('0.0600');
  });
});

describe('payments NO recalcula la comision', () => {
  it('el checkout lee el snapshot de la orden y no consulta el Config Store', async () => {
    const listing = await publicacion('chk');
    const comprador = await usuario('chk-buyer');

    const orden = await orderService.createOrder(comprador, {
      listingId: listing.id,
      quantity: 1,
      shippingAddress: { calle: 'Falsa 123' },
    });

    requestAsSeller.mockResolvedValue({
      ok: true,
      status: 201,
      body: { id: 'pref-cfg', init_point: 'https://mp.test/x' },
    });

    // La tasa cambia DESPUES de crear la orden y ANTES de cobrar.
    await settingsService.setCommissionRateBasisPoints(700);

    const espia = vi.spyOn(settingsService, 'getCommissionRateBasisPoints');

    const checkout = await paymentService.startCheckout(comprador, orden.id);

    // Manda el 6% congelado, no el 7% vigente.
    expect(checkout.marketplaceFeeAmount).toBe('300000');

    const [, preferencia] = requestAsSeller.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(preferencia.body.marketplace_fee).toBe(3_000);

    // Y ni siquiera pregunto por la configuracion.
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });
});
