import { getDatabase } from '@offside/database';

import * as errors from '../../auth/auth.errors';
import type { PublicUser } from '../../auth/services/auth.service';
import { getFiscalSource } from '../infrastructure/fiscal-source/unavailable-fiscal-source.adapter';
import * as taxRepo from '../repositories/seller-tax-profile.repository';
import * as fiscalErrors from '../seller.errors';
import { maskTaxId, validateTaxIdSyntax, type TaxIdType } from './fiscal-identity.service';
// La autorizacion del modulo (resolver el perfil POR `user.id`) vive en
// `seller.service`: una sola implementacion para identidad fiscal y para la
// conexion con Mercado Pago.
import { requireOwnSellerProfile } from './seller.service';

/**
 * Identidad fiscal del vendedor.
 *
 * ORQUESTA, en este orden:
 *   1. autoriza (el vendedor solo toca SU perfil)
 *   2. normaliza el identificador
 *   3. valida sintaxis + digito verificador
 *   4. persiste lo declarado, en estado PENDING de verificacion
 *   5. (futuro) consulta la fuente fiscal y guarda su resultado
 *
 * ⚠️ LO QUE ESTE SERVICIO **NO** HACE:
 *   - NO aprueba al vendedor. Cargar datos fiscales validos no es aprobacion;
 *     la aprobacion sigue siendo un paso aparte.
 *   - NO calcula comisiones ni percepciones. `tax_condition` queda disponible
 *     para que otro modulo la use, pero aca no se deriva nada de ella.
 *   - NO consulta ARCA: no hay integracion.
 */

export interface PublicTaxProfile {
  id: string;
  taxIdType: TaxIdType;
  taxId: string;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  taxCondition: string | null;
  source: string | null;
  checkedAt: string | null;
  validFrom: string;
  createdAt: string;
}

function toPublicTaxProfile(row: taxRepo.SellerTaxProfileRow): PublicTaxProfile {
  return {
    id: row.id,
    taxIdType: row.taxIdType,
    taxId: row.taxId,
    verificationStatus: row.verificationStatus,
    taxCondition: row.taxCondition,
    source: row.source,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    validFrom: row.validFrom.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Declara (o reemplaza) la identidad fiscal del vendedor.
 *
 * Si ya habia una vigente, se cierra y se inserta una nueva: la condicion
 * fiscal cambia con el tiempo y el historial se conserva.
 */
export async function submitTaxIdentity(
  user: PublicUser,
  input: { taxIdType: TaxIdType; taxId: string },
): Promise<PublicTaxProfile> {
  if (!user.emailVerified) throw errors.emailNotVerified();
  if (user.status !== 'active') throw errors.accountNotActive();

  const seller = await requireOwnSellerProfile(user);

  // Validacion SINTACTICA. No verifica nada contra la fuente oficial.
  const syntax = validateTaxIdSyntax(input.taxId);
  if (!syntax.valid) throw fiscalErrors.invalidTaxId(syntax.error);

  return getDatabase().transaction(async (tx) => {
    await taxRepo.closeCurrent(seller.id, tx);

    // Nace PENDING: sintaxis correcta ≠ verificado por la autoridad fiscal.
    return toPublicTaxProfile(
      await taxRepo.insertTaxProfile(
        { sellerId: seller.id, taxIdType: input.taxIdType, taxId: syntax.normalized },
        tx,
      ),
    );
  });
}

/** Perfil fiscal vigente del usuario. `null` si todavia no lo cargo. */
export async function getMyTaxProfile(user: PublicUser): Promise<PublicTaxProfile | null> {
  const seller = await requireOwnSellerProfile(user);
  const row = await taxRepo.findCurrentBySellerId(seller.id);

  return row ? toPublicTaxProfile(row) : null;
}

/**
 * Verificacion contra la fuente fiscal oficial.
 *
 * ⚠️ HOY SIEMPRE FALLA: no hay integracion con ARCA. Existe para que el punto
 * de conexion este definido y el resto del sistema ya hable con el contrato
 * correcto; el dia que exista el adapter real, esta funcion no cambia.
 *
 * NO devuelve una condicion fiscal inventada.
 */
export async function verifyTaxIdentity(user: PublicUser): Promise<PublicTaxProfile> {
  const seller = await requireOwnSellerProfile(user);
  const current = await taxRepo.findCurrentBySellerId(seller.id);
  if (!current) throw fiscalErrors.taxProfileNotFound();

  const source = getFiscalSource();
  if (!source.isAvailable) {
    console.warn(
      `[sellers] verificacion fiscal solicitada para ${maskTaxId(current.taxId)} pero no hay fuente integrada`,
    );
    throw fiscalErrors.fiscalSourceUnavailable();
  }

  // Cuando exista el adapter real: source.lookup(...) → persistir condicion,
  // source, checked_at y verification_status. Ver seller-tax-identity.md.
  throw fiscalErrors.fiscalSourceUnavailable();
}
