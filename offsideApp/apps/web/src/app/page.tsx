import Link from 'next/link';
import type { JSX } from 'react';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import {
  IconoAutenticado,
  IconoBalon,
  IconoBuzo,
  IconoCamiseta,
  IconoCampera,
  IconoConjunto,
  IconoIntercambio,
  IconoShort,
} from '@/components/iconos';
import { ListingCard, type EstadoDeFavorito } from '@/components/listing-card';
import { Aviso, BotonEnlace } from '@/components/ui';
import { getSessionUser } from '@/lib/session';
import { favoriteIdsOf } from '@/modules/favorites/services/favorite.service';
import {
  catalogoDeLaVitrina,
  coverUrls,
  listPublicCatalog,
  type CatalogListing,
  type EntradaDeCatalogo,
} from '@/modules/listings/services/listing.service';
import { listPromotedCatalog } from '@/modules/listings/services/promotion.service';
import { searchListings, type Faceta } from '@/modules/listings/services/search.service';

import estilos from './page.module.css';

/**
 * Home: la vitrina publica.
 *
 * Estructura (2026-11-06): banner corto, categorias, garantias y enseguida las
 * publicaciones. Sigue el orden de lectura de Mercado Libre: quien entra a un
 * marketplace viene a ver productos, no una tapa.
 *
 * SERVER COMPONENT que llama al Service directamente (decision del owner,
 * 2026-09-01). No exige sesion: cualquiera puede ver el catalogo sin registrarse.
 */

/**
 * ⚠️ SIN CACHE. Mostrar stock que ya no existe lleva a un checkout que falla.
 */
export const dynamic = 'force-dynamic';

/** Tope que aplica el repositorio (`findPublicCatalog`) cuando no se le pasa uno. */
const TOPE_DE_LA_VITRINA = 60;

/** Una fila de la grilla: la promocion compra lugar, no la portada entera. */
const TOPE_DE_PROMOCIONADAS = 4;

/** Cuantos atajos por grupo, y cuantos hacen falta para no caer en el catalogo sembrado. */
const TOPE_DE_ATAJOS = 8;
const MINIMO_DE_FACETAS = 4;

const FOTOS_DEL_BANNER = 3;

/**
 * El icono de cada categoria del enum `garment_category` (ERD §5). Se indexa por
 * `code`, que es fijo (migracion 0004, DEC-041).
 */
const ICONO_DE_CATEGORIA: Record<string, (props: { tamanio?: number }) => JSX.Element> = {
  camiseta: IconoCamiseta,
  short: IconoShort,
  buzo: IconoBuzo,
  campera: IconoCampera,
  conjunto: IconoConjunto,
  entrenamiento: IconoBalon,
};

/** Camisetas primero: es lo que vino a buscar casi todo el mundo. */
const ORDEN_DE_CATEGORIAS = ['camiseta', 'short', 'buzo', 'campera', 'conjunto', 'entrenamiento'];

function ordenDeCategoria(code: string): number {
  const posicion = ORDEN_DE_CATEGORIAS.indexOf(code);

  return posicion === -1 ? ORDEN_DE_CATEGORIAS.length : posicion;
}

/**
 * Lo que Offside puede afirmar, sin numeros ni sellos.
 *
 * ⚠️ LA COMISION NO SE ESCRIBE ACA: es ⚙️ CONFIGURABLE (CLAUDE.md §12).
 *
 * ⚠️ NADA QUE SUENE A "VENDEDOR VERIFICADO": BR-003 y SS-012 dicen que conectar
 * Mercado Pago no otorga confianza. Se describe el requisito, que es comprobable.
 *
 * ⚠️ "NO RETIENE LOS FONDOS" Y NO "NO TOCA LA PLATA", QUE SERIA FALSO: la comision
 * sale del mismo pago (DEC-043). Lo unico que se puede prometer es que Offside no
 * se queda con la plata en el medio (DEC-019).
 */
const GARANTIAS = [
  {
    icono: <IconoAutenticado tamanio={24} />,
    titulo: 'Identidad declarada',
    detalle: 'Para publicar hay que verificar el email y declarar CUIT, CUIL o CDI.',
  },
  {
    icono: <IconoIntercambio tamanio={24} />,
    titulo: 'Pagás con Mercado Pago',
    detalle: 'El vendedor cobra en su propia cuenta. Offside no retiene los fondos.',
  },
  {
    icono: <IconoCamiseta tamanio={24} />,
    titulo: 'Una prenda, una publicación',
    detalle: 'Con su talle, su estado y sus fotos reales, no una foto de catálogo.',
  },
];

/** Una faceta con conteo o una entrada de catalogo sin el. */
interface Atajo {
  valor: string;
  etiqueta: string;
}

/**
 * Las facetas reales si alcanzan; si no, un tramo del catalogo sembrado.
 *
 * ⚠️ NO ES AL AZAR NI ALFABETICO. Con 38 clubes sembrados, el orden alfabetico
 * mostraria siempre los mismos ocho y River y Boca no aparecerian nunca; al azar,
 * cada recarga barajaria los atajos. Con el dia del año como corrimiento, todos
 * ven lo mismo el mismo dia y el catalogo entero pasa por la portada.
 */
function atajosDe(facetas: Faceta[], catalogo: EntradaDeCatalogo[]): Atajo[] {
  if (facetas.length >= MINIMO_DE_FACETAS) {
    return facetas
      .slice(0, TOPE_DE_ATAJOS)
      .map((faceta) => ({ valor: faceta.valor, etiqueta: faceta.etiqueta }));
  }

  if (catalogo.length <= TOPE_DE_ATAJOS) {
    return catalogo.map((entrada) => ({ valor: entrada.id, etiqueta: entrada.nombre }));
  }

  const hoy = new Date();
  const diaDelAnio = Math.floor(
    (hoy.getTime() - Date.UTC(hoy.getUTCFullYear(), 0, 1)) / 86_400_000,
  );

  return Array.from({ length: TOPE_DE_ATAJOS }, (_, i) => {
    const entrada = catalogo[(diaDelAnio + i) % catalogo.length]!;

    return { valor: entrada.id, etiqueta: entrada.nombre };
  });
}

/**
 * Las promocionadas vigentes, ya con portada (PS-021).
 *
 * ⚠️ NO PUEDE VOLTEAR LA HOME: son realce. Si la consulta falla, la vitrina sigue
 * siendo el catalogo. El Service ya aplica el filtro de visibilidad: que alguien
 * haya pagado por figurar no vuelve comprable lo que la compra rechaza.
 */
async function promocionadasDeLaVitrina(): Promise<CatalogListing[]> {
  try {
    const filas = await listPromotedCatalog(TOPE_DE_PROMOCIONADAS);
    if (filas.length === 0) return [];

    const portadas = await coverUrls(filas.map((fila) => fila.id));

    return filas.map((fila) => ({
      id: fila.id,
      title: fila.title,
      priceAmount: fila.priceAmount.toString(),
      currency: fila.currency,
      sizeValue: fila.sizeValue,
      condition: fila.condition,
      stock: fila.stock,
      sellerDisplayName: fila.sellerDisplayName,
      coverUrl: portadas.get(fila.id) ?? null,
    }));
  } catch (error) {
    console.error('[home] no se pudieron leer las promocionadas', error);

    return [];
  }
}

/**
 * Las facetas de club y marca. Mismo blindaje: si falla el indice de busqueda, la
 * vitrina sigue en pie con el catalogo sembrado.
 */
async function facetasDeLaVitrina(): Promise<{ club: Faceta[]; marca: Faceta[] }> {
  try {
    const { facetas } = await searchListings({});

    return { club: facetas.club, marca: facetas.marca };
  } catch (error) {
    console.error('[home] no se pudieron leer las facetas de la vitrina', error);

    return { club: [], marca: [] };
  }
}

export default async function Home({
  searchParams,
}: {
  /** La home no tiene filtros, pero el corazon de una tarjeta vuelve con `?aviso=favorito`. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    ⚠️ `searchParams` SE ESPERA SOLO Y PRIMERO. Metido en el mismo `Promise.all`
    que `getSessionUser()`, la sesion volvia siempre null (medido en el navegador).
  */
  const params = await searchParams;

  const [listings, facetas, catalogo, promocionadas, user] = await Promise.all([
    listPublicCatalog(),
    facetasDeLaVitrina(),
    catalogoDeLaVitrina(),
    promocionadasDeLaVitrina(),
    getSessionUser(),
  ]);

  const idsPromocionados = new Set(promocionadas.map((item) => item.id));

  const favoritos =
    user === null
      ? new Set<string>()
      : await favoriteIdsOf(user, [
          ...new Set([...promocionadas.map((i) => i.id), ...listings.map((i) => i.id)]),
        ]);

  /** `volverA` lleva ancla para no perder el lugar en el catalogo. */
  const favoritoDe = (id: string): EstadoDeFavorito | undefined =>
    user === null ? undefined : { activo: favoritos.has(id), volverA: '/#en-venta' };

  const fotos = listings.filter((listing) => listing.coverUrl !== null).slice(0, FOTOS_DEL_BANNER);

  const clubes = atajosDe(facetas.club, catalogo.clubes);
  const marcas = atajosDe(facetas.marca, catalogo.marcas);

  return (
    <>
      <Header />

      <main id="contenido" className={estilos.pagina}>
        <section className={`${estilos.banner} sup-cancha`}>
          <div className={estilos.bannerInterior}>
            <div className={estilos.bannerTexto}>
              <h1 className={`${estilos.titulo} display`}>Camisetas con historia</h1>
              <p className={estilos.bajada}>
                Comprá y vendé camisetas de fútbol retro, de época y de temporada. Cada una con sus
                propias fotos.
              </p>
              <BotonEnlace href="/buscar">Ver camisetas</BotonEnlace>
            </div>

            {fotos.length === FOTOS_DEL_BANNER && (
              <div className={estilos.bannerFotos} aria-hidden="true">
                {fotos.map((foto) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={foto.id}
                    className={estilos.bannerFoto}
                    src={foto.coverUrl ?? ''}
                    alt=""
                    decoding="async"
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <div className={estilos.contenido}>
          <nav aria-label="Categorías">
            <ul className={estilos.categorias}>
              {[...catalogo.categorias]
                .sort((a, b) => ordenDeCategoria(a.code) - ordenDeCategoria(b.code))
                .map((categoria) => {
                  const Icono = ICONO_DE_CATEGORIA[categoria.code] ?? IconoCamiseta;

                  return (
                    <li key={categoria.id}>
                      <Link
                        href={`/buscar?categoria=${categoria.id}`}
                        className={estilos.categoria}
                      >
                        <span className={estilos.categoriaIcono} aria-hidden="true">
                          <Icono tamanio={32} />
                        </span>
                        {categoria.name}
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </nav>

          <section className={estilos.garantias} aria-label="Cómo funciona Offside">
            {GARANTIAS.map((garantia) => (
              <div key={garantia.titulo} className={estilos.garantia}>
                <span className={estilos.garantiaIcono} aria-hidden="true">
                  {garantia.icono}
                </span>
                <div>
                  <h2 className={estilos.garantiaTitulo}>{garantia.titulo}</h2>
                  <p className={estilos.garantiaDetalle}>{garantia.detalle}</p>
                </div>
              </div>
            ))}
          </section>

          {/*
            ⚠️ VA SEPARADA Y ROTULADA, no mezclada: quien mira sabe que esta viendo
            lugar pagado. Sin promocionadas no hay seccion.
          */}
          {promocionadas.length > 0 && (
            <section aria-labelledby="promocionadas-titulo">
              <div className={estilos.encabezado}>
                <h2 id="promocionadas-titulo" className={estilos.tituloSeccion}>
                  Promocionadas
                </h2>
                <p className={estilos.nota}>El vendedor pagó por aparecer acá</p>
              </div>
              <ul className={estilos.grilla}>
                {promocionadas.map((listing) => (
                  <li key={listing.id}>
                    <ListingCard listing={listing} promocionada favorito={favoritoDe(listing.id)} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section id="en-venta" aria-labelledby="en-venta-titulo">
            <div className={estilos.encabezado}>
              <h2 id="en-venta-titulo" className={estilos.tituloSeccion}>
                Publicaciones recientes
              </h2>
              {listings.length > 0 && (
                <Link href="/buscar" className={estilos.verTodas}>
                  Ver todas
                </Link>
              )}
            </div>

            {params.aviso === 'favorito' && (
              <div className={estilos.aviso}>
                <Aviso tono="error">
                  No pudimos guardar la publicación. Probá de nuevo en un momento.
                </Aviso>
              </div>
            )}

            {listings.length === 0 ? (
              <div className={estilos.vacio}>
                <p className={estilos.vacioTitulo}>Todavía no hay publicaciones</p>
                <p className={estilos.nota}>
                  Cuando un vendedor publique su primera camiseta, va a aparecer acá.
                </p>
                <BotonEnlace href="/vendedor/empezar">Publicar la primera</BotonEnlace>
              </div>
            ) : (
              <ul className={estilos.grilla}>
                {listings.map((listing) => (
                  <li key={listing.id}>
                    <ListingCard
                      listing={listing}
                      promocionada={idsPromocionados.has(listing.id)}
                      favorito={favoritoDe(listing.id)}
                    />
                  </li>
                ))}
              </ul>
            )}

            {/* La vitrina corta en 60 y no pagina: se manda a la busqueda en vez de mentir un total. */}
            {listings.length >= TOPE_DE_LA_VITRINA && (
              <p className={estilos.mas}>
                <Link href="/buscar" className={estilos.verTodas}>
                  Ver el resto en la búsqueda
                </Link>
              </p>
            )}
          </section>

          <div className={estilos.atajos}>
            <section className={estilos.tarjeta} aria-labelledby="clubes-titulo">
              <h2 id="clubes-titulo" className={estilos.tituloTarjeta}>
                Buscá por club
              </h2>
              <ul className={estilos.chips}>
                {clubes.map((club) => (
                  <li key={club.valor}>
                    <Link href={`/buscar?club=${club.valor}`} className={estilos.chip}>
                      {club.etiqueta}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className={estilos.tarjeta} aria-labelledby="marcas-titulo">
              <h2 id="marcas-titulo" className={estilos.tituloTarjeta}>
                Buscá por marca
              </h2>
              <ul className={estilos.chips}>
                {marcas.map((marca) => (
                  <li key={marca.valor}>
                    <Link href={`/buscar?marca=${marca.valor}`} className={estilos.chip}>
                      {marca.etiqueta}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/*
            ⚠️ NO PROMETE NADA QUE EL SITIO NO HAGA: dice los tres pasos que el
            sistema exige (TS-001, DEC-044).
          */}
          <section className={estilos.vender} aria-labelledby="vender-titulo">
            <div>
              <h2 id="vender-titulo" className={estilos.tituloTarjeta}>
                ¿Tenés una camiseta guardada?
              </h2>
              <p className={estilos.nota}>
                Verificás tu email, declarás tu CUIT, CUIL o CDI y conectás Mercado Pago. Cobrás en
                tu propia cuenta.
              </p>
            </div>
            <BotonEnlace href="/vendedor/empezar">Empezar a vender</BotonEnlace>
          </section>
        </div>
      </main>

      <Footer />
    </>
  );
}
