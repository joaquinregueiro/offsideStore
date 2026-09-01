import type { CatalogListing } from '@/modules/listings/services/listing.service';

import estilos from './listing-card.module.css';

/**
 * Ficha de producto del catalogo.
 *
 * Server Component: no tiene interactividad y no necesita JavaScript en el
 * cliente. Agregarle `'use client'` solo para renderizar texto mandaria el
 * componente al bundle sin ganar nada.
 */

/**
 * Formatea centavos como precio argentino.
 *
 * ⚠️ CONVIERTE A `number` PARA MOSTRAR, y solo para eso. El dinero viaja como
 * string de centavos justamente para no perder precision; aca ya no se opera
 * con el, solo se dibuja. `Number.MAX_SAFE_INTEGER` son mas de 90 mil millones
 * de pesos: no hay riesgo real de perder un centavo en el camino.
 */
function formatearPrecio(centavos: string, moneda: string): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda,
    maximumFractionDigits: 0,
  }).format(Number(centavos) / 100);
}

/** `COMO_NUEVO` -> `Como nuevo`. El enum es del ERD; esto es presentacion. */
function condicionLegible(condicion: string): string {
  const texto = condicion.replaceAll('_', ' ').toLowerCase();

  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function ListingCard({ listing }: { listing: CatalogListing }) {
  return (
    <article className={estilos.ficha}>
      {/* Sin imagenes todavia: se muestra el patron de la identidad §05. */}
      <div className={estilos.marco} aria-hidden="true" />

      <div className={estilos.cuerpo}>
        <h3 className={estilos.titulo}>{listing.title}</h3>

        <p className={estilos.precio}>{formatearPrecio(listing.priceAmount, listing.currency)}</p>

        <div className={estilos.metadatos}>
          <span className={estilos.etiqueta}>Talle {listing.sizeValue}</span>
          <span className={estilos.etiqueta}>{condicionLegible(listing.condition)}</span>
        </div>

        <p className={estilos.vendedor}>{listing.sellerDisplayName}</p>
      </div>
    </article>
  );
}
