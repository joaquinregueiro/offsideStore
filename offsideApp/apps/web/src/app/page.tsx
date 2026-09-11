import Link from 'next/link';
import type { CSSProperties, JSX } from 'react';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import {
  IconoAutenticado,
  IconoBalon,
  IconoBuzo,
  IconoCamiseta,
  IconoCampera,
  IconoConjunto,
  IconoFlechaDerecha,
  IconoIntercambio,
  IconoShort,
} from '@/components/iconos';
import { ListingCard, type EstadoDeFavorito } from '@/components/listing-card';
import { Pantalla } from '@/components/movimiento';
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
 * Home — la vitrina publica.
 *
 * SERVER COMPONENT que llama al Service DIRECTAMENTE, sin pasar por HTTP
 * (decision del owner, 2026-09-01). Backend y frontend viven en la misma app
 * Next, asi que una peticion de la pagina a su propia API seria un rodeo: mismo
 * proceso, misma base, una serializacion de mas.
 *
 * ⚠️ NO EXIGE SESION. Es la vitrina: cualquiera tiene que poder ver el catalogo
 * sin registrarse, y por eso `listPublicCatalog` no recibe usuario.
 */

/**
 * ⚠️ SIN CACHE. El catalogo cambia cuando alguien publica o cuando se vende la
 * ultima unidad, y mostrar stock que ya no existe lleva a un checkout que
 * falla. Cuando haya volumen esto se revisa con datos, no antes.
 */
export const dynamic = 'force-dynamic';

/** Tope que aplica el repositorio (`findPublicCatalog`) cuando no se le pasa uno. */
const TOPE_DE_LA_VITRINA = 60;

/**
 * ⚠️ CUANTOS VALORES HACEN FALTA PARA QUE UNA BANDA SEA UNA BANDA. Con menos de
 * cuatro no hay nada que recorrer: la fila entra completa en pantalla y el
 * desplazamiento se lee como un error de alineacion. Por debajo de eso la banda
 * no se muestra y la portada corta directo contra las garantias.
 */
const MINIMO_PARA_LA_BANDA = 4;

/**
 * ⚠️ CUANTOS ITEMS TIENE QUE TENER LA PISTA, Y NO ES UN NUMERO DE GUSTO. La
 * banda se desplaza hasta un 30% de su propio ancho: si la pista no mide como
 * minimo vez y media el ancho de la pantalla, al final del recorrido queda un
 * hueco a la derecha. Con 30 items —y cada nombre ocupando 150px o mas— la
 * pista pasa los 4500px, o sea que aguanta un monitor de 1920 con margen. Las
 * copias que sobran van `aria-hidden` y fuera del recorrido de teclado.
 */
const ITEMS_MINIMOS_DE_BANDA = 30;

/**
 * ⚠️ Y CUANTOS VALORES DISTINTOS ENTRAN, QUE ES EL TECHO DEL OTRO LADO. Las
 * facetas no vienen acotadas: con los 38 clubes que siembra la migracion `0007`
 * publicados, tres copias serian 114 anclas dentro de una cinta decorativa. Doce
 * nombres ya llenan una pista de sobra y el resto vive en `/buscar`, que es
 * donde se filtra de verdad.
 */
const TOPE_DE_LA_BANDA = 12;

/** Cuantos valores por grupo en "Buscá por lo que te importa". */
const TOPE_CLUBES = 8;
const TOPE_RESTO = 6;

/** Cuantas entradas de catalogo entran en un atajo cuando todavia no hay facetas. */
const TOPE_CATALOGO_CLUBES = 12;
const TOPE_CATALOGO_RESTO = 8;

/**
 * Cuantas promocionadas entran arriba del catalogo.
 *
 * ⚠️ CUATRO Y NO OCHO, QUE ES EL DEFAULT DEL SERVICE. Son exactamente una fila
 * de la grilla en escritorio: dos filas de destacadas empujarian el catalogo
 * real fuera de la pantalla, y entonces la vitrina pasaria a ser "lo que se
 * pago" con el catalogo debajo. La promocion compra lugar, no la portada.
 */
const TOPE_DE_PROMOCIONADAS = 4;

/**
 * El icono de cada categoria del enum `garment_category` (ERD §5). Se indexa
 * por `code`, que es fijo: las seis filas las siembra la migracion 0004 y
 * DEC-041 las excluye de las propuestas de catalogo. Si un dia apareciera un
 * codigo nuevo, cae en la camiseta y no en un hueco.
 */
const ICONO_DE_CATEGORIA: Record<string, (props: { tamanio?: number }) => JSX.Element> = {
  camiseta: IconoCamiseta,
  short: IconoShort,
  buzo: IconoBuzo,
  campera: IconoCampera,
  conjunto: IconoConjunto,
  entrenamiento: IconoBalon,
};

/**
 * Un tramo del catalogo que cambia con el dia.
 *
 * ⚠️ NO ES ALEATORIO Y NO ES ALFABETICO, Y LAS DOS COSAS SON DECISIONES. Con 38
 * clubes sembrados y lugar para doce, el orden alfabetico mostraria siempre los
 * mismos doce —y serian Aldosivi, Argentinos, Arsenal…— mientras River y Boca
 * no aparecerian nunca. Al azar, dos personas mirando la misma home verian dos
 * paginas distintas y cada recarga barajaria los atajos. Con el dia del año
 * como corrimiento, la ventana avanza un lugar por dia, todos ven lo mismo el
 * mismo dia y el catalogo entero pasa por la portada en poco mas de un mes.
 *
 * ⚠️ EL CATALOGO NO SABE CUANTAS CAMISETAS HAY DE CADA UNO: por eso estas
 * entradas van sin cantidad. Cuando la vitrina tiene facetas reales se usan
 * esas, con su conteo, y esto no se muestra.
 */
function tramoDelDia<T>(valores: T[], cuantos: number): T[] {
  if (valores.length <= cuantos) return valores;

  const hoy = new Date();
  const inicioDelAnio = Date.UTC(hoy.getUTCFullYear(), 0, 1);
  const diaDelAnio = Math.floor((hoy.getTime() - inicioDelAnio) / 86_400_000);
  const desde = diaDelAnio % valores.length;

  return Array.from({ length: cuantos }, (_, i) => valores[(desde + i) % valores.length]!);
}

/** Lo que una banda o un atajo muestran: una faceta con conteo o una entrada de catalogo sin el. */
interface Atajo {
  valor: string;
  etiqueta: string;
  cantidad?: number;
}

const desdeFaceta = (faceta: Faceta): Atajo => ({
  valor: faceta.valor,
  etiqueta: faceta.etiqueta,
  cantidad: faceta.cantidad,
});

const desdeCatalogo = (entrada: EntradaDeCatalogo): Atajo => ({
  valor: entrada.id,
  etiqueta: entrada.nombre,
});

/**
 * Las facetas reales si alcanzan; si no, un tramo del catalogo.
 *
 * ⚠️ NO SE MEZCLAN. Una lista con ocho clubes con conteo y cuatro sin conteo se
 * leeria como "de estos cuatro hay cero", que es verdad pero es lo contrario de
 * un atajo. O todos con cantidad o ninguno.
 */
function atajosDe(
  facetas: Faceta[],
  catalogo: EntradaDeCatalogo[],
  minimo: number,
  tope: number,
  topeCatalogo: number,
): Atajo[] {
  if (facetas.length >= minimo) return facetas.slice(0, tope).map(desdeFaceta);

  return tramoDelDia(catalogo, topeCatalogo).map(desdeCatalogo);
}

const FOTOS_DE_LA_TIRA = 3;

/**
 * Lo que Offside garantiza, en las palabras que la documentacion usa.
 *
 * ⚠️ NINGUNA DE LAS TRES DICE UN NUMERO. La comision es ⚙️ CONFIGURABLE
 * (CLAUDE.md §12): vive en `app_settings` y se cambia desde Admin sin redeploy.
 * Escribir "6%" en la portada la volveria a clavar en el codigo, y el dia que
 * el owner la cambie la home mentiria.
 *
 * ⚠️ TAMPOCO DICEN "VENDEDOR VERIFICADO" NI NADA QUE SUENE A SELLO DE
 * CONFIANZA. BR-003 y SS-012 son explicitos: conectar Mercado Pago no otorga
 * confianza. Se describe el REQUISITO —que es verdad y es comprobable—, no una
 * reputacion que el sistema todavia no mide.
 *
 * ⚠️ "NO RETIENE LOS FONDOS" Y NO "NO TOCA LA PLATA", QUE ES LO QUE DECIA Y ERA
 * FALSO. Offside SI cobra: la preferencia se crea sobre la cuenta del vendedor
 * con `marketplace_fee` y la comision sale de ese mismo pago (DEC-043). Lo que
 * Offside no hace es quedarse con la plata en el medio —Mercado Pago acredita
 * al vendedor al aprobarse el pago y no hay retencion posible (DEC-019, cerrada
 * en negativo)—, y eso es lo unico que esta tarjeta puede prometer. "No toca la
 * plata" se lee como "no cobra comision" en la pantalla mas visitada del sitio.
 *
 * ⚠️ EL ORDINAL ES DECORACION Y VA `aria-hidden`, PERO NO ES GRIS DE ADORNO: se
 * pinta en Verde Cancha, que sobre la superficie calida da 4.83:1.
 * `--color-neutro-apagado` da 2.49:1 y aca hay caracteres que alguien lee.
 */
const GARANTIAS = [
  {
    orden: '01',
    icono: <IconoAutenticado tamanio={24} />,
    titulo: 'Identidad declarada',
    detalle: 'Para publicar hay que verificar el email y declarar CUIT, CUIL o CDI.',
  },
  {
    orden: '02',
    icono: <IconoIntercambio tamanio={24} />,
    titulo: 'Pagás con Mercado Pago',
    detalle: 'El vendedor cobra en su propia cuenta. Offside no retiene los fondos.',
  },
  {
    orden: '03',
    icono: <IconoCamiseta tamanio={24} />,
    titulo: 'Una prenda, una publicación',
    detalle: 'Con su talle, su estado y sus fotos reales, no una foto de catálogo.',
  },
];

/**
 * Total real de la vitrina y las tres facetas de catalogo que esta pantalla usa.
 */
interface ResumenDeVitrina {
  total: number;
  club: Faceta[];
  marca: Faceta[];
  temporada: Faceta[];
}

const RESUMEN_VACIO: ResumenDeVitrina = { total: 0, club: [], marca: [], temporada: [] };

/**
 * Resumen de la vitrina: el total sin el tope de 60 y las facetas con nombre
 * legible y cantidad.
 *
 * ⚠️ SALE DE `searchListings({})`, QUE ES CARO PARA LO QUE SE USA Y ESTA
 * ANOTADO. Esa llamada resuelve tambien 24 resultados con sus portadas, que
 * esta pantalla tira a la basura: lo que corresponde es un `resumenDeVitrina()`
 * en el Service que traiga solo el conteo y las facetas. Escribirlo es una
 * edicion de `modules/`, que no es de esta superficie.
 *
 * ⚠️ NO PUEDE VOLTEAR LA HOME. El contrato de esta pantalla es el catalogo; las
 * bandas, los atajos y la cifra son realce. Encadenar las dos llamadas en un
 * `Promise.all` pelado convertiria cualquier falla del indice de busqueda en un
 * error 500 de la vitrina entera, que hoy no depende de la busqueda para nada.
 * El error se registra —no se traga en silencio— y la pagina sigue de pie sin
 * esas tres secciones.
 */
/**
 * Las promocionadas vigentes de la vitrina, ya con portada (PS-021).
 *
 * ⚠️ TIENE EL MISMO BLINDAJE QUE EL RESUMEN Y POR EL MISMO MOTIVO. Las
 * promocionadas son realce: si la consulta falla —la tabla de promociones, el
 * bucket de imagenes— la vitrina sigue siendo el catalogo. Encadenarla en un
 * `Promise.all` pelado convertiria cualquier falla de una funcionalidad
 * accesoria en un 500 de la pantalla mas visitada del sitio.
 *
 * ⚠️ LAS PORTADAS SALEN EN UNA SOLA CONSULTA, igual que en `listPublicCatalog`:
 * pedirlas de a una seria el problema N+1 en la primera seccion de la home.
 *
 * ⚠️ EL SERVICE YA APLICA EL FILTRO DE VISIBILIDAD DE LA VITRINA. Una
 * promocionada cuyo vendedor se desconecto de Mercado Pago o se fue de
 * vacaciones NO aparece: que alguien haya pagado por figurar no la vuelve
 * comprable, y ofrecer lo que la compra rechaza es peor que no ofrecerlo.
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

async function resumenDeVitrina(): Promise<ResumenDeVitrina> {
  try {
    const { total, facetas } = await searchListings({});

    return {
      total,
      club: facetas.club,
      marca: facetas.marca,
      temporada: facetas.temporada,
    };
  } catch (error) {
    console.error('[home] no se pudo armar el resumen de la vitrina', error);

    return RESUMEN_VACIO;
  }
}

/**
 * BANDA DE CATALOGO — nombres que corren con el scroll.
 *
 * ⚠️ NO ES UNA MARQUESINA Y ESA ES LA DECISION QUE MAS IMPORTA DE ESTE ARCHIVO.
 * Una marquesina en bucle es movimiento AUTOMATICO: WCAG 2.2.2 exige un
 * mecanismo para pausarla, y los dos que tiene la fundacion —`:hover` y
 * `:focus-within`— no existen en un telefono, donde para enfocar un enlace hay
 * que TOCARLO, o sea acertarle a un objetivo en movimiento. Dirigida por
 * scroll, el movimiento lo produce la persona: se detiene cuando deja de
 * scrollear y no hay nada que pausar. Y de paso desaparece el otro defecto: con
 * una duracion fija repartida entre 4 o entre 12 nombres, la misma cinta se
 * veia como dos cosas distintas segun cuantos clubes hubiera ese dia.
 *
 * ⚠️ SOLO LA PRIMERA COPIA ES NAVEGABLE. Sin `aria-hidden` un lector de pantalla
 * lee la lista tres veces; sin `tabIndex={-1}` quedan enlaces enfocables adentro
 * de un subarbol oculto, que es un fallo en si mismo: se tabula hacia algo que
 * no se anuncia.
 */
function Banda({
  etiqueta,
  clave,
  valores,
  inversa = false,
}: {
  etiqueta: string;
  clave: string;
  valores: Atajo[];
  inversa?: boolean;
}) {
  const nombres = valores.slice(0, TOPE_DE_LA_BANDA);
  const copias = Math.max(3, Math.ceil(ITEMS_MINIMOS_DE_BANDA / nombres.length));

  return (
    <nav
      className={[estilos.banda, inversa ? estilos.bandaInversa : ''].filter(Boolean).join(' ')}
      aria-label={etiqueta}
    >
      <div className={estilos.bandaPista}>
        {Array.from({ length: copias }, (_, copia) => (
          <ul key={copia} className={estilos.bandaGrupo} aria-hidden={copia > 0 ? true : undefined}>
            {nombres.map((valor) => (
              <li key={`${copia}-${valor.valor}`}>
                {/*
                  ⚠️ LAS COPIAS NO PREFETCHEAN. `next/link` precarga lo que entra
                  en pantalla: sin esto, la misma busqueda se pediria una vez por
                  copia visible, y las copias existen solo para que la pista sea
                  larga. La primera —la unica navegable y la unica que un lector
                  de pantalla anuncia— conserva el comportamiento normal.
                */}
                <Link
                  href={`/buscar?${clave}=${valor.valor}`}
                  className={estilos.bandaEnlace}
                  tabIndex={copia > 0 ? -1 : undefined}
                  prefetch={copia > 0 ? false : 'auto'}
                  transitionTypes={['barrido']}
                >
                  <span>{valor.etiqueta}</span>
                  {valor.cantidad !== undefined && (
                    <span className={estilos.bandaCuenta}>{valor.cantidad}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </nav>
  );
}

/**
 * Dos letras para la insignia de un atajo: "RP" para River Plate, "BO" para
 * Boca Juniors —la primera de cada una de las dos primeras palabras, o las dos
 * primeras letras si es una sola—. Es decoracion y va `aria-hidden`: el nombre
 * completo esta al lado.
 */
function monograma(nombre: string): string {
  const palabras = nombre
    .split(/[\s/-]+/)
    .map((palabra) => palabra.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((palabra) => palabra.length > 0);

  if (palabras.length === 0) return '·';
  if (palabras.length === 1) return palabras[0]!.slice(0, 2).toUpperCase();

  return `${palabras[0]![0]}${palabras[1]![0]}`.toUpperCase();
}

export default async function Home({
  searchParams,
}: {
  /**
   * ⚠️ LA HOME NO TIENE FILTROS, PERO SI TIENE UN AVISO. El corazon de una ficha
   * vuelve acá por POST y, si algo fallo, la accion redirige con
   * `?aviso=favorito`: sin leer la URL, el error seria invisible.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /**
   * ⚠️ LAS CUATRO LLAMADAS VAN EN PARALELO, NO ENCADENADAS. `listPublicCatalog`
   * trae la grilla (hasta 60 con sus portadas), el resumen trae el total real y
   * las tres facetas de catalogo, y las promocionadas son su propia consulta
   * blindada.
   */
  /*
    ⚠️ `searchParams` SE ESPERA SOLO Y PRIMERO, NO ADENTRO DEL `Promise.all`.
    Medido en el navegador: metido en el mismo `Promise.all` que
    `getSessionUser()`, la sesion volvia SIEMPRE null y la vitrina se pintaba
    sin corazones aunque la barra de arriba —que llama a la misma funcion—
    mostrara "Salir". Esperar el parametro primero deja la peticion en modo
    dinamico antes de que nadie lea la cookie, que es lo que hacen las demas
    pantallas de este grupo.
  */
  const params = await searchParams;

  const [listings, resumen, catalogo, promocionadas, user] = await Promise.all([
    listPublicCatalog(),
    resumenDeVitrina(),
    catalogoDeLaVitrina(),
    promocionadasDeLaVitrina(),
    getSessionUser(),
  ]);

  const avisoDeFavorito = params.aviso === 'favorito';

  /**
   * Que ids de la grilla estan promocionados.
   *
   * ⚠️ NO ES UNA CONSULTA MAS: las promocionadas ya vinieron para la seccion de
   * arriba, y la MISMA publicacion aparece tambien abajo, en el catalogo. Sin
   * este set, la ficha de la grilla general no llevaria distintivo y la misma
   * camiseta se veria promocionada arriba y comun abajo.
   */
  const idsPromocionados = new Set(promocionadas.map((item) => item.id));

  /**
   * Cuales de todo lo que se pinta ya tiene guardadas esta cuenta (BS-050).
   *
   * ⚠️ UNA SOLA CONSULTA PARA TODA LA PANTALLA, no una por ficha. Y sin sesion
   * ni siquiera se hace: `favoriteIdsOf` exige usuario y la ficha se pinta sin
   * corazon, que es lo que corresponde para quien todavia no tiene cuenta.
   */
  const favoritos =
    user === null
      ? new Set<string>()
      : await favoriteIdsOf(user, [
          ...new Set([...promocionadas.map((i) => i.id), ...listings.map((i) => i.id)]),
        ]);

  /**
   * Lo que la ficha necesita para su corazon, o `undefined` si no hay sesion.
   *
   * ⚠️ `volverA` LLEVA ANCLA. Sin ella, tocar la estrella de la ficha 40 devuelve
   * a la home y la deja ARRIBA DE TODO, o sea en la portada: la persona pierde
   * el lugar del catalogo en el que estaba por guardar una camiseta.
   */
  const favoritoDe = (id: string): EstadoDeFavorito | undefined =>
    user === null ? undefined : { activo: favoritos.has(id), volverA: '/#en-venta' };

  /** Fotos reales para la tira de la portada. Ya estan en memoria. */
  const tira = listings.filter((listing) => listing.coverUrl !== null).slice(0, FOTOS_DE_LA_TIRA);

  /**
   * ⚠️ LAS BANDAS SIEMPRE EXISTEN. Antes se armaban solo con las facetas de lo
   * publicado, y con menos de cuatro clubes vendiendo la home saltaba de la
   * portada a las garantias: en un marketplace recien abierto —que es cuando
   * mas tiene que convencer— la seccion mas reconocible no aparecia. Con pocas
   * facetas la banda corre sobre el catalogo sembrado, sin conteos.
   */
  const bandaClubes = atajosDe(
    resumen.club,
    catalogo.clubes,
    MINIMO_PARA_LA_BANDA,
    TOPE_DE_LA_BANDA,
    TOPE_DE_LA_BANDA,
  );
  const bandaMarcas = atajosDe(
    resumen.marca,
    catalogo.marcas,
    MINIMO_PARA_LA_BANDA,
    TOPE_DE_LA_BANDA,
    TOPE_DE_LA_BANDA,
  );

  /**
   * Atajos. Clubes y marcas siempre; temporadas solo cuando hay facetas
   * reales: 135 temporadas sembradas no son un atajo, son un almanaque.
   */
  const explorar: { titulo: string; clave: string; valores: Atajo[] }[] = [
    {
      titulo: 'Clubes',
      clave: 'club',
      valores: atajosDe(resumen.club, catalogo.clubes, 1, TOPE_CLUBES, TOPE_CATALOGO_CLUBES),
    },
    {
      titulo: 'Marcas',
      clave: 'marca',
      valores: atajosDe(resumen.marca, catalogo.marcas, 1, TOPE_RESTO, TOPE_CATALOGO_RESTO),
    },
    {
      titulo: 'Temporadas',
      clave: 'temporada',
      valores: resumen.temporada.slice(0, TOPE_RESTO).map(desdeFaceta),
    },
  ].filter((grupo) => grupo.valores.length > 0);

  return (
    <>
      <Header />

      {/*
        Progreso de lectura. ⚠️ VA `aria-hidden` Y FUERA DE `Pantalla`: para un
        lector de pantalla es informacion redundante —ya sabe donde esta en el
        documento— y es `position: fixed`, asi que no tiene por que entrar en la
        captura de la transicion de pantalla.
      */}
      <div className="barra-lectura" aria-hidden="true" />

      <Pantalla>
        <main id="contenido">
          {/*
            PORTADA. La superficie la pone `.sup-cancha`, que ademas cablea el
            anillo de foco y los ocho tokens de boton: por eso el modulo ya no
            escribe ni el fondo ni las variantes a mano.

            ⚠️ TRES PLANOS REALES, no un fondo con textura: el patron deriva poco
            (esta lejos), la tira de fotos deriva mas (esta en el medio) y el
            bloque de texto deriva EN CONTRA (esta adelante). Sin una capa que
            vaya al reves, el paralaje se lee como "todo se movio un poco".

            ⚠️ LAS TRES USAN `paralaje-portada` (`scroll(root)`) Y NO `view()`.
            La portada YA esta en pantalla cuando la persona empieza a bajar: con
            `view()` arrancaria su animacion por la mitad.
          */}
          <section className={`${estilos.portada} sup-cancha con-grano`}>
            <div
              className={`${estilos.portadaPatron} patron-vivo paralaje-portada`}
              aria-hidden="true"
            />

            {/*
              ⚠️ CAMISETAS EN LA PORTADA DE UN MARKETPLACE DE CAMISETAS. Hasta
              ahora la tapa era tipografia sobre un damero: quien entraba no veia
              una prenda hasta el segundo scroll. Son publicaciones REALES y no
              cuestan una consulta: ya vinieron con la grilla.

              ⚠️ NO LLEVAN `FotoCompartida`. Dos elementos con el mismo
              `viewTransitionName` en la misma pantalla rompen la transicion
              entera, y estas fotos son las mismas que estan mas abajo en la
              grilla, que si tiene que hacer morph al entrar a la ficha.

              ⚠️ `fetchPriority="low"`: son ornamento. No pueden competir por
              ancho de banda con la grilla, que es el contenido.
            */}
            {/*
              ⚠️ LA PORTADA NO PUEDE DEPENDER DE QUE HAYA FOTOS. La tira de fotos
              anterior solo aparecia con tres o mas publicaciones con foto, y en
              un marketplace recien abierto —que es cuando mas tiene que
              convencer— la mitad derecha quedaba VACIA: un damero tenue y nada
              mas. Ahora hay SIEMPRE tres cartas: con fotos reales de la vitrina
              si existen, y con la camiseta de la identidad si no. Las cifras
              salen del catalogo sembrado. Nada inventado.
            */}
            {/*
              ⚠️ `paralaje-portada` VA EN EL HIJO, NO EN EL CONTENEDOR. La clase
              anima `transform`, y el contenedor usa `transform` para centrarse
              verticalmente: en el mismo elemento, la animacion pisa el centrado
              y la escena aparece corrida media altura hacia abajo, cortada por
              el borde de la portada. Es el mismo reparto que tenia la tira.
            */}
            <div className={estilos.portadaVisual} aria-hidden="true">
              <div className={`${estilos.escenario} tilt-escena paralaje-portada`}>
                <div
                  className={`${estilos.camisetaCarta} flota-lento aparece-escala`}
                  data-pos="a"
                  style={{ '--retraso': '120ms' } as CSSProperties}
                >
                  {tira[0]?.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className={estilos.cartaFoto}
                      src={tira[0].coverUrl ?? ''}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                    />
                  ) : (
                    <IconoCamiseta className={estilos.cartaIcono} tamanio={160} strokeWidth={0.9} />
                  )}
                  <span className={estilos.cartaEtiqueta}>Retro</span>
                </div>
                <div
                  className={`${estilos.camisetaCarta} flota aparece-escala`}
                  data-pos="b"
                  style={{ '--retraso': '260ms' } as CSSProperties}
                >
                  {tira[1]?.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className={estilos.cartaFoto}
                      src={tira[1].coverUrl ?? ''}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                    />
                  ) : (
                    <IconoCamiseta className={estilos.cartaIcono} tamanio={160} strokeWidth={0.9} />
                  )}
                  <span className={estilos.cartaEtiqueta}>De época</span>
                </div>
                <div
                  className={`${estilos.camisetaCarta} flota-inverso aparece-escala`}
                  data-pos="c"
                  style={{ '--retraso': '400ms' } as CSSProperties}
                >
                  {tira[2]?.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className={estilos.cartaFoto}
                      src={tira[2].coverUrl ?? ''}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                    />
                  ) : (
                    <IconoCamiseta className={estilos.cartaIcono} tamanio={160} strokeWidth={0.9} />
                  )}
                  <span className={estilos.cartaEtiqueta}>De temporada</span>
                </div>
                <ul className={`${estilos.chipsDatos} escalona`}>
                  <li className={estilos.chipDato}>
                    <span className={estilos.chipNumero}>{catalogo.clubes.length}</span>
                    <span className={estilos.chipTexto}>clubes</span>
                  </li>
                  <li className={estilos.chipDato}>
                    <span className={estilos.chipNumero}>{catalogo.marcas.length}</span>
                    <span className={estilos.chipTexto}>marcas</span>
                  </li>
                  <li className={estilos.chipDato}>
                    <span className={estilos.chipNumero}>{catalogo.temporadas.length}</span>
                    <span className={estilos.chipTexto}>temporadas</span>
                  </li>
                </ul>
              </div>
            </div>
            <div className={`${estilos.portadaContenido} paralaje-portada`}>
              <p className={`${estilos.antetitulo} entra ${estilos.retraso1}`}>
                Marketplace de camisetas
              </p>

              {/*
                ⚠️ EL TITULAR SE COMPONE A MANO, LINEA POR LINEA. No hay forma de
                partir un titulo en lineas con CSS sin JavaScript, y aca la
                composicion es una decision: donde corta el titular de una tapa
                lo decide quien la diseña, igual que en una revista. El `<span>`
                externo enmascara y el interno se alza.

                ⚠️ ES `entra-lineas` Y NO `revela-lineas`: esto esta ARRIBA DEL
                PLIEGUE. Un revelado por scroll arrancaria con la animacion ya
                empezada, y en un navegador sin `animation-timeline` se quedaria
                quieto.

                A 320px `--display-1` entrega 52px y Big Noodle da unos 13
                caracteres por linea: "CAMISETAS" son 9 y "CON HISTORIA" son 12.
              */}
              <h1 className={`${estilos.titulo} display entra-lineas`}>
                <span>
                  <span>Camisetas</span>
                </span>
                <span>
                  <span className="oblicuo">con historia</span>
                </span>
              </h1>

              <p className={`${estilos.bajada} entra ${estilos.retraso2}`}>
                Compra y venta de camisetas de fútbol para coleccionistas. Retro, de época y de
                temporada, publicadas por quien las tuvo puestas.
              </p>

              {/*
                ⚠️ EL DESTELLO VA EN EL SECUNDARIO, NO EN EL PRIMARIO. Sobre verde
                el primario es Amarillo Cambio macizo y el destello de esta
                superficie tambien es amarillo: seria invisible. El secundario es
                de contorno, asi que el barrido se ve contra el verde.
              */}
              <div className={`${estilos.acciones} entra ${estilos.retraso3}`}>
                <BotonEnlace href="/buscar" tamanio="grande" className="presiona">
                  Ver todas las camisetas
                </BotonEnlace>
                <BotonEnlace
                  href="/vendedor/empezar"
                  tamanio="grande"
                  variante="secundario"
                  className="destello presiona"
                >
                  Vender la mía
                </BotonEnlace>
              </div>

              {/*
                ⚠️ EL NUMERO ES TEXTO DE VERDAD Y NO UN `counter()`. Un
                `content: counter(cifra)` animando una custom property no se
                selecciona, no se copia, y si `@property` no esta soportado el
                `counter-reset` invalido deja el elemento LITERALMENTE VACIO.
                `.cifra-entra` da la misma sensacion —el numero se alza desde
                atras de su mascara— mostrando el valor FINAL desde el primer
                cuadro, que ademas es la unica animacion que el sistema permite
                sobre una cifra.

                ⚠️ EL TOTAL SALE DEL RESUMEN, NO DE LA GRILLA. La vitrina corta
                en 60 y decir "60" cuando hay 300 seria mentir. Se rinde solo
                cuando ademas hay grilla: son dos filtros escritos por separado
                —la misma duplicacion consciente que ya existe entre
                `isPurchasable()` y el WHERE del catalogo— y sin grilla el numero
                no tendria contra que contrastarse.
              */}
              {resumen.total > 0 && listings.length > 0 && (
                <p className={`${estilos.cifra} entra ${estilos.retraso4}`}>
                  <span className={`${estilos.cifraNumero} cifra-entra`}>
                    <span>{resumen.total}</span>
                  </span>
                  <span className={estilos.cifraEtiqueta}>
                    {resumen.total === 1 ? 'camiseta en venta ahora' : 'camisetas en venta ahora'}
                  </span>
                </p>
              )}

              {/*
                ⚠️ LA SEÑAL DE "SEGUI BAJANDO" ES UN ENLACE, NO UNA FLECHA QUE
                REBOTA. Una flecha animada en bucle al lado de un titular es
                movimiento perpetuo que WCAG 2.2.2 obliga a poder frenar y que
                ademas no hace nada al tocarla. Esto lleva de verdad al catalogo,
                funciona sin JavaScript y el `scroll-padding-top` de `html` evita
                que la barra adherida tape el destino.
              */}
              <a href="#en-venta" className={`${estilos.bajar} entra ${estilos.retraso4}`}>
                <span className={estilos.bajarLinea} aria-hidden="true" />
                Ver el catálogo
              </a>
            </div>
          </section>

          {/*
            BANDAS DE CATALOGO.

            ⚠️ EL CORTE DIAGONAL LO HACE ESTA SECCION, NO LA PORTADA. `clip-path`
            recorta el elemento y deja ver LO QUE HAY DETRAS —que es el fondo del
            documento—, no la seccion siguiente: cortar la portada dejaba una
            cuña de papel entre el verde y el bloque casi negro, con el borde de
            abajo igual de recto. El bloque que ENTRA se come en diagonal al que
            sale, sube 40px con margen negativo y tapa: un solo borde, y es
            diagonal.

            ⚠️ DOS BANDAS EN SENTIDOS OPUESTOS. Es la firma visual mas
            reconocible del recurso y los datos ya estan en memoria: `marca`
            viene en la misma respuesta que `club`.
          */}
          <section className={`${estilos.cinta} ${estilos.corte} sup-fosa`}>
            <Banda etiqueta="Clubes" clave="club" valores={bandaClubes} />
            <Banda etiqueta="Marcas" clave="marca" valores={bandaMarcas} inversa />
          </section>

          {/*
            CATEGORIAS. Las seis prendas del enum `garment_category`, que son
            fijas (ERD §5, DEC-041) y por eso pueden ser la primera decision
            que la home le ofrece a alguien: antes de un club o una temporada,
            que tipo de prenda busca. Cada ficha lleva a la busqueda filtrada
            por `categoria`, que ya existia como faceta y nadie encontraba.

            ⚠️ NO DICE CUANTAS HAY DE CADA UNA. Las categorias vienen de la
            tabla y no de las facetas: decir "0" al lado de Shorts en un
            marketplace de dos semanas es cierto y es lo contrario de invitar.

            ⚠️ EL REVELADO VA EN LA LISTA, NO EN LA SECCION: la seccion lleva
            `.patron-vivo` en un hijo y ese hijo es `overflow: hidden`.
          */}
          <section
            className={`${estilos.categorias} sup-marca`}
            aria-labelledby="categorias-titulo"
          >
            <div
              className={`${estilos.categoriasPatron} patron-vivo patron-vivo-fino`}
              aria-hidden="true"
            />
            <div className={estilos.categoriasInterior}>
              <div className={estilos.encabezado}>
                <div>
                  <p className={estilos.seccionEtiqueta}>Qué buscás</p>
                  <h2
                    id="categorias-titulo"
                    className={`${estilos.tituloSeccion} display display-3`}
                  >
                    Elegí la prenda
                  </h2>
                </div>
                <p className={estilos.cuenta}>Seis categorías, todas con fotos reales</p>
              </div>

              <ul className={`${estilos.categoriasLista} revela-grilla-materia`}>
                {catalogo.categorias.map((categoria, indice) => {
                  const Icono = ICONO_DE_CATEGORIA[categoria.code] ?? IconoCamiseta;

                  return (
                    <li key={categoria.id}>
                      <Link
                        href={`/buscar?categoria=${categoria.id}`}
                        className={`${estilos.categoria} sup-ficha eleva-marca borde-brilla destello icono-crece`}
                        transitionTypes={['barrido']}
                      >
                        <span className={estilos.categoriaOrden} aria-hidden="true">
                          {String(indice + 1).padStart(2, '0')}
                        </span>
                        <span className={estilos.categoriaIcono} aria-hidden="true">
                          <Icono tamanio={34} />
                        </span>
                        <span className={estilos.categoriaNombre}>{categoria.name}</span>
                        <span className={estilos.categoriaFlecha} aria-hidden="true">
                          <IconoFlechaDerecha tamanio={18} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {/*
            ⚠️ NO ES UNA TIRA DE ADORNO. Es la unica parte del sitio que explica
            como funciona Offside antes de que alguien tenga que registrarse para
            averiguarlo. Los iconos salen del §04 de la identidad.

            ⚠️ LA SUPERFICIE CALIDA ROMPE EL PAPEL SOBRE PAPEL. Con blanco sobre
            papel, la mitad del scroll de la home era una sola densidad.
            `.sup-calida` ademas remapea sola los dos tokens de texto que sobre
            un lavado caen debajo de AA.

            ⚠️ EL PATRON VA EN UN HIJO VACIO, NUNCA EN LA SECCION. `.patron-vivo`
            declara `overflow: hidden`, y un `overflow: hidden` ES un contenedor
            de scroll: si lo llevara la seccion, el `view()` de todo lo que tiene
            adentro mediria contra una caja que no scrollea nunca y la lista
            quedaria clavada en `opacity: 0`.
          */}
          <section
            className={`${estilos.garantias} sup-calida`}
            id="como-funciona"
            aria-label="Cómo funciona"
          >
            <div
              className={`${estilos.garantiasPatron} patron-vivo diagonales-vivas`}
              aria-hidden="true"
            />

            <div className={estilos.garantiasInterior}>
              <hr className={`regla regla-acento revela-linea ${estilos.reglaSeccion}`} />
              <ul className={`${estilos.garantiasLista} revela-grilla-materia`}>
                {GARANTIAS.map((garantia) => (
                  <li key={garantia.titulo} className={estilos.garantia}>
                    <span className={estilos.garantiaOrden} aria-hidden="true">
                      {garantia.orden}
                    </span>
                    <span className={estilos.garantiaIcono} aria-hidden="true">
                      {garantia.icono}
                    </span>
                    <h2 className={estilos.garantiaTitulo}>{garantia.titulo}</h2>
                    <p className={estilos.garantiaDetalle}>{garantia.detalle}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/*
            PROMOCIONADAS (PS-021).

            ⚠️ VA ARRIBA DEL CATALOGO Y NO MEZCLADA ADENTRO. Un marketplace que
            intercala lo pago con lo organico sin decirlo está vendiendo
            posiciones en secreto; separado y rotulado, quien mira sabe qué está
            viendo. Las MISMAS publicaciones aparecen despues en la grilla
            general —con su distintivo— porque siguen siendo catalogo.

            ⚠️ EL TEXTO DICE QUIEN PAGO Y QUE NO SIGNIFICA. "El vendedor pagó por
            aparecer acá" es verificable; "Las mejores de la semana" seria un
            juicio de Offside sobre publicaciones que Offside no eligio.

            ⚠️ NO DICE CUANTO CUESTA PROMOCIONAR. El multiplicador y la duracion
            son ⚙️ CONFIGURABLES (Config Store): escribirlos acá los clavaria en
            el codigo. Quien quiera el numero lo tiene en `/como-funciona`, que
            lo lee del Config Store.

            ⚠️ SIN SECCION CUANDO NO HAY NINGUNA. Un rotulo "Promocionadas" sobre
            una fila vacia es peor que no tenerlo: parece una funcionalidad rota.
          */}
          {promocionadas.length > 0 && (
            <section
              className={estilos.promocionadas}
              id="promocionadas"
              aria-labelledby="promocionadas-titulo"
            >
              <div className={estilos.encabezado}>
                <div>
                  <p className={estilos.seccionEtiqueta}>Promocionadas</p>
                  <h2
                    id="promocionadas-titulo"
                    className={`${estilos.tituloSeccion} display display-3`}
                  >
                    Las que quieren que veas
                  </h2>
                </div>
                <p className={estilos.cuenta}>El vendedor pagó por aparecer acá</p>
              </div>

              <hr className={`regla regla-acento revela-linea ${estilos.reglaCatalogo}`} />

              {/*
                ⚠️ `compartirFoto={false}` NO ES UN DETALLE: ESTA MISMA
                PUBLICACION APARECE ABAJO, EN LA GRILLA GENERAL. Dos elementos
                con el mismo `view-transition-name` vivos a la vez rompen la
                transicion ENTERA —React lo grita por consola y el navegador
                aborta la animacion—, asi que la copia de arriba viaja sin
                nombre y el morph hacia la ficha se lo queda la grilla, que es
                donde esta el catalogo completo.
              */}
              <ul className={`${estilos.grilla} enfoca-hermanos revela-grilla-materia`}>
                {promocionadas.map((listing) => (
                  <li key={listing.id}>
                    <ListingCard
                      listing={listing}
                      promocionada
                      compartirFoto={false}
                      favorito={favoritoDe(listing.id)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={estilos.catalogo} id="en-venta">
            {/*
              ROTULO CINETICO. Movimiento permanente y a la vez completamente
              controlado por la persona, que es la unica forma de tener dinamismo
              sin distraer.

              ⚠️ ES DECORACION PURA Y POR ESO VA `aria-hidden`. No dice nada que
              no este dicho en otro lado, asi que no tiene requisito de contraste
              (WCAG 1.4.3 excluye el texto decorativo) — y justamente por eso NO
              puede llevar informacion nunca.
            */}
            <div className={estilos.rotulo} aria-hidden="true">
              <div className={`${estilos.rotuloPista} corre-con-scroll`}>
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i}>Camisetas con historia ·</span>
                ))}
              </div>
            </div>

            <div className={estilos.encabezado}>
              <div>
                <p className={estilos.seccionEtiqueta}>Catálogo</p>
                <h2 className={`${estilos.tituloSeccion} display display-3`}>En venta</h2>
              </div>
              {listings.length > 0 && (
                <p className={estilos.cuenta}>
                  {/*
                    ⚠️ LA VITRINA CORTA EN 60 Y NO HAY PAGINACION. El repositorio
                    aplica `limit(60)` por defecto, asi que la publicacion 61 no
                    es alcanzable desde esta pantalla. Cuando se llega al tope se
                    dice "mas recientes" en vez de mentir un total; el enlace a la
                    busqueda es un parche honesto, no la solucion.
                  */}
                  {listings.length === 1 ? '1 publicación' : `${listings.length} publicaciones`}
                  {listings.length >= TOPE_DE_LA_VITRINA && ' más recientes'}
                </p>
              )}
            </div>

            <hr className={`regla revela-linea ${estilos.reglaCatalogo}`} />

            {/*
              ⚠️ EL UNICO AVISO DE ESTA PANTALLA, Y APARECE SOLO SI FALLO ALGO.
              `alternarFavorito` no tiene estado —es un `<form>` pelado dentro de
              una grilla de 60, sin un componente cliente por ficha—, asi que la
              unica forma de contar que no se pudo guardar es este codigo en la
              URL. No dice POR QUE: el motivo exacto quedo en el log del servidor
              y un texto que viaje por la URL lo escribe cualquiera.
            */}
            {avisoDeFavorito && (
              <div className={estilos.avisoFavorito}>
                <Aviso tono="error">
                  No pudimos guardar la publicación. Probá de nuevo en un momento.
                </Aviso>
              </div>
            )}

            {listings.length === 0 ? (
              /*
                ⚠️ EL ESTADO VACIO ES EL ESTADO MAS PROBABLE DE UN MARKETPLACE
                NUEVO, asi que tiene composicion propia en vez del cuadrito gris
                generico. Con el catalogo vacio no hay bandas, no hay atajos y no
                hay grilla: si esto fuera un icono y dos renglones, la home entera
                seria una portada cinematografica y un hueco.
              */
              <div className={`${estilos.vacio} sup-marca`}>
                <div className={`${estilos.vacioPatron} patron-vivo`} aria-hidden="true" />
                <div className={estilos.vacioInterior}>
                  <p className={estilos.seccionEtiqueta}>Recién empezamos</p>
                  <p className={`${estilos.vacioTitulo} display display-2`}>
                    Todavía no hay <span className="oblicuo">nada acá</span>
                  </p>
                  <p className={estilos.vacioDetalle}>
                    Cuando un vendedor publique su primera camiseta, va a aparecer en esta grilla.
                    Podés ser el primero.
                  </p>
                  <BotonEnlace href="/vendedor/empezar" tamanio="grande" className="presiona">
                    Publicar la primera
                  </BotonEnlace>
                </div>
              </div>
            ) : (
              <>
                {/*
                  ⚠️ `enfoca-hermanos` SOLO TOCA LA FOTO, NUNCA EL TEXTO, y solo
                  con puntero fino: en un telefono el `:hover` queda pegado
                  despues de un toque y la grilla se quedaria con las demas fotos
                  apagadas. Una foto no tiene requisito de contraste; un precio
                  si, y por eso no se le baja la opacidad a la ficha.
                */}
                <ul className={`${estilos.grilla} enfoca-hermanos revela-grilla-materia`}>
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

                <div className={estilos.verTodo}>
                  <BotonEnlace href="/buscar" variante="secundario" className="presiona">
                    Buscar por club, marca o temporada
                  </BotonEnlace>
                </div>
              </>
            )}
          </section>

          {/*
            EXPLORAR POR CATALOGO. Es la mitad visible de PS-023: las facetas ya
            existian, pero habia que entrar a `/buscar` para descubrir que
            existian.

            ⚠️ EL REVELADO VA EN `.grupo`, NO EN `.fichas`. En telefono `.fichas`
            pasa a `overflow-x: auto`, o sea a contenedor de scroll: cualquier
            `view()` adentro mediria contra esa caja y las fichas quedarian
            invisibles. Se revela el grupo entero, que esta afuera.
          */}
          {explorar.length > 0 && (
            <section
              className={`${estilos.explorar} sup-2 escena-luz`}
              aria-labelledby="explorar-titulo"
            >
              <div className="blobs" aria-hidden="true">
                <span className="blob blob-cancha blob-grande" />
                <span className="blob blob-cambio blob-chico" />
              </div>
              <div className={estilos.explorarInterior}>
                <p className={estilos.seccionEtiqueta}>Atajos</p>
                <h2 id="explorar-titulo" className={`${estilos.tituloSeccion} display display-3`}>
                  Buscá por lo que te importa
                </h2>

                {explorar.map((grupo) => (
                  <div key={grupo.clave} className={`${estilos.grupo} revela-acerca`}>
                    <h3 className={estilos.grupoTitulo}>{grupo.titulo}</h3>
                    <ul className={estilos.fichas} data-grupo={grupo.clave}>
                      {grupo.valores.map((valor) => (
                        <li key={valor.valor}>
                          <Link
                            href={`/buscar?${grupo.clave}=${valor.valor}`}
                            className={`${estilos.ficha} sup-ficha eleva destello icono-vivo`}
                            transitionTypes={['barrido']}
                          >
                            <span className={estilos.fichaMonograma} aria-hidden="true">
                              {monograma(valor.etiqueta)}
                            </span>
                            <span className={estilos.fichaTexto}>
                              <span className={estilos.fichaNombre}>{valor.etiqueta}</span>
                              <span className={estilos.fichaCuenta}>
                                {valor.cantidad === undefined
                                  ? 'Ver camisetas'
                                  : valor.cantidad === 1
                                    ? '1 camiseta'
                                    : `${valor.cantidad} camisetas`}
                              </span>
                            </span>
                            <span className={estilos.fichaFlecha} aria-hidden="true">
                              <IconoFlechaDerecha tamanio={16} />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/*
            CIERRE. El final de la vitrina era el ultimo renglon de la grilla:
            quien bajaba hasta abajo se quedaba sin nada que hacer.

            ⚠️ NO PROMETE NADA QUE EL SITIO NO HAGA. No dice "vendé en un minuto"
            ni "llegá a miles de compradores": dice los tres pasos que el sistema
            realmente exige (email verificado, identificador fiscal, Mercado Pago
            conectado, TS-001/DEC-044) y manda a `/como-funciona`, que es donde
            vive la seccion "Lo que todavía no hacemos".

            ⚠️ EL TITULAR USA `entra-lineas` Y NO `revela-lineas`, AUNQUE ESTE
            ABAJO DEL PLIEGUE. Es el ULTIMO bloque del documento:
            `revela-lineas` corre su tercera linea hasta `cover 42%`, y si no
            queda scroll suficiente —catalogo vacio, pocas fichas— la animacion
            nunca llega al ultimo cuadro y `both` deja la palabra en
            `translateY(100%)` adentro de una mascara con `overflow: clip`. O
            sea: el titular mas grande de la pagina diria "TENÉS UNA / CAMISETA"
            y faltaria "GUARDADA". Con el reloj, el estado final esta
            garantizado.
          */}
          <section
            className={`${estilos.cierre} ${estilos.corte} sup-noche con-grano`}
            aria-labelledby="cierre-titulo"
          >
            <div
              className={`${estilos.cierrePatron} patron-vivo diagonales-vivas`}
              aria-hidden="true"
            />

            <div className={estilos.cierreInterior}>
              <p className={estilos.seccionEtiqueta}>Vendé lo tuyo</p>

              <h2
                id="cierre-titulo"
                className={`${estilos.cierreTitulo} display display-2 entra-lineas`}
              >
                <span>
                  <span>Tenés una</span>
                </span>
                <span>
                  <span className="oblicuo">camiseta</span>
                </span>
                <span>
                  <span>guardada</span>
                </span>
              </h2>

              <p className={estilos.cierreBajada}>
                Verificás tu email, declarás tu CUIT, CUIL o CDI y conectás tu cuenta de Mercado
                Pago. Con las tres cosas ya podés publicar, y cobrás en tu propia cuenta.
              </p>

              <div className={estilos.acciones}>
                <BotonEnlace href="/vendedor/empezar" tamanio="grande" className="presiona">
                  Empezar a vender
                </BotonEnlace>
                <BotonEnlace
                  href="/como-funciona"
                  tamanio="grande"
                  variante="secundario"
                  className="destello presiona"
                >
                  Cómo funciona
                </BotonEnlace>
              </div>
            </div>
          </section>
        </main>
      </Pantalla>

      <Footer />
    </>
  );
}
