import { and, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDatabase, getDatabase, schema } from './index';

/**
 * Segundo delta al ERD v1.3 (2026-09-10) — integracion contra PostgreSQL REAL.
 *
 * No prueba logica de negocio (no hay Services todavia): prueba que la
 * migracion `0011` dejo la base con las GUARDAS que los modulos que vienen van
 * a dar por sentadas. Cada CHECK, UNIQUE y FK RESTRICT de aca es una regla que
 * un Service podria olvidar; si la base no la sostiene, el olvido pasa en
 * silencio.
 *
 * Limpia todo lo que crea: sufijo `@erddelta.offside`.
 */

const SUFIJO = '@erddelta.offside';
const email = (n: string) => `${n}${SUFIJO}`;

let buyerId: string;
let sellerUserId: string;
let sellerId: string;
let listingId: string;

/** Mensaje de error de PostgreSQL, este donde este envuelto. */
function mensajeDe(error: unknown): string {
  if (error instanceof Error) {
    const causa = (error as { cause?: unknown }).cause;
    return `${error.message} ${causa instanceof Error ? causa.message : ''}`;
  }
  return String(error);
}

async function limpiar(): Promise<void> {
  const db = getDatabase();
  const usuarios = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(like(schema.users.email, `%${SUFIJO}`));
  const userIds = usuarios.map((u) => u.id);
  if (userIds.length === 0) return;

  const perfiles = await db
    .select({ id: schema.sellerProfiles.id })
    .from(schema.sellerProfiles)
    .where(inArray(schema.sellerProfiles.userId, userIds));
  const sellerIds = perfiles.map((p) => p.id);

  // Orden inverso a las FK RESTRICT: ordenes → promociones/denuncias →
  // publicaciones → perfiles → usuarios.
  if (sellerIds.length > 0) {
    await db.delete(schema.orders).where(inArray(schema.orders.sellerId, sellerIds));
    await db
      .delete(schema.listingPromotions)
      .where(inArray(schema.listingPromotions.sellerId, sellerIds));
    const publicaciones = await db
      .select({ id: schema.listings.id })
      .from(schema.listings)
      .where(inArray(schema.listings.sellerId, sellerIds));
    const listingIds = publicaciones.map((l) => l.id);
    if (listingIds.length > 0) {
      await db
        .delete(schema.listingReports)
        .where(inArray(schema.listingReports.listingId, listingIds));
      await db.delete(schema.listings).where(inArray(schema.listings.id, listingIds));
    }
    await db.delete(schema.sellerProfiles).where(inArray(schema.sellerProfiles.id, sellerIds));
  }
  await db.delete(schema.users).where(inArray(schema.users.id, userIds));
}

beforeAll(async () => {
  await limpiar();
  const db = getDatabase();

  const [comprador] = await db
    .insert(schema.users)
    .values({ email: email('comprador') })
    .returning({ id: schema.users.id });
  const [vendedor] = await db
    .insert(schema.users)
    .values({ email: email('vendedor') })
    .returning({ id: schema.users.id });
  if (!comprador || !vendedor) throw new Error('no se crearon los usuarios de prueba');
  buyerId = comprador.id;
  sellerUserId = vendedor.id;

  const [perfil] = await db
    .insert(schema.sellerProfiles)
    .values({ userId: sellerUserId, displayName: 'Tienda de prueba' })
    .returning({ id: schema.sellerProfiles.id });
  if (!perfil) throw new Error('no se creo el perfil de vendedor');
  sellerId = perfil.id;

  // Las categorias las carga la migracion 0004: se LEEN, no se inventan.
  const [categoria] = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .limit(1);
  if (!categoria) throw new Error('la migracion 0004 no cargo categorias');

  const [publicacion] = await db
    .insert(schema.listings)
    .values({
      sellerId,
      categoryId: categoria.id,
      title: 'Camiseta de prueba del delta',
      priceAmount: 100_000n,
      sizeValue: 'M',
      condition: 'BUENO',
    })
    .returning({ id: schema.listings.id });
  if (!publicacion) throw new Error('no se creo la publicacion de prueba');
  listingId = publicacion.id;
});

afterAll(async () => {
  await limpiar();
  await closeDatabase();
});

describe('semillas de app_settings (migracion 0011)', () => {
  it('carga las nueve claves nuevas en scope global, version 1, con su tipo', async () => {
    const db = getDatabase();
    const esperadas: Record<string, { value: unknown; valueType: string }> = {
      shipping_default_mode: { value: 'to_agree', valueType: 'string' },
      shipping_pickup_allowed: { value: true, valueType: 'bool' },
      questions_max_open_per_user: { value: 20, valueType: 'number' },
      questions_max_length: { value: 500, valueType: 'number' },
      favorites_price_drop_min_percent: { value: 10, valueType: 'number' },
      seller_tier_sales_window_days: { value: 365, valueType: 'number' },
      seller_tier_auto_assign: { value: true, valueType: 'bool' },
      seller_tier_auto_downgrade: { value: false, valueType: 'bool' },
      promoted_first_in_search: { value: true, valueType: 'bool' },
    };

    const filas = await db
      .select({
        key: schema.appSettings.key,
        value: schema.appSettings.value,
        valueType: schema.appSettings.valueType,
        version: schema.appSettings.version,
      })
      .from(schema.appSettings)
      .where(
        and(
          eq(schema.appSettings.scope, 'global'),
          isNull(schema.appSettings.scopeId),
          inArray(schema.appSettings.key, Object.keys(esperadas)),
        ),
      );

    expect(filas).toHaveLength(Object.keys(esperadas).length);
    for (const fila of filas) {
      const esperada = esperadas[fila.key];
      expect(esperada, fila.key).toBeDefined();
      expect(fila.value, fila.key).toEqual(esperada?.value);
      expect(fila.valueType, fila.key).toBe(esperada?.valueType);
      expect(fila.version, fila.key).toBe(1);
    }
  });

  it('el default de shipping_default_mode coincide con el DEFAULT de listings.shipping_mode', async () => {
    const db = getDatabase();
    const [fila] = await db
      .select({ shippingMode: schema.listings.shippingMode })
      .from(schema.listings)
      .where(eq(schema.listings.id, listingId));
    const [setting] = await db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, 'shipping_default_mode'));

    // Una fila creada sin tocar el campo y el valor con el que arranca el
    // formulario tienen que decir lo mismo; si no, "no elegi nada" significa
    // dos cosas distintas segun donde se mire.
    expect(fila?.shippingMode).toBe('to_agree');
    expect(setting?.value).toBe('to_agree');
  });
});

describe('listings — envio declarado', () => {
  it('rechaza un modo de envio fuera de los cuatro conocidos', async () => {
    const db = getDatabase();
    await expect(
      db
        .update(schema.listings)
        .set({ shippingMode: 'gratis' })
        .where(eq(schema.listings.id, listingId)),
    ).rejects.toSatisfy((e: unknown) => mensajeDe(e).includes('listings_shipping_mode_check'));
  });

  it('rechaza un costo de envio negativo y acepta null', async () => {
    const db = getDatabase();
    await expect(
      db
        .update(schema.listings)
        .set({ shippingMode: 'buyer_pays', shippingCostAmount: -1n })
        .where(eq(schema.listings.id, listingId)),
    ).rejects.toSatisfy((e: unknown) =>
      mensajeDe(e).includes('listings_shipping_cost_amount_check'),
    );

    await db
      .update(schema.listings)
      .set({ shippingMode: 'buyer_pays', shippingCostAmount: 250_000n })
      .where(eq(schema.listings.id, listingId));
    const [fila] = await db
      .select({ costo: schema.listings.shippingCostAmount })
      .from(schema.listings)
      .where(eq(schema.listings.id, listingId));
    expect(fila?.costo).toBe(250_000n);
  });
});

describe('listing_promotions — historial de promociones', () => {
  it('rechaza un estado desconocido, un periodo invertido y un multiplicador no positivo', async () => {
    const db = getDatabase();
    const ahora = new Date();
    const enUnaSemana = new Date(ahora.getTime() + 7 * 24 * 3600 * 1000);
    const base = {
      listingId,
      sellerId,
      createdBy: sellerUserId,
      commissionMultiplierSnapshot: '3.000',
      startsAt: ahora,
      endsAt: enUnaSemana,
    };

    await expect(
      db.insert(schema.listingPromotions).values({ ...base, status: 'paused' }),
    ).rejects.toSatisfy((e: unknown) => mensajeDe(e).includes('listing_promotions_status_check'));

    await expect(
      db
        .insert(schema.listingPromotions)
        .values({ ...base, status: 'active', startsAt: enUnaSemana, endsAt: ahora }),
    ).rejects.toSatisfy((e: unknown) => mensajeDe(e).includes('listing_promotions_period_check'));

    await expect(
      db
        .insert(schema.listingPromotions)
        .values({ ...base, status: 'active', commissionMultiplierSnapshot: '0.000' }),
    ).rejects.toSatisfy((e: unknown) =>
      mensajeDe(e).includes('listing_promotions_multiplier_check'),
    );
  });

  it('una orden que la referencia impide borrarla (RESTRICT) y explica su comision', async () => {
    const db = getDatabase();
    const ahora = new Date();
    const [promo] = await db
      .insert(schema.listingPromotions)
      .values({
        listingId,
        sellerId,
        createdBy: sellerUserId,
        status: 'active',
        commissionMultiplierSnapshot: '3.000',
        startsAt: ahora,
        endsAt: new Date(ahora.getTime() + 7 * 24 * 3600 * 1000),
      })
      .returning({ id: schema.listingPromotions.id });
    if (!promo) throw new Error('no se creo la promocion');

    const [orden] = await db
      .insert(schema.orders)
      .values({
        orderNumber: `ERDDELTA-${Date.now()}`,
        buyerId,
        sellerId,
        productAmount: 100_000n,
        totalAmount: 100_000n,
        shippingAddress: {},
        commissionSource: 'promoted',
        listingPromotionId: promo.id,
        promotionMultiplierAtTransaction: '3.000',
      })
      .returning({
        id: schema.orders.id,
        commissionSource: schema.orders.commissionSource,
      });
    expect(orden?.commissionSource).toBe('promoted');

    // Borrar la promocion dejaria una orden que dice "promoted" sin poder
    // decir POR CUAL: eso es exactamente lo que RESTRICT impide.
    await expect(
      db.delete(schema.listingPromotions).where(eq(schema.listingPromotions.id, promo.id)),
    ).rejects.toSatisfy((e: unknown) =>
      mensajeDe(e).includes('orders_listing_promotion_id_listing_promotions_id_fk'),
    );

    // La relacion de consulta tambien resuelve.
    const conPromo = await db.query.orders.findFirst({
      where: eq(schema.orders.id, orden?.id ?? ''),
      with: { listingPromotion: true },
    });
    // numeric llega como string; se compara el valor, no su formato.
    expect(Number(conPromo?.listingPromotion?.commissionMultiplierSnapshot)).toBe(3);
  });
});

describe('orders — origen de la comision', () => {
  it("arranca en 'default' y rechaza un origen fuera de los tres conocidos", async () => {
    const db = getDatabase();
    const [orden] = await db
      .insert(schema.orders)
      .values({
        orderNumber: `ERDDELTA-DEF-${Date.now()}`,
        buyerId,
        sellerId,
        productAmount: 100_000n,
        totalAmount: 100_000n,
        shippingAddress: {},
      })
      .returning({
        id: schema.orders.id,
        commissionSource: schema.orders.commissionSource,
        listingPromotionId: schema.orders.listingPromotionId,
      });
    expect(orden?.commissionSource).toBe('default');
    expect(orden?.listingPromotionId).toBeNull();

    await expect(
      db
        .update(schema.orders)
        .set({ commissionSource: 'manual' })
        .where(eq(schema.orders.id, orden?.id ?? '')),
    ).rejects.toSatisfy((e: unknown) => mensajeDe(e).includes('orders_commission_source_check'));
  });
});

describe('listing_reports — denuncias', () => {
  it("nace 'open', una persona denuncia una publicacion UNA vez y rechaza estados desconocidos", async () => {
    const db = getDatabase();
    const [denuncia] = await db
      .insert(schema.listingReports)
      .values({ listingId, reporterId: buyerId, reason: 'falsificacion' })
      .returning({ id: schema.listingReports.id, status: schema.listingReports.status });
    expect(denuncia?.status).toBe('open');

    await expect(
      db
        .insert(schema.listingReports)
        .values({ listingId, reporterId: buyerId, reason: 'otra vez' }),
    ).rejects.toSatisfy((e: unknown) =>
      mensajeDe(e).includes('listing_reports_listing_id_reporter_id_key'),
    );

    await expect(
      db
        .update(schema.listingReports)
        .set({ status: 'resolved' })
        .where(eq(schema.listingReports.id, denuncia?.id ?? '')),
    ).rejects.toSatisfy((e: unknown) => mensajeDe(e).includes('listing_reports_status_check'));

    // Con una denuncia (o una promocion) que la referencia, la publicacion no
    // se puede borrar: RESTRICT. Cual de las dos FK salta primero no importa.
    await expect(
      db.delete(schema.listings).where(eq(schema.listings.id, listingId)),
    ).rejects.toSatisfy((e: unknown) => mensajeDe(e).includes('_listings_id_fk'));
  });
});

describe('columnas nullable nuevas', () => {
  it('vacation_until, seller_reply y seller_replied_at existen y arrancan en null', async () => {
    const db = getDatabase();
    const [perfil] = await db
      .select({ vacationUntil: schema.sellerProfiles.vacationUntil })
      .from(schema.sellerProfiles)
      .where(eq(schema.sellerProfiles.id, sellerId));
    expect(perfil?.vacationUntil).toBeNull();

    // `reviews` exige una orden COMPLETED por regla de negocio (validada en
    // app); aca solo importa que las columnas existan con el tipo esperado.
    const columnas = await db.execute<{ column_name: string; is_nullable: string }>(
      sql`SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'reviews' AND column_name IN ('seller_reply', 'seller_replied_at')
        ORDER BY column_name`,
    );
    expect([...columnas]).toEqual([
      { column_name: 'seller_replied_at', is_nullable: 'YES' },
      { column_name: 'seller_reply', is_nullable: 'YES' },
    ]);
  });
});
