import { getDatabase, schema, type Database } from '@offside/database';
import { and, asc, eq, gte, isNull, notExists, sql } from 'drizzle-orm';

/**
 * Acceso a `seller_tiers` (ERD §7.1) y a `seller_profiles.seller_tier_id`
 * (ERD §7.2). Sin reglas de negocio.
 *
 * ⚠️ `commission_rate` llega como STRING (`'0.0600'`): es `numeric(6,4)` y
 * postgres.js no lo convierte a `number` a proposito, porque un `numeric` no
 * cabe sin perdida en un double. La conversion a basis points la hace el
 * Service con aritmetica de strings.
 */

export type SellerTierRow = typeof schema.sellerTiers.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

/**
 * Umbral de ventas del tier, leido del JSON `limits` en SQL.
 *
 * Se usa SOLO para ordenar: la validacion de forma la hace el Service. Un tier
 * sin `minCompletedSales` ordena como 0 para que no desaparezca de la lista;
 * el Service decide despues si esa fila esta bien configurada o no.
 */
const umbralSql = sql<number>`COALESCE((${schema.sellerTiers.limits}->>'minCompletedSales')::int, 0)`;

/** Tiers activos, del umbral mas bajo al mas alto. Empates: por `code`. */
export async function findActiveTiers(db?: Database): Promise<SellerTierRow[]> {
  return conn(db)
    .select()
    .from(schema.sellerTiers)
    .where(eq(schema.sellerTiers.isActive, true))
    .orderBy(asc(umbralSql), asc(schema.sellerTiers.code));
}

/** Por `code`, activo o no: quien pregunta por un code concreto decide que hacer. */
export async function findByCode(code: string, db?: Database): Promise<SellerTierRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.sellerTiers)
    .where(eq(schema.sellerTiers.code, code))
    .limit(1);

  return row;
}

export async function findById(id: string, db?: Database): Promise<SellerTierRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.sellerTiers)
    .where(eq(schema.sellerTiers.id, id))
    .limit(1);

  return row;
}

/** El perfil y su tier (o `null` si no tiene). `undefined` si el perfil no existe. */
export async function findSellerWithTier(
  sellerId: string,
  db?: Database,
): Promise<
  { sellerId: string; sellerTierId: string | null; tier: SellerTierRow | null } | undefined
> {
  const [row] = await conn(db)
    .select({
      sellerId: schema.sellerProfiles.id,
      sellerTierId: schema.sellerProfiles.sellerTierId,
      tier: schema.sellerTiers,
    })
    .from(schema.sellerProfiles)
    .leftJoin(schema.sellerTiers, eq(schema.sellerTiers.id, schema.sellerProfiles.sellerTierId))
    .where(eq(schema.sellerProfiles.id, sellerId))
    .limit(1);

  if (row === undefined) return undefined;

  return { sellerId: row.sellerId, sellerTierId: row.sellerTierId, tier: row.tier ?? null };
}

/**
 * A quien avisarle de un cambio de tier: el email de la cuenta y un nombre.
 *
 * `nombre` prefiere el nombre de la persona (`users.display_name`, que puede
 * no estar) y cae al nombre de la tienda (`seller_profiles.display_name`,
 * obligatorio): el email saluda a alguien, no a un id. `undefined` si el
 * perfil no existe.
 */
export async function findSellerContact(
  sellerId: string,
  db?: Database,
): Promise<{ email: string; nombre: string | null } | undefined> {
  const [row] = await conn(db)
    .select({
      email: schema.users.email,
      nombreUsuario: schema.users.displayName,
      nombreTienda: schema.sellerProfiles.displayName,
    })
    .from(schema.sellerProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.sellerProfiles.userId))
    .where(eq(schema.sellerProfiles.id, sellerId))
    .limit(1);

  if (row === undefined) return undefined;

  return { email: row.email, nombre: row.nombreUsuario ?? row.nombreTienda };
}

/**
 * Asigna (o quita, con `null`) el tier del perfil.
 *
 * ⚠️ CONDICIONADA AL TIER ACTUAL, y la condicion va en el WHERE: dos
 * evaluaciones simultaneas —dos ordenes del mismo vendedor que se completan a
 * la vez— leen el mismo tier previo y las dos quieren subirlo. Con el WHERE,
 * la segunda no encuentra la fila y devuelve `undefined`: quien llama sabe que
 * NO cambio nada y no audita un cambio que no hizo. Sin esto habria dos
 * entradas de auditoria para un solo cambio.
 */
export async function assignTier(
  sellerId: string,
  values: { fromTierId: string | null; toTierId: string | null },
  db?: Database,
): Promise<{ id: string; sellerTierId: string | null } | undefined> {
  const [row] = await conn(db)
    .update(schema.sellerProfiles)
    .set({ sellerTierId: values.toTierId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.sellerProfiles.id, sellerId),
        values.fromTierId === null
          ? isNull(schema.sellerProfiles.sellerTierId)
          : eq(schema.sellerProfiles.sellerTierId, values.fromTierId),
      ),
    )
    .returning({ id: schema.sellerProfiles.id, sellerTierId: schema.sellerProfiles.sellerTierId });

  return row;
}

export interface CountCompletedSalesOptions {
  /** Solo ordenes completadas a partir de este instante. `null` = sin ventana. */
  since: Date | null;
  /** Excluye las que tengan un refund COMPLETED (BR-051). */
  excludeRefunded: boolean;
}

/**
 * Ventas COMPLETED del vendedor que cuentan para el tier.
 *
 * Lee `orders` y `refunds` desde `sellers` porque es una LECTURA de conteo, no
 * una regla de esos modulos: el ciclo de vida de la orden sigue viviendo en
 * `orders`. Solo `COMPLETED` (nunca `PAID`): la venta recien "existe" cuando
 * termino sin reclamo (BR-033), y contar reembolsadas seria un incentivo a
 * inflar el volumen (BR-051).
 *
 * La ventana se mide sobre `completed_at`; si una orden COMPLETED no lo tuviera
 * cargado, cae a `created_at` para no perderla en vez de inventarle una fecha.
 */
export async function countCompletedSales(
  sellerId: string,
  options: CountCompletedSalesOptions,
  db?: Database,
): Promise<number> {
  const condiciones = [eq(schema.orders.sellerId, sellerId), eq(schema.orders.status, 'COMPLETED')];

  if (options.since !== null) {
    // El lado izquierdo es SQL crudo, asi que Drizzle no sabe que columna
    // manda y no serializa el `Date`: se pasa ISO y se castea del lado de
    // PostgreSQL.
    condiciones.push(
      gte(
        sql`COALESCE(${schema.orders.completedAt}, ${schema.orders.createdAt})`,
        sql`${options.since.toISOString()}::timestamptz`,
      ),
    );
  }

  if (options.excludeRefunded) {
    condiciones.push(
      notExists(
        conn(db)
          .select({ uno: sql`1` })
          .from(schema.refunds)
          .where(
            and(
              eq(schema.refunds.orderId, schema.orders.id),
              eq(schema.refunds.status, 'COMPLETED'),
            ),
          ),
      ),
    );
  }

  const [row] = await conn(db)
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.orders)
    .where(and(...condiciones));

  return row?.total ?? 0;
}
