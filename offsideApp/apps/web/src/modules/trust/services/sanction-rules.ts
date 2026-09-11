import type { SanctionRow, SanctionType } from '../repositories/sanction.repository';
import type { SellerStatus } from '../repositories/seller-status.repository';

/**
 * Reglas PURAS de las sanciones (ERD §16.2, `trust-and-safety.md` §4.5/§5.5).
 *
 * Sin IO, para poder fijarlas con tests unitarios. El Service las aplica.
 */

/**
 * Que tipos de sancion QUITAN la capacidad de vender.
 *
 * ⚠️ SOLO DOS, y es la decision mas importante del modulo. `warning` y
 * `penalty` son un registro contra el vendedor —afectan reputacion y riesgo,
 * DEC-036— pero no lo sacan de la vitrina: si lo hicieran, un aviso seria
 * indistinguible de una suspension. `limitation` tampoco: el enum
 * `seller_status` tiene `limited`, pero la documentacion NO define que limita
 * (`mercadopago-connection.service.ts` lo señala con 🟡), asi que bloquear la
 * venta seria inventar esa regla. Lo que una limitacion restringe viaja en
 * `sanctions.limitations`, para que quien defina la politica lo lea de ahi.
 */
export const TIPOS_QUE_BLOQUEAN_VENTA: ReadonlySet<SanctionType> = new Set<SanctionType>([
  'suspension',
  'expulsion',
]);

export function bloqueaVenta(type: SanctionType): boolean {
  return TIPOS_QUE_BLOQUEAN_VENTA.has(type);
}

/**
 * Estado del perfil que produce cada tipo de sancion, o `null` si no lo toca.
 *
 * `expulsion` es TERMINAL (BR-004: la cuenta expulsada no vuelve); `suspension`
 * es reversible: `liftSanction` la deshace.
 */
export function estadoDelVendedorPara(type: SanctionType): SellerStatus | null {
  switch (type) {
    case 'suspension':
      return 'suspended';
    case 'expulsion':
      return 'expelled';
    case 'warning':
    case 'limitation':
    case 'penalty':
      return null;
  }
}

/**
 * Una sancion RIGE si esta `active` y su ventana incluye `now`.
 *
 * `ends_at` null = sin vencimiento. `starts_at` null se trata como "desde
 * siempre": es un dato viejo, no una sancion futura.
 */
export function rige(
  sanction: Pick<SanctionRow, 'status' | 'startsAt' | 'endsAt'>,
  now: Date,
): boolean {
  if (sanction.status !== 'active') return false;
  if (sanction.startsAt !== null && sanction.startsAt > now) return false;
  if (sanction.endsAt !== null && sanction.endsAt <= now) return false;

  return true;
}

/** Sancion `active` cuyo `ends_at` ya paso: candidata a `expired`. */
export function vencida(sanction: Pick<SanctionRow, 'status' | 'endsAt'>, now: Date): boolean {
  return sanction.status === 'active' && sanction.endsAt !== null && sanction.endsAt <= now;
}

/**
 * Si un vendedor tiene alguna sancion vigente que le impida vender.
 *
 * Es el predicado que `sellers.canSell()` tiene que consultar (ver
 * `necesitaDeOtros`): hoy `canSell` mira solo `seller_profiles.status`, que
 * `suspension`/`expulsion` ya ponen en `suspended`/`expelled`. Este predicado
 * lo hace explicito y cubre el dia en que una sancion bloqueante no
 * materialice el estado.
 */
export function algunaBloqueaVenta(sanctions: readonly SanctionRow[], now: Date): boolean {
  return sanctions.some((s) => rige(s, now) && bloqueaVenta(s.type));
}

export interface ValidacionDeVentana {
  startsAt: Date;
  endsAt: Date | null;
}

/**
 * Normaliza la ventana de una sancion nueva. Devuelve un motivo si es invalida.
 *
 * Un `endsAt` anterior al inicio seria una sancion que nace vencida: rastro sin
 * efecto, que es lo peor de los dos mundos.
 */
export function validarVentana(
  now: Date,
  endsAt: Date | null | undefined,
): { ok: true; ventana: ValidacionDeVentana } | { ok: false; motivo: string } {
  if (endsAt === undefined || endsAt === null)
    return { ok: true, ventana: { startsAt: now, endsAt: null } };

  if (Number.isNaN(endsAt.getTime())) return { ok: false, motivo: 'La fecha de fin no es válida' };
  if (endsAt <= now)
    return { ok: false, motivo: 'La fecha de fin tiene que ser posterior a ahora' };

  return { ok: true, ventana: { startsAt: now, endsAt } };
}
