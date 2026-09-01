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
    <article className={estilos.ficha}>
      {/* Sin imagenes todavia: se muestra el patron de la identidad §05. */}
      <div className={estilos.marco} aria-hidden="true" />

      <div className={estilos.cuerpo}>
        <h3 className={estilos.titulo}>{listing.title}</h3>

        <p className={estilos.precio}>{precio(listing.priceAmount, listing.currency)}</p>

        <div className={estilos.metadatos}>
          <span className={estilos.etiqueta}>Talle {listing.sizeValue}</span>
          <span className={estilos.etiqueta}>{condicion(listing.condition)}</span>
        </div>

        <p className={estilos.vendedor}>{listing.sellerDisplayName}</p>
      </div>
    </article>
  );
}
