import { getDatabase, schema, type Database } from '@offside/database';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Lo minimo de `seller_profiles` que una sancion necesita tocar.
 *
 * ⚠️ POR QUE VIVE ACA Y NO EN `sellers`. La habilitacion del vendedor
 * —`aprobado → limitado → suspendido → expulsado`— la define
 * `trust-and-safety.md` (seller-system.md §6 remite ahi), y el ERD §16.2 dice
 * que las sanciones "se aplican al vendedor (capacidad de vender)". Suspender
 * ES el efecto de una sancion: el modulo que la aplica es el que escribe el
 * estado, en la MISMA transaccion que la fila de `sanctions`. Un modulo no
 * importa el repository de otro (`modules/README.md`), y `sellers` no expone
 * hoy un Service para esto; el precedente es `orders`, que lee
 * `seller_profiles` por su cuenta para el mismo motivo.
 *
 * Solo dos operaciones, y ninguna crea ni borra perfiles.
 */

export type SellerStatus = (typeof schema.sellerProfiles.$inferSelect)['status'];

const conn = (db?: Database): Database => db ?? getDatabase();

export interface SellerIdentity {
  id: string;
  userId: string;
  status: SellerStatus;
  /**
   * Si alguna vez fue aprobado. Es lo que decide a que estado VUELVE al
   * levantarse una suspension: `approved` si lo estaba, `pending` si no.
   */
  approvedAt: Date | null;
}

const IDENTIDAD = {
  id: schema.sellerProfiles.id,
  userId: schema.sellerProfiles.userId,
  status: schema.sellerProfiles.status,
  approvedAt: schema.sellerProfiles.approvedAt,
} as const;

export async function findSeller(
  sellerId: string,
  db?: Database,
): Promise<SellerIdentity | undefined> {
  const [row] = await conn(db)
    .select(IDENTIDAD)
    .from(schema.sellerProfiles)
    .where(eq(schema.sellerProfiles.id, sellerId))
    .limit(1);

  return row;
}

/**
 * Cambia el estado del vendedor SOLO si esta en uno de los `from`.
 *
 * ⚠️ LA CONDICION VA EN EL WHERE, igual que `approve()` en `sellers`: dos
 * sanciones simultaneas no pueden pisarse, y levantar una suspension no puede
 * "aprobar" a un vendedor que mientras tanto fue expulsado. Devuelve
 * `undefined` cuando no habia nada que cambiar.
 */
export async function transitionStatus(
  sellerId: string,
  from: readonly SellerStatus[],
  to: SellerStatus,
  db?: Database,
): Promise<SellerIdentity | undefined> {
  const [row] = await conn(db)
    .update(schema.sellerProfiles)
    .set({ status: to, updatedAt: new Date() })
    .where(
      and(eq(schema.sellerProfiles.id, sellerId), inArray(schema.sellerProfiles.status, [...from])),
    )
    .returning(IDENTIDAD);

  return row;
}
