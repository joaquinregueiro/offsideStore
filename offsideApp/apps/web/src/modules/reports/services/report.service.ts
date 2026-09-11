import { getDatabase } from '@offside/database';

import { CAPABILITIES, hasCapability } from '../../../lib/permissions';
import * as audit from '../../audit/services/audit.service';
import { forbidden } from '../../auth/auth.errors';
import type { PublicUser } from '../../auth/services/auth.service';
import * as errors from '../reports.errors';
import * as reportRepo from '../repositories/report.repository';

/**
 * Denuncias de publicaciones hechas por usuarios (`trust-and-safety.md`:
 * "marcas/flags de autenticidad dudosa").
 *
 * Una denuncia es UNA PERSONA diciendo algo sobre UNA PUBLICACION; despues
 * moderacion decide. Este Service hace exactamente eso y nada mas:
 *
 * ⚠️ NO MODERA AUTOMATICAMENTE. Ni pausa la publicacion, ni toca
 * `moderation_status`, ni sanciona al vendedor, ni emite `risk_events`, por
 * mas denuncias que junte. La politica de moderacion sigue 🟡 (DEC-045 es
 * transitoria; TS-042 tiene umbrales sin definir) y decidirla desde el codigo
 * seria inventarla. Lo que hace moderacion con la publicacion es otra
 * operacion, de otro modulo.
 *
 * ⚠️ CAPACIDAD: leer la cola y resolver exigen `trust:moderate` (DEC-023),
 * que existe en `lib/permissions.ts` para MODERATOR, ADMIN y SUPER_ADMIN.
 * Denunciar no exige ninguna: cualquier cuenta verificada puede.
 */

/**
 * Motivos de denuncia. LISTA CERRADA, validada en la app: `reason` es `text`
 * sin CHECK porque el vocabulario es de producto y sigue 🟡. ASUMIDO —se
 * eligieron los motivos que `trust-and-safety.md` y RISK-FR1 nombran
 * (falsificacion, engaño) mas los genericos de cualquier marketplace—,
 * pendiente de confirmacion del owner. Agregar uno es un cambio MENOR.
 */
export const REPORT_REASONS = [
  { codigo: 'falsificacion', etiqueta: 'Es una réplica o falsificación vendida como original' },
  { codigo: 'fotos_ajenas', etiqueta: 'Las fotos no son del producto' },
  { codigo: 'descripcion_enganosa', etiqueta: 'La descripción o el precio son engañosos' },
  { codigo: 'categoria_incorrecta', etiqueta: 'Está en la categoría equivocada' },
  { codigo: 'contenido_inapropiado', etiqueta: 'Tiene contenido ofensivo o inapropiado' },
  { codigo: 'otro', etiqueta: 'Otro motivo' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['codigo'];

export function isReportReason(valor: string): valor is ReportReason {
  return REPORT_REASONS.some((r) => r.codigo === valor);
}

/** Techo de la nota. Es una denuncia, no un expediente. */
export const NOTE_MAX_LENGTH = 1_000;

/** Cuantas abiertas trae la cola de una vez. */
export const OPEN_REPORTS_LIMIT = 100;

const ENTITY_TYPE = 'listing_report';

export interface PublicReport {
  id: string;
  listingId: string;
  reason: string;
  note: string | null;
  status: reportRepo.ReportStatus;
  createdAt: string;
  reviewedAt: string | null;
}

export interface OpenReport extends PublicReport {
  reporterId: string;
  listingTitle: string;
  listingStatus: string;
  sellerId: string;
  sellerDisplayName: string;
}

export function toPublicReport(row: reportRepo.ReportRow): PublicReport {
  return {
    id: row.id,
    listingId: row.listingId,
    reason: row.reason,
    note: row.note,
    status: row.status as reportRepo.ReportStatus,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

/** Normaliza la nota. FUNCION PURA. `otro` exige explicar que. */
export function validateReportNote(
  reason: ReportReason,
  note: string | null | undefined,
): string | null {
  const limpia = (note ?? '').replace(/\s+/g, ' ').trim();

  if (limpia.length > NOTE_MAX_LENGTH) {
    throw errors.reportInvalid(`La nota no puede superar los ${NOTE_MAX_LENGTH} caracteres`);
  }

  if (reason === 'otro' && limpia === '') {
    throw errors.reportInvalid('Contanos cuál es el motivo');
  }

  return limpia === '' ? null : limpia;
}

/**
 * Denuncia una publicacion. UNA por persona y publicacion: repetirla con
 * otro motivo EDITA la denuncia abierta en vez de sumar otra —un solo
 * usuario no puede hacer que una publicacion parezca denunciada por cien—.
 * Si moderacion ya la resolvio, no se reabre.
 */
export async function reportListing(
  user: PublicUser,
  listingId: string,
  reason: string,
  note?: string | null,
): Promise<PublicReport> {
  if (!isReportReason(reason)) throw errors.invalidReason();

  const listing = await reportRepo.findListingOwner(listingId);
  if (listing === undefined || listing.status === 'deleted') throw errors.listingNotFound();
  if (listing.sellerUserId === user.id) throw errors.cannotReportOwnListing();

  const row = await reportRepo.upsertOpen({
    listingId: listing.id,
    reporterId: user.id,
    reason,
    note: validateReportNote(reason, note),
  });
  if (row === undefined) throw errors.alreadyReported();

  return toPublicReport(row);
}

function requireModerator(user: PublicUser): void {
  if (!hasCapability(user.adminRole, CAPABILITIES.TRUST_MODERATE)) throw forbidden();
}

/** La cola de moderacion. Exige `trust:moderate`. */
export async function listOpenReports(admin: PublicUser): Promise<OpenReport[]> {
  requireModerator(admin);

  const rows = await reportRepo.findOpen(OPEN_REPORTS_LIMIT);

  return rows.map((row) => ({
    ...toPublicReport(row),
    reporterId: row.reporterId,
    listingTitle: row.listingTitle,
    listingStatus: row.listingStatus,
    sellerId: row.sellerId,
    sellerDisplayName: row.sellerDisplayName,
  }));
}

/** Cuantas abiertas. Para el indice del back-office. Exige `trust:moderate`. */
export async function countOpenReports(admin: PublicUser): Promise<number> {
  requireModerator(admin);

  return reportRepo.countOpen();
}

/** Cuantas denuncias abiertas tiene una publicacion. Para la ficha de moderacion. */
export async function countOpenReportsForListing(
  admin: PublicUser,
  listingId: string,
): Promise<number> {
  requireModerator(admin);

  return reportRepo.countOpenByListingId(listingId);
}

export type ReportDecision = 'reviewed' | 'dismissed';

/**
 * Resuelve una denuncia: `reviewed` (se atendio) o `dismissed` (se
 * descarto). Exige `trust:moderate`.
 *
 * ⚠️ LA NOTA DEL MODERADOR VA A `audit_log`, NO A LA FILA: `listing_reports.note`
 * es lo que dijo quien denuncio y no se pisa. La decision es una accion
 * administrativa sobre una entidad de otro —igual que un reembolso— y por
 * eso se audita, en la MISMA transaccion: sin rastro, la operacion no vale.
 *
 * Lo que se hace con la publicacion es otra cosa (`listings.moderation_status`,
 * `sanctions`) y no pasa por aca: ver el encabezado del archivo.
 */
export async function reviewReport(
  admin: PublicUser,
  reportId: string,
  decision: ReportDecision,
  note?: string | null,
): Promise<PublicReport> {
  requireModerator(admin);

  if (decision !== 'reviewed' && decision !== 'dismissed') {
    throw errors.reportInvalid('La decisión tiene que ser "reviewed" o "dismissed"');
  }

  const notaModerador = (note ?? '').trim();
  if (notaModerador.length > NOTE_MAX_LENGTH) {
    throw errors.reportInvalid(`La nota no puede superar los ${NOTE_MAX_LENGTH} caracteres`);
  }

  const row = await getDatabase().transaction(async (tx) => {
    const resuelta = await reportRepo.review(
      reportId,
      { status: decision, reviewedBy: admin.id },
      tx,
    );
    if (resuelta === undefined) throw errors.reportNotOpen();

    await audit.record(
      {
        actorType: 'admin',
        actorId: admin.id,
        action: 'LISTING_REPORT_REVIEWED',
        entityType: ENTITY_TYPE,
        entityId: resuelta.id,
        before: { status: 'open' },
        after: { status: decision },
        metadata: {
          listingId: resuelta.listingId,
          reason: resuelta.reason,
          ...(notaModerador === '' ? {} : { moderatorNote: notaModerador }),
        },
      },
      tx,
    );

    return resuelta;
  });

  return toPublicReport(row);
}
