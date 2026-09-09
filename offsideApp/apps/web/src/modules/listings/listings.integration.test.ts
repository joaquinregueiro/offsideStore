import { randomBytes } from 'node:crypto';

import { getDatabase, schema } from '@offside/database';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as AuthService from '../auth/services/auth.service';
import type { PublicUser } from '../auth/services/auth.service';
import type * as MpConnectionService from '../sellers/services/mercadopago-connection.service';
import type * as SellerService from '../sellers/services/seller.service';
import type Sharp from 'sharp';

import type * as ListingEditingService from './services/listing-editing.service';
import type * as SearchService from './services/search.service';
import type * as ListingImageService from './services/listing-image.service';
import type * as ListingService from './services/listing.service';
import type * as OrderService from '../orders/services/order.service';
import type * as PaymentService from '../payments/services/payment.service';
import type * as WebhookService from '../payments/services/payment-webhook.service';

/**
 * Publicaciones — integracion contra PostgreSQL y Redis REALES.
 * Requiere `docker compose up -d`.
 *
 * Ademas de la publicacion en si, cierra el **flujo completo**: publicar →
 * ordenar → checkout → webhook → orden pagada, sin tocar SQL en el medio.
 *
 * Limpia todo lo que crea: sufijo `@lstitest.offside`.
 */

const requestAsSeller = vi.hoisted(() => vi.fn());

vi.mock('../sellers/services/mercadopago-connection.service', async (importOriginal) => {
  const original = await importOriginal<typeof MpConnectionService>();

  return { ...original, requestAsSeller };
});

const SUFIJO = '@lstitest.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';

/** $50.000 en centavos. */
const PRECIO = '5000000';

let authService: typeof AuthService;
let sellerService: typeof SellerService;
let listingService: typeof ListingService;
let orderService: typeof OrderService;
let paymentService: typeof PaymentService;
let webhookService: typeof WebhookService;
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
  listingService = await import('./services/listing.service');
  orderService = await import('../orders/services/order.service');
  paymentService = await import('../payments/services/payment.service');
  webhookService = await import('../payments/services/payment-webhook.service');

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

  await db
    .delete(schema.categories)
    .where(inArray(schema.categories.slug, ['camisetas-lstitest', 'shorts-lstitest']));
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

/** `camiseta` exige `kitType` y `sleeve` (ERD §9.1); `short` no. */
async function categoria(code: 'camiseta' | 'short' = 'camiseta'): Promise<string> {
  return categoriaPorCodigo(code);
}

/**
 * Vendedor aprobado y con Mercado Pago conectado.
 *
 * ⚠️ La aprobacion y la conexion se escriben DIRECTO EN LA BASE: no existe flujo
 * de aprobacion (TS-001 🟡) y el OAuth tiene sus propios tests.
 */
async function vendedor(
  nombre: string,
  opciones: { conectado?: boolean; aprobado?: boolean } = {},
): Promise<PublicUser> {
  const db = getDatabase();
  secuencia += 1;

  const user = await usuario(`${nombre}-seller`);
  const perfil = await sellerService.createSellerProfile(user, {
    displayName: `Tienda ${nombre}`,
    acceptedSellerTerms: true,
  });

  if (opciones.aprobado !== false) {
    await db
      .update(schema.sellerProfiles)
      .set({ status: 'approved', approvedAt: new Date() })
      .where(eq(schema.sellerProfiles.id, perfil.id));
  }

  if (opciones.conectado !== false) {
    await db.insert(schema.mercadopagoAccounts).values({
      sellerId: perfil.id,
      mpUserId: `3000000${secuencia}`,
      accessTokenEncrypted: encryptToken('valor-que-simula-un-access-token'),
      status: 'connected',
      connectedAt: new Date(),
    });
  }

  return user;
}

/** Cuerpo valido de publicacion de camiseta. */
async function camiseta(overrides: Record<string, unknown> = {}) {
  return {
    categoryId: await categoria('camiseta'),
    title: 'Camiseta Boca 2001 titular',
    description: 'Original de epoca',
    priceAmount: BigInt(PRECIO),
    stock: 3,
    sizeValue: 'L',
    condition: 'EXCELENTE' as const,
    kitType: 'home' as const,
    sleeve: 'short' as const,
    ...overrides,
  };
}

/**
 * Publicacion lista para vender: publicada, con una foto y ACTIVA.
 *
 * ⚠️ LA FOTO NO ES DECORACION. PS-010 exige al menos una imagen, asi que una
 * publicacion sin fotos se queda en BORRADOR y no es comprable. Este helper
 * refleja esa regla en vez de saltearla: inserta la fila de imagen —sin pasar
 * por el procesador, que no aporta nada a estos tests— y despues activa.
 */
async function publicacionActiva(
  seller: PublicUser,
  overrides: Record<string, unknown> = {},
): Promise<Awaited<ReturnType<typeof listingService.publishListing>>> {
  const listing = await listingService.publishListing(seller, await camiseta(overrides));

  await getDatabase()
    .insert(schema.listingImages)
    .values({
      listingId: listing.id,
      storageKey: `listings/${listing.id}/test-large.webp`,
      url: null,
      variants: { large: `listings/${listing.id}/test-large.webp` },
      position: 0,
      hash: 'hash-de-prueba',
    });

  await getDatabase()
    .update(schema.listings)
    .set({ status: 'active' })
    .where(eq(schema.listings.id, listing.id));

  return { ...listing, status: 'active' as const };
}

/* -------------------------------------------------------------------------- */

describe('publicar', () => {
  it('⚠️ nace en BORRADOR: sin fotos no sale a la vitrina (PS-010 / SS-032)', async () => {
    // Antes nacia `active`. PS-010 exige al menos una foto, y una foto no
    // puede existir antes que la publicacion —es una FK—, asi que la
    // publicacion nace en borrador y se activa cuando tiene imagen.
    const seller = await vendedor('ok');

    const listing = await listingService.publishListing(seller, await camiseta());

    expect(listing.status).toBe('draft');
    expect(listing.priceAmount).toBe(PRECIO);
    expect(listing.stock).toBe(3);
    expect(listing.title).toBe('Camiseta Boca 2001 titular');

    // Y no aparece en la vitrina.
    expect(await listingService.findPublicListing(listing.id)).toBeNull();
  });

  it('⚠️ nace APROBADA: aprobacion automatica transitoria', async () => {
    // Decision del owner (2026-09-01). El ERD §9.1 exige `APPROVED` para que
    // algo sea comprable y nada asignaba ese estado: naciendo `PENDING`, la
    // regla del ERD era imposible de cumplir y el codigo la ignoraba.
    //
    // ⚠️ NO ESCALA. Cuando haya vendedores desconocidos hay que decidir la
    // politica de moderacion de verdad (RISK-FR1 es Critico/Alta).
    const seller = await vendedor('moderacion');

    const listing = await listingService.publishListing(seller, await camiseta());

    expect(listing.moderationStatus).toBe('APPROVED');
    // El status es otra dimension: nace en borrador hasta tener foto (PS-010).
    expect(listing.status).toBe('draft');
  });

  it('queda asociada al perfil del vendedor autenticado', async () => {
    const seller = await vendedor('ownership');

    const listing = await listingService.publishListing(seller, await camiseta());

    const [fila] = await getDatabase()
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.id, listing.id));

    const [perfil] = await getDatabase()
      .select()
      .from(schema.sellerProfiles)
      .where(eq(schema.sellerProfiles.userId, seller.id));

    expect(fila?.sellerId).toBe(perfil?.id);
  });

  it('RECHAZA a quien no tiene perfil de vendedor', async () => {
    const cualquiera = await usuario('sin-perfil');

    await expect(listingService.publishListing(cualquiera, await camiseta())).rejects.toMatchObject(
      {
        code: 'FORBIDDEN',
      },
    );
  });

  it('RECHAZA a un vendedor sin Mercado Pago conectado', async () => {
    const seller = await vendedor('sin-mp', { conectado: false });

    await expect(listingService.publishListing(seller, await camiseta())).rejects.toMatchObject({
      code: 'SELLER_NOT_OPERATIONAL',
    });
  });

  it('RECHAZA a un vendedor sin aprobar', async () => {
    const seller = await vendedor('sin-aprobar', { aprobado: false });

    await expect(listingService.publishListing(seller, await camiseta())).rejects.toMatchObject({
      code: 'SELLER_NOT_OPERATIONAL',
    });
  });

  it('rechaza una categoria inexistente', async () => {
    const seller = await vendedor('categoria-mala');

    await expect(
      listingService.publishListing(
        seller,
        await camiseta({ categoryId: '00000000-0000-4000-8000-000000000000' }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('exige kitType y sleeve cuando la categoria es camiseta', async () => {
    // ERD §9.1: obligatorio para camiseta, validado en la app.
    const seller = await vendedor('camiseta-incompleta');

    await expect(
      listingService.publishListing(seller, await camiseta({ kitType: null })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(
      listingService.publishListing(seller, await camiseta({ sleeve: null })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('NO exige kitType ni sleeve en otras categorias', async () => {
    const seller = await vendedor('short');

    const listing = await listingService.publishListing(seller, {
      ...(await camiseta()),
      categoryId: await categoria('short'),
      title: 'Short de entrenamiento',
      kitType: null,
      sleeve: null,
    });

    // Nace en borrador como cualquier publicacion; lo que se prueba aca es que
    // NO se rechazo por faltarle atributos de camiseta.
    expect(listing.status).toBe('draft');
  });

  it('lista las publicaciones propias', async () => {
    const seller = await vendedor('listado');
    await listingService.publishListing(seller, await camiseta());
    await listingService.publishListing(seller, await camiseta({ title: 'Segunda camiseta' }));

    const propias = await listingService.listMyListings(seller);

    expect(propias).toHaveLength(2);
    expect(propias.map((l) => l.title)).toContain('Segunda camiseta');
  });

  it('no lista las publicaciones de otro vendedor', async () => {
    const uno = await vendedor('aislado-uno');
    const otro = await vendedor('aislado-dos');
    await listingService.publishListing(uno, await camiseta());

    expect(await listingService.listMyListings(otro)).toHaveLength(0);
  });
});

describe('flujo completo: publicar → ordenar → cobrar', () => {
  it('cierra el circuito sin tocar SQL en el medio', async () => {
    const seller = await vendedor('flujo');
    const comprador = await usuario('flujo-buyer');

    // 1. El vendedor publica. Nace en BORRADOR: sin fotos no sale a la vitrina.
    const listing = await listingService.publishListing(seller, await camiseta());
    expect(listing.status).toBe('draft');

    // 1.b Sube una foto y la publicacion se activa (PS-010 / SS-032). Se hace
    // con el Service de verdad, no con SQL: el punto de este test es que el
    // circuito cierre sin atajos.
    const imgService = await import('./services/listing-image.service');
    const sharpLib = (await import('sharp')).default;

    await imgService.uploadImage(seller, {
      listingId: listing.id,
      bytes: await sharpLib({
        create: { width: 600, height: 400, channels: 3, background: '#0f7a45' },
      })
        .jpeg()
        .toBuffer(),
    });

    expect(await imgService.activateListing(seller, listing.id)).toBe(true);

    // 2. El comprador ordena.
    const orden = await orderService.createOrder(comprador, {
      listingId: listing.id,
      quantity: 1,
      shippingAddress: { calle: 'Falsa 123' },
    });
    // 6% de $50.000 = $3.000
    expect(orden.commissionAmount).toBe('300000');
    expect(orden.status).toBe('PENDING_PAYMENT');

    // 3. Checkout: la preferencia lleva el 6% como marketplace_fee.
    const mpPaymentId = '777000111';
    requestAsSeller.mockImplementation((_sellerId: string, request: { path: string }) => {
      if (request.path.startsWith('/checkout/preferences')) {
        return Promise.resolve({
          ok: true,
          status: 201,
          body: {
            id: 'pref-flujo',
            init_point: 'https://www.mercadopago.com.ar/checkout?pref_id=pref-flujo',
            collector_id: '300000099',
          },
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        body: {
          id: mpPaymentId,
          status: 'approved',
          status_detail: 'accredited',
          external_reference: orden.id,
          transaction_amount: 50_000,
          currency_id: 'ARS',
          payment_method_id: 'visa',
          installments: 1,
          date_approved: '2026-08-25T12:00:00.000Z',
          transaction_details: { net_received_amount: 44_500 },
        },
      });
    });

    const checkout = await paymentService.startCheckout(comprador, orden.id);
    expect(checkout.initPoint).toContain('mercadopago');
    expect(checkout.marketplaceFeeAmount).toBe('300000');

    const [, preferencia] = requestAsSeller.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(preferencia.body.marketplace_fee).toBe(3_000);

    // 4. Mercado Pago avisa: el webhook resuelve el pago.
    const outcome = await webhookService.handleNotification(
      {
        type: 'payment',
        action: 'payment.updated',
        dataId: mpPaymentId,
        notificationId: `notif-flujo-${Date.now()}`,
        mpUserId: '3000000' + secuencia,
      },
      {},
    );
    expect(outcome).toBe('processed');

    // 5. El pago quedo aprobado y la orden pagada.
    const [pago] = await getDatabase()
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, orden.id));
    expect(pago?.status).toBe('APPROVED');

    const [ordenFinal] = await getDatabase()
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orden.id));
    expect(ordenFinal?.status).toBe('PAID');
    expect(ordenFinal?.paidAt).not.toBeNull();

    // El reparto real quedo registrado para conciliar.
    const [split] = await getDatabase()
      .select()
      .from(schema.paymentSplits)
      .where(eq(schema.paymentSplits.paymentId, pago!.id));
    expect(split?.marketplaceFeeAmount).toBe(300_000n);
  });
});

/* -------------------------------------------------------------------------- */

describe('stock', () => {
  /** Cobra una orden de punta a punta: checkout + webhook aprobado. */
  async function cobrar(
    comprador: PublicUser,
    orden: { id: string },
    mpPaymentId: string,
    mpUserId: string,
    montoPesos: number,
  ): Promise<string> {
    requestAsSeller.mockImplementation((_sellerId: string, request: { path: string }) => {
      if (request.path.startsWith('/checkout/preferences')) {
        return Promise.resolve({
          ok: true,
          status: 201,
          body: { id: `pref-${mpPaymentId}`, init_point: 'https://mp.test/x' },
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        body: {
          id: mpPaymentId,
          status: 'approved',
          status_detail: 'accredited',
          external_reference: orden.id,
          transaction_amount: montoPesos,
          currency_id: 'ARS',
          date_approved: '2026-08-26T12:00:00.000Z',
        },
      });
    });

    await paymentService.startCheckout(comprador, orden.id);

    return webhookService.handleNotification(
      {
        type: 'payment',
        action: 'payment.updated',
        dataId: mpPaymentId,
        notificationId: `notif-${mpPaymentId}-${Date.now()}`,
        mpUserId,
      },
      {},
    );
  }

  async function stockDe(listingId: string): Promise<number> {
    const [row] = await getDatabase()
      .select({ stock: schema.listings.stock })
      .from(schema.listings)
      .where(eq(schema.listings.id, listingId));

    return row!.stock;
  }

  async function repo() {
    return import('./repositories/listing.repository');
  }

  it('se descuenta al APROBARSE el pago, no antes (MF-022)', async () => {
    const seller = await vendedor('stk1');
    const mpUserId = `3000000${secuencia}`;
    const comprador = await usuario('stk1-buyer');
    const listing = await publicacionActiva(seller, { stock: 3 });

    const orden = await orderService.createOrder(comprador, {
      listingId: listing.id,
      quantity: 2,
      shippingAddress: { calle: 'Falsa 123' },
    });

    // Crear la orden NO reserva: el stock sigue intacto (BR-022).
    expect(await stockDe(listing.id)).toBe(3);

    expect(await cobrar(comprador, orden, '900000001', mpUserId, 100_000)).toBe('processed');

    expect(await stockDe(listing.id)).toBe(1);
  });

  it('un webhook repetido NO descuenta dos veces', async () => {
    const seller = await vendedor('stk2');
    const mpUserId = `3000000${secuencia}`;
    const comprador = await usuario('stk2-buyer');
    const listing = await publicacionActiva(seller, { stock: 2 });

    const orden = await orderService.createOrder(comprador, {
      listingId: listing.id,
      quantity: 1,
      shippingAddress: { calle: 'Falsa 123' },
    });

    await cobrar(comprador, orden, '900000002', mpUserId, 50_000);
    expect(await stockDe(listing.id)).toBe(1);

    // Mercado Pago reintenta el mismo pago: la orden ya esta PAID y el
    // descuento no se repite.
    await webhookService.handleNotification(
      {
        type: 'payment',
        action: 'payment.updated',
        dataId: '900000002',
        notificationId: `notif-repetido-${Date.now()}`,
        mpUserId,
      },
      {},
    );

    expect(await stockDe(listing.id)).toBe(1);
  });

  it('⚠️ dos descuentos SIMULTANEOS de la ultima unidad: gana uno solo', async () => {
    // El corazon del anti-overselling. Si la condicion `stock >= cantidad`
    // estuviera en un `if` previo al UPDATE en vez de adentro del WHERE, los
    // dos lados leerian stock=1 y los dos escribirian stock=0.
    const seller = await vendedor('stk3');
    const listing = await publicacionActiva(seller, { stock: 1 });
    const listingRepo = await repo();

    const [a, b] = await Promise.all([
      listingRepo.decrementStock(listing.id, 1),
      listingRepo.decrementStock(listing.id, 1),
    ]);

    const ganadores = [a, b].filter((r) => r !== undefined);
    expect(ganadores).toHaveLength(1);
    expect(ganadores[0]).toBe(0);
    expect(await stockDe(listing.id)).toBe(0);
  });

  it('nunca deja el stock en negativo', async () => {
    const seller = await vendedor('stk4');
    const listing = await publicacionActiva(seller, { stock: 1 });
    const listingRepo = await repo();

    expect(await listingRepo.decrementStock(listing.id, 5)).toBeUndefined();
    expect(await stockDe(listing.id)).toBe(1);
  });

  it('el checkout NO cobra si la publicacion se quedo sin stock (UC-MF-3)', async () => {
    const seller = await vendedor('stk5');
    const comprador = await usuario('stk5-buyer');
    const listing = await publicacionActiva(seller, { stock: 1 });

    const orden = await orderService.createOrder(comprador, {
      listingId: listing.id,
      quantity: 1,
      shippingAddress: { calle: 'Falsa 123' },
    });

    // Otro comprador se lleva la ultima unidad entre la orden y el pago.
    const listingRepo = await repo();
    await listingRepo.decrementStock(listing.id, 1);

    await expect(paymentService.startCheckout(comprador, orden.id)).rejects.toMatchObject({
      code: 'LISTING_OUT_OF_STOCK',
    });

    // Y NO se llamo a Mercado Pago: no se cobra lo que no se puede entregar.
    expect(requestAsSeller).not.toHaveBeenCalled();
  });

  it('un pago aprobado sin stock queda AUDITADO, no silenciado', async () => {
    // Caso residual: el checkout revalido, pero entre esa lectura y la
    // aprobacion alguien se llevo la unidad. El dinero ya se cobro, y que hacer
    // con eso es una decision de negocio que todavia no esta tomada.
    const seller = await vendedor('stk6');
    const mpUserId = `3000000${secuencia}`;
    const comprador = await usuario('stk6-buyer');
    const listing = await publicacionActiva(seller, { stock: 1 });

    const orden = await orderService.createOrder(comprador, {
      listingId: listing.id,
      quantity: 1,
      shippingAddress: { calle: 'Falsa 123' },
    });

    requestAsSeller.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 201,
        body: { id: 'pref-stk6', init_point: 'https://mp.test/x' },
      }),
    );
    await paymentService.startCheckout(comprador, orden.id);

    // La unidad se va DESPUES de que el checkout revalido y creo la preferencia.
    const listingRepo = await repo();
    await listingRepo.decrementStock(listing.id, 1);

    // Se va directo al webhook: el checkout ya ocurrio y ahora rechazaria.
    requestAsSeller.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: {
          id: '900000006',
          status: 'approved',
          status_detail: 'accredited',
          external_reference: orden.id,
          transaction_amount: 50_000,
          currency_id: 'ARS',
          date_approved: '2026-08-26T12:00:00.000Z',
        },
      }),
    );

    const outcome = await webhookService.handleNotification(
      {
        type: 'payment',
        action: 'payment.updated',
        dataId: '900000006',
        notificationId: `notif-stk6-${Date.now()}`,
        mpUserId,
      },
      {},
    );
    expect(outcome).toBe('processed');

    // La orden se paga igual —el dinero entro— pero queda el rastro.
    const [ordenFinal] = await getDatabase()
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orden.id));
    expect(ordenFinal?.status).toBe('PAID');

    const eventos = await getDatabase()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, orden.id));

    expect(eventos.map((e) => e.action)).toContain('ORDER_PAID_WITHOUT_STOCK');
  });
});

/* -------------------------------------------------------------------------- */

describe('catalogo publico', () => {
  it('lista lo publicado, sin exigir sesion', async () => {
    const seller = await vendedor('cat-visible');
    const publicada = await publicacionActiva(seller);

    const catalogo = await listingService.listPublicCatalog();
    const mia = catalogo.find((l) => l.id === publicada.id);

    expect(mia).toBeDefined();
    expect(mia!.title).toBe(publicada.title);
    expect(mia!.priceAmount).toBe(PRECIO);
    expect(mia!.sellerDisplayName).toBe('Tienda cat-visible');
  });

  it('⚠️ NO expone datos del vendedor mas que su nombre de tienda', async () => {
    const seller = await vendedor('cat-privacidad');
    await listingService.publishListing(seller, await camiseta());

    const catalogo = await listingService.listPublicCatalog();
    const serializado = JSON.stringify(catalogo);

    // Ni el email del usuario ni ningun identificador interno del vendedor.
    expect(serializado).not.toContain(seller.email);
    expect(serializado).not.toContain(seller.id);
  });

  it('⚠️ excluye lo que NO se puede comprar (ERD §9.1)', async () => {
    // Lo que se ve tiene que ser comprable: mostrar algo agotado o sin aprobar
    // lleva a un checkout que falla.
    const seller = await vendedor('cat-filtros');
    const db = getDatabase();

    const agotada = await publicacionActiva(seller, { stock: 1 });
    const pausada = await listingService.publishListing(seller, await camiseta());
    const sinAprobar = await listingService.publishListing(seller, await camiseta());

    await db.update(schema.listings).set({ stock: 0 }).where(eq(schema.listings.id, agotada.id));
    await db
      .update(schema.listings)
      .set({ status: 'paused' })
      .where(eq(schema.listings.id, pausada.id));
    await db
      .update(schema.listings)
      .set({ moderationStatus: 'PENDING' })
      .where(eq(schema.listings.id, sinAprobar.id));

    const ids = (await listingService.listPublicCatalog()).map((l) => l.id);

    expect(ids).not.toContain(agotada.id);
    expect(ids).not.toContain(pausada.id);
    expect(ids).not.toContain(sinAprobar.id);
  });

  it('el filtro del catalogo coincide con isPurchasable', async () => {
    // Son la misma regla expresada en dos lugares —SQL y memoria— y tienen que
    // dar lo mismo: si se separan, la vitrina promete lo que la compra rechaza.
    const seller = await vendedor('cat-coherencia');
    const publicada = await publicacionActiva(seller);

    const fila = await listingService.findById(publicada.id);

    expect(listingService.isPurchasable(fila!)).toBe(true);
    expect((await listingService.listPublicCatalog()).map((l) => l.id)).toContain(publicada.id);
  });
  /**
   * SS-013 / UC-SS-4 — "pausa la venta hasta reconectar".
   *
   * ⚠️ EL AGUJERO QUE CIERRA: antes la vitrina mostraba publicaciones de
   * vendedores que habian desconectado Mercado Pago. `POST /api/orders` las
   * rechazaba con `409 SELLER_NOT_OPERATIONAL` —SS-013 se cumplia del lado de
   * la compra—, pero el comprador se enteraba recien despues de entrar,
   * completar la direccion y apretar comprar.
   */
  describe('el vendedor tiene que poder operar (SS-013)', () => {
    /** Desconecta Mercado Pago SIN tocar la publicacion. */
    async function desconectar(sellerId: string) {
      await getDatabase()
        .update(schema.mercadopagoAccounts)
        .set({ status: 'disconnected' })
        .where(eq(schema.mercadopagoAccounts.sellerId, sellerId));
    }

    async function perfilDe(user: PublicUser) {
      const [perfil] = await getDatabase()
        .select({ id: schema.sellerProfiles.id })
        .from(schema.sellerProfiles)
        .where(eq(schema.sellerProfiles.userId, user.id));

      return perfil!.id;
    }

    it('desconectar Mercado Pago saca la publicacion de la vitrina', async () => {
      const seller = await vendedor('ss013-vitrina');
      const publicada = await publicacionActiva(seller);

      expect((await listingService.listPublicCatalog()).map((l) => l.id)).toContain(publicada.id);

      await desconectar(await perfilDe(seller));

      expect((await listingService.listPublicCatalog()).map((l) => l.id)).not.toContain(
        publicada.id,
      );
    });

    it('⚠️ tambien saca la FICHA, no solo el listado', async () => {
      // El enlace de una publicacion se comparte por WhatsApp y sobrevive al
      // catalogo. Si la ficha siguiera respondiendo, esos enlaces llevarian a
      // una compra imposible mucho despues de la desconexion.
      const seller = await vendedor('ss013-ficha');
      const publicada = await publicacionActiva(seller);

      expect(await listingService.findPublicListing(publicada.id)).not.toBeNull();

      await desconectar(await perfilDe(seller));

      expect(await listingService.findPublicListing(publicada.id)).toBeNull();
    });

    it('⚠️ NO cambia el estado de la publicacion: sigue `active`', async () => {
      // ES LA DECISION DE DISEÑO MAS IMPORTANTE DE SS-013. "Pausa la venta" se
      // implementa como un PREDICADO DERIVADO, no pisando `listings.status`.
      // Si se materializara, al reconectar seria imposible distinguir las que
      // el vendedor habia pausado a mano de las que apago la desconexion, y se
      // reactivarian publicaciones que su dueño queria abajo.
      const seller = await vendedor('ss013-estado');
      const publicada = await publicacionActiva(seller);

      await desconectar(await perfilDe(seller));

      const fila = await listingService.findById(publicada.id);

      expect(fila?.status).toBe('active');
    });

    it('reconectar la devuelve sola, sin republicar nada', async () => {
      const seller = await vendedor('ss013-reconecta');
      const publicada = await publicacionActiva(seller);
      const sellerId = await perfilDe(seller);

      await desconectar(sellerId);
      expect((await listingService.listPublicCatalog()).map((l) => l.id)).not.toContain(
        publicada.id,
      );

      await getDatabase()
        .update(schema.mercadopagoAccounts)
        .set({ status: 'connected' })
        .where(eq(schema.mercadopagoAccounts.sellerId, sellerId));

      expect((await listingService.listPublicCatalog()).map((l) => l.id)).toContain(publicada.id);
    });

    it('⚠️ el vendedor SIGUE viendo sus publicaciones', async () => {
      // Esconderselas a el tambien seria hacerle creer que las perdio, y la
      // reaccion natural —borrarlas y republicar— destruye su historial.
      const seller = await vendedor('ss013-panel');
      const publicada = await publicacionActiva(seller);

      await desconectar(await perfilDe(seller));

      expect((await listingService.listMyListings(seller)).map((l) => l.id)).toContain(
        publicada.id,
      );
    });

    it('un vendedor SUSPENDIDO tampoco aparece, aunque tenga MP conectado', async () => {
      // `canSell` son DOS condiciones, no una: `approved` Y `connected`.
      const seller = await vendedor('ss013-suspendido');
      const publicada = await publicacionActiva(seller);

      await getDatabase()
        .update(schema.sellerProfiles)
        .set({ status: 'suspended' })
        .where(eq(schema.sellerProfiles.id, await perfilDe(seller)));

      expect((await listingService.listPublicCatalog()).map((l) => l.id)).not.toContain(
        publicada.id,
      );
    });
  });
});

describe('fotos de la publicacion (PS-010 / ERD §9.2)', () => {
  let imageService: typeof ListingImageService;
  let sharp: typeof Sharp;

  beforeAll(async () => {
    imageService = await import('./services/listing-image.service');
    sharp = (await import('sharp')).default;
  });

  /** Foto valida generada al vuelo: no se versionan binarios en el repo. */
  async function foto(ancho = 900, alto = 600): Promise<Buffer> {
    return sharp({
      create: { width: ancho, height: alto, channels: 3, background: '#0f7a45' },
    })
      .jpeg()
      .toBuffer();
  }

  it('sube una foto y guarda las tres variantes', async () => {
    const seller = await vendedor('fotos');
    const listing = await listingService.publishListing(seller, await camiseta());

    const imagen = await imageService.uploadImage(seller, {
      listingId: listing.id,
      bytes: await foto(),
      alt: 'Frente de la camiseta',
    });

    expect(imagen.position).toBe(0);
    expect(imagen.alt).toBe('Frente de la camiseta');
    expect(Object.keys(imagen.variants).sort()).toEqual(['large', 'medium', 'thumb']);
    expect(imagen.url).not.toBe('');

    const listado = await imageService.listImages(listing.id);
    expect(listado).toHaveLength(1);
  });

  it('⚠️ guarda CLAVES, no URLs: cambiar el dominio reapunta TODAS las fotos', async () => {
    // Es el punto del diseno. Si se guardara la URL completa, cambiar el
    // dominio publico dejaria las fotos ya subidas apuntando al lugar viejo y
    // habria que migrar filas.
    const { getDatabase: db2, schema: sch } = await import('@offside/database');
    const seller = await vendedor('fotos-claves');
    const listing = await listingService.publishListing(seller, await camiseta());

    const imagen = await imageService.uploadImage(seller, {
      listingId: listing.id,
      bytes: await foto(),
    });

    const [fila] = await db2()
      .select()
      .from(sch.listingImages)
      .where(eq(sch.listingImages.id, imagen.id));

    const guardadas = fila!.variants as Record<string, string>;

    // Lo persistido es una clave, no una direccion.
    expect(guardadas.large).toMatch(/^listings\//);
    expect(guardadas.large).not.toMatch(/^https?:/);
    // Y `url` queda NULL: congelarla seria el mismo problema.
    expect(fila!.url).toBeNull();

    // Lo que se DEVUELVE si es una direccion completa.
    const devuelta = imagen.variants.large!;
    expect(devuelta).toMatch(/^https?:\/\//);
    expect(devuelta.endsWith(guardadas.large!)).toBe(true);
  });

  it('las posiciones se asignan en orden', async () => {
    const seller = await vendedor('fotos-orden');
    const listing = await listingService.publishListing(seller, await camiseta());

    const primera = await imageService.uploadImage(seller, {
      listingId: listing.id,
      bytes: await foto(800, 600),
    });
    const segunda = await imageService.uploadImage(seller, {
      listingId: listing.id,
      bytes: await foto(801, 600),
    });

    expect(primera.position).toBe(0);
    expect(segunda.position).toBe(1);
  });

  it('⚠️ NO se pueden subir fotos a la publicacion de OTRO vendedor', async () => {
    // La autorizacion resuelve el perfil por `user.id` y lo compara contra
    // `listings.seller_id`. El error es el mismo que "no existe": distinguirlos
    // permitiria averiguar que publicaciones hay.
    const dueno = await vendedor('fotos-dueno');
    const ajeno = await vendedor('fotos-ajeno');
    const listing = await listingService.publishListing(dueno, await camiseta());

    await expect(
      imageService.uploadImage(ajeno, { listingId: listing.id, bytes: await foto() }),
    ).rejects.toMatchObject({ code: 'LISTING_NOT_FOUND' });
  });

  it('⚠️ rechaza un archivo que no es una imagen', async () => {
    const seller = await vendedor('fotos-basura');
    const listing = await listingService.publishListing(seller, await camiseta());

    await expect(
      imageService.uploadImage(seller, {
        listingId: listing.id,
        bytes: Buffer.from('esto no es una imagen', 'utf8'),
      }),
    ).rejects.toMatchObject({ code: 'IMAGE_INVALID' });
  });

  it('respeta el maximo de fotos del Config Store', async () => {
    const db = getDatabase();
    const seller = await vendedor('fotos-cupo');
    const listing = await listingService.publishListing(seller, await camiseta());

    // Se baja el cupo a 1 con una version nueva del setting, que es como se
    // cambia de verdad desde Admin.
    await db.insert(schema.appSettings).values({
      scope: 'global',
      scopeId: null,
      key: 'listing_max_images',
      value: 1,
      valueType: 'number',
      version: 999,
    });

    try {
      await imageService.uploadImage(seller, { listingId: listing.id, bytes: await foto() });

      await expect(
        imageService.uploadImage(seller, { listingId: listing.id, bytes: await foto(901, 600) }),
      ).rejects.toMatchObject({ code: 'TOO_MANY_IMAGES' });
    } finally {
      await db.delete(schema.appSettings).where(eq(schema.appSettings.version, 999));
    }
  });

  it('borra una foto y la saca del listado', async () => {
    const seller = await vendedor('fotos-borrar');
    const listing = await listingService.publishListing(seller, await camiseta());

    const imagen = await imageService.uploadImage(seller, {
      listingId: listing.id,
      bytes: await foto(),
    });

    await imageService.deleteImage(seller, listing.id, imagen.id);

    expect(await imageService.listImages(listing.id)).toHaveLength(0);
  });

  it('borrar la publicacion se lleva sus fotos (FK CASCADE)', async () => {
    const db = getDatabase();
    const seller = await vendedor('fotos-cascade');
    const listing = await listingService.publishListing(seller, await camiseta());

    await imageService.uploadImage(seller, { listingId: listing.id, bytes: await foto() });

    await db.delete(schema.listings).where(eq(schema.listings.id, listing.id));

    expect(await imageService.listImages(listing.id)).toHaveLength(0);
  });
});

describe('editar y ciclo de vida (SS-040 / SS-050 / SS-051)', () => {
  let editService: typeof ListingEditingService;

  beforeAll(async () => {
    editService = await import('./services/listing-editing.service');
  });

  it('⚠️ un cambio de precio queda en listing_price_history (BR-015 / ERD §9.3)', async () => {
    const seller = await vendedor('editar-precio');
    const listing = await publicacionActiva(seller);

    await editService.editListing(seller, listing.id, { priceAmount: 7_000_000n });

    const historia = await getDatabase()
      .select()
      .from(schema.listingPriceHistory)
      .where(eq(schema.listingPriceHistory.listingId, listing.id));

    expect(historia).toHaveLength(1);
    expect(historia[0]!.oldPriceAmount).toBe(BigInt(PRECIO));
    expect(historia[0]!.newPriceAmount).toBe(7_000_000n);
    expect(historia[0]!.changedBy).toBe(seller.id);
  });

  it('editar el titulo NO ensucia el historial de precios', async () => {
    // BR-015 pide auditar lo SENSIBLE. Registrar cada correccion de un typo
    // llenaria las tablas de ruido y esconderia lo que importa.
    const seller = await vendedor('editar-titulo');
    const listing = await publicacionActiva(seller);

    await editService.editListing(seller, listing.id, { title: 'Otro titulo' });

    const historia = await getDatabase()
      .select()
      .from(schema.listingPriceHistory)
      .where(eq(schema.listingPriceHistory.listingId, listing.id));

    expect(historia).toHaveLength(0);
  });

  it('⚠️ cambiar el precio NO afecta a una orden ya creada (BR-023 / SS-041)', async () => {
    // La orden congelo su importe al crearse (DEC-030) y nunca vuelve a leer el
    // precio de la publicacion. Es por construccion, pero vale fijarlo: es
    // plata de alguien.
    const seller = await vendedor('editar-orden');
    const comprador = await usuario('editar-orden-buyer');
    const listing = await publicacionActiva(seller);

    const orden = await orderService.createOrder(comprador, {
      listingId: listing.id,
      quantity: 1,
      shippingAddress: { calle: 'Falsa 123' },
    });

    await editService.editListing(seller, listing.id, { priceAmount: 1n });

    const despues = await orderService.findById(orden.id);
    expect(despues!.totalAmount).toBe(BigInt(PRECIO));
  });

  it('⚠️ NO se puede editar la publicacion de otro vendedor', async () => {
    const dueno = await vendedor('editar-dueno');
    const ajeno = await vendedor('editar-ajeno');
    const listing = await publicacionActiva(dueno);

    await expect(
      editService.editListing(ajeno, listing.id, { title: 'Secuestrada' }),
    ).rejects.toMatchObject({ code: 'LISTING_NOT_FOUND' });
  });

  it('pausar la saca de la vitrina; reactivar la devuelve', async () => {
    const seller = await vendedor('pausar');
    const listing = await publicacionActiva(seller);

    await editService.pauseListing(seller, listing.id);

    expect(await listingService.findPublicListing(listing.id)).toBeNull();

    await editService.resumeListing(seller, listing.id);

    expect(await listingService.findPublicListing(listing.id)).not.toBeNull();
  });

  it('⚠️ reactivar SIN fotos se rechaza (PS-010 por la puerta de atras)', async () => {
    const seller = await vendedor('pausar-sin-fotos');
    const listing = await publicacionActiva(seller);

    await editService.pauseListing(seller, listing.id);

    // Se borran las fotos con la publicacion pausada, que es cuando el guard de
    // "ultima foto de una activa" no aplica.
    await getDatabase()
      .delete(schema.listingImages)
      .where(eq(schema.listingImages.listingId, listing.id));

    await expect(editService.resumeListing(seller, listing.id)).rejects.toMatchObject({
      code: 'IMAGE_REQUIRED',
    });
  });

  it('eliminar es LOGICO y terminal: no rompe el historial ni se puede editar', async () => {
    const seller = await vendedor('eliminar');
    const listing = await publicacionActiva(seller);

    await editService.deleteListing(seller, listing.id);

    // La fila sigue existiendo: `order_items` la referencia.
    const fila = await listingService.findById(listing.id);
    expect(fila!.status).toBe('deleted');

    // Y ya no se opera sobre ella.
    await expect(
      editService.editListing(seller, listing.id, { title: 'Revivida' }),
    ).rejects.toMatchObject({ code: 'LISTING_DELETED' });
  });

  it('⚠️ SS-051: vender la ultima unidad la marca AGOTADA sola', async () => {
    const seller = await vendedor('agotada');
    const comprador = await usuario('agotada-buyer');
    const listing = await publicacionActiva(seller, { stock: 1 });

    const orden = await orderService.createOrder(comprador, {
      listingId: listing.id,
      quantity: 1,
      shippingAddress: { calle: 'Falsa 123' },
    });

    await orderService.decrementStockForOrder(orden.id);

    const fila = await listingService.findById(listing.id);
    expect(fila!.stock).toBe(0);
    expect(fila!.status).toBe('sold_out');
  });
});

describe('busqueda (PS-020 / PS-020.b / PS-022, DEC-042)', () => {
  let searchService: typeof SearchService;

  beforeAll(async () => {
    searchService = await import('./services/search.service');
  });

  /** Publicacion activa, con foto e indexada, con el titulo que se pida. */
  async function publicada(seller: PublicUser, title: string, overrides = {}) {
    const listing = await publicacionActiva(seller, { title, ...overrides });
    // `publicacionActiva` activa por SQL, asi que el indice se refresca aparte.
    await searchService.reindex(listing.id);

    return listing;
  }

  it('⚠️ "river 96 adidas" encuentra "River Plate 1996 Adidas" (PS-020.b)', async () => {
    // ES EL EJEMPLO OBLIGATORIO de la documentacion. Sin catalogos cargados, lo
    // resuelve el full-text sobre el TITULO, que es texto libre que escribe el
    // vendedor.
    const seller = await vendedor('busca-river');
    const buscada = await publicada(seller, 'River Plate 1996 Adidas');
    await publicada(seller, 'Boca Juniors 2001 Nike');

    const { resultados } = await searchService.searchListings({ texto: 'river 96 adidas' });
    const ids = resultados.map((r) => r.id);

    expect(ids).toContain(buscada.id);
  });

  it('⚠️ ignora acentos en los dos sentidos (DEC-042: unaccent)', async () => {
    const seller = await vendedor('busca-acentos');
    const buscada = await publicada(seller, 'Camiseta de Peñarol 1982');

    const sinAcento = await searchService.searchListings({ texto: 'penarol' });
    expect(sinAcento.resultados.map((r) => r.id)).toContain(buscada.id);

    const conAcento = await searchService.searchListings({ texto: 'peñarol' });
    expect(conAcento.resultados.map((r) => r.id)).toContain(buscada.id);
  });

  it('⚠️ tolera un error de tipeo (PS-020.b: pg_trgm)', async () => {
    // El full-text solo no alcanza: "indepediente" no comparte lexema con
    // "Independiente". Lo encuentra el indice de trigramas.
    const seller = await vendedor('busca-typo');
    const buscada = await publicada(seller, 'Independiente 1984');

    const { resultados } = await searchService.searchListings({ texto: 'indepediente' });

    expect(resultados.map((r) => r.id)).toContain(buscada.id);
  });

  it('⚠️ NO devuelve lo que no se puede comprar', async () => {
    // La busqueda usa el MISMO filtro que la vitrina (ERD §9.1). Si mostrara una
    // pausada o sin stock, prometeria lo que la compra rechaza.
    const seller = await vendedor('busca-invisible');
    const activa = await publicada(seller, 'Talleres 1977 visible');
    const pausada = await publicada(seller, 'Talleres 1977 pausada');

    const edit = await import('./services/listing-editing.service');
    await edit.pauseListing(seller, pausada.id);

    const { resultados } = await searchService.searchListings({ texto: 'Talleres 1977' });
    const ids = resultados.map((r) => r.id);

    expect(ids).toContain(activa.id);
    expect(ids).not.toContain(pausada.id);
  });

  it('las facetas traen conteos y filtran combinadas (PS-022 / PS-020)', async () => {
    const seller = await vendedor('busca-facetas');
    await publicada(seller, 'Facetas uno', { sizeValue: 'M' });
    await publicada(seller, 'Facetas dos', { sizeValue: 'M' });
    await publicada(seller, 'Facetas tres', { sizeValue: 'XL' });

    const todo = await searchService.searchListings({ texto: 'Facetas' });
    const talles = new Map(todo.facetas.talle.map((f) => [f.valor, f.cantidad]));

    expect(talles.get('M')).toBe(2);
    expect(talles.get('XL')).toBe(1);

    const soloM = await searchService.searchListings({ texto: 'Facetas', sizeValue: 'M' });
    expect(soloM.total).toBe(2);
  });

  it('⚠️ la faceta activa NO se filtra a si misma', async () => {
    // Si al elegir "talle M" contaramos los talles CON ese filtro puesto, la
    // unica opcion visible seria M y no se podria cambiar de idea.
    const seller = await vendedor('busca-faceta-propia');
    await publicada(seller, 'Autofiltro uno', { sizeValue: 'M' });
    await publicada(seller, 'Autofiltro dos', { sizeValue: 'XL' });

    const conFiltro = await searchService.searchListings({ texto: 'Autofiltro', sizeValue: 'M' });

    // Los resultados son solo los M...
    expect(conFiltro.total).toBe(1);
    // ...pero la faceta sigue ofreciendo XL para poder cambiar.
    expect(conFiltro.facetas.talle.map((f) => f.valor).sort()).toEqual(['M', 'XL']);
  });

  it('editar el titulo actualiza el indice', async () => {
    const seller = await vendedor('busca-reindex');
    const listing = await publicada(seller, 'Titulo viejo Gimnasia');

    const edit = await import('./services/listing-editing.service');
    await edit.editListing(seller, listing.id, { title: 'Titulo nuevo Estudiantes' });

    const viejo = await searchService.searchListings({ texto: 'Gimnasia' });
    expect(viejo.resultados.map((r) => r.id)).not.toContain(listing.id);

    const nuevo = await searchService.searchListings({ texto: 'Estudiantes' });
    expect(nuevo.resultados.map((r) => r.id)).toContain(listing.id);
  });
});

describe('catalogos y alias (PS-023 / PS-024, DEC-041)', () => {
  let searchService: typeof SearchService;

  beforeAll(async () => {
    searchService = await import('./services/search.service');
  });

  async function idDe(tabla: 'clubs' | 'brands' | 'seasons', slug: string): Promise<string> {
    const nombre = { clubs: schema.clubs, brands: schema.brands, seasons: schema.seasons }[tabla];
    const [fila] = await getDatabase()
      .select({ id: nombre.id })
      .from(nombre)
      .where(eq(nombre.slug, slug))
      .limit(1);

    if (!fila)
      throw new Error(
        `Falta "${slug}" en ${tabla}. Corre las migraciones: la 0007 siembra los catalogos.`,
      );

    return fila.id;
  }

  it('la migracion sembro los seis catalogos', async () => {
    const db = getDatabase();

    expect((await db.select().from(schema.clubs)).length).toBeGreaterThan(20);
    expect((await db.select().from(schema.brands)).length).toBeGreaterThan(10);
    expect((await db.select().from(schema.seasons)).length).toBeGreaterThan(100);
  });

  it('⚠️ "CARP" encuentra River Plate aunque el titulo no lo diga (PS-024)', async () => {
    // ES EL EJEMPLO DE LA DOCUMENTACION: "River = River Plate = CARP, resueltos
    // al construir el indice". El titulo dice "Camiseta retro 1996" y nada mas:
    // lo unico que conecta la busqueda con la publicacion es el ALIAS del club,
    // que el Service mete en `search_vector`.
    const seller = await vendedor('alias-carp');
    const listing = await listingService.publishListing(seller, {
      ...(await camiseta()),
      title: 'Camiseta retro 1996',
      clubId: await idDe('clubs', 'river-plate'),
    });

    await getDatabase()
      .insert(schema.listingImages)
      .values({
        listingId: listing.id,
        storageKey: `listings/${listing.id}/x.webp`,
        url: null,
        variants: { large: `listings/${listing.id}/x.webp` },
        position: 0,
        hash: 'h',
      });
    await getDatabase()
      .update(schema.listings)
      .set({ status: 'active' })
      .where(eq(schema.listings.id, listing.id));
    await searchService.reindex(listing.id);

    for (const consulta of ['CARP', 'River', 'Millonario']) {
      const { resultados } = await searchService.searchListings({ texto: consulta });
      expect(
        resultados.map((r) => r.id),
        `busqueda: ${consulta}`,
      ).toContain(listing.id);
    }
  });

  it('las facetas de catalogo cuentan y filtran (PS-023)', async () => {
    const seller = await vendedor('facetas-catalogo');
    const boca = await idDe('clubs', 'boca-juniors');
    const adidas = await idDe('brands', 'adidas');

    for (const [titulo, clubId] of [
      ['Faceta catalogo A', boca],
      ['Faceta catalogo B', boca],
    ] as const) {
      const l = await listingService.publishListing(seller, {
        ...(await camiseta()),
        title: titulo,
        clubId,
        brandId: adidas,
      });

      await getDatabase()
        .insert(schema.listingImages)
        .values({
          listingId: l.id,
          storageKey: `listings/${l.id}/x.webp`,
          url: null,
          variants: { large: `listings/${l.id}/x.webp` },
          position: 0,
          hash: 'h',
        });
      await getDatabase()
        .update(schema.listings)
        .set({ status: 'active' })
        .where(eq(schema.listings.id, l.id));
      await searchService.reindex(l.id);
    }

    const { facetas } = await searchService.searchListings({ texto: 'Faceta catalogo' });
    const clubes = new Map(facetas.club.map((f) => [f.valor, f]));

    expect(clubes.get(boca)?.cantidad).toBe(2);
    // La etiqueta es el NOMBRE, no el uuid: es lo que ve la persona.
    expect(clubes.get(boca)?.etiqueta).toBe('Boca Juniors');

    const filtrado = await searchService.searchListings({ clubId: boca });
    expect(filtrado.total).toBeGreaterThanOrEqual(2);
  });

  it('⚠️ la busqueda tampoco muestra a un vendedor desconectado (SS-013)', async () => {
    // La busqueda usa EL MISMO filtro de visibilidad que la vitrina. Si se
    // quedara afuera de SS-013, seria la puerta de atras: la camiseta no
    // aparece en el catalogo pero si buscandola por nombre.
    const seller = await vendedor('ss013-busqueda');
    const listing = await publicacionActiva(seller, {
      title: 'Camiseta Sarmiento desconectada 1994',
    });
    await searchService.reindex(listing.id);

    const antes = await searchService.searchListings({ texto: 'Sarmiento desconectada' });
    expect(antes.resultados.map((r) => r.id)).toContain(listing.id);

    const [perfil] = await getDatabase()
      .select({ id: schema.sellerProfiles.id })
      .from(schema.sellerProfiles)
      .where(eq(schema.sellerProfiles.userId, seller.id));

    await getDatabase()
      .update(schema.mercadopagoAccounts)
      .set({ status: 'disconnected' })
      .where(eq(schema.mercadopagoAccounts.sellerId, perfil!.id));

    const despues = await searchService.searchListings({ texto: 'Sarmiento desconectada' });

    expect(despues.resultados.map((r) => r.id)).not.toContain(listing.id);
    // ⚠️ Y EL TOTAL TAMBIEN. Un contador que dice "1 publicacion" sobre una
    // lista vacia es peor que no mostrarlo.
    expect(despues.total).toBe(0);
    // ⚠️ Y LAS FACETAS. Si contaran lo invisible, el filtro ofreceria "Talle L
    // (1)" y al tocarlo no habria nada: un filtro que miente sobre lo que hay.
    expect(despues.facetas.talle).toHaveLength(0);
  });
});
