import { getDatabase, schema, type Database } from '@offside/database';
import { and, count, desc, eq } from 'drizzle-orm';

/**
 * Acceso a `user_addresses` (ERD §6.1). Sin reglas de negocio.
 *
 * ⚠️ TODAS LAS LECTURAS Y ESCRITURAS LLEVAN `user_id` EN EL WHERE. No hay
 * funcion que tome un id de direccion a secas: asi es imposible leer, editar o
 * borrar la de otra persona aunque se adivine el uuid.
 */

export type AddressRow = typeof schema.userAddresses.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

/**
 * Direcciones de un usuario: la predeterminada primero, despues las mas
 * nuevas.
 *
 * ⚠️ EL `ORDER BY` NO ES COSMETICO: marcar una como predeterminada hace un
 * UPDATE y sin orden explicito PostgreSQL reordena las filas, con lo que la
 * libreta se barajaria sola al tocarla.
 */
export async function findByUserId(userId: string, db?: Database): Promise<AddressRow[]> {
  return conn(db)
    .select()
    .from(schema.userAddresses)
    .where(eq(schema.userAddresses.userId, userId))
    .orderBy(
      desc(schema.userAddresses.isDefault),
      desc(schema.userAddresses.createdAt),
      desc(schema.userAddresses.id),
    );
}

export async function findByIdForUser(
  id: string,
  userId: string,
  db?: Database,
): Promise<AddressRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.userAddresses)
    .where(and(eq(schema.userAddresses.id, id), eq(schema.userAddresses.userId, userId)))
    .limit(1);

  return row;
}

export async function findDefaultByUserId(
  userId: string,
  db?: Database,
): Promise<AddressRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.userAddresses)
    .where(and(eq(schema.userAddresses.userId, userId), eq(schema.userAddresses.isDefault, true)))
    .orderBy(desc(schema.userAddresses.createdAt))
    .limit(1);

  return row;
}

export async function countByUserId(userId: string, db?: Database): Promise<number> {
  const [fila] = await conn(db)
    .select({ cantidad: count() })
    .from(schema.userAddresses)
    .where(eq(schema.userAddresses.userId, userId));

  return Number(fila?.cantidad ?? 0);
}

/**
 * `countries.id` de Argentina, por `iso_code`.
 *
 * Se lee `countries` directo porque es una tabla de catalogo sin Service
 * propio (`listings/catalog.repository` la usa para las facetas, pero un
 * modulo no importa el repository de otro).
 */
export async function findArgentinaCountryId(db?: Database): Promise<string | undefined> {
  const [row] = await conn(db)
    .select({ id: schema.countries.id })
    .from(schema.countries)
    .where(eq(schema.countries.isoCode, 'AR'))
    .limit(1);

  return row?.id;
}

export interface InsertAddressValues {
  userId: string;
  countryId: string;
  label: string | null;
  recipientName: string;
  phone: string | null;
  street: string;
  number: string | null;
  apartment: string | null;
  city: string;
  province: string;
  postalCode: string;
  isDefault: boolean;
}

export async function insert(values: InsertAddressValues, db?: Database): Promise<AddressRow> {
  const [row] = await conn(db).insert(schema.userAddresses).values(values).returning();

  return row!;
}

export type UpdateAddressValues = Omit<InsertAddressValues, 'userId' | 'countryId' | 'isDefault'>;

export async function update(
  id: string,
  userId: string,
  values: UpdateAddressValues,
  db?: Database,
): Promise<AddressRow | undefined> {
  const [row] = await conn(db)
    .update(schema.userAddresses)
    .set(values)
    .where(and(eq(schema.userAddresses.id, id), eq(schema.userAddresses.userId, userId)))
    .returning();

  return row;
}

/** Devuelve la fila borrada, o `undefined` si no existia (o no era del usuario). */
export async function remove(
  id: string,
  userId: string,
  db?: Database,
): Promise<AddressRow | undefined> {
  const [row] = await conn(db)
    .delete(schema.userAddresses)
    .where(and(eq(schema.userAddresses.id, id), eq(schema.userAddresses.userId, userId)))
    .returning();

  return row;
}

/** Quita la marca de predeterminada a TODAS las del usuario. */
export async function clearDefault(userId: string, db?: Database): Promise<void> {
  await conn(db)
    .update(schema.userAddresses)
    .set({ isDefault: false })
    .where(and(eq(schema.userAddresses.userId, userId), eq(schema.userAddresses.isDefault, true)));
}

/** Marca UNA como predeterminada. No limpia las demas: eso es `clearDefault`. */
export async function setDefault(
  id: string,
  userId: string,
  db?: Database,
): Promise<AddressRow | undefined> {
  const [row] = await conn(db)
    .update(schema.userAddresses)
    .set({ isDefault: true })
    .where(and(eq(schema.userAddresses.id, id), eq(schema.userAddresses.userId, userId)))
    .returning();

  return row;
}
