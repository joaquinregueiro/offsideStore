import { getDatabase, schema, type Database } from '@offside/database';
import { eq } from 'drizzle-orm';

/** Acceso a `seller_profiles` (ERD §7.2). Sin reglas de negocio. */

export type SellerProfileRow = typeof schema.sellerProfiles.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

export async function findByUserId(
  userId: string,
  db?: Database,
): Promise<SellerProfileRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.sellerProfiles)
    .where(eq(schema.sellerProfiles.userId, userId))
    .limit(1);

  return row;
}

/**
 * Crea el perfil de vendedor.
 *
 * ⚠️ NO recibe `sellerTierId` ni `status`:
 *  - `status` usa el default `'pending'` del ERD §7.2; aprobarlo es otro flujo
 *    (TS-010) y hoy esta bloqueado por TS-001.
 *  - `seller_tier_id` queda NULL: los tiers estan 🟡 sin definir (DEC-037) y la
 *    columna es nullable justamente para esto.
 */
export async function insertSellerProfile(
  values: {
    userId: string;
    displayName: string;
    bio?: string | undefined;
    shippingPolicy?: string | undefined;
  },
  db?: Database,
): Promise<SellerProfileRow> {
  const [row] = await conn(db)
    .insert(schema.sellerProfiles)
    .values({
      userId: values.userId,
      displayName: values.displayName,
      ...(values.bio === undefined ? {} : { bio: values.bio }),
      ...(values.shippingPolicy === undefined ? {} : { shippingPolicy: values.shippingPolicy }),
    })
    .returning();

  return row!;
}

export async function updateSellerProfile(
  userId: string,
  values: { displayName?: string; bio?: string; shippingPolicy?: string },
  db?: Database,
): Promise<SellerProfileRow | undefined> {
  const [row] = await conn(db)
    .update(schema.sellerProfiles)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(schema.sellerProfiles.userId, userId))
    .returning();

  return row;
}
