import * as audit from '../../audit/services/audit.service';
import * as errors from '../../auth/auth.errors';
import type { CreateSellerProfileInput } from '../../auth/auth.schemas';
import type { PublicUser } from '../../auth/services/auth.service';
import * as sellerRepo from '../repositories/seller.repository';
import * as sellerErrors from '../seller.errors';

/**
 * Logica de negocio de vendedores.
 *
 * ALCANCE DE ESTA FASE — SS-001 y SS-002 unicamente: un usuario ya registrado
 * solicita habilitar el rol vendedor y acepta los terminos de vendedor. El
 * perfil nace en `pending`.
 *
 * ⚠️ LO QUE **NO** SE IMPLEMENTA, y por que:
 *
 *  - **Aprobacion del vendedor (TS-010).** Requiere "identidad verificada", y
 *    **TS-001 no define que significa eso** (🟡). Aprobar seria inventar la
 *    regla. El perfil queda en `pending` hasta que se decida.
 *  - **Conexion con Mercado Pago (SS-010).** Es el modulo `payments`, fuera de
 *    alcance. Ademas BR-003/SS-012: conectar MP no aprueba ni da confianza.
 *  - **`seller_tier_id`.** DEC-037 sin valores (🟡); queda NULL.
 */

export interface PublicSellerProfile {
  id: string;
  userId: string;
  displayName: string;
  bio: string | null;
  status: 'pending' | 'approved' | 'limited' | 'suspended' | 'expelled';
  shippingPolicy: string | null;
  sellerTierId: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export function toPublicSellerProfile(row: sellerRepo.SellerProfileRow): PublicSellerProfile {
  return {
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    bio: row.bio,
    status: row.status,
    shippingPolicy: row.shippingPolicy,
    sellerTierId: row.sellerTierId,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Resuelve el perfil de vendedor del usuario autenticado.
 *
 * ESTA ES LA AUTORIZACION del modulo: se busca el perfil POR `user.id`, nunca
 * por un id que venga del request. Asi es imposible tocar el perfil de otro
 * vendedor — no hay parametro que manipular.
 *
 * Vive aca, y no en cada servicio, para que la identidad fiscal y la conexion
 * con Mercado Pago autoricen exactamente igual. Duplicarla seria arriesgarse a
 * que una de las copias se relaje.
 */
export async function requireOwnSellerProfile(
  user: PublicUser,
): Promise<sellerRepo.SellerProfileRow> {
  const profile = await sellerRepo.findByUserId(user.id);
  if (!profile) throw sellerErrors.sellerProfileNotFound();
  return profile;
}

/**
 * SS-001/SS-002 — habilitar el rol vendedor sobre un usuario existente.
 *
 * BS-021: el mismo usuario puede ser comprador y vendedor; por eso esto NO crea
 * una cuenta nueva, sino un perfil sobre la cuenta que ya existe.
 * BR-001: el email tiene que estar verificado para operar.
 */
export async function createSellerProfile(
  user: PublicUser,
  input: CreateSellerProfileInput,
): Promise<PublicSellerProfile> {
  if (!user.emailVerified) throw errors.emailNotVerified();
  if (user.status !== 'active') throw errors.accountNotActive();

  const existing = await sellerRepo.findByUserId(user.id);
  if (existing) throw errors.sellerProfileAlreadyExists();

  const created = await sellerRepo.insertSellerProfile({
    userId: user.id,
    displayName: input.displayName,
    bio: input.bio,
    shippingPolicy: input.shippingPolicy,
  });

  // TERMINOS ACEPTADOS (TS-010 punto 3). El schema exige `acceptedSellerTerms`
  // en true para llegar hasta aca, asi que la existencia del perfil YA implica
  // la aceptacion; lo que faltaba era dejar rastro de CUANDO.
  //
  // ⚠️ Va a `audit_log` y no a `user_history_events`, que seria su lugar
  // natural (DEC-036), porque `history_event_type` es un ENUM y no tiene un
  // valor para esto. Agregarlo es un cambio de ERD y necesita autorizacion
  // (CLAUDE.md §5). Queda señalado.
  await audit.record({
    actorType: 'user',
    actorId: user.id,
    action: 'SELLER_TERMS_ACCEPTED',
    entityType: 'seller_profile',
    entityId: created.id,
    metadata: { sellerId: created.id },
  });

  return toPublicSellerProfile(created);
}

/** Perfil de vendedor del usuario, o `null` si todavia no lo solicito. */
export async function getMySellerProfile(userId: string): Promise<PublicSellerProfile | null> {
  const row = await sellerRepo.findByUserId(userId);
  return row ? toPublicSellerProfile(row) : null;
}

/** Actualiza datos de tienda (SS-020). No toca `status` ni `seller_tier_id`. */
export async function updateMySellerProfile(
  userId: string,
  input: { displayName?: string; bio?: string; shippingPolicy?: string },
): Promise<PublicSellerProfile> {
  const updated = await sellerRepo.updateSellerProfile(userId, input);
  if (!updated) throw errors.forbidden();
  return toPublicSellerProfile(updated);
}
