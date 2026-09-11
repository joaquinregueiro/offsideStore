import { getDatabase, type Database } from '@offside/database';

import * as audit from '../../audit/services/audit.service';
import type { PublicUser } from '../../auth/services/auth.service';
import * as vacationRepo from '../repositories/seller-vacation.repository';
import * as sellerErrors from '../seller.errors';
import * as errors from '../seller-tier.errors';
import { requireOwnSellerProfile } from './seller.service';

/**
 * MODO VACACIONES del vendedor.
 *
 * ⚠️ ES UN PREDICADO DERIVADO, NO UN ESTADO. Estar de vacaciones es
 * `now() < seller_profiles.vacation_until`, y nada mas: NO toca
 * `listings.status` ni `seller_profiles.status`. Es exactamente la misma
 * decision que la desconexion de Mercado Pago (SS-013 / UC-SS-4): si la
 * ausencia materializara `paused` en cada publicacion, al volver seria
 * imposible distinguir las que el vendedor pauso a mano (SS-050) de las que
 * apago la ausencia, y se reactivarian publicaciones que su dueño queria
 * abajo. Con un predicado, el estado nunca se toca y al vencer la fecha no
 * hay nada que reactivar: vuelve solo.
 *
 * ⚠️ LO QUE ESTE MODULO NO HACE, y quien lo tiene que hacer: `listings` es el
 * que decide que se muestra y que se puede comprar. `isPurchasable()` y el
 * WHERE de vitrina/busqueda/ficha tienen que excluir a los vendedores en
 * vacaciones con el MISMO predicado (`vacation_until IS NULL OR vacation_until
 * <= now()`), igual que hoy excluyen a los desconectados de MP. Hasta que eso
 * exista, marcar vacaciones guarda la fecha y nada mas. Anotado en el reporte.
 *
 * Lo que SI se decide aca: el panel del vendedor NO debe ocultarle sus
 * publicaciones mientras esta ausente (mismo criterio que SS-013): avisa que
 * no se ven y que vuelven solas.
 */

export interface VacationStatus {
  onVacation: boolean;
  /** ISO 8601, o `null` si no esta ausente. */
  vacationUntil: string | null;
}

/**
 * La regla, aislada y pura, para que la use quien filtre publicaciones.
 * `vacation_until` en el pasado equivale a `null`: nunca hace falta limpiarla.
 */
export function isOnVacationAt(vacationUntil: Date | null, now: Date = new Date()): boolean {
  return vacationUntil !== null && now.getTime() < vacationUntil.getTime();
}

/** Si el vendedor esta ausente AHORA. Perfil inexistente = no esta de vacaciones. */
export async function isOnVacation(sellerId: string, db?: Database): Promise<boolean> {
  const until = await vacationRepo.findVacationUntil(sellerId, db);

  return isOnVacationAt(until ?? null);
}

function toStatus(vacationUntil: Date | null): VacationStatus {
  const onVacation = isOnVacationAt(vacationUntil);

  return {
    onVacation,
    vacationUntil: onVacation && vacationUntil !== null ? vacationUntil.toISOString() : null,
  };
}

/** Estado actual, para la pantalla. No escribe nada. */
export async function getVacation(sellerUser: PublicUser): Promise<VacationStatus> {
  const profile = await requireOwnSellerProfile(sellerUser);

  return toStatus(profile.vacationUntil);
}

/**
 * Marca la ausencia hasta `until`, o la levanta con `null`.
 *
 * AUTORIZACION: el perfil se resuelve POR EL USUARIO AUTENTICADO
 * (`requireOwnSellerProfile`), nunca por un id del request. No hay forma de
 * poner de vacaciones a otro vendedor.
 *
 * `until` tiene que ser una fecha FUTURA: una pasada equivaldria a "no estoy
 * de vacaciones" y guardarla solo confundiria al panel. No hay tope maximo:
 * no esta documentado y ponerle uno seria inventar una regla.
 *
 * Queda en `audit_log` con el usuario como actor: es una decision del
 * vendedor que cambia que se puede comprar, y hay que poder reconstruir
 * desde cuando una publicacion dejo de verse.
 *
 * ⚠️ La pantalla o el endpoint que la llame tiene que consumir el rate limit
 * por usuario (`lib/rate-limit-actions.ts`), con un scope propio que hoy no
 * existe en `RateLimitScope`. Anotado en el reporte.
 */
export async function setVacation(
  sellerUser: PublicUser,
  until: Date | null,
  db?: Database,
): Promise<VacationStatus> {
  const profile = await requireOwnSellerProfile(sellerUser);

  if (until !== null && (Number.isNaN(until.getTime()) || !isOnVacationAt(until))) {
    throw errors.vacationDateInvalid();
  }

  // La fecha y su auditoria van juntas o no van: una ausencia sin rastro no
  // se puede reconstruir, y un rastro sin ausencia miente.
  const ejecutar = async (tx: Database): Promise<VacationStatus> => {
    const row = await vacationRepo.setVacationUntil(profile.id, until, tx);
    // El perfil existia una linea mas arriba; si desaparecio en el medio no hay
    // nada que informar distinto de "no tenes perfil".
    if (row === undefined) throw sellerErrors.sellerProfileNotFound();

    await audit.record(
      {
        actorType: 'user',
        actorId: sellerUser.id,
        action: until === null ? AUDIT_ACTION_VACATION_CLEARED : AUDIT_ACTION_VACATION_SET,
        entityType: 'seller_profile',
        entityId: profile.id,
        before: { vacationUntil: profile.vacationUntil?.toISOString() ?? null },
        after: { vacationUntil: row.vacationUntil?.toISOString() ?? null },
      },
      tx,
    );

    return toStatus(row.vacationUntil);
  };

  return db === undefined ? getDatabase().transaction(ejecutar) : ejecutar(db);
}

/** Acciones que quedan en `audit_log` (BR-052). */
export const AUDIT_ACTION_VACATION_SET = 'SELLER_VACATION_SET';
export const AUDIT_ACTION_VACATION_CLEARED = 'SELLER_VACATION_CLEARED';
