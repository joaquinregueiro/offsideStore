import Link from 'next/link';

import { alternarFavorito } from '@/app/acciones';
import { condicion, precio } from '@/lib/formato';
import type { CatalogListing } from '@/modules/listings/services/listing.service';

import { IconoCamiseta, IconoFavorito } from './iconos';
import estilos from './listing-card.module.css';
import { Distintivo } from './ui';

/**
 * Tarjeta de publicacion del catalogo.
 *
 * Server Component: no necesita JavaScript en el cliente.
 *
 * ⚠️ EL ORDEN DEL DOM ES EL QUE LEE UN LECTOR DE PANTALLA: el nombre accesible del
 * enlace es la concatenacion de lo que hay adentro. Por eso no lleva un
 * `aria-label` compuesto, que quedaria viejo el dia que se agregue un dato.
 *
 * ⚠️ `Promocionada` SE ROTULA SIEMPRE (PS-021): quien mira tiene que saber que
 * alguien pago por ese lugar.
 */

/** Lo que la tarjeta necesita saber para pintar el corazon. */
export interface EstadoDeFavorito {
  /** Si esta cuenta ya la tiene guardada (`favoriteIdsOf`). */
  activo: boolean;
  /** A donde vuelve el POST. Se valida con `rutaInternaSegura` del otro lado. */
  volverA: string;
}

export function ListingCard({
  listing,
  promocionada = false,
  favorito,
}: {
  listing: CatalogListing;
  /** Tiene promocion vigente (PS-021). Lo resuelve la pantalla, no la tarjeta. */
  promocionada?: boolean;
  /** Sin sesion no se pasa, y entonces no hay corazon. */
  favorito?: EstadoDeFavorito | undefined;
}) {
  return (
    <div className={estilos.envoltorio}>
      <Link href={`/p/${listing.id}`} className={estilos.ficha}>
        <div className={estilos.marco}>
          {listing.coverUrl === null ? (
            <IconoCamiseta tamanio={72} className={estilos.sinFoto} aria-hidden="true" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={estilos.foto}
              src={listing.coverUrl}
              alt=""
              loading="lazy"
              decoding="async"
            />
          )}
        </div>
        <div className={estilos.cuerpo}>
          {promocionada && <Distintivo />}
          <h3 className={estilos.titulo}>{listing.title}</h3>
          <p className={estilos.precio}>{precio(listing.priceAmount, listing.currency)}</p>
          <p className={estilos.dato}>
            Talle {listing.sizeValue} · {condicion(listing.condition)}
          </p>
          {listing.stock === 1 && <p className={estilos.ultima}>Última unidad</p>}
          <p className={estilos.dato}>Por {listing.sellerDisplayName}</p>
        </div>
      </Link>

      {/*
        ⚠️ VA AFUERA DEL ENLACE. Un <button> adentro de un <a> es HTML invalido, y
        guardar una publicacion no tiene que abrirla.
      */}
      {favorito !== undefined && (
        <form action={alternarFavorito} className={estilos.favorito}>
          <input type="hidden" name="listingId" value={listing.id} />
          <input type="hidden" name="volverA" value={favorito.volverA} />
          <button
            type="submit"
            className={estilos.favoritoBoton}
            aria-pressed={favorito.activo}
            data-activo={favorito.activo ? 'si' : undefined}
          >
            <IconoFavorito tamanio={20} />
            <span className="solo-lectores">
              {favorito.activo ? 'Quitar de guardadas' : 'Guardar'}: {listing.title}
            </span>
          </button>
        </form>
      )}
    </div>
  );
}
