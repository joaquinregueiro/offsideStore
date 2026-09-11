import type { Metadata } from 'next';
import Link from 'next/link';

import { CampoOculto, Formulario } from '@/components/form';
import { IconoFavorito } from '@/components/iconos';
import { FotoCompartida, Pantalla } from '@/components/movimiento';
import { BotonEnlace, Etiqueta, EstadoVacio, Paginacion, Precio, Seccion } from '@/components/ui';
import { cantidad, condicion, precio } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { listFavorites } from '@/modules/favorites/services/favorite.service';

import { quitarDeFavoritos } from '../../acciones';
import { ChapaDeCuenta } from '../../chapa';
import { PanelDeCuenta } from '../../panel';
import estilos from '../../cuenta.module.css';

export const metadata: Metadata = { title: 'Mis favoritos' };
export const dynamic = 'force-dynamic';

/** Página válida: entero ≥ 1. Cualquier otra cosa es la primera. */
function paginaDeLaUrl(valor: string | string[] | undefined): number {
  if (typeof valor !== 'string') return 1;

  const numero = Number.parseInt(valor, 10);

  return Number.isInteger(numero) && numero >= 1 ? numero : 1;
}

/**
 * MIS FAVORITOS (BS-050/051).
 *
 * ⚠️ LA LISTA NO FILTRA LO QUE NO SE PUEDE COMPRAR, Y ESO ES EL PUNTO. Una
 * publicación pausada, agotada o de un vendedor desconectado sigue acá,
 * marcada: es exactamente lo que BS-051 quiere que la persona vea —guardó esa
 * camiseta justamente para enterarse cuando vuelva—. El Service sólo excluye
 * las eliminadas, que no llevan a ningún lado.
 *
 * ⚠️ EL AVISO DE BAJA DE PRECIO COMPARA CONTRA EL PRECIO AL GUARDAR, que el
 * repositorio conserva. No es una promoción ni una oferta: es un hecho sobre lo
 * que esta persona guardó, y por eso se dice con el importe viejo al lado.
 */
export default async function MisFavoritos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireVerifiedSessionUser('/cuenta/favoritos');
  const params = await searchParams;

  const pagina = await listFavorites(user, paginaDeLaUrl(params.pagina));
  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.porPagina));

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="favoritos">
        <main id="contenido">
          <ChapaDeCuenta
            rotulo="Mi cuenta"
            titulo="Favoritos"
            detalle={
              <p className={estilos.chapaDetalle}>
                {pagina.total === 0
                  ? 'Todavía no guardaste ninguna'
                  : cantidad(pagina.total, 'publicación', 'publicaciones')}
              </p>
            }
          />

          {pagina.favoritos.length === 0 ? (
            <EstadoVacio titulo="No guardaste nada todavía" icono={<IconoFavorito tamanio={40} />}>
              <p>
                Tocá el corazón en cualquier publicación y la vas a encontrar acá, con aviso si baja
                de precio o si se vende.
              </p>
              <BotonEnlace href="/">Ver el catálogo</BotonEnlace>
            </EstadoVacio>
          ) : (
            <Seccion
              titulo="Guardadas"
              dato={cantidad(pagina.total, 'publicación', 'publicaciones')}
            >
              <ul className={`${estilos.favoritos} ${estilos.revela}`}>
                {pagina.favoritos.map((favorito) => (
                  <li key={favorito.listingId} className={`${estilos.favorito} sup-ficha eleva`}>
                    {/*
                    ⚠️ `FotoCompartida` USA EL MISMO NOMBRE QUE LA VITRINA Y LA
                    FICHA (`foto-<id>`): la misma camiseta que se toca acá se
                    despega y aterriza en `/p/[id]`. El nombre es un contrato que
                    ya leen cuatro pantallas; no se cambia.
                  */}
                    <Link
                      href={`/p/${favorito.listingId}`}
                      className={estilos.favoritoEnlace}
                      transitionTypes={['avanza']}
                    >
                      <FotoCompartida id={favorito.listingId}>
                        <span className={`${estilos.favoritoMarco} zoom-marco`}>
                          {favorito.coverUrl === null ? (
                            <span
                              className={`${estilos.favoritoPatron} ${estilos.rombos}`}
                              aria-hidden="true"
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className={`${estilos.favoritoFoto} zoom-foto`}
                              src={favorito.coverUrl}
                              alt=""
                              width={240}
                              height={300}
                              loading="lazy"
                              decoding="async"
                            />
                          )}
                        </span>
                      </FotoCompartida>

                      <p className={estilos.favoritoTitulo}>{favorito.title}</p>
                    </Link>

                    <p className={estilos.favoritoMeta}>
                      Talle {favorito.sizeValue} · {condicion(favorito.condition)} ·{' '}
                      {favorito.sellerDisplayName}
                    </p>

                    {/*
                    ⚠️ LOS DOS AVISOS SON HECHOS, NO ALARMAS. "Se vendió" y "bajó
                    de precio" son la razón por la que alguien guarda algo; que
                    latieran los convertiría en publicidad.
                  */}
                    {!favorito.comprable && (
                      <Etiqueta tono="alerta">
                        {favorito.status === 'sold_out' || favorito.stock <= 0
                          ? 'Se vendió'
                          : favorito.status === 'paused'
                            ? 'Pausada por el vendedor'
                            : 'No disponible por ahora'}
                      </Etiqueta>
                    )}

                    {favorito.bajoDePrecio && favorito.precioAlGuardar !== null && (
                      <Etiqueta tono="exito">Bajó de precio</Etiqueta>
                    )}

                    <div className={estilos.favoritoPie}>
                      <span>
                        <Precio valor={precio(favorito.priceAmount, favorito.currency)} />
                        {favorito.bajoDePrecio && favorito.precioAlGuardar !== null && (
                          <span className={estilos.favoritoAntes}>
                            <span className="solo-lectores">Antes: </span>
                            {precio(favorito.precioAlGuardar, favorito.currency)}
                          </span>
                        )}
                      </span>

                      {/*
                      ⚠️ QUITAR ES UN `<form>` POR POST, NO UN ENLACE. Muta, y un
                      GET que muta lo dispara solo cualquier prefetch o
                      prefetcher del navegador: alguien perdería sus favoritos
                      con sólo pasar por encima.
                    */}
                      <Formulario
                        accion={quitarDeFavoritos}
                        enviar="Quitar"
                        variante="fantasma"
                        tamanio="chico"
                        bloque={false}
                      >
                        <CampoOculto nombre="listingId" valor={favorito.listingId} />
                      </Formulario>
                    </div>
                  </li>
                ))}
              </ul>

              <Paginacion
                actual={pagina.pagina}
                total={totalPaginas}
                hrefDe={(numero) => `/cuenta/favoritos?pagina=${numero}`}
              />
            </Seccion>
          )}
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
