import { getDatabase, type Database } from '@offside/database';

import { CAPABILITIES, hasCapability } from '@/lib/permissions';

import * as audit from '../../audit/services/audit.service';
import * as authErrors from '../../auth/auth.errors';
import type { PublicUser } from '../../auth/services/auth.service';
import * as sanctionRepo from '../repositories/sanction.repository';
import * as sellerStatusRepo from '../repositories/seller-status.repository';
import * as errors from '../trust.errors';
import { emitHistoryEvent } from './history.service';
import {
  algunaBloqueaVenta,
  bloqueaVenta,
  estadoDelVendedorPara,
  rige,
  validarVentana,
} from './sanction-rules';

/**
 * Sanciones a vendedores (ERD §16.2, `trust-and-safety.md` §4.5/§5.5).
 *
 * Tres cosas pasan juntas, en UNA transaccion, cada vez que se aplica una:
 *
 *   1. la fila de `sanctions`;
 *   2. el estado del perfil (`suspended` / `expelled`) si el tipo lo cambia
 *      —`sanction-rules.ts` decide cuales—;
 *   3. el HECHO en `user_history_events` (DEC-036) y la fila de `audit_log`
 *      (ERD §16.2: "toda sancion → audit_log").
 *
 * Si una de las tres falla, no queda ninguna: un vendedor suspendido sin
 * rastro, o un rastro de una suspension que no ocurrio, son los dos errores
 * que este modulo existe para impedir.
 *
 * ⚠️ QUE SE LEVANTA Y QUE NO. `liftSanction` deshace una suspension —y
 * devuelve al vendedor al estado que tenia—, pero NO una expulsion: es
 * terminal (BR-004, `sanction-rules.ts`). Deshacer una expulsion queda por
 * SQL, igual que asignar roles: a proposito fuera de la aplicacion.
 */

export type SanctionType = sanctionRepo.SanctionType;
export type SanctionStatus = sanctionRepo.SanctionStatus;

const ENTITY_TYPE = 'sanction';
const REASON_MAX_LENGTH = 2_000;
const SANCTION_TYPES: readonly SanctionType[] = [
  'warning',
  'limitation',
  'suspension',
  'expulsion',
  'penalty',
];

export interface PublicSanction {
  id: string;
  sellerId: string;
  type: SanctionType;
  reason: string | null;
  disputeId: string | null;
  limitations: Record<string, unknown> | null;
  appliedBy: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: SanctionStatus;
  createdAt: string;
}

export function toPublicSanction(row: sanctionRepo.SanctionRow): PublicSanction {
  return {
    id: row.id,
    sellerId: row.sellerId,
    type: row.type,
    reason: row.reason,
    disputeId: row.disputeId,
    limitations: esObjetoPlano(row.limitations) ? row.limitations : null,
    appliedBy: row.appliedBy,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    // El ERD lo modela como `text` nullable; en el codigo nunca se escribe
    // otra cosa. Un null viejo se lee como `active` para fallar del lado
    // restrictivo.
    status: (row.status as SanctionStatus | null) ?? 'active',
    createdAt: row.createdAt.toISOString(),
  };
}

function esObjetoPlano(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

export interface ApplySanctionOptions {
  /** Disputa que la origina (ERD §16.2 `dispute_id`). */
  disputeId?: string | null | undefined;
  /** Vencimiento. Ausente o null = sin vencimiento. */
  endsAt?: Date | null | undefined;
  /** Que restringe una `limitation`. 🟡 sin semantica definida: solo se guarda. */
  limitations?: Record<string, unknown> | null | undefined;
}

interface Actor {
  id: string;
}

/**
 * Aplica una sancion. Capacidad `trust:moderate` (DEC-023).
 *
 * ⚠️ VERIFICA LA CAPACIDAD ACA ADEMAS DEL BORDE: una Server Action es
 * alcanzable por POST directo, y este Service es el que mueve el estado de un
 * vendedor. Autorizar dos veces con el MISMO mapa no duplica politica.
 */
export async function applySanction(
  admin: PublicUser,
  sellerId: string,
  type: SanctionType,
  reason: string,
  options: ApplySanctionOptions = {},
): Promise<PublicSanction> {
  if (!hasCapability(admin.adminRole, CAPABILITIES.TRUST_MODERATE)) throw authErrors.forbidden();

  return getDatabase().transaction((tx) =>
    aplicar({ id: admin.id }, sellerId, type, reason, options, tx),
  );
}

/**
 * Sancion que NACE de la resolucion de una disputa (TS-054 / §5.5).
 *
 * NO verifica `trust:moderate`: quien llama es `disputes.resolve`, que ya
 * exigio `disputes:resolve`, y la sancion es un EFECTO de esa resolucion, no
 * una decision aparte. Exige la transaccion de la resolucion en `db` para que
 * disputa y sancion queden juntas o ninguna.
 */
export async function applySanctionFromDispute(
  admin: PublicUser,
  sellerId: string,
  type: Extract<SanctionType, 'penalty' | 'suspension'>,
  reason: string,
  disputeId: string,
  db: Database,
): Promise<PublicSanction> {
  return aplicar({ id: admin.id }, sellerId, type, reason, { disputeId }, db);
}

async function aplicar(
  actor: Actor,
  sellerId: string,
  type: SanctionType,
  reason: string,
  options: ApplySanctionOptions,
  db: Database,
): Promise<PublicSanction> {
  if (!SANCTION_TYPES.includes(type)) throw errors.sanctionInvalid('Tipo de sanción desconocido');

  const motivo = typeof reason === 'string' ? reason.trim() : '';
  if (motivo.length === 0) throw errors.sanctionInvalid('La sanción necesita un motivo');
  if (motivo.length > REASON_MAX_LENGTH) {
    throw errors.sanctionInvalid(`El motivo admite hasta ${REASON_MAX_LENGTH} caracteres`);
  }

  if (
    options.limitations !== undefined &&
    options.limitations !== null &&
    !esObjetoPlano(options.limitations)
  ) {
    throw errors.sanctionInvalid('Las limitaciones tienen que ser un objeto');
  }

  const now = new Date();
  const ventana = validarVentana(now, options.endsAt);
  if (!ventana.ok) throw errors.sanctionInvalid(ventana.motivo);

  const seller = await sellerStatusRepo.findSeller(sellerId, db);
  if (seller === undefined) throw errors.sellerNotFound();
  // Terminal: sobre un expulsado no hay nada mas que aplicar (BR-004).
  if (seller.status === 'expelled') throw errors.sanctionInvalid('El vendedor ya está expulsado');

  const row = await sanctionRepo.insertActive(
    {
      sellerId,
      type,
      reason: motivo,
      disputeId: options.disputeId ?? null,
      limitations: options.limitations ?? null,
      appliedBy: actor.id,
      startsAt: ventana.ventana.startsAt,
      endsAt: ventana.ventana.endsAt,
    },
    db,
  );

  // El estado del perfil cambia SOLO si el tipo lo pide. Un vendedor ya
  // suspendido que recibe otra suspension conserva el estado: `transitionStatus`
  // devuelve `undefined` y no es un error.
  const nuevoEstado = estadoDelVendedorPara(type);
  let estadoFinal: sellerStatusRepo.SellerStatus = seller.status;
  if (nuevoEstado !== null && seller.status !== nuevoEstado) {
    /*
     * ⚠️ `expelled` NO ESTA EN LOS ESTADOS DE ORIGEN, y es deliberado: la
     * expulsion es terminal (seller-system.md §6). Un vendedor expulsado no
     * baja a suspendido por una sancion nueva; `transitionStatus` no encuentra
     * la fila, devuelve `undefined` y el estado queda como estaba.
     */
    const cambiado = await sellerStatusRepo.transitionStatus(
      sellerId,
      ['pending', 'approved', 'limited', 'suspended'] as const,
      nuevoEstado,
      db,
    );
    if (cambiado !== undefined) estadoFinal = cambiado.status;
  }

  // HECHO de confianza (DEC-036): suspender/expulsar es `ACCOUNT_SUSPENDED`;
  // aviso, limitacion y penalizacion son una infraccion confirmada. ASUMIDO:
  // el enum no tiene un valor por tipo de sancion y no se agregan valores.
  await emitHistoryEvent(
    {
      userId: seller.userId,
      eventType: bloqueaVenta(type) ? 'ACCOUNT_SUSPENDED' : 'POLICY_VIOLATION_CONFIRMED',
      role: 'seller',
      refEntityType: ENTITY_TYPE,
      refEntityId: row.id,
      data: {
        sanctionType: type,
        disputeId: options.disputeId ?? null,
        endsAt: ventana.ventana.endsAt?.toISOString() ?? null,
      },
    },
    db,
  );

  await audit.record(
    {
      actorType: 'admin',
      actorId: actor.id,
      action: 'SANCTION_APPLIED',
      entityType: ENTITY_TYPE,
      entityId: row.id,
      before: { sellerStatus: seller.status },
      after: { sellerStatus: estadoFinal, sanctionStatus: 'active' },
      metadata: {
        sellerId,
        type,
        reason: motivo,
        disputeId: options.disputeId ?? null,
        endsAt: ventana.ventana.endsAt?.toISOString() ?? null,
      },
    },
    db,
  );

  return toPublicSanction(row);
}

/**
 * Levanta una sancion vigente. Capacidad `trust:moderate`.
 *
 * Si era una suspension y no queda OTRA sancion bloqueante vigente, el
 * vendedor vuelve al estado que tenia: `approved` si alguna vez fue aprobado,
 * `pending` si no. ⚠️ ASUMIDO: el ERD no guarda el estado previo; `approved_at`
 * es la unica pista y es suficiente para los estados que existen hoy.
 */
export async function liftSanction(
  admin: PublicUser,
  sanctionId: string,
  motivo: string,
): Promise<PublicSanction> {
  if (!hasCapability(admin.adminRole, CAPABILITIES.TRUST_MODERATE)) throw authErrors.forbidden();

  const razon = typeof motivo === 'string' ? motivo.trim() : '';
  if (razon.length === 0) throw errors.sanctionInvalid('Levantar una sanción necesita un motivo');
  if (razon.length > REASON_MAX_LENGTH) {
    throw errors.sanctionInvalid(`El motivo admite hasta ${REASON_MAX_LENGTH} caracteres`);
  }

  return getDatabase().transaction(async (tx) => {
    const actual = await sanctionRepo.findById(sanctionId, tx);
    if (actual === undefined) throw errors.sanctionNotFound();
    if (actual.type === 'expulsion') throw errors.sanctionInvalid('La expulsión es definitiva');

    const levantada = await sanctionRepo.transitionFromActive(sanctionId, 'lifted', tx);
    if (levantada === undefined) throw errors.sanctionNotActive();

    const seller = await sellerStatusRepo.findSeller(actual.sellerId, tx);
    const restaurado = seller === undefined ? null : await restaurarSiCorresponde(seller, tx);

    await audit.record(
      {
        actorType: 'admin',
        actorId: admin.id,
        action: 'SANCTION_LIFTED',
        entityType: ENTITY_TYPE,
        entityId: sanctionId,
        before: { sanctionStatus: 'active', sellerStatus: seller?.status ?? null },
        after: { sanctionStatus: 'lifted', sellerStatus: restaurado ?? seller?.status ?? null },
        metadata: { sellerId: actual.sellerId, type: actual.type, reason: razon },
      },
      tx,
    );

    return toPublicSanction(levantada);
  });
}

/**
 * Devuelve al vendedor su estado si ya no lo bloquea ninguna sancion vigente.
 * Devuelve el estado nuevo, o `null` si no habia nada que restaurar.
 */
async function restaurarSiCorresponde(
  seller: sellerStatusRepo.SellerIdentity,
  db: Database,
): Promise<sellerStatusRepo.SellerStatus | null> {
  if (seller.status !== 'suspended') return null;

  const vigentes = await sanctionRepo.findActiveBySellerId(seller.id, db);
  if (algunaBloqueaVenta(vigentes, new Date())) return null;

  const destino: sellerStatusRepo.SellerStatus =
    seller.approvedAt !== null ? 'approved' : 'pending';
  const cambiado = await sellerStatusRepo.transitionStatus(seller.id, ['suspended'], destino, db);

  return cambiado?.status ?? null;
}

/** Todas las sanciones de un vendedor, de la mas nueva a la mas vieja. NO autoriza. */
export async function listSanctions(sellerId: string, db?: Database): Promise<PublicSanction[]> {
  const rows = await sanctionRepo.findBySellerId(sellerId, db);

  return rows.map(toPublicSanction);
}

export interface SellerSanctionState {
  /** Tiene alguna sancion vigente, del tipo que sea. */
  sancionado: boolean;
  /** Alguna sancion vigente le quita la capacidad de vender. */
  bloqueaVenta: boolean;
}

/**
 * Estado sancionatorio del vendedor, AHORA.
 *
 * Es el predicado que `sellers.canSell()` tiene que consultar (ver
 * NECESITA-DE-OTROS): hoy `canSell` mira solo `seller_profiles.status`, que
 * `suspension`/`expulsion` ya materializan. Esto lo hace explicito y ademas
 * mira la fecha, asi que una suspension vencida que el barrido todavia no
 * marco `expired` ya no bloquea.
 */
export async function isSellerSanctioned(
  sellerId: string,
  db?: Database,
): Promise<SellerSanctionState> {
  const activas = await sanctionRepo.findActiveBySellerId(sellerId, db);
  const now = new Date();

  return {
    sancionado: activas.some((s) => rige(s, now)),
    bloqueaVenta: algunaBloqueaVenta(activas, now),
  };
}

/**
 * Barrido: marca `expired` las sanciones vencidas y devuelve al vendedor su
 * estado cuando la que vencio era la ultima que lo bloqueaba. Para un job
 * (ver NECESITA-DE-OTROS). Devuelve cuantas expiraron.
 *
 * Una por transaccion: que una falle no deja a las demas sin expirar.
 */
export async function expireSanctions(now = new Date(), limit = 100): Promise<number> {
  const vencidas = await sanctionRepo.findActiveEndedBefore(now, limit);
  let expiradas = 0;

  for (const sancion of vencidas) {
    const hecho = await getDatabase().transaction(async (tx) => {
      const [expirada] = await sanctionRepo.expireMany([sancion.id], tx);
      if (expirada === undefined) return false;

      const seller = await sellerStatusRepo.findSeller(sancion.sellerId, tx);
      const restaurado = seller === undefined ? null : await restaurarSiCorresponde(seller, tx);

      await audit.record(
        {
          actorType: 'system',
          action: 'SANCTION_EXPIRED',
          entityType: ENTITY_TYPE,
          entityId: sancion.id,
          before: { sanctionStatus: 'active', sellerStatus: seller?.status ?? null },
          after: { sanctionStatus: 'expired', sellerStatus: restaurado ?? seller?.status ?? null },
          metadata: {
            sellerId: sancion.sellerId,
            type: sancion.type,
            ...(sancion.endsAt === null ? {} : { endsAt: sancion.endsAt.toISOString() }),
          },
        },
        tx,
      );

      return true;
    });

    if (hecho) expiradas += 1;
  }

  return expiradas;
}
