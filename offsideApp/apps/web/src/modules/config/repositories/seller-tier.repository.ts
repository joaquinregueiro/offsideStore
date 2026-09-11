import { getDatabase, schema, type Database } from '@offside/database';
import { asc, eq } from 'drizzle-orm';

/**
 * LECTURA de `seller_tiers` (ERD §7.1). Sin reglas de negocio.
 *
 * `seller_tiers` es la otra mitad del Config Store (DEC-039, alternativa C):
 * lo relacional —tasa, limites, beneficios de cada tier— vive aca y no en el
 * key-value. Por eso el modulo `config` lo lee: la comision efectiva de un
 * vendedor sale de esta tabla o de `commission_rate_default`, y los overrides
 * de `app_settings` con `scope = 'seller_tier'` apuntan a estas filas.
 *
 * ⚠️ SOLO LECTURA A PROPOSITO. Asignar un tier a un vendedor, evaluar umbrales
 * y editar la tasa de un tier son del modulo de tiers/sellers, que ademas
 * tiene que auditar el cambio (ERD §7.1: "cambios -> audit_log"). Este
 * repositorio no escribe.
 */

export type SellerTierRow = typeof schema.sellerTiers.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

export async function findTierById(id: string, db?: Database): Promise<SellerTierRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.sellerTiers)
    .where(eq(schema.sellerTiers.id, id))
    .limit(1);

  return row;
}

export async function findTierByCode(
  code: string,
  db?: Database,
): Promise<SellerTierRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.sellerTiers)
    .where(eq(schema.sellerTiers.code, code))
    .limit(1);

  return row;
}

/** Todos los tiers, activos o no, por codigo. Para el back-office. */
export async function findAllTiers(db?: Database): Promise<SellerTierRow[]> {
  return conn(db).select().from(schema.sellerTiers).orderBy(asc(schema.sellerTiers.code));
}
