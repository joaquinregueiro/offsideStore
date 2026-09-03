import { condicion, precio } from '@/lib/formato';
import type { CatalogListing } from '@/modules/listings/services/listing.service';

import estilos from './listing-card.module.css';

/**
 * Ficha de producto del catalogo.
 *
 * Server Component: no tiene interactividad y no necesita JavaScript en el
 * cliente. Agregarle `'use client'` solo para renderizar texto mandaria el
 * componente al bundle sin ganar nada.
 */

export function ListingCard({ listing }: { listing: CatalogListing }) {
  return (
    <a href={`/p/${listing.id}`} className={estilos.ficha}>
      {/*
        La portada, o el patron de la identidad §05 si la publicacion no tiene
        fotos. El marco reserva la proporcion en los dos casos, asi que la
        grilla no se reacomoda segun cuales tengan imagen.

        ⚠️ `<img>` y no `next/image`: la foto ya viene redimensionada desde el
        CDN del bucket —el procesador genera tres variantes—. Pasarla otra vez
        por el optimizador de Next la procesaria dos veces y meteria al servidor
        en el camino de cada imagen de cada visita, que es lo que un CDN evita.
      */}
      {listing.coverUrl === null ? (
        <div className={estilos.marco} aria-hidden="true" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={estilos.marco}
          src={listing.coverUrl}
          alt=""
          loading="lazy"
          decoding="async"
        />
      )}

      <div className={estilos.cuerpo}>
        <h3 className={estilos.titulo}>{listing.title}</h3>

        <p className={estilos.precio}>{precio(listing.priceAmount, listing.currency)}</p>

        <div className={estilos.metadatos}>
          <span className={estilos.etiqueta}>Talle {listing.sizeValue}</span>
          <span className={estilos.etiqueta}>{condicion(listing.condition)}</span>
        </div>

        <p className={estilos.vendedor}>{listing.sellerDisplayName}</p>
      </div>
    </a>
  );
}
