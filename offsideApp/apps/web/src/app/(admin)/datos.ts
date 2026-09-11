import { and, desc, eq, ilike, isNotNull, ne, or, sql } from 'drizzle-orm';

import { getDatabase, schema } from '@offside/database';

/**
 * CONSULTAS PROPIAS DEL BACK-OFFICE.
 *
 * =============================================================================
 * ⚠️ ESTO ES DEUDA DECLARADA, NO UN PATRON A COPIAR.
 * =============================================================================
 *
 * La arquitectura del proyecto es `Route Handler → Controller → Service →
 * Repository → Database` (CLAUDE.md §8) y una pantalla NO debería hablar con
 * Drizzle. Estas cuatro consultas viven acá porque **no existe un Service que
 * las responda** y `modules/` está fuera de esta superficie de trabajo:
 *
 *   - `ingresosPorPeriodoYOrigen`  ningún módulo agrega los snapshots de
 *                                  `orders` por período. Es el reporte que
 *                                  pide `/admin/ingresos`.
 *   - `buscarVendedores`           `sellers` sólo resuelve el perfil PROPIO
 *                                  (`getMySellerProfile`, `requireOwnSellerProfile`):
 *                                  no hay búsqueda administrativa.
 *   - `verVendedor`                lo mismo, por id.
 *   - `promocionesDeVendedor`      `listPromotions` exige ser el vendedor
 *                                  dueño; desde el back-office no sirve.
 *
 * Las cuatro pertenecen a un repositorio de su módulo. Queda reportado.
 *
 * ⚠️ NINGUNA AUTORIZA. Son lecturas crudas: quien llama ya exigió su capacidad
 * con `requireCapabilitySessionUser` (DEC-023), igual que hace el resto del
 * grupo. Ninguna recibe datos del formulario sin tipar: los ids se validan con
 * Zod en `acciones.ts` y el texto de búsqueda viaja parametrizado por Drizzle.
 *
 * ⚠️ EL DINERO SALE COMO STRING DE CENTAVOS, como en todos los Services: un
 * `bigint` de PostgreSQL no sobrevive a `Number` y `sum()` devuelve `numeric`.
 * Se castea a `text` en SQL y se formatea con `lib/formato.ts`.
 */

/* -------------------------------------------------------------- ingresos -- */

/** Una fila del reporte: un mes, un origen de comisión. */
export interface IngresoPorOrigen {
  /** `2026-09`. Mes en el que se acreditó el pago. */
  periodo: string;
  /** `default` | `seller_tier` | `promoted` (CHECK de `orders`). */
  origen: string;
  currency: string;
  ordenes: number;
  /** Centavos. Lo que Offside retuvo, según el snapshot congelado (DEC-030). */
  comision: string;
  /** Centavos. Lo que se le cobró al comprador. */
  facturado: string;
}

/**
 * Comisión cobrada por mes y por origen, leyendo el SNAPSHOT de cada orden.
 *
 * ⚠️ SE LEE `commission_amount`, NUNCA SE RECALCULA. Es la tasa que rigió al
 * crear la orden (DEC-030); multiplicar el total por la comisión de hoy daría
 * un número distinto y falso para toda orden vieja.
 *
 * ⚠️ EL PERÍODO ES EL DEL PAGO (`paid_at`), no el de la creación: una orden
 * creada en agosto y pagada en septiembre es plata de septiembre.
 *
 * ⚠️ SE EXCLUYEN LAS CANCELADAS y nada más. **No se descuentan reembolsos ni
 * disputas**, y no es un olvido: un reembolso vive en `refunds` y no escribe
 * de vuelta en `orders`, así que restarlo desde acá sería inventar un cruce
 * que nadie decidió. La pantalla lo dice con todas las letras.
 */
export async function ingresosPorPeriodoYOrigen(meses = 12): Promise<IngresoPorOrigen[]> {
  const periodo = sql<string>`to_char(date_trunc('month', ${schema.orders.paidAt}), 'YYYY-MM')`;

  const filas = await getDatabase()
    .select({
      periodo,
      origen: schema.orders.commissionSource,
      currency: schema.orders.currency,
      ordenes: sql<number>`count(*)::int`,
      comision: sql<string>`coalesce(sum(${schema.orders.commissionAmount}), 0)::text`,
      facturado: sql<string>`coalesce(sum(${schema.orders.totalAmount}), 0)::text`,
    })
    .from(schema.orders)
    .where(and(isNotNull(schema.orders.paidAt), ne(schema.orders.status, 'CANCELLED')))
    .groupBy(periodo, schema.orders.commissionSource, schema.orders.currency)
    .orderBy(sql`1 desc`, schema.orders.commissionSource)
    // El techo es de cordura: son tres orígenes por mes, así que `meses * 3`
    // cubre el rango pedido sin traer la historia entera de la plataforma.
    .limit(Math.max(1, meses) * 3);

  return filas;
}

/* ------------------------------------------------------------ vendedores -- */

export interface VendedorDeLista {
  sellerId: string;
  userId: string;
  displayName: string;
  email: string;
  /** `pending` | `approved` | `suspended` | `expelled` (enum `seller_status`). */
  status: string;
  userLevel: string;
  riskLevel: string;
  tierCode: string | null;
  tierName: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  vacationUntil: Date | null;
}

const COLUMNAS_DE_VENDEDOR = {
  sellerId: schema.sellerProfiles.id,
  userId: schema.sellerProfiles.userId,
  displayName: schema.sellerProfiles.displayName,
  email: schema.users.email,
  status: schema.sellerProfiles.status,
  userLevel: schema.users.userLevel,
  riskLevel: schema.users.riskLevel,
  tierCode: schema.sellerTiers.code,
  tierName: schema.sellerTiers.name,
  createdAt: schema.sellerProfiles.createdAt,
  approvedAt: schema.sellerProfiles.approvedAt,
  vacationUntil: schema.sellerProfiles.vacationUntil,
};

/**
 * Busca vendedores por nombre visible o por email.
 *
 * ⚠️ SIN TEXTO DEVUELVE LOS ÚLTIMOS, NO TODOS. Un listado completo de
 * vendedores con su email es exactamente la pantalla que no conviene tener
 * abierta: se acota a `limite` y se ordena por alta reciente, que además es lo
 * que se mira cuando no se busca a nadie en particular.
 *
 * ⚠️ `ilike` CON EL TEXTO PARAMETRIZADO. Los comodines se agregan acá; lo que
 * escribió la persona viaja como parámetro y nunca se concatena al SQL.
 */
export async function buscarVendedores(texto: string, limite = 25): Promise<VendedorDeLista[]> {
  const consulta = texto.trim();

  const base = getDatabase()
    .select(COLUMNAS_DE_VENDEDOR)
    .from(schema.sellerProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.sellerProfiles.userId))
    .leftJoin(schema.sellerTiers, eq(schema.sellerTiers.id, schema.sellerProfiles.sellerTierId));

  if (consulta === '') {
    return base.orderBy(desc(schema.sellerProfiles.createdAt)).limit(limite);
  }

  const patron = `%${consulta}%`;

  return base
    .where(or(ilike(schema.sellerProfiles.displayName, patron), ilike(schema.users.email, patron)))
    .orderBy(desc(schema.sellerProfiles.createdAt))
    .limit(limite);
}

/** Un vendedor por su id de perfil, o `undefined`. */
export async function verVendedor(sellerId: string): Promise<VendedorDeLista | undefined> {
  const filas = await getDatabase()
    .select(COLUMNAS_DE_VENDEDOR)
    .from(schema.sellerProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.sellerProfiles.userId))
    .leftJoin(schema.sellerTiers, eq(schema.sellerTiers.id, schema.sellerProfiles.sellerTierId))
    .where(eq(schema.sellerProfiles.id, sellerId))
    .limit(1);

  return filas[0];
}

/* ----------------------------------------------------------- promociones -- */

export interface PromocionDeVendedor {
  id: string;
  listingId: string;
  listingTitle: string;
  multiplicador: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Promociones VIGENTES de un vendedor, para poder cortarlas desde el
 * back-office (`endPromotionByAdmin`).
 *
 * ⚠️ SÓLO LAS `active`. Una promoción terminada o cancelada no se puede volver
 * a terminar, y ofrecer el botón sería prometer una acción que el Service
 * rechaza.
 */
export async function promocionesDeVendedor(
  sellerId: string,
  limite = 20,
): Promise<PromocionDeVendedor[]> {
  return getDatabase()
    .select({
      id: schema.listingPromotions.id,
      listingId: schema.listingPromotions.listingId,
      listingTitle: schema.listings.title,
      multiplicador: schema.listingPromotions.commissionMultiplierSnapshot,
      startsAt: schema.listingPromotions.startsAt,
      endsAt: schema.listingPromotions.endsAt,
    })
    .from(schema.listingPromotions)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.listingPromotions.listingId))
    .where(
      and(
        eq(schema.listingPromotions.sellerId, sellerId),
        eq(schema.listingPromotions.status, 'active'),
      ),
    )
    .orderBy(desc(schema.listingPromotions.startsAt))
    .limit(limite);
}
