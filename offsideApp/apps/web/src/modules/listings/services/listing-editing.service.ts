import { getDatabase } from '@offside/database';

import * as audit from '../../audit/services/audit.service';
import type { PublicUser } from '../../auth/services/auth.service';
import { requireOwnSellerProfile } from '../../sellers/services/seller.service';
import * as errors from '../listings.errors';
import * as imageRepo from '../repositories/listing-image.repository';
import * as listingRepo from '../repositories/listing.repository';
import { getShippingSettings } from './listing-settings.service';
import { toPublicListing, type PublicListing } from './listing.service';
import { reindex } from './search.service';
import { validateShippingDeclaration, type ShippingMode } from './shipping-declaration';

/**
 * Edicion y ciclo de vida de una publicacion (SS-040/041, SS-050/051).
 *
 * Vive aparte de `listing.service.ts` porque son responsabilidades distintas:
 * aquel PUBLICA y expone la vitrina; este modifica lo ya publicado, que es
 * donde estan las reglas de auditoria y de transicion de estados.
 *
 * ⚠️ AUTORIZACION: la publicacion se resuelve por el perfil del vendedor
 * autenticado, igual que en el resto del modulo. "No existe" y "no es tuya"
 * devuelven el MISMO error para que no se puedan enumerar publicaciones.
 *
 * ⚠️ QUE SE PUEDA EDITAR ES ⚙️ CONFIGURABLE y su valor sigue 🟡
 * (`configuration-registry.md` §8: "si se permite edicion posterior y cambios
 * de precio"). SS-040 dice que el vendedor PUEDE editar, asi que se implementa;
 * lo que NO existe todavia es la perilla para apagarlo desde Admin.
 */

const ENTITY_TYPE = 'listing';

/** Categoria que exige `kitType` y `sleeve` (ERD §9.1). */
const CATEGORIA_CAMISETA = 'camiseta';

async function requireOwnListing(user: PublicUser, listingId: string) {
  const seller = await requireOwnSellerProfile(user);
  const listing = await listingRepo.findById(listingId);

  if (listing?.sellerId !== seller.id) throw errors.listingNotFound();

  // Una publicacion eliminada es historia: no se edita ni se revive. Se
  // conserva porque `order_items` la referencia.
  if (listing.status === 'deleted') throw errors.listingDeleted();

  return listing;
}

export interface EditListingInput {
  title?: string;
  description?: string | null;
  priceAmount?: bigint;
  stock?: number;
  sizeValue?: string;
  condition?: listingRepo.ListingRow['condition'];
  kitType?: listingRepo.ListingRow['kitType'];
  sleeve?: listingRepo.ListingRow['sleeve'];
  /** Referencias de catalogo. Cambiarlas obliga a reindexar: llevan alias. */
  clubId?: string | null;
  nationalTeamId?: string | null;
  brandId?: string | null;
  competitionId?: string | null;
  seasonId?: string | null;
  /**
   * Envio declarado (delta §11).
   *
   * ⚠️ `undefined` SIGNIFICA "NO VINO EN EL FORMULARIO" Y CONSERVA LO QUE
   * HABIA, igual que los catalogos. Es la misma trampa del 2026-09-09: si un
   * campo ausente se leyera como "vaciar", corregir un typo en el titulo
   * dejaria la publicacion sin modo de envio.
   */
  shippingMode?: string | null;
  shippingCostAmount?: bigint | null;
}

/**
 * Edita una publicacion (SS-040).
 *
 * ⚠️ EL PRECIO Y LA CONDICION SE AUDITAN (BR-015, que es un MUST). El precio
 * ademas va a `listing_price_history` (ERD §9.3) porque su historia se consulta
 * como serie —cuanto costaba esto antes—, que es algo que `audit_log` no
 * responde bien.
 *
 * ⚠️ NO TOCA LAS ORDENES YA CREADAS (BR-023/SS-041). No hace falta ningun
 * cuidado especial: cada orden congelo su importe al crearse (DEC-030) y nunca
 * vuelve a leer el precio de la publicacion. Cambiar el precio hoy no puede
 * alterar lo que alguien ya pago, por construccion.
 *
 * ⚠️ NO PERMITE CAMBIAR DE CATEGORIA. Cambiarla puede volver obligatorios
 * atributos que la publicacion no tiene, y arrastra la validacion del ERD §9.1
 * a un caso que nadie pidio. Si hace falta, se publica de nuevo.
 */
export async function editListing(
  user: PublicUser,
  listingId: string,
  input: EditListingInput,
): Promise<PublicListing> {
  const listing = await requireOwnListing(user, listingId);

  // La regla del ERD §9.1 sigue valiendo despues de editar: si alguien intenta
  // dejar una camiseta sin tipo de kit o sin manga, se rechaza igual que al
  // publicar.
  const categoria = await listingRepo.findCategoryById(listing.categoryId);
  const kitType = input.kitType === undefined ? listing.kitType : input.kitType;
  const sleeve = input.sleeve === undefined ? listing.sleeve : input.sleeve;

  if (categoria?.code === CATEGORIA_CAMISETA && (kitType === null || sleeve === null)) {
    throw errors.missingShirtAttributes();
  }

  const precioCambio = input.priceAmount !== undefined && input.priceAmount !== listing.priceAmount;
  const condicionCambio = input.condition !== undefined && input.condition !== listing.condition;

  /*
   * ⚠️ EL ENVIO SE REVALIDA CONTRA EL CONFIG STORE, pero pasandole lo que la
   * publicacion YA TENIA: `validateShippingDeclaration` solo gobierna lo que
   * se ELIGE ahora. Si Admin apago `pickup` despues de que este vendedor lo
   * eligio, corregir el titulo no puede fallar por un campo que no se toco.
   */
  const tocaElEnvio = input.shippingMode !== undefined || input.shippingCostAmount !== undefined;
  const envio = tocaElEnvio
    ? validateShippingDeclaration(
        {
          ...(input.shippingMode === undefined ? {} : { shippingMode: input.shippingMode }),
          ...(input.shippingCostAmount === undefined
            ? {}
            : { shippingCostAmount: input.shippingCostAmount }),
        },
        await getShippingSettings(),
        {
          shippingMode: listing.shippingMode as ShippingMode,
          shippingCostAmount: listing.shippingCostAmount,
        },
      )
    : undefined;

  /*
   * ⚠️ SE QUITAN LOS CAMPOS CRUDOS DEL ENVIO Y SE PONEN LOS VALIDADOS. El
   * input los admite como `string | null` porque vienen de un `<select>`; el
   * repositorio exige el modo ya estrechado. Pasarle el crudo escribiria en la
   * columna lo que alguien haya mandado por POST.
   */
  const { shippingMode: _modoCrudo, shippingCostAmount: _costoCrudo, ...resto } = input;
  const cambios = envio === undefined ? resto : { ...resto, ...envio };

  const actualizada = await getDatabase().transaction(async (tx) => {
    const fila = await listingRepo.updateListing(listing.id, cambios, tx);
    if (fila === undefined) throw errors.listingNotFound();

    if (precioCambio) {
      await listingRepo.insertPriceChange(
        {
          listingId: listing.id,
          oldPriceAmount: listing.priceAmount,
          newPriceAmount: input.priceAmount!,
          currency: listing.currency,
          changedBy: user.id,
        },
        tx,
      );
    }

    // Se audita SOLO lo sensible (BR-015). Registrar cada correccion de un
    // typo en el titulo llenaria `audit_log` de ruido y haria mas dificil
    // encontrar lo que importa.
    if (precioCambio || condicionCambio) {
      await audit.record(
        {
          actorType: 'user',
          actorId: user.id,
          action: 'LISTING_UPDATED',
          entityType: ENTITY_TYPE,
          entityId: listing.id,
          before: {
            priceAmount: listing.priceAmount.toString(),
            condition: listing.condition,
          },
          after: {
            priceAmount: (input.priceAmount ?? listing.priceAmount).toString(),
            condition: input.condition ?? listing.condition,
          },
        },
        tx,
      );
    }

    return fila;
  });

  // El titulo y la descripcion alimentan el indice: si cambian y no se
  // reindexa, la busqueda sigue encontrando la version vieja.
  await reindex(actualizada.id);

  return toPublicListing(actualizada);
}

/**
 * Pausa una publicacion (SS-050). Deja de ser comprable.
 *
 * `isPurchasable` ya exige `status === 'active'`, asi que pausar la saca de la
 * vitrina sin ninguna regla adicional.
 */
export async function pauseListing(user: PublicUser, listingId: string): Promise<PublicListing> {
  const listing = await requireOwnListing(user, listingId);

  if (listing.status === 'paused') return toPublicListing(listing);
  if (listing.status !== 'active' && listing.status !== 'sold_out') {
    throw errors.listingNotPausable();
  }

  const fila = await listingRepo.updateListing(listing.id, { status: 'paused' });
  if (fila === undefined) throw errors.listingNotFound();

  return toPublicListing(fila);
}

/**
 * Reactiva una publicacion pausada (SS-050).
 *
 * ⚠️ VUELVE A EXIGIR PS-010. Reactivar es volver a la vitrina, y una
 * publicacion sin fotos no puede estar ahi. Sin esta comprobacion, borrar las
 * fotos con la publicacion pausada y reactivarla seria la puerta de atras a la
 * regla.
 *
 * ⚠️ SIN STOCK VUELVE A `sold_out`, no a `active` (SS-051): reactivar no
 * inventa unidades.
 */
export async function resumeListing(user: PublicUser, listingId: string): Promise<PublicListing> {
  const listing = await requireOwnListing(user, listingId);

  if (listing.status !== 'paused') throw errors.listingNotResumable();

  if ((await imageRepo.countByListingId(listing.id)) === 0) {
    throw errors.imageRequiredToPublish();
  }

  const destino = listing.stock >= 1 ? 'active' : 'sold_out';
  const fila = await listingRepo.updateListing(listing.id, { status: destino });
  if (fila === undefined) throw errors.listingNotFound();

  return toPublicListing(fila);
}

/**
 * Elimina una publicacion (SS-050).
 *
 * ⚠️ ES BORRADO LOGICO, y no es una preferencia estetica: `order_items`
 * referencia la publicacion con FK, asi que borrarla de verdad romperia el
 * historial de compras de quien ya la compro. CLAUDE.md §6 lo fija como regla
 * para entidades de negocio.
 *
 * ⚠️ ES TERMINAL. Una publicacion eliminada no se edita ni se reactiva:
 * `requireOwnListing` la rechaza. Para volver a venderla, se publica de nuevo.
 */
export async function deleteListing(user: PublicUser, listingId: string): Promise<void> {
  const listing = await requireOwnListing(user, listingId);

  await listingRepo.updateListing(listing.id, { status: 'deleted' });

  // Se audita porque saca algo de la venta y no se puede deshacer.
  await audit.record({
    actorType: 'user',
    actorId: user.id,
    action: 'LISTING_DELETED',
    entityType: ENTITY_TYPE,
    entityId: listing.id,
    before: { status: listing.status },
    after: { status: 'deleted' },
  });
}
