import { getDatabase, schema, type Database } from '@offside/database';
import { eq } from 'drizzle-orm';

/**
 * Acceso a `seller_profiles.vacation_until` (delta del 2026-09-10, ver
 * `docs-implementation/erd-delta-2026-09-10.md` §12). Sin reglas de negocio.
 *
 * Vive aparte de `seller.repository.ts` para no tocar un archivo que otros
 * modulos ya usan; es el unico lugar que escribe esa columna.
 */

const conn = (db?: Database): Database => db ?? getDatabase();

/** `undefined` si el perfil no existe; `null` si no esta de vacaciones. */
export async function findVacationUntil(
  sellerId: string,
  db?: Database,
): Promise<Date | null | undefined> {
  const [row] = await conn(db)
    .select({ vacationUntil: schema.sellerProfiles.vacationUntil })
    .from(schema.sellerProfiles)
    .where(eq(schema.sellerProfiles.id, sellerId))
    .limit(1);

  return row?.vacationUntil;
}

/**
 * Escribe la fecha de regreso (`null` = vuelve a vender ya).
 *
 * ⚠️ SOLO esta columna. No toca `status` del perfil ni de ninguna publicacion:
 * vacaciones es un predicado derivado (`now() < vacation_until`).
 */
export async function setVacationUntil(
  sellerId: string,
  until: Date | null,
  db?: Database,
): Promise<{ id: string; vacationUntil: Date | null } | undefined> {
  const [row] = await conn(db)
    .update(schema.sellerProfiles)
    .set({ vacationUntil: until, updatedAt: new Date() })
    .where(eq(schema.sellerProfiles.id, sellerId))
    .returning({
      id: schema.sellerProfiles.id,
      vacationUntil: schema.sellerProfiles.vacationUntil,
    });

  return row;
}
