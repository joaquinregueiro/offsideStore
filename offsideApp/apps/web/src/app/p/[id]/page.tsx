import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';

import { Footer } from '@/components/footer';
import { AreaDeTexto, CampoOculto, Formulario, Seleccion } from '@/components/form';
import { Header } from '@/components/header';
import {
  IconoAutenticado,
  IconoBandera,
  IconoCamion,
  IconoEtiqueta,
  IconoFavorito,
  IconoLlave,
  IconoPregunta,
  IconoTilde,
} from '@/components/iconos';
import { FotoCompartida, Pantalla } from '@/components/movimiento';
import {
  Aviso,
  BotonEnlace,
  Confirmar,
  Estrellas,
  Etiqueta,
  InsigniaDeNivel,
  InsigniaDeReputacion,
  Migas,
  Pliego,
  Precio,
} from '@/components/ui';
import {
  cantidad as cantidadLegible,
  condicion,
  fecha,
  fechaRelativa,
  horas,
  manga,
  modoDeEnvioCorto,
  porcentajeDeComision,
  precio,
  tipoDeCamiseta,
} from '@/lib/formato';
import { getSessionUser } from '@/lib/session';
import { isFeatureEnabled } from '@/modules/config/services/setting-store.service';
import { favoriteIdsOf } from '@/modules/favorites/services/favorite.service';
import { findPublicListing } from '@/modules/listings/services/listing.service';
import {
  averageAnswerHours,
  listPublicQuestions,
  type PublicQuestion,
} from '@/modules/questions/services/question.service';
import {
  getSellerReputation,
  getSellerReputationForUser,
} from '@/modules/reputation/services/reputation.service';
import { REPORT_REASONS } from '@/modules/reports/services/report.service';
import { listSellerReviews } from '@/modules/reviews/services/review.service';
import { getTierProgress } from '@/modules/sellers/services/seller-tier.service';

import { agregarAlCarrito } from '../../carrito/acciones';
import { alternarFavorito, preguntar, reportarPublicacion } from '../../acciones';
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

/**
 * Cuantas reseñas del vendedor entran en la ficha.
 *
 * ⚠️ TRES Y NO VEINTE. Esta pantalla es de una CAMISETA: veinte reseñas de otras
 * ventas empujan la compra fuera del viewport y convierten la ficha en el perfil
 * del vendedor, que ya existe y esta a un enlace. Tres alcanzan para dar tono.
 */
const TOPE_DE_RESENAS = 3;

/**
 * ⚠️ SE LEE `process.env` DIRECTO Y NO `getEnv()`, POR LA MISMA RAZON QUE
 * `app/layout.tsx`: `getEnv()` valida el entorno ENTERO y tira si falta
 * cualquier variable. La ficha publica no deberia dejar de servirse porque no
 * este configurado Mercado Pago. Aca solo hace falta una URL base para armar el
 * enlace que se comparte, y si no esta, localhost sirve.
 */
const URL_BASE = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await findPublicListing(id);

  if (listing === null) return { title: 'Publicación no encontrada' };

  /*
   * ⚠️ ESTA ES LA PANTALLA QUE MAS SE COMPARTE DEL SITIO. El enlace de una
   * camiseta viaja por WhatsApp, y sin Open Graph WhatsApp muestra la URL
   * pelada: ni el titulo, ni el precio, ni la foto.
   *
   * ⚠️ EL PRECIO VA EN LA BAJADA, no en el titulo. En el titulo lo cortaria
   * cualquier previsualizacion; en la bajada sobrevive y es el dato que decide
   * si alguien abre el enlace o no.
   */
  const portada = listing.images[0];
  const bajada =
    listing.description ??
    `${condicion(listing.condition)} · Talle ${listing.sizeValue} · ${precio(
      listing.priceAmount,
      listing.currency,
    )}`;

  return {
    title: listing.title,
    description: bajada,
    openGraph: {
      type: 'website',
      title: listing.title,
      description: bajada,
      ...(portada === undefined ? {} : { images: [{ url: portada.url, alt: listing.title }] }),
    },
  };
}

/**
 * Una fila de la ficha tecnica.
 *
 * ⚠️ CADA PAR VA EN SU PROPIO `<div>` ADENTRO DEL `<dl>`. Es marcado valido
 * desde HTML 5.2 y es lo unico que permite darle a la fila su propia caja y su
 * propio filete sin tocar el resto.
 */
function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className={estilos.dato}>
      <dt>{etiqueta}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Cuantas unidades se pueden elegir de una vez.
 *
 * ⚠️ NO ES UNA REGLA DE NEGOCIO: `MAX_QUANTITY_PER_LINE` del carrito es 99 y el
 * stock real lo valida `addToCart`. Esto es un techo de pantalla —un desplegable
 * con 99 opciones no es un selector— y siempre se acota al stock, asi que nunca
 * se puede elegir mas de lo que hay.
 */
const TOPE_DE_CANTIDAD = 10;

/**
 * Preguntas y respuestas de la publicacion (BS-040).
 *
 * ⚠️ NUNCA DICE QUIEN PREGUNTO. `PublicQuestion` directamente no trae al autor, y
 * eso es del Service, no un olvido de la pantalla: en un marketplace la lista de
 * quien preguntó por una camiseta es la lista de quien la está por comprar.
 *
 * ⚠️ LAS SIN RESPONDER SE MUESTRAN IGUAL. Esconderlas dejaría la sección vacía
 * en una publicación nueva y, peor, borraría la única señal honesta que hay de
 * que el vendedor no contesta.
 */
function Preguntas({ preguntas }: { preguntas: PublicQuestion[] }) {
  const ahora = new Date();

  return (
    <ol className={estilos.preguntas}>
      {preguntas.map((pregunta) => (
        <li key={pregunta.id} className={estilos.pregunta}>
          <p className={estilos.preguntaTexto}>
            <span className={estilos.preguntaMarca} aria-hidden="true">
              <IconoPregunta tamanio={16} />
            </span>
            {pregunta.question}
          </p>

          {pregunta.answer === null ? (
            <p className={estilos.sinRespuesta}>Todavía sin responder</p>
          ) : (
            <p className={estilos.respuesta}>
              {pregunta.answer}
              {pregunta.answeredAt !== null && (
                <span className={estilos.respuestaFecha}>
                  {' · '}
                  {fechaRelativa(pregunta.answeredAt, ahora)}
                </span>
              )}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

export default async function DetalleDePublicacion({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** Sólo se lee `aviso`: el corazón vuelve acá por POST y puede haber fallado. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const [listing, user, preguntas, preguntasHabilitadas, params2] = await Promise.all([
    findPublicListing(id),
    getSessionUser(),
    /*
      ⚠️ LAS PREGUNTAS NO PUEDEN VOLTEAR LA FICHA. Son un bloque accesorio de la
      pantalla más compartida del sitio: si la consulta falla, se pierde la
      sección y no la publicación.
    */
    listPublicQuestions(id).catch((error: unknown) => {
      console.error('[ficha] no se pudieron leer las preguntas', error);

      return [] as PublicQuestion[];
    }),
    isFeatureEnabled('questions').catch(() => false),
    searchParams,
  ]);

  /**
   * ⚠️ 404 TAMBIEN CUANDO EXISTE PERO NO ES COMPRABLE. `findPublicListing`
   * aplica el filtro del ERD §9.1, asi que una publicacion pausada, agotada o
   * sin aprobar llega como `null`. Mostrarla porque alguien tiene el enlace
   * seria una via lateral para ver lo que la vitrina esconde.
   */
  if (listing === null) notFound();

  const quedaPoco = listing.stock <= UMBRAL_POCO_STOCK;
  const cantidadDeFotos = listing.images.length;
  const importe = precio(listing.priceAmount, listing.currency);
  const rutaDeCompra =
    user === null
      ? `/ingresar?next=${encodeURIComponent(`/p/${listing.id}`)}`
      : `/comprar/${listing.id}`;
  const avisoDeStock = listing.stock === 1 ? 'Última unidad' : `Quedan ${listing.stock}`;

  /*
   * ⚠️ COMPARTIR POR WHATSAPP ES UN ANCLA COMUN, NO UN BOTON CON JAVASCRIPT.
   * `wa.me` abre la app en el telefono y la version web en escritorio, y sin
   * JavaScript funciona igual. Es la forma en que este catalogo circula de
   * verdad, y hasta hoy la pantalla se ocupaba de como se ve un enlace que ya
   * viajo (Open Graph) y de nada de como viaja.
   *
   * ⚠️ LA URL TIENE QUE SER ABSOLUTA: no se arma con `location`, que no existe
   * en el servidor.
   */
  const rutaDeCompartir = `https://wa.me/?text=${encodeURIComponent(
    `${listing.title} — ${importe}\n${URL_BASE}/p/${listing.id}`,
  )}`;

  /**
   * Estado del corazón (BS-050).
   *
   * ⚠️ SE PREGUNTA POR UNA SOLA PUBLICACIÓN CON LA MISMA FUNCIÓN QUE LA GRILLA
   * (`favoriteIdsOf`) EN VEZ DE `isFavorite`. Las dos existen y hacen lo mismo
   * acá; usar la de la grilla mantiene un solo camino y evita que el día que
   * cambie la regla —favoritos de publicaciones borradas, por ejemplo— la ficha
   * y la vitrina digan cosas distintas.
   */
  /**
   * QUIEN VENDE: reputación, nivel, cuánto tarda en responder y sus últimas
   * reseñas.
   *
   * ⚠️ LAS CUATRO VAN EN PARALELO Y NINGUNA PUEDE VOLTEAR LA FICHA. Es la
   * pantalla más compartida del sitio y lo que la sostiene es la publicación: si
   * `seller_tiers` está vacía o la proyección de reputación falla, se pierde el
   * bloque del vendedor y no la camiseta. Es el mismo blindaje que ya tenían las
   * preguntas.
   *
   * ⚠️ `getSellerReputation` MATERIALIZA LA PROYECCIÓN EN LA PRIMERA LECTURA
   * —recomputa si la fila no existe—, así que un vendedor sin ningún hecho no
   * rompe nada: devuelve todo en cero, que es la verdad.
   */
  const [reputacion, nivel, horasDeRespuesta, resenas] = await Promise.all([
    getSellerReputation(listing.sellerId).catch((error: unknown) => {
      console.error('[ficha] no se pudo leer la reputación del vendedor', error);

      return null;
    }),
    getTierProgress(listing.sellerId).catch(() => null),
    averageAnswerHours(listing.sellerId).catch(() => null),
    listSellerReviews(listing.sellerId, 1).catch(() => null),
  ]);

  /**
   * ⚠️ ES LA COMPARACIÓN QUE FALTABA. Sin `sellerId` la ficha no podía saber si
   * quien mira es el dueño: el formulario de preguntas se le mostraba igual y
   * `askQuestion` lo rechazaba DESPUÉS de escribir la pregunta entera. Lo mismo
   * con "Reportar publicación", que el Service rechaza con
   * `cannotReportOwnListing`.
   *
   * ⚠️ SE RESUELVE POR `getSellerReputationForUser(user.id)` Y NO COMPARANDO
   * `user.id` CON `listing.sellerId`. Son dos entidades distintas —
   * `seller_profiles.id` no es `users.id`— así que compararlas daría "no es el
   * dueño" SIEMPRE, en silencio, que es la peor forma de equivocarse acá.
   * Devuelve `null` para quien no es vendedor, que es la mayoría.
   */
  const miPerfilDeVendedor =
    user === null ? null : await getSellerReputationForUser(user.id).catch(() => null);
  const esElDueno = miPerfilDeVendedor?.sellerId === listing.sellerId;

  /** Las tres últimas, no las veinte: la ficha no es el perfil del vendedor. */
  const ultimasResenas = resenas?.items.slice(0, TOPE_DE_RESENAS) ?? [];

  const guardada =
    user === null ? false : (await favoriteIdsOf(user, [listing.id])).has(listing.id);
  const avisoDeFavorito = params2.aviso === 'favorito';
  const volverAqui = `/p/${listing.id}#acciones`;

  /** 1..stock, con techo de pantalla. Nunca se puede pedir más de lo que hay. */
  const cantidades = Array.from(
    { length: Math.max(1, Math.min(listing.stock, TOPE_DE_CANTIDAD)) },
    (_, i) => ({ valor: String(i + 1), etiqueta: String(i + 1) }),
  );

  return (
    <>
      <Header />

      <Pantalla>
        <main id="contenido" className={estilos.pagina}>
          <div className={estilos.contenedor}>
            {/*
              ⚠️ MIGA DE PAN, NO UN "← VOLVER". El enlace anterior decia "volver
              al catalogo" y llevaba a la home, aunque la persona hubiera
              llegado desde una busqueda: le prometia deshacer un paso y la
              mandaba a otro lado. Una miga no promete historia, describe donde
              esta parada.

              ⚠️ ES LA PRIMITIVA COMPARTIDA Y NO LA COPIA QUE ESTE MODULO TENIA.
              El separador en rombo, el `aria-current`, los 44px del eslabon
              enlazado y el `retrocede` de la transicion ya viven en `Migas`;
              tenerlos escritos dos veces significa que arreglar uno deja roto
              el otro.
            */}
            <Migas
              items={[
                { texto: 'Catálogo', href: '/' },
                { texto: 'Buscar', href: '/buscar' },
                { texto: listing.title },
              ]}
            />

            <div className={estilos.grilla}>
              {/*
                ⚠️ EL ENCABEZADO ES UN BLOQUE APARTE DE LA GALERIA, Y ESO ES LO
                QUE ARREGLA LA FICHA EN TELEFONO: en escritorio va a la derecha
                de las fotos, en telefono va ARRIBA. Se ve QUE es y CUANTO sale
                antes de mirar una sola imagen.

                ⚠️ EL ENCABEZADO ESTA ARRIBA DEL PLIEGUE, ASI QUE ENTRA AL
                PRIMER PINTADO Y NO POR SCROLL. `.revela-*` usa
                `animation-timeline: view()`, que sobre un elemento ya visible
                al cargar entrega su animacion TERMINADA: la mitad superior de
                la ficha apareceria de golpe, igual que hoy.
              */}
              <header className={`entra-largo ${estilos.encabezado}`}>
                <h1 className={`display display-3 titular-degradado ${estilos.titulo}`}>
                  {listing.title}
                </h1>

                <hr className={estilos.filete} aria-hidden="true" />

                {/*
                  ⚠️ EL PRECIO PUEDE ENTRAR, NO PUEDE MOVERSE. `animado` de la
                  primitiva muestra el valor FINAL desde el primer cuadro, se
                  desplaza una vez y termina quieto. Nada de contar hacia
                  arriba: un numero en movimiento se lee como un numero que
                  todavia no esta decidido, y esto es un sitio donde se
                  transfiere plata a un desconocido.

                  ⚠️ EL `--retraso` LO PONE DESPUES DEL TITULO, no al mismo
                  tiempo: el encabezado se lee de arriba abajo y la entrada
                  tiene que respetar ese orden.
                */}
                <div style={{ '--retraso': '110ms' } as CSSProperties}>
                  <Precio
                    valor={importe}
                    tamanio="display"
                    animado
                    className={`${estilos.precio}`}
                  />
                </div>

                <div
                  className={`escalona ${estilos.atributos}`}
                  style={{ '--retraso': '180ms' } as CSSProperties}
                >
                  <Etiqueta>Talle {listing.sizeValue}</Etiqueta>
                  <Etiqueta>{condicion(listing.condition)}</Etiqueta>
                  {/*
                    ⚠️ EL PULSO ES UNA PROP DE LA PRIMITIVA, no un envoltorio con
                    la clase global: `Etiqueta` ya lo trae, ya lo corta a las
                    tres vueltas (WCAG 2.2.2) y ya lo apaga con
                    `prefers-reduced-motion`. El movimiento NO es la
                    informacion: el texto y el color ya dicen que queda poco.
                  */}
                  {quedaPoco && (
                    <Etiqueta tono="alerta" pulso>
                      {avisoDeStock}
                    </Etiqueta>
                  )}
                </div>

                {/*
                  ⚠️ ESTA ADVERTENCIA SUBE AL ENCABEZADO POR UNA RAZON DE
                  PRODUCTO. Con la compra pegada al fondo del viewport se puede
                  apretar "Comprar" desde la primera pantalla sin haber pasado
                  nunca por el panel de confianza, que es donde vivia. Antes el
                  boton estaba al final de todo y la advertencia era inevitable;
                  moverlo la volvia opcional sin decirlo.

                  ⚠️ NO SE MUESTRA `authenticity` AUNQUE ESTE EN LOS DATOS. El
                  enum incluye `SOSPECHOSA` y `FALSIFICACION`, y DEC-025 deja 🟦
                  PENDIENTE que evidencia exige cada categoria: publicar ese
                  campo seria inventarle una semantica —y, con esos dos valores,
                  difamar a un vendedor— sobre una decision que no esta tomada.
                */}
                <p className={estilos.aclaracion}>
                  La autenticidad la declara el vendedor. Offside no la verifica.
                </p>

                <div className={estilos.acciones}>
                  {/*
                    ⚠️ ABRE EN OTRA PESTAÑA Y LO DICE. `rel="noreferrer"` ya
                    estaba —es la pareja de `target="_blank"`— pero sin el
                    `target` compartir SACABA de la ficha: quien pasa el enlace
                    perdia la publicacion que estaba mirando y tenia que volver
                    con el boton atras. La nota para lectores de pantalla es lo
                    que pide WCAG 3.2.5: un cambio de contexto se avisa antes,
                    no se descubre despues.
                  */}
                  <a
                    href={rutaDeCompartir}
                    className={`subraya ${estilos.enlaceSecundario}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Compartir por WhatsApp
                    <span className="solo-lectores"> (se abre en otra pestaña)</span>
                  </a>
                </div>
              </header>

              {/*
                Galeria.

                ⚠️ SIGUE SIN HABER CARRUSEL Y SIGUEN ESTANDO TODAS LAS FOTOS: en
                escritorio en mosaico —portada grande, el resto de a dos— y en
                telefono en una pista con `scroll-snap`. Esconder fotos detras
                de flechas seria esconder justo lo que decide una compra de
                segunda mano: la etiqueta, el dorso y los defectos.

                ⚠️ `--fotos` VIAJA COMO PROPIEDAD CSS: es el unico dato que el
                riel de posicion necesita para saber de cuantos pasos es el
                recorrido y cuantos segmentos dibujar.
              */}
              <div
                className={estilos.columnaFotos}
                style={{ '--fotos': cantidadDeFotos } as CSSProperties}
              >
                {cantidadDeFotos === 0 ? (
                  <div className={estilos.marco} aria-hidden="true" />
                ) : (
                  <>
                    {/*
                      ⚠️ EL ENVOLTORIO ES ENFOCABLE CUANDO HAY MAS DE UNA FOTO, Y
                      ESO ARREGLA UN FALLO DE WCAG 2.1.1. En telefono este div es
                      un contenedor de scroll: Chrome 127+ enfoca los scrollers
                      solo, pero Safari y Firefox NO, y adentro no hay nada
                      enfocable a lo que tabular. Sin `tabIndex`, quien navega
                      con teclado no llega a siete de las ocho fotos. Con el, las
                      flechas lo recorren de forma nativa, sin JavaScript.

                      Con una sola foto no se pone: seria un punto de tabulacion
                      que no lleva a ningun lado.
                    */}
                    <div
                      className={estilos.pista}
                      {...(cantidadDeFotos > 1
                        ? {
                            tabIndex: 0,
                            role: 'region',
                            'aria-label': `Fotos de ${listing.title}`,
                          }
                        : {})}
                    >
                      {/*
                        ⚠️ `.enfoca-hermanos` YA VIENE ACOTADA A PUNTERO FINO
                        desde `movimiento.css`. Al pasar el mouse por una foto,
                        las otras se desaturan: la galeria deja de ser una lista
                        y pasa a tener foco. Toca la FOTO y nunca el texto, asi
                        que no hay ningun contraste que pueda bajar.
                      */}
                      <ul className={`enfoca-hermanos ${estilos.galeria}`} role="list">
                        {listing.images.map((imagen, indice) => {
                          const esPortada = indice === 0;

                          const foto = (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className={estilos.foto}
                              src={imagen.url}
                              alt={imagen.alt ?? `${listing.title} — foto ${indice + 1}`}
                              loading={esPortada ? 'eager' : 'lazy'}
                              /*
                                ⚠️ LA PORTADA ES EL ELEMENTO LCP DE LA PANTALLA
                                QUE MAS SE COMPARTE. `loading="eager"` solo dice
                                que no espere; `fetchPriority="high"` le dice al
                                navegador que la pida ANTES que el resto.
                              */
                              fetchPriority={esPortada ? 'high' : 'auto'}
                              decoding="async"
                            />
                          );

                          /*
                            ⚠️ SOLO LA PORTADA COMPARTE IDENTIDAD CON LA GRILLA.
                            Es la unica que tiene par del otro lado; nombrarlas
                            todas haria que se animen entre si en cualquier
                            transicion de la pagina.

                            ⚠️ Y ES LA UNICA SIN REVELADO POR SCROLL: una
                            animacion de entrada encima del morph son dos cosas
                            peleandose por el mismo elemento durante los mismos
                            420ms.

                            ⚠️ EL ESCENARIO OSCURO ES LA PORTADA Y NADA MAS. Una
                            sola superficie en deriva se lee como ambiente; ocho
                            son ocho capas de compositor promovidas para siempre
                            en la pantalla mas pesada del sitio.

                            ⚠️ LA CAPA DE ROMBOS ES UN HERMANO DE LA FOTO Y NO
                            UNA CLASE EN EL `<li>`: `.sup-fosa::before` es el
                            filo de luz y `.patron-vivo::before` son los rombos.
                            En el mismo nodo una pisa a la otra y se pierde el
                            filo, que es lo que hace que un bloque oscuro sea un
                            objeto y no un rectangulo. Es la misma correccion
                            que ya lleva `<Pliego>`.
                          */
                          if (esPortada) {
                            return (
                              <li
                                key={imagen.url}
                                className={`sup-fosa destello ${estilos.escenario}`}
                              >
                                <span
                                  className={`patron-vivo patron-vivo-fino ${estilos.capaRombos}`}
                                  aria-hidden="true"
                                />
                                <FotoCompartida id={listing.id}>{foto}</FotoCompartida>
                                {cantidadDeFotos > 1 && (
                                  <span className={estilos.numero} aria-hidden="true">
                                    1/{cantidadDeFotos}
                                  </span>
                                )}
                              </li>
                            );
                          }

                          return (
                            <li key={imagen.url} className={`revela-acerca ${estilos.diapositiva}`}>
                              {foto}
                              <span className={estilos.numero} aria-hidden="true">
                                {indice + 1}/{cantidadDeFotos}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    {cantidadDeFotos > 1 && (
                      <>
                        <div className={estilos.progreso} aria-hidden="true" />
                        <p className={estilos.pieDeGaleria}>
                          <span className={estilos.pistaEscritorio}>
                            {cantidadDeFotos} fotos de la prenda.
                          </span>
                          <span className={estilos.pistaTelefono}>
                            Deslizá para ver las {cantidadDeFotos} fotos.
                          </span>
                        </p>
                      </>
                    )}
                  </>
                )}
              </div>

              <div className={estilos.detalle}>
                {/*
                  LLEVARLA: cantidad, carrito, compra directa y guardado.

                  ⚠️ SON DOS CAMINOS DISTINTOS Y LOS DOS TIENEN QUE ESTAR
                  (DEC-026). "Comprar" crea la orden de esta camiseta ya mismo;
                  el carrito junta varias y al cerrar se parte en UNA ORDEN POR
                  VENDEDOR. Sin carrito, comprarle tres camisetas al mismo
                  vendedor son tres compras y tres envíos.

                  ⚠️ LA CANTIDAD SÓLO GOBIERNA EL CARRITO, Y ES A PROPÓSITO: la
                  compra directa es de UNA unidad —así la resuelve
                  `/comprar/[id]`— y un selector que cambiara las dos cosas
                  prometería algo que el otro camino no cumple.

                  ⚠️ SIN SESIÓN NO SE DIBUJA NADA DE ESTO. Un formulario que
                  manda al login después de elegir la cantidad hace perder el
                  paso; la barra de abajo ya ofrece "Ingresar" y conserva a
                  dónde volver.
                */}
                {user !== null && (
                  <section
                    className={estilos.bloqueLlevar}
                    id="acciones"
                    aria-label="Llevar esta prenda"
                  >
                    {avisoDeFavorito && (
                      <div className={estilos.avisoLlevar}>
                        <Aviso tono="error">
                          No pudimos guardar la publicación. Probá de nuevo en un momento.
                        </Aviso>
                      </div>
                    )}

                    <Formulario
                      accion={agregarAlCarrito}
                      enviar="Agregar al carrito"
                      variante="secundario"
                      tamanio="medio"
                      bloque={false}
                    >
                      <CampoOculto nombre="listingId" valor={listing.id} />
                      <Seleccion
                        nombre="cantidad"
                        etiqueta="Cantidad"
                        opciones={cantidades}
                        defaultValue="1"
                      />
                    </Formulario>

                    {/*
                      ⚠️ EL CORAZÓN ES UN `<form>` HERMANO, NO UN CAMPO DEL
                      ANTERIOR: anidar formularios es HTML inválido y el
                      navegador lo desarma en silencio. Y lleva texto visible,
                      al revés que en la grilla: acá hay lugar y la persona está
                      decidiendo, así que el icono solo sería adivinanza.
                    */}
                    <form action={alternarFavorito} className={estilos.guardar}>
                      <input type="hidden" name="listingId" value={listing.id} />
                      <input type="hidden" name="volverA" value={volverAqui} />
                      <button
                        type="submit"
                        className={estilos.guardarBoton}
                        aria-pressed={guardada}
                        data-activo={guardada ? 'si' : undefined}
                      >
                        <IconoFavorito tamanio={18} />
                        {guardada ? 'Guardada' : 'Guardar'}
                      </button>
                    </form>
                  </section>
                )}

                {/*
                  ⚠️ LOS SELLOS DICEN LO QUE OFFSIDE YA DICE EN
                  `/como-funciona`, Y NADA MAS. No hay "compra protegida" ni
                  "devolución garantizada": no hay disputas, ni reclamos, ni
                  reembolsos probados contra Mercado Pago real, y un sello
                  inventado en la pantalla donde alguien decide transferir plata
                  es exactamente lo que no se hace.

                  ⚠️ TODOS LLEVAN ICONO, INCLUIDO EL DE LA CUENTA. La grilla del
                  sello tiene una primera columna de 20px fijos: un sello sin
                  icono arrancaria 32px a la izquierda de los demas y se leeria
                  como un error de render.
                */}
                {/*
                  QUIEN VENDE (SS-020 / DEC-036).

                  ⚠️ TODO LO QUE DICE ES MEDIBLE Y NINGUNA PALABRA ES UN
                  VEREDICTO. Ventas completadas, reclamos, cuánto tarda en
                  responder: eso es verificable. "Vendedor confiable" no lo es, y
                  el `score` derivado —que existe y se guarda— NO se muestra
                  acá: no decide nada (TS-020) y un número sin unidad al lado de
                  un nombre se lee como una calificación de Offside sobre una
                  persona.

                  ⚠️ SI LA REPUTACIÓN NO SE PUDO LEER, EL BLOQUE NO EXISTE. No se
                  dibuja un esqueleto ni un "—": un dato de confianza vacío en la
                  pantalla donde alguien decide transferir plata es peor que no
                  ofrecerlo.
                */}
                {reputacion !== null && (
                  <section className={estilos.vendedor} aria-labelledby="vendedor-titulo">
                    <h2 id="vendedor-titulo" className={estilos.vendedorNombre}>
                      {listing.sellerDisplayName}
                    </h2>

                    <div className={estilos.vendedorInsignias}>
                      <InsigniaDeReputacion
                        etiqueta={reputacion.label}
                        metricas={[
                          reputacion.salesCount === 0
                            ? 'sin ventas completadas'
                            : cantidadLegible(
                                reputacion.salesCount,
                                'venta completada',
                                'ventas completadas',
                              ),
                          ...(reputacion.salesCount > 0 || reputacion.claimsCount > 0
                            ? [cantidadLegible(reputacion.claimsCount, 'reclamo')]
                            : []),
                          /*
                            ⚠️ "RESPONDE EN ~X" SÓLO SI ALGUNA VEZ RESPONDIÓ.
                            `averageAnswerHours` devuelve `null` justamente para
                            que nadie invente un número: prometer "responde en
                            ~2 h" sobre un vendedor que nunca contestó es la
                            clase de dato que hace que alguien compre.
                          */
                          ...(horasDeRespuesta === null
                            ? []
                            : [`responde preguntas en ~${horas(horasDeRespuesta)}`]),
                        ]}
                      />

                      {nivel?.currentTier != null && (
                        <InsigniaDeNivel
                          nombre={nivel.currentTier.name}
                          tasa={porcentajeDeComision(nivel.currentTier.basisPoints)}
                        />
                      )}
                    </div>

                    <Estrellas promedio={reputacion.ratingAvg} cantidad={reputacion.ratingCount} />

                    {/*
                      ⚠️ TRES RESEÑAS, NO VEINTE. Esta pantalla es de una
                      camiseta: el perfil completo está a un enlace y tiene su
                      propia paginación. Sin recorte, veinte reseñas de OTRAS
                      ventas empujan la compra fuera de la pantalla.
                    */}
                    {ultimasResenas.length > 0 && (
                      <ul className={estilos.resenasBreves}>
                        {ultimasResenas.map((resena) => (
                          <li key={resena.id} className={estilos.resenaBreve}>
                            <p className={estilos.resenaBreveCabecera}>
                              <Estrellas promedio={resena.rating} cantidad={1} />
                              <span className={estilos.resenaBreveFecha}>
                                {fecha(resena.createdAt.toISOString())}
                              </span>
                            </p>
                            {resena.comment !== null && resena.comment !== '' && (
                              <p className={estilos.resenaBreveTexto}>{resena.comment}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/*
                      ⚠️ EL ENLACE A LA TIENDA ES LO QUE VUELVE ALCANZABLE A
                      `/tienda/[sellerId]`. La pantalla existía y no había forma
                      de llegar navegando: el `sellerId` no salía de ningún lado.
                    */}
                    <Link
                      href={`/tienda/${listing.sellerId}`}
                      className={`subraya ${estilos.enlaceTienda}`}
                      transitionTypes={['avanza']}
                    >
                      Ver su tienda y todas sus reseñas
                    </Link>
                  </section>
                )}

                <section className={estilos.confianza} aria-label="Sobre esta compra">
                  <p className={estilos.sello}>
                    <IconoAutenticado tamanio={20} />
                    <span>
                      Vendida por <strong>{listing.sellerDisplayName}</strong>, con email verificado
                      y Mercado Pago conectado.
                    </span>
                  </p>

                  <p className={estilos.sello}>
                    <IconoTilde tamanio={20} />
                    <span>
                      El pago ocurre dentro de <strong>Mercado Pago</strong>. Offside nunca ve ni
                      guarda los datos de tu tarjeta, y el vendedor cobra en su propia cuenta.
                    </span>
                  </p>

                  {/*
                    ENVIO DECLARADO (delta §11).

                    ⚠️ LA ETIQUETA LA RESUELVE EL SERVICE (`shippingSummaryFor`),
                    no esta pantalla. Interpretar `shipping_mode` a mano acá
                    significaría que el día que el enum crezca, la ficha diga una
                    cosa y la compra cobre otra.

                    ⚠️ SE DICE QUE LO DECLARA EL VENDEDOR Y NO "CALCULAMOS EL
                    ENVÍO": no hay integración con ningún correo y no hay
                    cotización (SH-011 sigue sin proveedor). Lo único verdadero
                    es lo que quien vende eligió al publicar.

                    ⚠️ EL IMPORTE SOLO APARECE CON `buyer_pays`, que es el único
                    modo en que `shippingCostAmount` significa algo. El resumen
                    lo devuelve `null` en los otros tres, así que no hay forma de
                    mostrar un número inventado.
                  */}
                  <p className={estilos.sello}>
                    <IconoCamion tamanio={20} />
                    <span>
                      <strong>{listing.shipping.shippingLabel}</strong>
                      {listing.shipping.shippingCostAmount !== null && (
                        <>
                          {': '}
                          {precio(listing.shipping.shippingCostAmount, listing.currency)} que se
                          suman al total
                        </>
                      )}
                      {'. '}
                      Lo declara el vendedor: Offside no cotiza envíos.
                    </span>
                  </p>

                  <p className={estilos.sello}>
                    <IconoEtiqueta tamanio={20} />
                    <span>
                      La autenticidad <strong>la declara el vendedor</strong>. Offside no la
                      verifica.
                    </span>
                  </p>

                  {user === null && (
                    <p className={estilos.sello}>
                      <IconoLlave tamanio={20} />
                      <span>
                        Necesitás una cuenta para completar la compra. Mirar el catálogo no.
                      </span>
                    </p>
                  )}

                  <Link href="/como-funciona" className={`subraya ${estilos.enlaceComoFunciona}`}>
                    Cómo funciona una compra
                  </Link>
                </section>

                {/*
                  ⚠️ LA DESCRIPCION ES LO UNICO DE ESTA PANTALLA QUE ESCRIBIO
                  UNA PERSONA, y era el unico bloque sin ninguna identidad
                  visual: un parrafo gris suelto debajo de un panel elevado. En
                  una prenda usada ahi viven los defectos, la historia y el
                  motivo por el que alguien la vende, o sea la mitad de la
                  decision. El filete grueso y el rotulo la separan de lo que
                  afirma Offside, que es la distincion que importa: arriba
                  hablamos nosotros, aca habla el vendedor.

                  ⚠️ ES UN `h2` Y NO UN PARRAFO EN MAYUSCULAS. La ficha tiene un
                  solo `h1` y dos bloques largos; con encabezados de verdad se
                  puede saltar entre ellos con lector de pantalla en vez de
                  recorrer todo el texto.
                */}
                {listing.description !== null && listing.description !== '' && (
                  <div className={estilos.bloqueDescripcion}>
                    <h2 className={estilos.rotuloDescripcion}>Lo que dice el vendedor</h2>
                    <p className={estilos.descripcion}>{listing.description}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/*
            ⚠️ LA FICHA TECNICA SALIO DE LA COLUMNA Y ES UNA BANDA A SANGRE. Es
            lo que hace posible que la columna de datos se pegue en escritorio
            —con la tecnica adentro medía ~900px y no entraba en pantalla— y
            ademas es el unico bloque de la ficha que toca los dos bordes: sin
            el, la pantalla sigue siendo una caja de 1200px con cajas adentro.

            ⚠️ NO INVENTA UN SOLO CAMPO: son exactamente los que devuelve
            `PublicListingDetail`. Club, seleccion, marca, temporada y
            competencia NO estan en ese tipo aunque las tablas esten sembradas y
            `/buscar` facete por ellas; la `<dl>` esta compuesta en columnas
            justamente para que esas filas entren sin rehacer nada.
          */}
          <Pliego superficie="noche" patron className={`${estilos.bandaTecnica}`}>
            <div className={estilos.bandaInterior}>
              <h2 className={`display display-3 revela-acerca ${estilos.tituloTecnica}`}>
                Ficha técnica
              </h2>

              <div className={estilos.cintaDiagonal} aria-hidden="true" />

              <dl className={`revela-grilla ${estilos.fichaTecnica}`}>
                <Dato etiqueta="Talle">{listing.sizeValue}</Dato>
                <Dato etiqueta="Condición">{condicion(listing.condition)}</Dato>
                {listing.kitType !== null && (
                  <Dato etiqueta="Tipo">{tipoDeCamiseta(listing.kitType)}</Dato>
                )}
                {listing.sleeve !== null && <Dato etiqueta="Mangas">{manga(listing.sleeve)}</Dato>}
                <Dato etiqueta="Unidades">
                  {listing.stock === 1 ? 'Última unidad' : `${listing.stock} disponibles`}
                </Dato>
                {/*
                  ⚠️ `modoDeEnvioCorto` Y NO LA ETIQUETA LARGA. La ficha técnica
                  es una grilla de pares cortos: "Envío a convenir con el
                  vendedor" parte la celda en tres líneas al lado de "Talle: L".
                  La frase completa ya está arriba, en el panel de la compra.
                */}
                <Dato etiqueta="Envío">{modoDeEnvioCorto(listing.shipping.shippingMode)}</Dato>
                <Dato etiqueta="Vendedor">{listing.sellerDisplayName}</Dato>
              </dl>
            </div>
          </Pliego>

          {/*
            PREGUNTAS Y RESPUESTAS (BS-040) + REPORTE (TS-030).

            ⚠️ VA DESPUES DE LA FICHA TECNICA Y ANTES DE LA BARRA DE COMPRA. Es
            el ultimo bloque que alguien lee antes de decidir, y es el unico
            lugar del sitio donde comprador y vendedor se comunican: no hay chat
            privado, así que acá se arregla el envío "a convenir".
          */}
          <section className={estilos.conversacion} aria-labelledby="preguntas-titulo">
            <div className={estilos.conversacionInterior}>
              <h2 id="preguntas-titulo" className={`display display-3 ${estilos.tituloPreguntas}`}>
                Preguntas
              </h2>

              {preguntas.length === 0 ? (
                <p className={estilos.sinPreguntas}>
                  Todavía nadie preguntó nada sobre esta publicación.
                </p>
              ) : (
                <Preguntas preguntas={preguntas} />
              )}

              {/*
                ⚠️ EL FORMULARIO SE MUESTRA CON SESION VERIFICADA Y CON LA
                FUNCIONALIDAD ENCENDIDA (`feature_questions` ⚙️). Las preguntas
                YA HECHAS se siguen viendo con la perilla apagada: apagarla frena
                preguntas nuevas, no borra las conversaciones que existen.

                ⚠️ NO SE ESCONDE AL DUEÑO DE LA PUBLICACION, Y NO ES UN OLVIDO:
                `PublicListingDetail` no expone `sellerId`, así que la pantalla no
                puede saber si quien mira es el vendedor. `askQuestion` lo rechaza
                con un mensaje claro ("No podés preguntar en tu propia
                publicación") y el formulario lo muestra como cualquier otro
                error. Queda anotado: con `sellerId` en el tipo, esto se
                convierte en un `&&`.
              */}
              {user !== null && !esElDueno && preguntasHabilitadas && (
                <div className={estilos.preguntar}>
                  <Formulario accion={preguntar} enviar="Preguntar" tamanio="medio" bloque={false}>
                    <CampoOculto nombre="listingId" valor={listing.id} />
                    <AreaDeTexto
                      nombre="texto"
                      etiqueta="Tu pregunta"
                      ayuda="La ven todos: no pongas tu teléfono ni tu dirección."
                      requerido
                      filas={3}
                    />
                  </Formulario>
                </div>
              )}

              {user === null && (
                <p className={estilos.sinPreguntas}>
                  <Link
                    href={`/ingresar?next=${encodeURIComponent(`/p/${listing.id}`)}`}
                    className="subraya"
                  >
                    Ingresá
                  </Link>{' '}
                  para preguntarle al vendedor.
                </p>
              )}

              {/*
                ⚠️ AL DUEÑO SE LE DICE POR QUÉ NO HAY FORMULARIO, NO SE LE
                ESCONDE Y LISTO. Un hueco donde los demás ven un campo de texto
                se lee como un error de la pantalla; y el enlace a su bandeja es
                lo que realmente necesita, porque responder se hace desde ahí.
              */}
              {esElDueno && (
                <p className={estilos.sinPreguntas}>
                  Esta publicación es tuya.{' '}
                  <Link href="/vendedor/preguntas" className="subraya">
                    Respondé desde tu bandeja de preguntas
                  </Link>
                  .
                </p>
              )}

              {/*
                REPORTAR (TS-030).

                ⚠️ ES UN `<details>` EN DOS PASOS Y NO UN BOTON SUELTO. Denunciar
                abre un expediente de moderación contra una persona: el primer
                clic ABRE, no envía. Es la misma primitiva que usan eliminar una
                publicación y emitir un reembolso.

                ⚠️ ESTA ABAJO DE TODO Y SIN COLOR DE ALARMA. Tiene que existir y
                tiene que encontrarse, pero un botón rojo al lado del precio
                convierte cada ficha en una acusación.

                ⚠️ EL MOTIVO ES UNA LISTA CERRADA QUE VIENE DEL SERVICE
                (`REPORT_REASONS`). Escribirla acá haría que agregar un motivo
                haya que hacerlo dos veces, y el Service es el que valida.
              */}
              <div className={estilos.reportar}>
                {/*
                  ⚠️ SON TRES CASOS Y NO DOS. Al dueño no se le puede ofrecer
                  "Ingresá para reportarla" —ya tiene sesión— ni el formulario,
                  que `reportListing` rechaza con `cannotReportOwnListing`: se le
                  dice adónde ir si quiere bajarla, que es lo que en realidad
                  quiere hacer.
                */}
                {esElDueno ? (
                  <p className={estilos.reportarNota}>
                    Es tu publicación: para sacarla de la venta, pausala o eliminala desde{' '}
                    <Link href="/vendedor/publicaciones" className="subraya">
                      tus publicaciones
                    </Link>
                    .
                  </p>
                ) : user === null ? (
                  <p className={estilos.reportarNota}>
                    ¿Hay algo mal con esta publicación?{' '}
                    <Link
                      href={`/ingresar?next=${encodeURIComponent(`/p/${listing.id}`)}`}
                      className="subraya"
                    >
                      Ingresá para reportarla
                    </Link>
                    .
                  </p>
                ) : (
                  <Confirmar
                    etiqueta="Reportar publicación"
                    pregunta="Contanos qué pasa. El reporte va a moderación y no baja la publicación sola; tampoco le decimos al vendedor quién lo reportó."
                  >
                    <Formulario
                      accion={reportarPublicacion}
                      enviar="Enviar reporte"
                      variante="peligro"
                      tamanio="medio"
                      bloque={false}
                    >
                      <CampoOculto nombre="listingId" valor={listing.id} />
                      <Seleccion
                        nombre="motivo"
                        etiqueta="Motivo"
                        opciones={REPORT_REASONS.map((motivo) => ({
                          valor: motivo.codigo,
                          etiqueta: motivo.etiqueta,
                        }))}
                      />
                      <AreaDeTexto
                        nombre="nota"
                        etiqueta="Contanos más (opcional)"
                        ayuda="Si elegís “Otro motivo”, contá cuál."
                        filas={3}
                        maximo={1000}
                      />
                    </Formulario>
                  </Confirmar>
                )}

                <p className={estilos.reportarNota}>
                  <span className={estilos.reportarIcono} aria-hidden="true">
                    <IconoBandera tamanio={16} />
                  </span>
                  La moderación revisa los reportes a mano. No hay baja automática.
                </p>
              </div>
            </div>
          </section>

          {/*
            ⚠️ ESTA ES LA UNICA ACCION DE COMPRA DE LA PANTALLA Y ES UN SOLO NODO
            DEL DOM EN TODOS LOS ANCHOS. Es el ultimo hijo de `<main>` a
            proposito: `position: sticky; bottom: 0` corre el bloque hacia
            ARRIBA hasta el tope de su contenedor, asi que queda clavado al
            fondo del viewport desde la primera pantalla y aterriza solo al
            final, arriba del pie. En telefono es una franja al pie; en
            escritorio, una tarjeta de 460px alineada con la columna de datos.

            ⚠️ EL TEXTO VISIBLE ES CORTO Y EL ACCESIBLE ES COMPLETO. "Ingresar
            para comprar" tiene `white-space: nowrap` y a 320px se llevaba puesta
            la tarjeta; `etiquetaAccesible` conserva la frase entera para quien
            la escucha.

            Se conserva a donde queria ir: al iniciar sesion vuelve a esta ficha,
            no a la home. `rutaInternaSegura` valida ese parametro del otro lado.
          */}
          <div className={estilos.barraAccion}>
            <div className={estilos.barraInterior}>
              <p className={estilos.barraPrecio}>
                {quedaPoco && <span className={estilos.barraAlerta}>{avisoDeStock}</span>}
                <span className={estilos.barraRotulo}>Precio</span>
                <span className={estilos.barraImporte}>{importe}</span>
              </p>

              <BotonEnlace
                href={rutaDeCompra}
                tamanio="grande"
                className={`barrido-diagonal ${estilos.cta}`}
                {...(user === null ? { etiquetaAccesible: 'Ingresar para comprar' } : {})}
              >
                {user === null ? 'Ingresar' : 'Comprar'}
              </BotonEnlace>
            </div>
          </div>
        </main>
      </Pantalla>

      <Footer />
    </>
  );
}
