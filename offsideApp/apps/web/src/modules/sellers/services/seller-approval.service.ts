import { getDatabase, schema } from '@offside/database';
import { eq } from 'drizzle-orm';

import * as audit from '../../audit/services/audit.service';
import type { PublicUser } from '../../auth/services/auth.service';
import * as identity from '../../users/services/identity.service';
import * as mpRepo from '../repositories/mercadopago-account.repository';
import * as sellerRepo from '../repositories/seller.repository';
import * as taxRepo from '../repositories/seller-tax-profile.repository';

/**
 * TS-010 — aprobacion del vendedor.
 *
 * Un vendedor pasa a `approved` cuando cumple, TODO junto:
 *
 *   1. identidad verificada  (TS-001, ver `users/services/identity.service.ts`)
 *   2. Mercado Pago conectado por OAuth
 *   3. terminos aceptados
 *   4. no estar en un estado de riesgo que lo impida
 *
 * ORDEN DEL ONBOARDING (UC-SS-1, `seller-system.md` §5):
 *
 *   pide ser vendedor -> verifica identidad -> conecta MP -> acepta terminos
 *   -> queda aprobado
 *
 * La aprobacion es lo ULTIMO. Por eso conectar Mercado Pago NO puede exigir
 * estar aprobado: seria un punto muerto.
 *
 * ⚠️ ESTA APROBACION ES AUTOMATICA Y NO OTORGA CONFIANZA (BR-003 / SS-012). El
 * vendedor arranca con reputacion cero y sin distintivos. Aprobado significa
 * "puede operar", no "es confiable".
 */

const ENTITY_TYPE = 'seller_profile';

/** Se derivan del schema para no repetir los enums a mano. */
type SellerStatus = (typeof schema.sellerProfiles.$inferSelect)['status'];
type RiskLevel = (typeof schema.users.$inferSelect)['riskLevel'];

/** Estado de la habilitacion, tal como se expone por API. */
export interface ApprovalStatus {
  sellerStatus: SellerStatus;
  identityVerified: boolean;
  signals: identity.IdentitySignals;
  /** Que falta para poder aprobarse. Vacio = nada. */
  missing: string[];
  approvedAt: string | null;
}

/**
 * Riesgo que impide aprobar (TS-010 punto 4).
 *
 * ⚠️ Los UMBRALES que llevan a cada nivel siguen 🟡 (DEC-021, marcados 🟦 en el
 * ERD). Lo que NO esta pendiente es que `SUSPENDIDO` y `RESTRINGIDO` impiden
 * operar: eso se desprende del nombre del propio enum. `RIESGO` no bloquea:
 * es una senal de atencion, no una sancion, y tratarla como sancion seria
 * inventar la politica que falta.
 */
function riesgoBloquea(riskLevel: RiskLevel): boolean {
  return riskLevel === 'SUSPENDIDO' || riskLevel === 'RESTRINGIDO';
}

/**
 * Junta las senales de identidad del usuario.
 *
 * ⚠️ Vive en `sellers` y no en `users` a proposito: dos de las tres senales
 * —fiscal y Mercado Pago— son datos del vendedor. `users` define la REGLA
 * (TS-001); `sellers` aporta la evidencia.
 */
async function gatherSignals(
  user: PublicUser,
  sellerId: string,
): Promise<identity.IdentitySignals> {
  const [fiscal, mp] = await Promise.all([
    taxRepo.findCurrentBySellerId(sellerId),
    mpRepo.findBySellerId(sellerId),
  ]);

  return {
    emailVerified: user.emailVerified,
    // Declarado y sintacticamente valido. La verificacion contra ARCA todavia
    // no existe, y exigirla haria inalcanzable la aprobacion.
    fiscalIdentityDeclared: fiscal !== undefined,
    mercadoPagoConnected: mp?.status === 'connected',
  };
}

/** Nivel de riesgo del usuario. Vive en `users`, no en el perfil (DEC-021). */
async function riskLevelOf(userId: string): Promise<RiskLevel> {
  const [row] = await getDatabase()
    .select({ riskLevel: schema.users.riskLevel })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  return row?.riskLevel ?? 'NORMAL';
}

/**
 * Evalua y, si corresponde, aprueba. Idempotente.
 *
 * Se llama sola cuando cambia alguna senal —al conectar Mercado Pago y al
 * declarar la identidad fiscal— porque el orden en que el vendedor completa
 * los pasos no esta fijado: puede conectar MP antes o despues de cargar el
 * CUIT. Evaluar en ambos puntos cubre las dos secuencias.
 *
 * ⚠️ NO DEGRADA. Si un vendedor ya aprobado pierde una senal —desconecta
 * Mercado Pago—, esta funcion NO lo baja a `pending`. Revocar una aprobacion
 * es TS-011 y depende de las reglas de riesgo, que siguen 🟡. Mientras tanto,
 * el predicado `canSell` ya impide vender sin Mercado Pago conectado, asi que
 * no queda ningun agujero operativo.
 */
export async function evaluate(user: PublicUser): Promise<ApprovalStatus> {
  const seller = await sellerRepo.findByUserId(user.id);

  if (seller === undefined) {
    const signals: identity.IdentitySignals = {
      emailVerified: user.emailVerified,
      fiscalIdentityDeclared: false,
      mercadoPagoConnected: false,
    };

    return {
      sellerStatus: 'pending',
      identityVerified: false,
      signals,
      missing: [...identity.missingSignals(signals), 'seller_profile'],
      approvedAt: null,
    };
  }

  const signals = await gatherSignals(user, seller.id);
  const verificado = identity.isVerified(signals);

  // Se deja constancia de la evaluacion SIEMPRE, no solo cuando aprueba: hay
  // que poder reconstruir por que un vendedor NO fue aprobado.
  await identity.recordEvaluation(user.id, signals);

  const faltan = identity.missingSignals(signals);
  const riesgo = await riskLevelOf(user.id);

  if (riesgo !== 'NORMAL' && riesgoBloquea(riesgo)) faltan.push('risk_level');

  const puedeAprobarse =
    verificado && faltan.length === 0 && seller.status === 'pending' && !riesgoBloquea(riesgo);

  if (!puedeAprobarse) {
    return {
      sellerStatus: seller.status,
      identityVerified: verificado,
      signals,
      missing: faltan,
      approvedAt: seller.approvedAt?.toISOString() ?? null,
    };
  }

  const aprobado = await sellerRepo.approve(seller.id);

  await audit.record({
    actorType: 'system',
    action: 'SELLER_APPROVED',
    entityType: ENTITY_TYPE,
    entityId: seller.id,
    metadata: {
      userId: user.id,
      identityMethod: identity.IDENTITY_METHOD,
      signals,
    },
  });

  return {
    sellerStatus: aprobado?.status ?? 'approved',
    identityVerified: true,
    signals,
    missing: [],
    approvedAt: aprobado?.approvedAt?.toISOString() ?? new Date().toISOString(),
  };
}

/**
 * Estado actual SIN evaluar ni aprobar. Para mostrarselo al vendedor.
 *
 * Existe aparte de `evaluate()` porque una consulta de solo lectura no deberia
 * escribir una fila de verificacion cada vez que alguien refresca la pantalla.
 */
export async function getStatus(user: PublicUser): Promise<ApprovalStatus> {
  const seller = await sellerRepo.findByUserId(user.id);

  const signals: identity.IdentitySignals =
    seller === undefined
      ? {
          emailVerified: user.emailVerified,
          fiscalIdentityDeclared: false,
          mercadoPagoConnected: false,
        }
      : await gatherSignals(user, seller.id);

  const faltan = identity.missingSignals(signals);
  if (seller === undefined) faltan.push('seller_profile');

  return {
    sellerStatus: seller?.status ?? 'pending',
    identityVerified: identity.isVerified(signals),
    signals,
    missing: faltan,
    approvedAt: seller?.approvedAt?.toISOString() ?? null,
  };
}
