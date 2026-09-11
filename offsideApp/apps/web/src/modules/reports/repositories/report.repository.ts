import { getDatabase, schema, type Database } from '@offside/database';
import { and, asc, count, eq, isNull } from 'drizzle-orm';

/**
 * Acceso a `listing_reports` (delta al ERD v1.3, 2026-09-10). Sin reglas de
 * negocio.
 *
 * `status` es `text` con CHECK (`open | reviewed | dismissed`) y `reason` es
 * `text` sin CHECK: el vocabulario lo valida el Service contra
 * `REPORT_REASONS`.
 */

export type ReportRow = typeof schema.listingReports.$inferSelect;
export type ReportStatus = 'open' | 'reviewed' | 'dismissed';

const conn = (db?: Database): Database => db ?? getDatabase();

/** Publicacion NO eliminada con el usuario dueño, para no denunciarse a si mismo. */
export async function findListingOwner(
  listingId: string,
  db?: Database,
): Promise<{ id: string; title: string; sellerUserId: string; status: string } | undefined> {
  const [row] = await conn(db)
    .select({
      id: schema.listings.id,
      title: schema.listings.title,
      sellerUserId: schema.sellerProfiles.userId,
      status: schema.listings.status,
    })
    .from(schema.listings)
    .innerJoin(schema.sellerProfiles, eq(schema.listings.sellerId, schema.sellerProfiles.id))
    .where(and(eq(schema.listings.id, listingId), isNull(schema.listings.deletedAt)))
    .limit(1);

  return row;
}

export interface UpsertReportValues {
  listingId: string;
  reporterId: string;
  reason: string;
  note: string | null;
}

/**
 * Inserta la denuncia, o ACTUALIZA motivo y nota si la persona ya habia
 * denunciado esa publicacion y la denuncia sigue abierta.
 *
 * `UNIQUE(listing_id, reporter_id)` es la regla "una por persona y
 * publicacion"; el `ON CONFLICT ... WHERE status = 'open'` es lo que permite
 * cambiar de motivo sin crear otra fila —"si quiere cambiar el motivo, edita
 * la fila", dice el esquema— y lo que impide reabrir una ya revisada: en ese
 * caso no se actualiza nada y se devuelve `undefined`.
 */
export async function upsertOpen(
  values: UpsertReportValues,
  db?: Database,
): Promise<ReportRow | undefined> {
  const [row] = await conn(db)
    .insert(schema.listingReports)
    .values({ ...values, status: 'open' })
    .onConflictDoUpdate({
      target: [schema.listingReports.listingId, schema.listingReports.reporterId],
      set: { reason: values.reason, note: values.note },
      setWhere: eq(schema.listingReports.status, 'open'),
    })
    .returning();

  return row;
}

export async function findById(id: string, db?: Database): Promise<ReportRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.listingReports)
    .where(eq(schema.listingReports.id, id))
    .limit(1);

  return row;
}

/** Una denuncia abierta con lo que moderacion necesita ver de un vistazo. */
export interface OpenReportRow extends ReportRow {
  listingTitle: string;
  listingStatus: string;
  sellerId: string;
  sellerDisplayName: string;
}

/**
 * La cola de moderacion: abiertas, la mas vieja primero. Acotada por
 * `limite`: es una pantalla, no una exportacion.
 */
export async function findOpen(limite: number, db?: Database): Promise<OpenReportRow[]> {
  const filas = await conn(db)
    .select({
      denuncia: schema.listingReports,
      listingTitle: schema.listings.title,
      listingStatus: schema.listings.status,
      sellerId: schema.listings.sellerId,
      sellerDisplayName: schema.sellerProfiles.displayName,
    })
    .from(schema.listingReports)
    .innerJoin(schema.listings, eq(schema.listingReports.listingId, schema.listings.id))
    .innerJoin(schema.sellerProfiles, eq(schema.listings.sellerId, schema.sellerProfiles.id))
    .where(eq(schema.listingReports.status, 'open'))
    .orderBy(asc(schema.listingReports.createdAt), asc(schema.listingReports.id))
    .limit(limite);

  return filas.map((fila) => ({
    ...fila.denuncia,
    listingTitle: fila.listingTitle,
    listingStatus: fila.listingStatus,
    sellerId: fila.sellerId,
    sellerDisplayName: fila.sellerDisplayName,
  }));
}

export async function countOpen(db?: Database): Promise<number> {
  const [fila] = await conn(db)
    .select({ cantidad: count() })
    .from(schema.listingReports)
    .where(eq(schema.listingReports.status, 'open'));

  return Number(fila?.cantidad ?? 0);
}

/** Cuantas denuncias ABIERTAS tiene una publicacion. */
export async function countOpenByListingId(listingId: string, db?: Database): Promise<number> {
  const [fila] = await conn(db)
    .select({ cantidad: count() })
    .from(schema.listingReports)
    .where(
      and(eq(schema.listingReports.listingId, listingId), eq(schema.listingReports.status, 'open')),
    );

  return Number(fila?.cantidad ?? 0);
}

/**
 * Resuelve una denuncia. CONDICIONADO a `status = 'open'`: dos moderadores
 * sobre la misma fila no se pisan; el segundo ve `undefined`.
 */
export async function review(
  id: string,
  values: { status: 'reviewed' | 'dismissed'; reviewedBy: string },
  db?: Database,
): Promise<ReportRow | undefined> {
  const [row] = await conn(db)
    .update(schema.listingReports)
    .set({ status: values.status, reviewedBy: values.reviewedBy, reviewedAt: new Date() })
    .where(and(eq(schema.listingReports.id, id), eq(schema.listingReports.status, 'open')))
    .returning();

  return row;
}
