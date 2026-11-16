import { getDatabase } from '@offside/database';

import * as audit from '../../audit/services/audit.service';
import type { PublicUser } from '../../auth/services/auth.service';
import { CAPABILITIES, hasCapability } from '../../../lib/permissions';
import * as catalogRepo from '../repositories/catalog.repository';
import * as errors from '../listings.errors';
import { normalizar } from './catalogo-por-nombre';

/**
 * MODERACION DEL CATALOGO CONTROLADO (DEC-041).
 *
 * ⚠️ ES LA SEGUNDA MITAD DE LO QUE SE ABRIO EL 2026-11-10. Desde que el
 * formulario dejo de ser una lista cerrada, quien publica puede PROPONER un
 * club o una marca que no existe; sin esto, esas propuestas se acumulan y
 * "lo proponemos al catálogo" es una promesa que no cumple nadie.
 *
 * ⚠️ LA REGLA DURA DE LA TABLA: la solicitud NO modifica el catalogo. Solo la
 * APROBACION crea la entidad, y su id queda en `created_entity_id`. Esto la
 * respeta: nada escribe en `clubs` fuera de `aprobar`.
 *
 * ⚠️ APROBAR ES UNA DECISION ADMINISTRATIVA Y SE AUDITA (BR-052). Decide que
 * entidades existen en el sitio: `product-specification.md` §11 marca los datos
 * sucios como el riesgo que mata la busqueda facetada, asi que cada alta tiene
 * que poder rastrearse hasta quien la aprobo.
 */

export interface SolicitudDeCatalogo {
  id: string;
  /** `club`, `national_team`, `brand`… */
  targetType: catalogRepo.CatalogTargetType;
  /** El nombre propuesto, tal como se escribio. */
  nombre: string;
  /** La publicacion que la origino, si vino en el payload. */
  listingId: string | null;
  requesterEmail: string;
  createdAt: string;
}

/**
 * ⚠️ LA CAPACIDAD SE EXIGE EN EL SERVICE, NO SOLO EN LA PANTALLA. La pantalla
 * del back-office ya devuelve 404 sin capacidad, pero cada Server Action es
 * alcanzable por POST directo: que la pagina haya decidido mostrarla no protege
 * a la operacion.
 */
function exigirCapacidad(user: PublicUser): void {
  if (!hasCapability(user.adminRole, CAPABILITIES.CATALOG_MODERATE)) {
    throw errors.sinCapacidadDeCatalogo();
  }
}

/** Lee `{ name, listingId, campo }` sin confiar en que esten. */
function leerPayload(payload: unknown): { nombre: string; listingId: string | null } {
  if (typeof payload !== 'object' || payload === null) return { nombre: '', listingId: null };

  const datos = payload as Record<string, unknown>;

  return {
    nombre: typeof datos.name === 'string' ? datos.name : '',
    listingId: typeof datos.listingId === 'string' ? datos.listingId : null,
  };
}

function aPublica(fila: catalogRepo.SolicitudDeCatalogoRow): SolicitudDeCatalogo {
  const { nombre, listingId } = leerPayload(fila.payload);

  return {
    id: fila.id,
    targetType: fila.targetType,
    nombre,
    listingId,
    requesterEmail: fila.requesterEmail,
    createdAt: fila.createdAt.toISOString(),
  };
}

/** La cola de propuestas sin resolver. */
export async function listPendingCatalogRequests(user: PublicUser): Promise<SolicitudDeCatalogo[]> {
  exigirCapacidad(user);

  const filas = await catalogRepo.findPendingRequests();

  return filas.map(aPublica);
}

/**
 * El `slug` con el que entra al catalogo.
 *
 * ⚠️ SE DERIVA DEL NOMBRE Y ES UNIQUE: es lo que impide que "River Plate"
 * aprobado dos veces deje dos clubes. Se reusa `normalizar` —el mismo que
 * resuelve lo que se escribe— para que el slug y la busqueda coincidan por
 * construccion; los guiones se arman aparte para que siga siendo legible.
 */
export function slugDe(nombre: string): string {
  const limpio = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return limpio === '' ? normalizar(nombre) : limpio;
}

/**
 * Aprueba una propuesta: crea la entidad y engancha la publicacion.
 *
 * ⚠️ EL NOMBRE SE PUEDE CORREGIR AL APROBAR. Quien publica escribe
 * "deportivo moron" y lo que entra al catalogo es "Deportivo Morón": el alta la
 * decide quien modera, no el texto crudo. Sin esto, la unica salida ante un
 * nombre mal escrito seria rechazar y pedirle que lo escriba de nuevo.
 *
 * ⚠️ TODO EN UNA TRANSACCION. Crear el club, cerrar la solicitud y enganchar la
 * publicacion son un solo hecho: a medias quedaria un club sin solicitud que lo
 * explique, o una solicitud aprobada cuya entidad no existe.
 */
export async function approveCatalogRequest(
  user: PublicUser,
  requestId: string,
  nombreFinal?: string,
): Promise<void> {
  exigirCapacidad(user);

  const solicitud = await catalogRepo.findRequestById(requestId);
  if (solicitud === undefined) throw errors.solicitudNoEncontrada();
  if (solicitud.status !== 'PENDING') throw errors.solicitudYaResuelta();

  const catalogo = catalogRepo.catalogoDeTarget(solicitud.targetType);
  /*
   * ⚠️ EL ENUM TIENE SIETE DESTINOS Y EL FORMULARIO SOLO PROPONE TRES. Una
   * solicitud de `country` o `size_chart` no se puede aprobar desde aca, y
   * decirlo es mejor que crear la entidad en la tabla equivocada.
   */
  if (catalogo === undefined) throw errors.catalogoNoModerable(solicitud.targetType);

  const { nombre, listingId } = leerPayload(solicitud.payload);
  const elegido = (nombreFinal ?? nombre).trim();
  if (elegido === '') throw errors.catalogAmbiguo('nombre', []);

  await getDatabase().transaction(async (tx) => {
    const entityId = await catalogRepo.insertCatalogEntity(
      catalogo,
      { name: elegido, slug: slugDe(elegido) },
      tx,
    );

    const cerrada = await catalogRepo.resolveRequest(
      solicitud.id,
      { status: 'APPROVED', reviewedBy: user.id, reviewNote: null, createdEntityId: entityId },
      tx,
    );
    // Otro moderador la cerro entre la lectura y el UPDATE: se revierte todo.
    if (cerrada === undefined) throw errors.solicitudYaResuelta();

    /*
     * ⚠️ SOLO LOS TRES CATALOGOS QUE LA PUBLICACION TIENE COMO COLUMNA. El
     * `NombreDeCatalogo` incluye competicion y temporada, que hoy no se
     * proponen desde el formulario; el `if` lo deja explicito en vez de confiar
     * en que nunca llegue.
     */
    if (
      listingId !== null &&
      (catalogo === 'club' || catalogo === 'nationalTeam' || catalogo === 'brand')
    ) {
      await catalogRepo.attachCatalogToListing(listingId, catalogo, entityId, tx);
    }

    await audit.record(
      {
        actorType: 'user',
        actorId: user.id,
        action: 'CATALOG_REQUEST_APPROVED',
        entityType: 'catalog_change_request',
        entityId: solicitud.id,
        after: { targetType: solicitud.targetType, name: elegido, createdEntityId: entityId },
        ...(listingId === null ? {} : { metadata: { listingId } }),
      },
      tx,
    );
  });
}

/**
 * Rechaza una propuesta.
 *
 * ⚠️ EL MOTIVO ES OBLIGATORIO, como dice la tabla. Un rechazo sin motivo es
 * indistinguible de un error, y la publicacion del otro lado queda sin club sin
 * que nadie pueda explicar por que.
 */
export async function rejectCatalogRequest(
  user: PublicUser,
  requestId: string,
  motivo: string,
): Promise<void> {
  exigirCapacidad(user);

  const nota = motivo.trim();
  if (nota === '') throw errors.motivoRequerido();

  const cerrada = await getDatabase().transaction(async (tx) => {
    const fila = await catalogRepo.resolveRequest(
      requestId,
      { status: 'REJECTED', reviewedBy: user.id, reviewNote: nota, createdEntityId: null },
      tx,
    );
    if (fila === undefined) return undefined;

    await audit.record(
      {
        actorType: 'user',
        actorId: user.id,
        action: 'CATALOG_REQUEST_REJECTED',
        entityType: 'catalog_change_request',
        entityId: requestId,
        after: { status: 'REJECTED' },
        metadata: { reviewNote: nota },
      },
      tx,
    );

    return fila;
  });

  if (cerrada === undefined) throw errors.solicitudYaResuelta();
}
