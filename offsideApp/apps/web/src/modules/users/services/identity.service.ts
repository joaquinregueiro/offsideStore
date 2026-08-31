import { getDatabase, schema, type Database } from '@offside/database';
import { desc, eq } from 'drizzle-orm';

/**
 * TS-001 — que significa "identidad verificada" en Offside.
 *
 * DECIDIDO el 2026-08-27, registrado como DEC-044: identidad verificada =
 *
 *   email verificado  +  identificador fiscal declarado y valido  +  Mercado
 *   Pago conectado
 *
 * FUENTE DE VERDAD: `docs/DECISIONS.md` DEC-044 y `trust-and-safety.md` §4.1.
 * Lo de aca es la IMPLEMENTACION de esa regla, no la regla: si alguna vez
 * difieren, manda `docs/` (CLAUDE.md §2). Esta aislada en una funcion pura para
 * que la diferencia sea evidente de un vistazo.
 *
 * POR QUE ESAS TRES:
 *
 *  - Las tres existen hoy, sin terceros nuevos ni costo por operacion.
 *  - Mercado Pago hace **KYC real** (documento, datos fiscales) antes de
 *    habilitar a alguien a cobrar. Que una cuenta pueda recibir dinero es la
 *    senal de identidad mas fuerte disponible, y es gratis.
 *  - El telefono quedo afuera: las columnas existen pero no hay flujo, y
 *    agregarlo exige elegir proveedor de SMS, que es otra decision de stack sin
 *    documentar.
 *
 * ⚠️ NO CONTRADICE BR-003. BR-003 dice que conectar Mercado Pago no otorga
 * CONFIANZA automatica, y habla de reputacion y badges. Identidad no es
 * confianza: un vendedor aprobado por esta via arranca igual con reputacion
 * cero, sin distintivos, y sujeto a las reglas de riesgo.
 *
 * ⚠️ LIMITE CONOCIDO: el identificador fiscal se valida por SINTAXIS Y DIGITO
 * VERIFICADOR, no contra ARCA — no hay integracion. Prueba que el numero esta
 * bien formado, NO que pertenezca a esa persona. Cuando exista el adapter
 * fiscal, esta regla debería exigir `verification_status = VERIFIED` en vez de
 * la mera declaracion, y eso es un cambio de UNA condicion en `isVerified()`.
 */

/** Version de la regla. Queda guardada en cada verificacion para poder auditar. */
export const IDENTITY_METHOD = 'offside_v1_email_fiscal_mp';

/** Senales que evalua TS-001. Quien las junta es `sellers`. */
export interface IdentitySignals {
  emailVerified: boolean;
  /** Identificador fiscal declarado y sintacticamente valido. */
  fiscalIdentityDeclared: boolean;
  mercadoPagoConnected: boolean;
}

/**
 * La regla, aislada y pura.
 *
 * Las tres senales se exigen JUNTAS: la documentacion dice que son "mecanismos
 * que suman, no equivalen entre si" (trust-and-safety.md §4.1), asi que ninguna
 * reemplaza a otra.
 */
export function isVerified(signals: IdentitySignals): boolean {
  return signals.emailVerified && signals.fiscalIdentityDeclared && signals.mercadoPagoConnected;
}

/** Que falta para llegar a verificado. Para poder decirselo al vendedor. */
export function missingSignals(signals: IdentitySignals): string[] {
  const faltan: string[] = [];

  if (!signals.emailVerified) faltan.push('email_verified');
  if (!signals.fiscalIdentityDeclared) faltan.push('fiscal_identity');
  if (!signals.mercadoPagoConnected) faltan.push('mercadopago_connected');

  return faltan;
}

export type IdentityVerificationRow = typeof schema.identityVerifications.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

/** Ultima verificacion registrada del usuario. */
export async function findLatest(
  userId: string,
  db?: Database,
): Promise<IdentityVerificationRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.identityVerifications)
    .where(eq(schema.identityVerifications.userId, userId))
    .orderBy(desc(schema.identityVerifications.createdAt))
    .limit(1);

  return row;
}

/**
 * Registra el resultado de evaluar la identidad (ERD §6.2).
 *
 * ⚠️ APPEND-ONLY: cada evaluacion inserta una fila. No se actualiza la anterior
 * porque las senales cambian con el tiempo —un vendedor puede desconectar
 * Mercado Pago— y hay que poder reconstruir con que evidencia se lo aprobo.
 *
 * `reviewed_by` queda en null: esta verificacion es automatica, no la reviso
 * una persona. Cuando exista revision manual, ese campo la distingue.
 *
 * ⚠️ `data` guarda SOLO los booleanos de las senales. Nunca el CUIT, el email
 * ni ningun dato personal: para eso ya estan sus tablas.
 */
export async function recordEvaluation(
  userId: string,
  signals: IdentitySignals,
  db?: Database,
): Promise<IdentityVerificationRow> {
  const verificado = isVerified(signals);

  const [row] = await conn(db)
    .insert(schema.identityVerifications)
    .values({
      userId,
      status: verificado ? 'verified' : 'unverified',
      method: IDENTITY_METHOD,
      data: { signals, missing: missingSignals(signals) },
      verifiedAt: verificado ? new Date() : null,
    })
    .returning();

  return row!;
}
