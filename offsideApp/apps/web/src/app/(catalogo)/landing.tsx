import Link from 'next/link';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { ListingCard, type EstadoDeFavorito } from '@/components/listing-card';
import { Pantalla } from '@/components/movimiento';
import { BotonEnlace, Migas } from '@/components/ui';
import { getSessionUser } from '@/lib/session';
import { favoriteIdsOf } from '@/modules/favorites/services/favorite.service';
import { searchListings, POR_PAGINA } from '@/modules/listings/services/search.service';
import type { EntradaDeCatalogo } from '@/modules/listings/services/listing.service';

import estilos from './landing.module.css';

/**
 * Pantalla de catalogo: `/club/[slug]` y `/marca/[slug]`.
 *
 * ⚠️ EXISTE POR SEO, Y ESA ES TODA SU RAZON DE SER. Las facetas por club y marca
 * ya funcionaban, pero solo se llegaba a ellas por `/buscar?club=<uuid>`: una URL
 * que no dice nada, que nadie comparte y que un buscador no indexa como "camisetas
 * de River". En un marketplace de nicho la busqueda organica es LA puerta de
 * entrada, y no habia ninguna pagina que la recibiera.
 *
 * ⚠️ NO ES UN BUSCADOR NUEVO: llama a `searchListings` con un filtro fijo. Si
 * tuviera su propia consulta, el dia que cambie el filtro de visibilidad de la
 * vitrina esta pantalla ofreceria lo que la compra rechaza. Lo unico que agrega
 * es el rotulo, la metadata y una URL legible.
 *
 * ⚠️ CLUB Y MARCA COMPARTEN ESTE ARCHIVO A PROPOSITO. Son la misma pantalla con
 * distinto sustantivo; dos copias significan que arreglar una deja rota la otra.
 * El tipo decide el texto y el parametro, nada mas.
 */

/** Que catalogo se esta mirando. */
export type TipoDeLanding = 'club' | 'marca';

interface Textos {
  /** Como se nombra el grupo en la miga de pan. */
  grupo: string;
  /** El titulo de la pantalla, ya con el nombre adentro. */
  titulo: (nombre: string) => string;
  /** La bajada. Describe lo que hay, sin prometer nada que el catalogo no tenga. */
  bajada: (nombre: string) => string;
  /** La clave con la que `/buscar` filtra por esto. */
  clave: 'club' | 'marca';
}

/**
 * ⚠️ EL TEXTO NO DICE "LAS MEJORES" NI "LAS MAS BUSCADAS". Es una lista filtrada
 * del catalogo: cualquier superlativo seria un juicio que nadie midio, y ademas
 * el buscador lo penaliza como relleno.
 */
const TEXTOS: Record<TipoDeLanding, Textos> = {
  club: {
    grupo: 'Clubes',
    titulo: (nombre) => `Camisetas de ${nombre}`,
    bajada: (nombre) =>
      `Camisetas de ${nombre} publicadas por coleccionistas: retro, de época y de temporada, con su talle, su estado y fotos reales.`,
    clave: 'club',
  },
  marca: {
    grupo: 'Marcas',
    titulo: (nombre) => `Camisetas ${nombre}`,
    bajada: (nombre) =>
      `Camisetas ${nombre} publicadas por coleccionistas: retro, de época y de temporada, con su talle, su estado y fotos reales.`,
    clave: 'marca',
  },
};

export const textosDe = (tipo: TipoDeLanding): Textos => TEXTOS[tipo];

/** El filtro que recibe `searchListings` segun el tipo. */
const filtroDe = (tipo: TipoDeLanding, id: string) =>
  tipo === 'club' ? { clubId: id } : { brandId: id };

/**
 * Cuantas publicaciones tiene una entrada de catalogo. Lo usa `generateMetadata`
 * para no prometer en el titulo lo que la pantalla no muestra.
 */
export async function contarDeCatalogo(tipo: TipoDeLanding, id: string): Promise<number> {
  try {
    const { total } = await searchListings(filtroDe(tipo, id));

    return total;
  } catch {
    return 0;
  }
}

export async function LandingDeCatalogo({
  tipo,
  entrada,
  pagina,
}: {
  tipo: TipoDeLanding;
  entrada: EntradaDeCatalogo;
  pagina: number;
}) {
  const textos = TEXTOS[tipo];

  const [resultado, user] = await Promise.all([
    searchListings({ ...filtroDe(tipo, entrada.id), pagina }),
    getSessionUser(),
  ]);

  /*
   * ⚠️ LA PAGINA SE ACOTA ANTES DE PINTAR NADA, igual que en `/buscar`: con
   * `?pagina=99` sobre dos paginas de resultados, la grilla saldria vacia y el
   * pie diria "mostrando 2353-2353", que no es un estado, es un error a la vista.
   */
  const paginas = Math.max(1, Math.ceil(resultado.total / POR_PAGINA));
  const paginaSegura = Math.min(Math.max(1, pagina), paginas);

  const favoritos =
    user === null
      ? new Set<string>()
      : await favoriteIdsOf(
          user,
          resultado.resultados.map((item) => item.id),
        );

  const favoritoDe = (id: string): EstadoDeFavorito | undefined =>
    user === null ? undefined : { activo: favoritos.has(id), volverA: `/${tipo}/${entrada.slug}` };

  /** Conserva la pagina en la URL sin ensuciarla con un `?pagina=1`. */
  const urlDePagina = (n: number) =>
    n <= 1 ? `/${tipo}/${entrada.slug}` : `/${tipo}/${entrada.slug}?pagina=${n}`;

  return (
    <>
      <Header seccion="explorar" />

      <Pantalla>
        <main id="contenido" className={estilos.pagina}>
          <div className={estilos.interior}>
            <Migas
              items={[
                { texto: 'Catálogo', href: '/' },
                { texto: textos.grupo, href: '/buscar' },
                { texto: entrada.nombre },
              ]}
            />

            <header className={estilos.encabezado}>
              <h1 className={`display display-3 titular-degradado ${estilos.titulo}`}>
                {textos.titulo(entrada.nombre)}
              </h1>
              <p className={estilos.bajada}>{textos.bajada(entrada.nombre)}</p>
              <p className={estilos.cuenta}>
                {resultado.total === 1 ? '1 publicación' : `${resultado.total} publicaciones`}
              </p>
            </header>

            {resultado.resultados.length === 0 ? (
              /*
                ⚠️ EL ESTADO VACIO NO ES UN ERROR Y NO SE DISFRAZA DE UNO. Un club
                sembrado sin publicaciones es lo normal en un marketplace nuevo, y
                esta pantalla es alcanzable desde un buscador: quien llega tiene
                que encontrar una salida, no un cartel de "no hay nada".
              */
              <div className={estilos.vacio}>
                <p className={estilos.vacioTitulo}>
                  Todavía no hay camisetas de {entrada.nombre} publicadas.
                </p>
                <p className={estilos.vacioDetalle}>
                  Cuando alguien publique la primera, va a aparecer acá. Mientras tanto podés ver
                  todo el catálogo o publicar la tuya.
                </p>
                <div className={estilos.vacioAcciones}>
                  <BotonEnlace href="/buscar" variante="secundario">
                    Ver todo el catálogo
                  </BotonEnlace>
                  <BotonEnlace href="/vendedor/empezar" variante="secundario">
                    Publicar la mía
                  </BotonEnlace>
                </div>
              </div>
            ) : (
              <>
                <ul className={`${estilos.grilla} enfoca-hermanos revela-grilla-materia`}>
                  {resultado.resultados.map((item) => (
                    <li key={item.id}>
                      <ListingCard
                        listing={{
                          id: item.id,
                          title: item.title,
                          priceAmount: item.priceAmount,
                          currency: item.currency,
                          sizeValue: item.sizeValue,
                          condition: item.condition,
                          stock: item.stock,
                          sellerDisplayName: item.sellerDisplayName,
                          coverUrl: item.coverUrl,
                          coverSrcSet: item.coverSrcSet,
                        }}
                        promocionada={item.promocionada}
                        favorito={favoritoDe(item.id)}
                      />
                    </li>
                  ))}
                </ul>

                {/*
                  ⚠️ LA PAGINACION SON ENLACES, NO BOTONES CON JAVASCRIPT: la
                  pagina viaja en la URL, asi que se comparte, se guarda y vuelve
                  con el boton atras. Es el mismo criterio que `/buscar`.
                */}
                {paginas > 1 && (
                  <nav className={estilos.paginacion} aria-label="Paginación">
                    {paginaSegura > 1 && (
                      <Link
                        href={urlDePagina(paginaSegura - 1)}
                        className={estilos.paginaEnlace}
                        rel="prev"
                      >
                        ← Anterior
                      </Link>
                    )}
                    <span className={estilos.paginaActual}>
                      Página {paginaSegura} de {paginas}
                    </span>
                    {paginaSegura < paginas && (
                      <Link
                        href={urlDePagina(paginaSegura + 1)}
                        className={estilos.paginaEnlace}
                        rel="next"
                      >
                        Siguiente →
                      </Link>
                    )}
                  </nav>
                )}
              </>
            )}

            {/*
              ⚠️ EL ENLACE A `/buscar` NO ES REDUNDANTE: esta pantalla filtra por
              UNA cosa y no ofrece facetas. Quien llego desde un buscador queriendo
              "camisetas de River talle L" necesita un camino al filtrador de
              verdad, y esa es la pantalla que lo tiene.
            */}
            <p className={estilos.masFiltros}>
              <Link
                href={`/buscar?${textos.clave}=${entrada.id}`}
                className="subraya"
                transitionTypes={['barrido']}
              >
                Filtrar por talle, estado, temporada y precio
              </Link>
            </p>
          </div>
        </main>
      </Pantalla>

      <Footer />
    </>
  );
}
