import { randomBytes } from 'node:crypto';

import { getDatabase, schema } from '@offside/database';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as AddressService from '../addresses/services/address.service';
import type * as AuthService from '../auth/services/auth.service';
import type { PublicUser } from '../auth/services/auth.service';
import type * as SellerService from '../sellers/services/seller.service';
import type * as OrderShippingService from './services/order-shipping.service';
import type * as OrderService from './services/order.service';

/**
 * Envio automatico — integracion contra PostgreSQL y Redis REALES, con el
 * transportista SIMULADO.
 *
 * Cubre lo que los tests del adaptador no ven: que el alta y el barrido se
 * hablen por la MISMA referencia, y que el barrido mueva la orden. Ese hueco
 * existio —el barrido buscaba por `labelRef`, que en el simulado es el numero
 * de seguimiento— y ningun test lo marcaba.
 *
 * Limpia todo lo que crea: sufijo `@envtest.offside`.
 */

const SUFIJO = '@envtest.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';
const PRECIO = 5_000_000n;
const PAQUETE = { weightGrams: 500, heightCm: 5, widthCm: 25, lengthCm: 35 };

const DESTINO = {
  nombre: 'Martina Gómez',
  calle: 'Bv. Oroño',
  numero: '1180',
  departamento: null,
  ciudad: 'Rosario',
  provincia: 'S',
  codigoPostal: 'S2000DSB',
  telefono: '+543415550199',
  etiqueta: null,
};

let authService: typeof AuthService;
let sellerService: typeof SellerService;
let addressService: typeof AddressService;
let orderService: typeof OrderService;
let envios: typeof OrderShippingService;
let encryptToken: (plaintext: string) => string;
let closeRedis: () => Promise<void>;
let secuencia = 0;

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');

  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  loadRootEnv(import.meta.dirname);
  // ⚠️ Con la credencial cargada en `.env`, este test daria de alta envios
  // REALES en la cuenta de Offside. Se borra antes de leer el entorno.
  delete process.env.ANDREANI_CREDENCIAL;
  resetEnvCache();

  authService = await import('../auth/services/auth.service');
  sellerService = await import('../sellers/services/seller.service');
  addressService = await import('../addresses/services/address.service');
  orderService = await import('./services/order.service');
  envios = await import('./services/order-shipping.service');

  const cipher = await import('../sellers/infrastructure/mercadopago/token-cipher');
  cipher.resetTokenCipherCache();
  encryptToken = cipher.encryptToken;

  ({ closeRedisConnections: closeRedis } = await import('@offside/jobs'));

  await limpiar();
});

afterEach(() => {
  vi.useRealTimers();
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

  const ordenes = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(inArray(schema.orders.buyerId, ids));
  const orderIds = ordenes.map((o) => o.id);

  if (orderIds.length > 0) {
    const envio = await db
      .select({ id: schema.shipments.id })
      .from(schema.shipments)
      .where(inArray(schema.shipments.orderId, orderIds));
    if (envio.length > 0) {
      await db.delete(schema.shipmentTrackingEvents).where(
        inArray(
          schema.shipmentTrackingEvents.shipmentId,
          envio.map((e) => e.id),
        ),
      );
    }
    await db.delete(schema.shipments).where(inArray(schema.shipments.orderId, orderIds));
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

  await db.delete(schema.userAddresses).where(inArray(schema.userAddresses.userId, ids));
  await db.delete(schema.auditLog).where(inArray(schema.auditLog.actorId, ids));
  await db.delete(schema.sellerProfiles).where(inArray(schema.sellerProfiles.userId, ids));
  await db.delete(schema.userHistoryEvents).where(inArray(schema.userHistoryEvents.userId, ids));
  await db.delete(schema.sessions).where(inArray(schema.sessions.userId, ids));
  await db
    .delete(schema.emailVerificationTokens)
    .where(inArray(schema.emailVerificationTokens.userId, ids));
  await db
    .delete(schema.identityVerifications)
    .where(inArray(schema.identityVerifications.userId, ids));
  await db.delete(schema.users).where(inArray(schema.users.id, ids));
}

async function usuario(nombre: string): Promise<PublicUser> {
  const { emailVerificationToken } = await authService.register({
    email: email(nombre),
    password: PASSWORD,
    acceptedTerms: true,
  });

  return authService.verifyEmail(emailVerificationToken);
}

/**
 * Venta en `PROCESSING`, lista para despachar.
 *
 * El pago se aprueba como lo hace el webhook: PAID y PROCESSING en la MISMA
 * transaccion, que es justo el caso en que el historial empataba la hora.
 */
async function ventaEnPreparacion(
  nombre: string,
  { conOrigen = true }: { conOrigen?: boolean } = {},
): Promise<{ vendedor: PublicUser; orderId: string; orderNumber: string }> {
  const db = getDatabase();
  secuencia += 1;

  const vendedor = await usuario(`${nombre}-seller`);
  const perfil = await sellerService.createSellerProfile(vendedor, {
    displayName: `Tienda ${nombre}`,
    acceptedSellerTerms: true,
  });
  await db
    .update(schema.sellerProfiles)
    .set({ status: 'approved', approvedAt: new Date() })
    .where(eq(schema.sellerProfiles.id, perfil.id));
  await db.insert(schema.mercadopagoAccounts).values({
    sellerId: perfil.id,
    mpUserId: `3000000${secuencia}`,
    accessTokenEncrypted: encryptToken('valor-que-simula-un-access-token'),
    status: 'connected',
    connectedAt: new Date(),
  });

  const [categoria] = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.code, 'camiseta'))
    .limit(1);
  const [listing] = await db
    .insert(schema.listings)
    .values({
      sellerId: perfil.id,
      categoryId: categoria!.id,
      title: `Camiseta ${nombre}`,
      priceAmount: PRECIO,
      sizeValue: 'L',
      condition: 'NUEVO',
      status: 'active',
      moderationStatus: 'APPROVED',
      stock: 3,
    })
    .returning();

  if (conOrigen) {
    await addressService.createAddress(vendedor, {
      nombre: 'Tienda de prueba',
      telefono: '+541155550100',
      calle: 'Av. Corrientes',
      numero: '1234',
      ciudad: 'CABA',
      provincia: 'C',
      codigoPostal: 'C1043AAZ',
    });
  }

  const comprador = await usuario(`${nombre}-buyer`);
  const orden = await orderService.createOrder(comprador, {
    listingId: listing!.id,
    quantity: 1,
    shippingAddress: DESTINO,
  });

  await db.transaction(async (tx) => {
    await orderService.markAsPaid(orden.id, new Date(), tx);
    await orderService.startProcessing(orden.id, tx);
  });

  return { vendedor, orderId: orden.id, orderNumber: orden.orderNumber };
}

async function estadoDe(orderId: string): Promise<string | undefined> {
  return (await orderService.findById(orderId))?.status;
}

/* -------------------------------------------------------------------------- */

describe('historial de la orden', () => {
  /**
   * ⚠️ PAID Y PROCESSING SE ESCRIBEN EN LA MISMA TRANSACCION. Con `now()`
   * empataban la hora y el desempate por uuid es al azar: la ficha mostraba
   * "Pagada (estado actual)" con la orden en preparacion, mas o menos la mitad
   * de las veces. Por eso se repite.
   */
  it('termina en el estado actual aunque dos transiciones compartan transaccion', async () => {
    for (let i = 0; i < 4; i += 1) {
      const { orderId } = await ventaEnPreparacion(`historia${i}`);
      const historial = await orderService.getOrderTimeline(orderId);

      expect(historial.map((h) => h.toStatus)).toEqual(['PENDING_PAYMENT', 'PAID', 'PROCESSING']);
    }
  });
});

describe('despacho automatico', () => {
  it('da de alta el envio y lo deja con etiqueta y seguimiento', async () => {
    const { vendedor, orderId } = await ventaEnPreparacion('alta');

    const envio = await envios.despacharAutomatico(vendedor, orderId, PAQUETE);

    expect(envio.provider).toBe('fake');
    expect(envio.trackingNumber).toMatch(/^SIM-/);
    expect(envio.status).toBe('created');
    // Generar el envio no es despacharlo: la orden sigue en preparacion hasta
    // que el transportista informe que lo tiene.
    expect(await estadoDe(orderId)).toBe('PROCESSING');
  });

  it('rechaza sin domicilio de despacho y no deja reserva', async () => {
    const { vendedor, orderId } = await ventaEnPreparacion('sinorigen', { conOrigen: false });

    await expect(envios.despacharAutomatico(vendedor, orderId, PAQUETE)).rejects.toThrow(
      /domicilio de despacho/,
    );

    const filas = await getDatabase()
      .select()
      .from(schema.shipments)
      .where(eq(schema.shipments.orderId, orderId));
    expect(filas).toHaveLength(0);
  });

  it('no da de alta dos envios para la misma venta', async () => {
    const { vendedor, orderId } = await ventaEnPreparacion('doble');

    await envios.despacharAutomatico(vendedor, orderId, PAQUETE);

    await expect(envios.despacharAutomatico(vendedor, orderId, PAQUETE)).rejects.toBeDefined();
  });

  it('no deja despachar la venta de otro vendedor', async () => {
    const { orderId } = await ventaEnPreparacion('ajena');
    const intruso = await usuario('intruso');
    await sellerService.createSellerProfile(intruso, {
      displayName: 'Tienda intrusa',
      acceptedSellerTerms: true,
    });

    await expect(envios.despacharAutomatico(intruso, orderId, PAQUETE)).rejects.toBeDefined();
  });
});

describe('seguimiento automatico', () => {
  /**
   * ⚠️ EL TEST QUE FALTABA. El alta y el barrido tienen que hablar de la misma
   * referencia; si no, el barrido "corre bien", no encuentra nada y la orden se
   * queda en preparacion para siempre sin que ningun log lo diga.
   */
  it('mueve la orden a enviada y despues a entregada con lo que informa el transportista', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date());

    const { vendedor, orderId } = await ventaEnPreparacion('seguimiento');
    await envios.despacharAutomatico(vendedor, orderId, PAQUETE);

    // El simulado avanza una etapa cada dos minutos: a los cinco, en transito.
    vi.setSystemTime(Date.now() + 5 * 60_000);
    expect(await envios.sincronizarEnvios({ soloOrdenes: [orderId] })).toBeGreaterThanOrEqual(1);
    expect(await estadoDe(orderId)).toBe('SHIPPED');

    vi.setSystemTime(Date.now() + 10 * 60_000);
    await envios.sincronizarEnvios({ soloOrdenes: [orderId] });
    expect(await estadoDe(orderId)).toBe('DELIVERED');

    const [envio] = await getDatabase()
      .select()
      .from(schema.shipments)
      .where(eq(schema.shipments.orderId, orderId));
    expect(envio?.status).toBe('delivered');
    expect(envio?.dispatchedAt).not.toBeNull();
    expect(envio?.deliveredAt).not.toBeNull();

    const historial = await orderService.getOrderTimeline(orderId);
    expect(historial.at(-1)).toMatchObject({ toStatus: 'DELIVERED', actorType: 'system' });
  });

  it('una segunda vuelta sin novedades no cambia nada', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date());

    const { vendedor, orderId } = await ventaEnPreparacion('quieto');
    await envios.despacharAutomatico(vendedor, orderId, PAQUETE);

    vi.setSystemTime(Date.now() + 5 * 60_000);
    await envios.sincronizarEnvios({ soloOrdenes: [orderId] });
    const antes = await orderService.getOrderTimeline(orderId);

    await envios.sincronizarEnvios({ soloOrdenes: [orderId] });

    expect(await orderService.getOrderTimeline(orderId)).toHaveLength(antes.length);
  });
});

describe('liberacion del dinero', () => {
  async function pago(orderId: string, status: 'APPROVED' | 'REJECTED', liberacion: string) {
    await getDatabase()
      .insert(schema.payments)
      .values({
        orderId,
        status,
        amount: PRECIO,
        checkoutType: 'checkout_pro',
        raw: { id: 1, status: status.toLowerCase(), money_release_date: liberacion },
      });
  }

  /**
   * ⚠️ OFFSIDE NO LIBERA NADA (DEC-019): la fecha es la que informo Mercado
   * Pago en el pago, tal cual. Sin mostrarla, "no se me liquida" no tenia
   * respuesta en ningun lado del sitio.
   */
  it('muestra la fecha que informo Mercado Pago en el pago aprobado', async () => {
    const { vendedor, orderId } = await ventaEnPreparacion('libera');
    await pago(orderId, 'APPROVED', '2026-10-20T15:04:05.000-04:00');

    const venta = await orderService.getSaleDetail(vendedor, orderId);

    expect(venta?.moneyReleaseDate).toBe('2026-10-20T19:04:05.000Z');
  });

  it('no toma la fecha de un pago rechazado', async () => {
    const { vendedor, orderId } = await ventaEnPreparacion('rechazado');
    await pago(orderId, 'REJECTED', '2026-10-20T15:04:05.000-04:00');

    expect((await orderService.getSaleDetail(vendedor, orderId))?.moneyReleaseDate).toBeNull();
  });
});
