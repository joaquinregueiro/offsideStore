import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Header } from '@/components/header';
import { BotonEnlace, Etiqueta } from '@/components/ui';
import { condicion, precio } from '@/lib/formato';
import { getSessionUser } from '@/lib/session';
import { findPublicListing } from '@/modules/listings/services/listing.service';

import estilos from './page.module.css';

/**
 * Detalle de una publicacion.
 *
 * ⚠️ `params` ES UNA PROMESA en esta version de Next: hay que esperarla antes de
 * leer el id.
 *
 * ⚠️ NO EXIGE SESION para VER. Cualquiera puede mirar una camiseta; la sesion
 * recien hace falta para comprarla, y el boton lo refleja en vez de esconder la
 * pagina detras del login.
 */

export const dynamic = 'force-dynamic';

/** Pocas unidades: a partir de aca se avisa. */
const UMBRAL_POCO_STOCK = 3;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await findPublicListing(id);

  if (listing === null) return { title: 'Publicación no encontrada — Offside Store' };

  return {
    title: `${listing.title} — Offside Store`,
    description: listing.description ?? 'Camiseta de fútbol en Offside Store.',
  };
}

export default async function DetalleDePublicacion({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [listing, user] = await Promise.all([findPublicListing(id), getSessionUser()]);

  /**
   * ⚠️ 404 TAMBIEN CUANDO EXISTE PERO NO ES COMPRABLE. `findPublicListing`
   * aplica el filtro del ERD §9.1, asi que una publicacion pausada, agotada o
   * sin aprobar llega como `null`. Mostrarla porque alguien tiene el enlace
   * seria una via lateral para ver lo que la vitrina esconde.
   */
  if (listing === null) notFound();

  const quedaPoco = listing.stock <= UMBRAL_POCO_STOCK;

  return (
    <>
      <Header />

      <main className={estilos.contenedor}>
        <a href="/" className={estilos.volver}>
          ← Volver al catálogo
        </a>

        <div className={estilos.grilla}>
          <div className={estilos.marco} aria-hidden="true" />

          <div>
            <h1 className={estilos.titulo}>{listing.title}</h1>
            <p className={estilos.vendedor}>Vendida por {listing.sellerDisplayName}</p>

            <p className={estilos.precio}>{precio(listing.priceAmount, listing.currency)}</p>

            <div className={estilos.atributos}>
              <Etiqueta>Talle {listing.sizeValue}</Etiqueta>
              <Etiqueta>{condicion(listing.condition)}</Etiqueta>
              {listing.kitType !== null && <Etiqueta>{condicion(listing.kitType)}</Etiqueta>}
              {quedaPoco && (
                <Etiqueta aviso>
                  {listing.stock === 1 ? 'Última unidad' : `Quedan ${listing.stock}`}
                </Etiqueta>
              )}
            </div>

            {listing.description !== null && listing.description !== '' && (
              <p className={estilos.descripcion}>{listing.description}</p>
            )}

            <div className={estilos.compra}>
              {user === null ? (
                <>
                  {/*
                    Se conserva a donde queria ir: al iniciar sesion vuelve a
                    esta ficha, no a la home. `rutaInternaSegura` valida ese
                    parametro del otro lado.
                  */}
                  <BotonEnlace
                    href={`/ingresar?next=${encodeURIComponent(`/p/${listing.id}`)}`}
                    bloque
                  >
                    Ingresar para comprar
                  </BotonEnlace>
                  <p className={estilos.vendedor}>Necesitás una cuenta para completar la compra.</p>
                </>
              ) : (
                <BotonEnlace href={`/comprar/${listing.id}`} bloque>
                  Comprar
                </BotonEnlace>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
