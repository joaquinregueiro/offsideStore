import { randomBytes } from 'node:crypto';

import { getDatabase, schema } from '@offside/database';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as AuthService from '../auth/services/auth.service';
import type { PublicUser } from '../auth/services/auth.service';
import type * as MpConnectionService from '../sellers/services/mercadopago-connection.service';
import type * as SellerService from '../sellers/services/seller.service';
import type * as OrderService from './services/order.service';
import type * as PaymentService from '../payments/services/payment.service';

/**
 * Ordenes — integracion contra PostgreSQL y Redis REALES.
 * Requiere `docker compose up -d`.
 *
 * Cubre la creacion de la orden y su continuidad con el checkout: que el
 * snapshot del 6% que calcula `orders` sea exactamente el `marketplace_fee` que
 * `payments` le manda a Mercado Pago.
 *
 * Limpia todo lo que crea: sufijo `@orditest.offside`.
 */

const requestAsSeller = vi.hoisted(() => vi.fn());

vi.mock('../sellers/services/mercadopago-connection.service', async (importOriginal) => {
  const original = await importOriginal<typeof MpConnectionService>();

  return { ...original, requestAsSeller };
});

const SUFIJO = '@orditest.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';

/** $50.000 en centavos. */
const PRECIO = 5_000_000n;
const DIRECCION = { calle: 'Falsa 123', ciudad: 'CABA' };

let authService: typeof AuthService;
let sellerService: typeof SellerService;
let orderService: typeof OrderService;
let paymentService: typeof PaymentService;
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
  orderService = await import('./services/order.service');
  paymentService = await import('../payments/services/payment.service');

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

  await db.delete(schema.categories).where(eq(schema.categories.slug, 'camisetas-orditest'));
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

async function categoria(): Promise<string> {
  return categoriaPorCodigo('camiseta');
}

interface Vendedor {
  user: PublicUser;
  sellerId: string;
  listingId: string;
}

/**
 * Vendedor con publicacion activa.
 *
 * ⚠️ La aprobacion y la conexion con Mercado Pago se escriben DIRECTO EN LA
 * BASE: no existe flujo de aprobacion (TS-001 🟡) y el OAuth tiene sus propios
 * tests. El listing tambien, porque `modules/listings` todavia no permite
 * publicar.
 */
async function vendedorConPublicacion(
  nombre: string,
  opciones: {
    conectado?: boolean;
    aprobado?: boolean;
    stock?: number;
    estado?: 'active' | 'paused';
  } = {},
): Promise<Vendedor> {
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
      mpUserId: `2000000${secuencia}`,
      accessTokenEncrypted: encryptToken('valor-que-simula-un-access-token'),
      status: 'connected',
      connectedAt: new Date(),
    });
  }

  const [listing] = await db
    .insert(schema.listings)
    .values({
      sellerId: perfil.id,
      categoryId: await categoria(),
      title: `Camiseta ${nombre}`,
      priceAmount: PRECIO,
      sizeValue: 'L',
      condition: 'NUEVO',
      status: opciones.estado ?? 'active',
      // ERD §9.1: comprable exige `APPROVED`. Las publicaciones nacen
      // aprobadas desde el Service; al insertar por SQL hay que replicarlo.
      moderationStatus: 'APPROVED',
      stock: opciones.stock ?? 5,
    })
    .returning();

  return { user, sellerId: perfil.id, listingId: listing!.id };
}

/* -------------------------------------------------------------------------- */

describe('creacion de orden', () => {
  it('crea la orden con el snapshot financiero del 6%', async () => {
    const vendedor = await vendedorConPublicacion('ok');
    const comprador = await usuario('ok-buyer');

    const orden = await orderService.createOrder(comprador, {
      listingId: vendedor.listingId,
      quantity: 1,
      shippingAddress: DIRECCION,
    });

    expect(orden.status).toBe('PENDING_PAYMENT');
    expect(orden.totalAmount).toBe(PRECIO.toString());
    // 6% de $50.000 = $3.000
    expect(orden.commissionAmount).toBe('300000');
    expect(orden.sellerAmount).toBe('4700000');
    expect(orden.orderNumber).toMatch(/^OFF-[0-9A-F]{10}$/);
  });

  it('multiplica por la cantidad', async () => {
    const vendedor = await vendedorConPublicacion('cantidad');
    const comprador = await usuario('cantidad-buyer');

    const orden = await orderService.createOrder(comprador, {
      listingId: vendedor.listingId,
      quantity: 3,
      shippingAddress: DIRECCION,
    });

    expect(orden.totalAmount).toBe((PRECIO * 3n).toString());
    expect(orden.commissionAmount).toBe('900000');
  });

  it('congela la tasa aplicada y el item comprado', async () => {
    const vendedor = await vendedorConPublicacion('snapshot');
    const comprador = await usuario('snapshot-buyer');

    const orden = await orderService.createOrder(comprador, {
      listingId: vendedor.listingId,
      quantity: 1,
      shippingAddress: DIRECCION,
    });

    const [fila] = await getDatabase()
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orden.id));

    expect(fila?.commissionRateAtTransaction).toBe('0.0600');
    expect(fila?.sellerId).toBe(vendedor.sellerId);
    // Sin envio ni descuentos mientras esos modulos no existan.
    expect(fila?.shippingAmount).toBe(0n);
    expect(fila?.discountAmount).toBe(0n);
    /*
     * ⚠️ ESTO ANTES ESPERABA `null` Y AHORA ESPERA UNA FECHA, y no es un
     * ajuste del test: es que DEC-033 se implemento (2026-09-11). La orden
     * nace con `payment_deadline = now + payment_window_minutes` (⚙️ Config
     * Store) y el barrido `orders-expire-pending-payment` la cancela al
     * vencer. Lo que se fija acá es que el plazo EXISTE y esta en el futuro;
     * cuanto dura es configuracion y no se escribe en un test.
     */
    expect(fila?.paymentDeadline).not.toBeNull();
    expect(fila!.paymentDeadline!.getTime()).toBeGreaterThan(Date.now());

    const [item] = await getDatabase()
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orden.id));

    expect(item?.titleSnapshot).toBe('Camiseta snapshot');
    expect(item?.unitPriceAmount).toBe(PRECIO);
  });

  it('registra la creacion en el historial de estados', async () => {
    const vendedor = await vendedorConPublicacion('historial');
    const comprador = await usuario('historial-buyer');

    const orden = await orderService.createOrder(comprador, {
      listingId: vendedor.listingId,
      quantity: 1,
      shippingAddress: DIRECCION,
    });

    const historial = await getDatabase()
      .select()
      .from(schema.orderStatusHistory)
      .where(eq(schema.orderStatusHistory.orderId, orden.id));

    expect(historial).toHaveLength(1);
    expect(historial[0]!.fromStatus).toBeNull();
    expect(historial[0]!.toStatus).toBe('PENDING_PAYMENT');
  });

  it('NO descuenta stock al crear la orden', async () => {
    // MF-022: el stock se descuenta cuando el pago se aprueba.
    const vendedor = await vendedorConPublicacion('stock-intacto');
    const comprador = await usuario('stock-intacto-buyer');

    await orderService.createOrder(comprador, {
      listingId: vendedor.listingId,
      quantity: 2,
      shippingAddress: DIRECCION,
    });

    const [listing] = await getDatabase()
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.id, vendedor.listingId));

    expect(listing?.stock).toBe(5);
  });

  it('rechaza comprar la propia publicacion', async () => {
    const vendedor = await vendedorConPublicacion('propia');

    await expect(
      orderService.createOrder(vendedor.user, {
        listingId: vendedor.listingId,
        quantity: 1,
        shippingAddress: DIRECCION,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rechaza una publicacion que no esta activa', async () => {
    const vendedor = await vendedorConPublicacion('pausada', { estado: 'paused' });
    const comprador = await usuario('pausada-buyer');

    await expect(
      orderService.createOrder(comprador, {
        listingId: vendedor.listingId,
        quantity: 1,
        shippingAddress: DIRECCION,
      }),
    ).rejects.toMatchObject({ code: 'LISTING_NOT_AVAILABLE' });
  });

  it('rechaza una publicacion inexistente', async () => {
    const comprador = await usuario('inexistente-buyer');

    await expect(
      orderService.createOrder(comprador, {
        listingId: '00000000-0000-4000-8000-000000000000',
        quantity: 1,
        shippingAddress: DIRECCION,
      }),
    ).rejects.toMatchObject({ code: 'LISTING_NOT_AVAILABLE' });
  });

  it('rechaza cuando no hay stock suficiente', async () => {
    const vendedor = await vendedorConPublicacion('sin-stock', { stock: 1 });
    const comprador = await usuario('sin-stock-buyer');

    await expect(
      orderService.createOrder(comprador, {
        listingId: vendedor.listingId,
        quantity: 2,
        shippingAddress: DIRECCION,
      }),
    ).rejects.toMatchObject({ code: 'LISTING_OUT_OF_STOCK' });
  });

  it('rechaza si el vendedor no tiene Mercado Pago conectado', async () => {
    const vendedor = await vendedorConPublicacion('sin-mp', { conectado: false });
    const comprador = await usuario('sin-mp-buyer');

    await expect(
      orderService.createOrder(comprador, {
        listingId: vendedor.listingId,
        quantity: 1,
        shippingAddress: DIRECCION,
      }),
    ).rejects.toMatchObject({ code: 'SELLER_NOT_OPERATIONAL' });
  });

  it('rechaza si el vendedor no esta aprobado', async () => {
    const vendedor = await vendedorConPublicacion('sin-aprobar', { aprobado: false });
    const comprador = await usuario('sin-aprobar-buyer');

    await expect(
      orderService.createOrder(comprador, {
        listingId: vendedor.listingId,
        quantity: 1,
        shippingAddress: DIRECCION,
      }),
    ).rejects.toMatchObject({ code: 'SELLER_NOT_OPERATIONAL' });
  });

  it('lista las ordenes del comprador', async () => {
    const vendedor = await vendedorConPublicacion('listado');
    const comprador = await usuario('listado-buyer');

    await orderService.createOrder(comprador, {
      listingId: vendedor.listingId,
      quantity: 1,
      shippingAddress: DIRECCION,
    });

    const ordenes = await orderService.listMyOrders(comprador);

    expect(ordenes).toHaveLength(1);
    expect(ordenes[0]!.commissionAmount).toBe('300000');
  });
});

describe('continuidad con el checkout', () => {
  it('la comision de la orden es exactamente el marketplace_fee que recibe Mercado Pago', async () => {
    // Es la costura entre `orders` y `payments`: si estos dos numeros se
    // separan, Offside cobra distinto de lo que registro.
    const vendedor = await vendedorConPublicacion('costura');
    const comprador = await usuario('costura-buyer');

    const orden = await orderService.createOrder(comprador, {
      listingId: vendedor.listingId,
      quantity: 2,
      shippingAddress: DIRECCION,
    });

    requestAsSeller.mockResolvedValue({
      ok: true,
      status: 201,
      body: {
        id: 'pref-orders-test',
        init_point: 'https://www.mercadopago.com.ar/checkout?pref_id=pref-orders-test',
        collector_id: '200000099',
      },
    });

    const checkout = await paymentService.startCheckout(comprador, orden.id);

    expect(checkout.marketplaceFeeAmount).toBe(orden.commissionAmount);

    const [, request] = requestAsSeller.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    // $100.000 de total -> $6.000 de comision, en unidades decimales.
    expect(request.body.marketplace_fee).toBe(6_000);
    expect(request.body.external_reference).toBe(orden.id);
  });
});
