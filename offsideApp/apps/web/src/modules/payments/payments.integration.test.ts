import { randomBytes, randomUUID } from 'node:crypto';

import { getDatabase, schema } from '@offside/database';
import { and, eq, inArray, like } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as AuthService from '../auth/services/auth.service';
import type { PublicUser } from '../auth/services/auth.service';
import type * as MpConnectionService from '../sellers/services/mercadopago-connection.service';
import type * as SellerService from '../sellers/services/seller.service';
import type * as OrderService from '../orders/services/order.service';
import type * as PaymentService from './services/payment.service';
import type * as WebhookService from './services/payment-webhook.service';
import type * as RefundService from './services/refund.service';

/**
 * Payments — integracion contra PostgreSQL y Redis REALES.
 * Requiere `docker compose up -d`.
 *
 *   npm test -- --project=integration
 *
 * NO sale a internet: `requestAsSeller` esta mockeado, asi que el test cubre
 * todo lo que pasa de este lado —comision, preferencia, idempotencia, webhook,
 * estados, reembolsos y `audit_log`— sin tocar Mercado Pago.
 *
 * ⚠️ Ningun valor de este archivo es una credencial real.
 *
 * Limpia todo lo que crea: sufijo `@payitest.offside`.
 */

const requestAsSeller = vi.hoisted(() => vi.fn());

vi.mock('../sellers/services/mercadopago-connection.service', async (importOriginal) => {
  const original = await importOriginal<typeof MpConnectionService>();

  return { ...original, requestAsSeller };
});

const SUFIJO = '@payitest.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';
const MP_USER_ID = '100000777';

/** $100.000 en centavos, el ejemplo de DEC-043. */
const TOTAL = 10_000_000n;
/** El 6%. */
const COMISION = 600_000n;

let authService: typeof AuthService;
let sellerService: typeof SellerService;
let orderService: typeof OrderService;
let paymentService: typeof PaymentService;
let webhookService: typeof WebhookService;
let refundService: typeof RefundService;
let encryptToken: (plaintext: string) => string;
let closeRedis: () => Promise<void>;

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');

  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  loadRootEnv(import.meta.dirname);
  resetEnvCache();

  authService = await import('../auth/services/auth.service');
  sellerService = await import('../sellers/services/seller.service');
  orderService = await import('../orders/services/order.service');
  paymentService = await import('./services/payment.service');
  webhookService = await import('./services/payment-webhook.service');
  refundService = await import('./services/refund.service');

  const cipher = await import('../sellers/infrastructure/mercadopago/token-cipher');
  cipher.resetTokenCipherCache();
  encryptToken = cipher.encryptToken;

  ({ closeRedisConnections: closeRedis } = await import('@offside/jobs'));

  await limpiar();
});

afterEach(() => {
  requestAsSeller.mockReset();
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
    const pagos = await db
      .select({ id: schema.payments.id })
      .from(schema.payments)
      .where(inArray(schema.payments.orderId, orderIds));

    if (pagos.length > 0) {
      const paymentIds = pagos.map((p) => p.id);
      await db
        .delete(schema.paymentSplits)
        .where(inArray(schema.paymentSplits.paymentId, paymentIds));
      await db.delete(schema.refunds).where(inArray(schema.refunds.paymentId, paymentIds));
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
  await db
    .delete(schema.identityVerifications)
    .where(inArray(schema.identityVerifications.userId, ids));
  await db.delete(schema.users).where(inArray(schema.users.id, ids));

  await db.delete(schema.categories).where(eq(schema.categories.slug, 'camisetas-payitest'));
}

async function usuario(nombre: string): Promise<PublicUser> {
  const { emailVerificationToken } = await authService.register({
    email: email(nombre),
    password: PASSWORD,
    acceptedTerms: true,
  });

  return authService.verifyEmail(emailVerificationToken);
}

/** Categoria compartida por los listings del test. */
/**
 * Categoria del catalogo.
 *
 * Se LEE la que carga la migracion 0004; no se crea una de test. `code` es
 * UNIQUE y las seis categorias son un conjunto fijo respaldado por el enum
 * `garment_category` (database-design.md §5), asi que insertar una propia
 * chocaria contra la fila real. Ademas los tests corren contra el mismo
 * catalogo que produccion, que es lo que se quiere.
 */
async function categoriaPorCodigo(code: 'camiseta' | 'short'): Promise<string> {
  const [fila] = await getDatabase()
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.code, code))
    .limit(1);

  if (!fila) {
    throw new Error(
      `Falta la categoria '${code}'. Corre las migraciones: la 0004 carga el catalogo.`,
    );
  }

  return fila.id;
}

async function categoria(): Promise<string> {
  return categoriaPorCodigo('camiseta');
}

interface Escenario {
  buyer: PublicUser;
  sellerId: string;
  orderId: string;
  /** Cuenta de MP del vendedor. Unica por escenario: la columna es UNIQUE. */
  mpUserId: string;
  /** Id del pago en MP para este escenario. Tambien UNIQUE en `payments`. */
  mpPaymentId: string;
  preferenceId: string;
}

/** Contador para que cada escenario tenga identificadores propios de MP. */
let secuencia = 0;

/**
 * Vendedor aprobado + conectado, con una orden lista para pagar.
 *
 * ⚠️ El vendedor se aprueba y se conecta ESCRIBIENDO EN LA BASE. No existe flujo
 * de aprobacion (TS-001 sigue 🟡) y el OAuth ya tiene sus propios tests: no se
 * fabrica un endpoint para que este test pase.
 *
 * La orden tambien se crea a mano: `modules/orders` no existe todavia. La
 * comision se calcula con el MISMO codigo que usara `orders` cuando exista.
 */
async function escenario(nombre: string, opciones: { total?: bigint } = {}): Promise<Escenario> {
  const db = getDatabase();
  const total = opciones.total ?? TOTAL;
  secuencia += 1;

  const mpUserId = `${MP_USER_ID}${secuencia}`;
  const mpPaymentId = `555${String(secuencia).padStart(9, '0')}`;
  const preferenceId = `pref-test-${secuencia}`;

  const buyer = await usuario(`${nombre}-buyer`);
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
    mpUserId,
    accessTokenEncrypted: encryptToken('valor-que-simula-un-access-token'),
    status: 'connected',
    connectedAt: new Date(),
  });

  const [listing] = await db
    .insert(schema.listings)
    .values({
      // ERD §9.1: comprable exige `APPROVED`. Las publicaciones nacen
      // aprobadas desde el Service; al insertar por SQL hay que replicarlo.
      moderationStatus: 'APPROVED',
      sellerId: perfil.id,
      categoryId: await categoria(),
      title: `Camiseta ${nombre}`,
      priceAmount: total,
      sizeValue: 'L',
      condition: 'NUEVO',
      status: 'active',
    })
    .returning();

  const comision = orderService.calculateCommission(total, 600);

  const [order] = await db
    .insert(schema.orders)
    .values({
      orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
      buyerId: buyer.id,
      sellerId: perfil.id,
      status: 'PENDING_PAYMENT',
      productAmount: total,
      totalAmount: total,
      commissionAmount: comision,
      commissionRateAtTransaction: '0.0600',
      sellerAmount: total - comision,
      shippingAddress: { calle: 'Falsa 123' },
      paymentDeadline: new Date(Date.now() + 60 * 60 * 1000),
    })
    .returning();

  await db.insert(schema.orderItems).values({
    orderId: order!.id,
    listingId: listing!.id,
    titleSnapshot: listing!.title,
    unitPriceAmount: total,
    quantity: 1,
  });

  return { buyer, sellerId: perfil.id, orderId: order!.id, mpUserId, mpPaymentId, preferenceId };
}

/** Doble de Mercado Pago: responde preferencia y consulta de pago. */
function mercadoPago(
  ctx: Escenario,
  overrides: Record<string, unknown> = {},
): (sellerId: string, request: { path: string; method: string }) => Promise<unknown> {
  return (_sellerId, request) => {
    if (request.path.startsWith('/checkout/preferences')) {
      return Promise.resolve({
        ok: true,
        status: 201,
        body: {
          id: ctx.preferenceId,
          init_point: `https://www.mercadopago.com.ar/checkout?pref_id=${ctx.preferenceId}`,
          collector_id: ctx.mpUserId,
        },
      });
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      body: {
        id: ctx.mpPaymentId,
        status: 'approved',
        status_detail: 'accredited',
        external_reference: ctx.orderId,
        transaction_amount: 100_000,
        currency_id: 'ARS',
        payment_method_id: 'visa',
        installments: 1,
        date_approved: '2026-08-24T12:00:00.000Z',
        transaction_details: { net_received_amount: 89_000 },
        ...overrides,
      },
    });
  };
}

async function pago(orderId: string) {
  const [row] = await getDatabase()
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.orderId, orderId));

  return row;
}

async function auditoria(action: string) {
  return getDatabase().select().from(schema.auditLog).where(eq(schema.auditLog.action, action));
}

/** Notificacion de webhook con la forma que manda Mercado Pago. */
function notificacion(ctx: Escenario, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: 'payment',
    action: 'payment.updated',
    dataId: ctx.mpPaymentId,
    notificationId: `notif-${randomUUID()}`,
    mpUserId: ctx.mpUserId,
    ...overrides,
  } as Parameters<typeof webhookService.handleNotification>[0];
}

/* -------------------------------------------------------------------------- */

describe('checkout', () => {
  it('crea el pago local y devuelve el init_point', async () => {
    const ctx = await escenario('ok');
    const { buyer, orderId } = ctx;
    requestAsSeller.mockImplementation(mercadoPago(ctx));

    const resultado = await paymentService.startCheckout(buyer, orderId);

    expect(resultado.initPoint).toContain('mercadopago');
    expect(resultado.marketplaceFeeAmount).toBe(COMISION.toString());

    const local = await pago(orderId);
    expect(local?.status).toBe('PENDING');
    expect(local?.mpPreferenceId).toBe(ctx.preferenceId);
    expect(local?.amount).toBe(TOTAL);
    expect(local?.checkoutType).toBe('pro');
  });

  it('MANDA el 6% como marketplace_fee, tomado del snapshot de la orden', async () => {
    const ctx = await escenario('fee');
    const { buyer, orderId } = ctx;
    requestAsSeller.mockImplementation(mercadoPago(ctx));

    await paymentService.startCheckout(buyer, orderId);

    const [, request] = requestAsSeller.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    // $6.000 sobre $100.000. Sin estimar ni descontar el costo de MP (DEC-043).
    expect(request.body.marketplace_fee).toBe(6_000);
    expect(request.body.external_reference).toBe(orderId);
  });

  it('usa el vendedor de la orden, no uno arbitrario', async () => {
    const ctx = await escenario('seller');
    const { buyer, orderId, sellerId } = ctx;
    requestAsSeller.mockImplementation(mercadoPago(ctx));

    await paymentService.startCheckout(buyer, orderId);

    expect(requestAsSeller.mock.calls[0]?.[0]).toBe(sellerId);
  });

  it('la fila local se crea ANTES de llamar a Mercado Pago', async () => {
    // Si MP falla, tiene que quedar rastro local del intento.
    const { buyer, orderId } = await escenario('antes');
    requestAsSeller.mockResolvedValue({ ok: false, status: 500, body: {} });

    await expect(paymentService.startCheckout(buyer, orderId)).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_ERROR',
    });

    const local = await pago(orderId);
    expect(local).toBeDefined();
    expect(local?.status).toBe('PENDING');
    expect(local?.mpPreferenceId).toBeNull();
  });

  it('RECHAZA la orden de otro comprador', async () => {
    const { orderId } = await escenario('ownership');
    const intruso = await usuario('ownership-intruso');

    await expect(paymentService.startCheckout(intruso, orderId)).rejects.toMatchObject({
      code: 'ORDER_NOT_FOUND',
    });

    expect(requestAsSeller).not.toHaveBeenCalled();
  });

  it('rechaza una orden que no esta pendiente de pago', async () => {
    const { buyer, orderId } = await escenario('pagada');
    await getDatabase()
      .update(schema.orders)
      .set({ status: 'PAID' })
      .where(eq(schema.orders.id, orderId));

    await expect(paymentService.startCheckout(buyer, orderId)).rejects.toMatchObject({
      code: 'ORDER_NOT_PAYABLE',
    });
  });

  it('rechaza una orden con la ventana de pago vencida', async () => {
    const { buyer, orderId } = await escenario('vencida');
    await getDatabase()
      .update(schema.orders)
      .set({ paymentDeadline: new Date(Date.now() - 1_000) })
      .where(eq(schema.orders.id, orderId));

    await expect(paymentService.startCheckout(buyer, orderId)).rejects.toMatchObject({
      code: 'PAYMENT_DEADLINE_EXPIRED',
    });
  });

  it('rechaza si el vendedor no tiene Mercado Pago conectado', async () => {
    const { buyer, orderId, sellerId } = await escenario('sin-mp');
    await getDatabase()
      .update(schema.mercadopagoAccounts)
      .set({ status: 'disconnected' })
      .where(eq(schema.mercadopagoAccounts.sellerId, sellerId));

    // El mock deja pasar todo: quien corta es la conexion real de `sellers`.
    const { requestAsSeller: real } =
      await import('../sellers/services/mercadopago-connection.service');
    requestAsSeller.mockImplementation(real);

    await expect(paymentService.startCheckout(buyer, orderId)).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_ERROR',
    });
  });

  it('audita la creacion de la preferencia sin credenciales', async () => {
    const ctx = await escenario('audit');
    const { buyer, orderId } = ctx;
    requestAsSeller.mockImplementation(mercadoPago(ctx));

    await paymentService.startCheckout(buyer, orderId);

    const filas = (await auditoria('PAYMENT_PREFERENCE_CREATED')).filter(
      (f) => f.actorId === buyer.id,
    );
    expect(filas).toHaveLength(1);
    const metadata = filas[0]!.metadata as Record<string, unknown>;
    expect(metadata.marketplaceFee).toBe(COMISION.toString());
    expect(JSON.stringify(filas)).not.toContain('access-token');
  });

  it('un segundo checkout reutiliza la preferencia: no crea dos pagos', async () => {
    const ctx = await escenario('idem');
    const { buyer, orderId } = ctx;
    requestAsSeller.mockImplementation(mercadoPago(ctx));

    const primero = await paymentService.startCheckout(buyer, orderId);
    const segundo = await paymentService.startCheckout(buyer, orderId);

    expect(segundo.paymentId).toBe(primero.paymentId);

    const pagos = await getDatabase()
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, orderId));
    expect(pagos).toHaveLength(1);
  });
});

describe('webhook', () => {
  async function conCheckout(nombre: string): Promise<Escenario> {
    const ctx = await escenario(nombre);
    requestAsSeller.mockImplementation(mercadoPago(ctx));
    await paymentService.startCheckout(ctx.buyer, ctx.orderId);
    return ctx;
  }

  it('aprueba el pago y pasa la orden a PAID', async () => {
    const ctx = await conCheckout('wh-ok');
    const { orderId } = ctx;

    const outcome = await webhookService.handleNotification(notificacion(ctx), {});

    expect(outcome).toBe('processed');

    const local = await pago(orderId);
    expect(local?.status).toBe('APPROVED');
    expect(local?.mpPaymentId).toBe(ctx.mpPaymentId);
    expect(local?.mpStatus).toBe('approved');

    const [order] = await getDatabase()
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));
    expect(order?.status).toBe('PAID');
    expect(order?.paidAt).not.toBeNull();
  });

  it('registra el reparto real informado por Mercado Pago', async () => {
    const ctx = await conCheckout('wh-split');
    const { orderId } = ctx;

    await webhookService.handleNotification(notificacion(ctx), {});

    const local = await pago(orderId);
    const [split] = await getDatabase()
      .select()
      .from(schema.paymentSplits)
      .where(eq(schema.paymentSplits.paymentId, local!.id));

    expect(split?.marketplaceFeeAmount).toBe(COMISION);
    // net_received_amount = $89.000 -> el vendedor cobro eso.
    expect(split?.sellerAmount).toBe(8_900_000n);
    // $100.000 - $89.000 - $6.000 = $5.000 de costo de MP.
    expect(split?.mpFeeAmount).toBe(500_000n);
  });

  it('el webhook DUPLICADO no vuelve a aplicar nada', async () => {
    const ctx = await conCheckout('wh-dup');
    const { orderId } = ctx;
    const evento = notificacion(ctx);

    expect(await webhookService.handleNotification(evento, {})).toBe('processed');
    expect(await webhookService.handleNotification(evento, {})).toBe('duplicate');

    const splits = await getDatabase()
      .select()
      .from(schema.paymentSplits)
      .where(eq(schema.paymentSplits.paymentId, (await pago(orderId))!.id));

    expect(splits).toHaveLength(1);
  });

  it('reprocesar el mismo pago con otra notificacion es idempotente', async () => {
    const ctx = await conCheckout('wh-reproceso');
    const { orderId } = ctx;

    await webhookService.handleNotification(notificacion(ctx), {});
    await webhookService.handleNotification(notificacion(ctx, { action: 'payment.created' }), {});

    const [order] = await getDatabase()
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));
    expect(order?.status).toBe('PAID');

    const splits = await getDatabase()
      .select()
      .from(schema.paymentSplits)
      .where(eq(schema.paymentSplits.paymentId, (await pago(orderId))!.id));
    expect(splits).toHaveLength(1);
  });

  it('RECONSULTA el pago a Mercado Pago: no confia en el payload', async () => {
    const ctx = await conCheckout('wh-reconsulta');
    requestAsSeller.mockClear();

    // El payload miente y dice "rejected"; MP responde "approved".
    await webhookService.handleNotification(notificacion(ctx), { status: 'rejected' });

    const consultas = requestAsSeller.mock.calls.filter(([, req]) =>
      (req as { path: string }).path.startsWith('/v1/payments/'),
    );
    expect(consultas.length).toBeGreaterThan(0);
  });

  it('un pago rechazado NO cancela la orden (DEC-033)', async () => {
    const ctx = await conCheckout('wh-rechazado');
    const { orderId } = ctx;
    requestAsSeller.mockImplementation(
      mercadoPago(ctx, { status: 'rejected', status_detail: 'cc_rejected' }),
    );

    await webhookService.handleNotification(notificacion(ctx), {});

    expect((await pago(orderId))?.status).toBe('REJECTED');

    const [order] = await getDatabase()
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));
    expect(order?.status).toBe('PENDING_PAYMENT');
  });

  it('un estado en mediacion no toca el estado local', async () => {
    const ctx = await conCheckout('wh-mediacion');
    const { orderId } = ctx;
    requestAsSeller.mockImplementation(mercadoPago(ctx, { status: 'in_mediation' }));

    await webhookService.handleNotification(notificacion(ctx), {});

    expect((await pago(orderId))?.status).toBe('PENDING');
  });

  it('ignora los topics que no son de pago', async () => {
    const ctx = await conCheckout('wh-otro-topic');
    const outcome = await webhookService.handleNotification(
      notificacion(ctx, { type: 'merchant_order' }),
      {},
    );

    expect(outcome).toBe('ignored');
  });

  it('un pago de una cuenta desconocida no produce efectos', async () => {
    const ctx = await escenario('wh-desconocida');
    const outcome = await webhookService.handleNotification(
      notificacion(ctx, { mpUserId: '999999999999' }),
      {},
    );

    expect(outcome).toBe('unknown_payment');
  });

  it('registra cada evento recibido', async () => {
    const ctx = await conCheckout('wh-registro');
    const evento = notificacion(ctx);

    await webhookService.handleNotification(evento, { prueba: true });

    const [fila] = await getDatabase()
      .select()
      .from(schema.paymentWebhookEvents)
      .where(eq(schema.paymentWebhookEvents.idempotencyKey, webhookService.buildEventKey(evento)));

    expect(fila?.provider).toBe('mercadopago');
    expect(fila?.processed).toBe(true);
    expect(fila?.signatureValid).toBe(true);
  });
});

describe('refunds', () => {
  async function pagoAprobado(nombre: string) {
    const ctx = await escenario(nombre);
    requestAsSeller.mockImplementation(mercadoPago(ctx));
    await paymentService.startCheckout(ctx.buyer, ctx.orderId);
    await webhookService.handleNotification(notificacion(ctx), {});

    const admin = await usuario(`${nombre}-admin`);
    await getDatabase()
      .update(schema.users)
      .set({ adminRole: 'FINANCE' })
      .where(eq(schema.users.id, admin.id));

    return { ...ctx, admin, paymentId: (await pago(ctx.orderId))!.id };
  }

  function refundOk(id = 'refund-mp-1'): void {
    requestAsSeller.mockResolvedValue({
      ok: true,
      status: 201,
      body: { id, status: 'approved' },
    });
  }

  it('reembolso TOTAL: sin amount y el pago queda REFUNDED', async () => {
    const { admin, paymentId } = await pagoAprobado('rf-total');
    refundOk();

    const refund = await refundService.refundPayment(admin, {
      paymentId,
      amountCents: null,
      reason: 'prueba',
    });

    expect(refund.type).toBe('FULL');
    expect(refund.status).toBe('COMPLETED');
    expect(refund.amount).toBe(TOTAL.toString());

    // La ultima llamada es el refund; la primera fue la preferencia.
    const [, request] = requestAsSeller.mock.calls.at(-1) as [string, { body: unknown }];
    expect(request.body).toEqual({});

    const [row] = await getDatabase()
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId));
    expect(row?.status).toBe('REFUNDED');
  });

  it('reembolso PARCIAL: manda el importe y deja PARTIALLY_REFUNDED', async () => {
    const { admin, paymentId } = await pagoAprobado('rf-parcial');
    refundOk('refund-mp-2');

    const refund = await refundService.refundPayment(admin, {
      paymentId,
      amountCents: 2_500_000n,
      reason: null,
    });

    expect(refund.type).toBe('PARTIAL');
    const [, request] = requestAsSeller.mock.calls.at(-1) as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(request.body).toEqual({ amount: 25_000 });

    const [row] = await getDatabase()
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId));
    expect(row?.status).toBe('PARTIALLY_REFUNDED');
  });

  it('varios parciales no pueden superar el total', async () => {
    const { admin, paymentId } = await pagoAprobado('rf-suma');
    refundOk('refund-mp-3');

    await refundService.refundPayment(admin, { paymentId, amountCents: 6_000_000n, reason: null });

    await expect(
      refundService.refundPayment(admin, { paymentId, amountCents: 5_000_000n, reason: null }),
    ).rejects.toMatchObject({ code: 'REFUND_AMOUNT_INVALID' });
  });

  it('no se puede reembolsar dos veces el total', async () => {
    const { admin, paymentId } = await pagoAprobado('rf-doble');
    refundOk('refund-mp-4');

    await refundService.refundPayment(admin, { paymentId, amountCents: null, reason: null });

    await expect(
      refundService.refundPayment(admin, { paymentId, amountCents: null, reason: null }),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_REFUNDABLE' });
  });

  it('rechaza un importe no positivo', async () => {
    const { admin, paymentId } = await pagoAprobado('rf-cero');

    await expect(
      refundService.refundPayment(admin, { paymentId, amountCents: 0n, reason: null }),
    ).rejects.toMatchObject({ code: 'REFUND_AMOUNT_INVALID' });
  });

  it('no reembolsa un pago que nunca se aprobo', async () => {
    const ctx = await escenario('rf-pendiente');
    const { buyer, orderId } = ctx;
    requestAsSeller.mockImplementation(mercadoPago(ctx));
    await paymentService.startCheckout(buyer, orderId);

    const admin = await usuario('rf-pendiente-admin');
    const paymentId = (await pago(orderId))!.id;

    await expect(
      refundService.refundPayment(admin, { paymentId, amountCents: null, reason: null }),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_REFUNDABLE' });
  });

  it('si Mercado Pago rechaza, el refund local queda REJECTED', async () => {
    const { admin, paymentId } = await pagoAprobado('rf-falla');
    requestAsSeller.mockResolvedValue({ ok: false, status: 400, body: { error: 4296 } });

    await expect(
      refundService.refundPayment(admin, { paymentId, amountCents: null, reason: null }),
    ).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_ERROR' });

    const [refund] = await getDatabase()
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.paymentId, paymentId));
    expect(refund?.status).toBe('REJECTED');

    // El pago sigue aprobado: no se devolvio nada.
    const [row] = await getDatabase()
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId));
    expect(row?.status).toBe('APPROVED');
  });

  it('audita el reembolso', async () => {
    const { admin, paymentId } = await pagoAprobado('rf-audit');
    refundOk('refund-mp-5');

    await refundService.refundPayment(admin, { paymentId, amountCents: null, reason: 'motivo' });

    const filas = await getDatabase()
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.actorId, admin.id), eq(schema.auditLog.action, 'REFUND_COMPLETED')),
      );

    expect(filas).toHaveLength(1);
    expect(filas[0]!.actorType).toBe('admin');
  });
});

describe('barrido de credenciales', () => {
  it('ninguna fila de audit_log del flujo contiene un token', async () => {
    const ctx = await escenario('barrido');
    const { buyer, orderId } = ctx;
    requestAsSeller.mockImplementation(mercadoPago(ctx));

    await paymentService.startCheckout(buyer, orderId);
    await webhookService.handleNotification(notificacion(ctx), {});

    const filas = await getDatabase()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorId, buyer.id));

    const volcado = JSON.stringify(filas);
    expect(volcado).not.toContain('valor-que-simula-un-access-token');
    expect(volcado).not.toContain('Bearer');
  });
});
