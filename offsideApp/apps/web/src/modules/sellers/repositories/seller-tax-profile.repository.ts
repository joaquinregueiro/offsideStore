import { getDatabase, schema, type Database } from '@offside/database';
import { and, eq, isNull } from 'drizzle-orm';

/** Acceso a `seller_tax_profiles`. Sin reglas de negocio. */

export type SellerTaxProfileRow = typeof schema.sellerTaxProfiles.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

/** Perfil fiscal VIGENTE del vendedor (`valid_to IS NULL`). */
export async function findCurrentBySellerId(
  sellerId: string,
  db?: Database,
): Promise<SellerTaxProfileRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.sellerTaxProfiles)
    .where(
      and(
        eq(schema.sellerTaxProfiles.sellerId, sellerId),
        isNull(schema.sellerTaxProfiles.validTo),
      ),
    )
    .limit(1);

  return row;
}

/** Historial completo, incluida la fila vigente. Mas reciente primero. */
export async function findHistoryBySellerId(
  sellerId: string,
  db?: Database,
): Promise<SellerTaxProfileRow[]> {
  return conn(db)
    .select()
    .from(schema.sellerTaxProfiles)
    .where(eq(schema.sellerTaxProfiles.sellerId, sellerId))
    .orderBy(schema.sellerTaxProfiles.validFrom);
}

/**
 * Cierra la fila vigente poniendole `valid_to`.
 *
 * Append-only: NO se hace UPDATE sobre los datos, solo se marca el fin de su
 * vigencia. El historial se conserva.
 */
export async function closeCurrent(sellerId: string, db?: Database): Promise<void> {
  const now = new Date();
  await conn(db)
    .update(schema.sellerTaxProfiles)
    .set({ validTo: now, updatedAt: now })
    .where(
      and(
        eq(schema.sellerTaxProfiles.sellerId, sellerId),
        isNull(schema.sellerTaxProfiles.validTo),
      ),
    );
}

export async function insertTaxProfile(
  values: {
    sellerId: string;
    taxIdType: 'CUIT' | 'CUIL' | 'CDI';
    taxId: string;
  },
  db?: Database,
): Promise<SellerTaxProfileRow> {
  const [row] = await conn(db).insert(schema.sellerTaxProfiles).values(values).returning();

  return row!;
}
