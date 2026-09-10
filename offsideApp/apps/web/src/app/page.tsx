import Link from 'next/link';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { IconoAutenticado, IconoCamiseta, IconoIntercambio } from '@/components/iconos';
import { ListingCard } from '@/components/listing-card';
import { Pantalla } from '@/components/movimiento';
import { BotonEnlace } from '@/components/ui';
import { listPublicCatalog } from '@/modules/listings/services/listing.service';
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

/**
 * ⚠️ LA TIRA DE FOTOS DE LA PORTADA SON PUBLICACIONES REALES, NO UN MOCKUP.
 * Salen de `listings`, que ya esta en memoria: cero consultas extra. Con menos
 * de tres no se muestra —dos fotos sueltas en diagonal se ven como un error de
 * maquetado, no como una tira—.
 */
const MINIMO_PARA_LA_TIRA = 3;
const FOTOS_DE_LA_TIRA = 7;

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
  valores: Faceta[];
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
                  <span className={estilos.bandaCuenta}>{valor.cantidad}</span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </nav>
  );
}

export default async function Home() {
  /**
   * ⚠️ LAS DOS LLAMADAS VAN EN PARALELO, NO ENCADENADAS. `listPublicCatalog`
   * trae la grilla (hasta 60 con sus portadas) y el resumen trae el total real y
   * las tres facetas de catalogo.
   */
  const [listings, resumen] = await Promise.all([listPublicCatalog(), resumenDeVitrina()]);

  const clubes = resumen.club;
  const marcas = resumen.marca;

  /** Fotos reales para la tira de la portada. Ya estan en memoria. */
  const tira = listings.filter((listing) => listing.coverUrl !== null).slice(0, FOTOS_DE_LA_TIRA);

  /** Un grupo vacio no se arma: la seccion entera desaparece si no hay ninguno. */
  const explorar: { titulo: string; clave: string; valores: Faceta[] }[] = [
    { titulo: 'Clubes', clave: 'club', valores: clubes.slice(0, TOPE_CLUBES) },
    { titulo: 'Marcas', clave: 'marca', valores: marcas.slice(0, TOPE_RESTO) },
    { titulo: 'Temporadas', clave: 'temporada', valores: resumen.temporada.slice(0, TOPE_RESTO) },
  ].filter((grupo) => grupo.valores.length > 0);

  const hayBandas = clubes.length >= MINIMO_PARA_LA_BANDA || marcas.length >= MINIMO_PARA_LA_BANDA;

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
            {tira.length >= MINIMO_PARA_LA_TIRA && (
              <div className={estilos.portadaTira} aria-hidden="true">
                <div className={`${estilos.portadaTiraPista} paralaje-portada`}>
                  {tira.map((listing) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      key={listing.id}
                      className={estilos.tiraFoto}
                      src={listing.coverUrl ?? ''}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                    />
                  ))}
                </div>
              </div>
            )}

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
                  <span className={estilos.cifraEtiqueta}>camisetas en venta ahora</span>
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
          {hayBandas && (
            <section className={`${estilos.cinta} ${estilos.corte} sup-fosa`}>
              {clubes.length >= MINIMO_PARA_LA_BANDA && (
                <Banda etiqueta="Clubes con camisetas publicadas" clave="club" valores={clubes} />
              )}
              {marcas.length >= MINIMO_PARA_LA_BANDA && (
                <Banda
                  etiqueta="Marcas con camisetas publicadas"
                  clave="marca"
                  valores={marcas}
                  inversa
                />
              )}
            </section>
          )}

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
                      <ListingCard listing={listing} />
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
            <section className={`${estilos.explorar} sup-2`} aria-labelledby="explorar-titulo">
              <div className={estilos.explorarInterior}>
                <p className={estilos.seccionEtiqueta}>Atajos</p>
                <h2 id="explorar-titulo" className={`${estilos.tituloSeccion} display display-3`}>
                  Buscá por lo que te importa
                </h2>

                {explorar.map((grupo) => (
                  <div key={grupo.clave} className={`${estilos.grupo} revela-acerca`}>
                    <h3 className={estilos.grupoTitulo}>{grupo.titulo}</h3>
                    <ul className={estilos.fichas}>
                      {grupo.valores.map((valor) => (
                        <li key={valor.valor}>
                          <Link
                            href={`/buscar?${grupo.clave}=${valor.valor}`}
                            className={`${estilos.ficha} sup-ficha eleva destello`}
                            transitionTypes={['barrido']}
                          >
                            <span className={estilos.fichaNombre}>{valor.etiqueta}</span>
                            <span className={estilos.fichaCuenta}>
                              {valor.cantidad === 1 ? '1 camiseta' : `${valor.cantidad} camisetas`}
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
