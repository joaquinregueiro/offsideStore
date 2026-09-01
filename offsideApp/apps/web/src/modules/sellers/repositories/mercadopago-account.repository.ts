import { getDatabase, schema, type Database } from '@offside/database';
import { and, eq, isNotNull, lte } from 'drizzle-orm';

/**
 * Acceso a `mercadopago_accounts` (ERD §7.3). Sin reglas de negocio.
 *
 * ⚠️ Las columnas `access_token_encrypted` y `refresh_token_encrypted` guardan
 * valores YA CIFRADOS por `infrastructure/mercadopago/token-cipher.ts`. Este
 * repository no cifra, no descifra y no sabe que hay adentro: solo persiste
 * texto opaco.
 *
 * ⚠️ NO existe un `findByMpUserId` que devuelva la fila entera hacia afuera con
 * los tokens: ver `findSellerIdByMpUserId`.
 */

export type MercadoPagoAccountRow = typeof schema.mercadopagoAccounts.$inferSelect;
export type MercadoPagoAccountStatus =
  (typeof schema.mercadopagoAccounts.status.enumValues)[number];

const conn = (db?: Database): Database => db ?? getDatabase();

export async function findBySellerId(
  sellerId: string,
  db?: Database,
): Promise<MercadoPagoAccountRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.mercadopagoAccounts)
    .where(eq(schema.mercadopagoAccounts.sellerId, sellerId))
    .limit(1);

  return row;
}

/**
 * Resuelve a QUE vendedor pertenece una cuenta de Mercado Pago.
 *
 * Devuelve solo el `seller_id`, nunca la fila: quien pregunta esto esta
 * detectando el caso D de la spec §9 (cuenta ya vinculada a otro vendedor) y no
 * tiene por que recibir las credenciales de un tercero.
 */
export async function findSellerIdByMpUserId(
  mpUserId: string,
  db?: Database,
): Promise<string | undefined> {
  const [row] = await conn(db)
    .select({ sellerId: schema.mercadopagoAccounts.sellerId })
    .from(schema.mercadopagoAccounts)
    .where(eq(schema.mercadopagoAccounts.mpUserId, mpUserId))
    .limit(1);

  return row?.sellerId;
}

/** Credenciales cifradas listas para persistir. */
export interface ConnectionCredentials {
  mpUserId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  expiresAt: Date;
  scopes: string[] | null;
  publicKey: string | null;
}

/**
 * Crea o actualiza la conexion de un vendedor y la deja `connected`.
 *
 * `UNIQUE(seller_id)` (ERD §7.3) garantiza una sola conexion por vendedor, asi
 * que el upsert por `seller_id` cubre los tres casos permitidos de la spec §9:
 * alta (A), reconexion de la misma cuenta (B) y reemplazo por otra cuenta del
 * mismo vendedor (C). El caso D —cuenta de otro vendedor— lo rechaza el Service
 * ANTES de llegar aca, y en ultima instancia `UNIQUE(mp_user_id)`.
 *
 * ⚠️ Al reemplazar una cuenta por otra, la anterior se SOBRESCRIBE: el ERD no
 * modela historial de cuentas de Mercado Pago. El cambio queda unicamente en
 * `audit_log` (spec §9).
 */
export async function upsertConnectedAccount(
  sellerId: string,
  credentials: ConnectionCredentials,
  db?: Database,
): Promise<MercadoPagoAccountRow> {
  const now = new Date();

  const values = {
    sellerId,
    mpUserId: credentials.mpUserId,
    accessTokenEncrypted: credentials.encryptedAccessToken,
    refreshTokenEncrypted: credentials.encryptedRefreshToken,
    tokenExpiresAt: credentials.expiresAt,
    scopes: credentials.scopes,
    publicKey: credentials.publicKey,
    status: 'connected' as const,
    connectedAt: now,
  };

  const [row] = await conn(db)
    .insert(schema.mercadopagoAccounts)
    .values(values)
    .onConflictDoUpdate({
      target: schema.mercadopagoAccounts.sellerId,
      set: { ...values, updatedAt: now },
    })
    .returning();

  return row!;
}

/**
 * Cambia el estado de la conexion.
 *
 * ⚠️ NO borra las credenciales cifradas. `disconnected` significa "Offside dejo
 * de usar esta conexion" (spec §12); si el vendedor vuelve a conectar la misma
 * cuenta, el flujo las reemplaza igual. Borrarlas no aportaria seguridad —estan
 * cifradas— y perderia la trazabilidad de que cuenta estuvo vinculada.
 */
export async function updateStatus(
  sellerId: string,
  status: MercadoPagoAccountStatus,
  db?: Database,
): Promise<MercadoPagoAccountRow | undefined> {
  const [row] = await conn(db)
    .update(schema.mercadopagoAccounts)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.mercadopagoAccounts.sellerId, sellerId))
    .returning();

  return row;
}

/**
 * Conexiones `connected` cuyo token vence antes de `limite`.
 *
 * ⚠️ EXIGE `refresh_token_encrypted`: sin el no hay nada que renovar, y
 * traerlas solo produciria fallos garantizados en cada barrido.
 *
 * ⚠️ Incluye las YA VENCIDAS a proposito (`token_expires_at <= limite` sin piso
 * inferior): si un barrido no corrio —el proceso estuvo caido— hay que
 * intentarlas igual. Mercado Pago puede seguir aceptando el `refresh_token`
 * despues del vencimiento del `access_token`; darlas por perdidas sin intentar
 * seria peor.
 */
export async function findExpiringConnections(
  limite: Date,
  db?: Database,
): Promise<MercadoPagoAccountRow[]> {
  return conn(db)
    .select()
    .from(schema.mercadopagoAccounts)
    .where(
      and(
        eq(schema.mercadopagoAccounts.status, 'connected'),
        isNotNull(schema.mercadopagoAccounts.refreshTokenEncrypted),
        isNotNull(schema.mercadopagoAccounts.tokenExpiresAt),
        lte(schema.mercadopagoAccounts.tokenExpiresAt, limite),
      ),
    )
    .orderBy(schema.mercadopagoAccounts.tokenExpiresAt);
}

/**
 * Persiste unas credenciales RENOVADAS (spec §10).
 *
 * ⚠️ NO TOCA `connected_at` NI `mp_user_id`: renovar no es reconectar. La
 * cuenta vinculada es la misma y la fecha de vinculacion original tiene que
 * sobrevivir; pisarlas haria imposible distinguir una conexion vieja renovada
 * de una recien hecha.
 *
 * ⚠️ SOLO ACTUALIZA SI SIGUE `connected`. La condicion va en el WHERE, no en un
 * `if` previo: entre que el barrido eligio la fila y que Mercado Pago responde
 * pasan segundos, y en el medio el vendedor pudo desconectarse. Un refresh no
 * puede reactivar una conexion que alguien dio de baja (spec §10, reglas de
 * concurrencia). Devuelve `undefined` si ya no correspondia.
 */
export async function updateRefreshedCredentials(
  sellerId: string,
  credentials: {
    encryptedAccessToken: string;
    encryptedRefreshToken: string | null;
    expiresAt: Date;
    scopes: string[] | null;
  },
  db?: Database,
): Promise<MercadoPagoAccountRow | undefined> {
  const now = new Date();

  const [row] = await conn(db)
    .update(schema.mercadopagoAccounts)
    .set({
      accessTokenEncrypted: credentials.encryptedAccessToken,
      refreshTokenEncrypted: credentials.encryptedRefreshToken,
      tokenExpiresAt: credentials.expiresAt,
      scopes: credentials.scopes,
      lastRefreshedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.mercadopagoAccounts.sellerId, sellerId),
        eq(schema.mercadopagoAccounts.status, 'connected'),
      ),
    )
    .returning();

  return row;
}
