import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { Footer } from '@/components/footer';
import { AreaDeTexto, CampoOculto, Formulario, Seleccion } from '@/components/form';
import { Header } from '@/components/header';
import {
  IconoAutenticado,
  IconoCamiseta,
  IconoBandera,
  IconoCamion,
  IconoEtiqueta,
  IconoFavorito,
  IconoPregunta,
  IconoTilde,
} from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  BotonEnlace,
  Confirmar,
  Estrellas,
  InsigniaDeNivel,
  InsigniaDeReputacion,
  Migas,
  Paginacion,
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
  answerStats,
  frecuenciaDeRespuesta,
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
 * Un entero de la URL, o `undefined`.
 *
 * ⚠️ NO VALIDA EL RANGO: de eso se encarga `normalizarPagina` en el Service, que
 * es donde vive la regla. Aca solo se convierte texto a numero —lo que llega es
 * `string | string[] | undefined` y puede ser cualquier cosa—.
 */
function numeroDeParametro(valor: string | string[] | undefined): number | undefined {
  if (typeof valor !== 'string') return undefined;

  const n = Number.parseInt(valor, 10);

  return Number.isNaN(n) ? undefined : n;
}

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
  /*
    ⚠️ LOS PARAMETROS SE LEEN ANTES DEL RESTO, y no por prolijidad: la pagina de
    preguntas viaja en la URL y hay que saberla para pedirlas. Es el mismo
    criterio que el resto del sitio —todo filtro y toda pagina van por GET, asi
    se comparten, vuelven con el botón atrás y andan sin JavaScript—.
  */
  const params2 = await searchParams;
  const paginaDePreguntas = numeroDeParametro(params2.preguntas);

  const [listing, user, preguntas, preguntasHabilitadas] = await Promise.all([
    findPublicListing(id),
    getSessionUser(),
    /*
      ⚠️ LAS PREGUNTAS NO PUEDEN VOLTEAR LA FICHA. Son un bloque accesorio de la
      pantalla más compartida del sitio: si la consulta falla, se pierde la
      sección y no la publicación.
    */
    listPublicQuestions(id, paginaDePreguntas).catch((error: unknown) => {
      console.error('[ficha] no se pudieron leer las preguntas', error);

      return { preguntas: [], total: 0, pagina: 1, porPagina: 1 };
    }),
    isFeatureEnabled('questions').catch(() => false),
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
  const [reputacion, nivel, respuestas, resenas] = await Promise.all([
    getSellerReputation(listing.sellerId).catch((error: unknown) => {
      console.error('[ficha] no se pudo leer la reputación del vendedor', error);

      return null;
    }),
    getTierProgress(listing.sellerId).catch(() => null),
    answerStats(listing.sellerId).catch(() => null),
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
            <Migas
              items={[
                { texto: 'Inicio', href: '/' },
                { texto: 'Camisetas', href: '/buscar' },
                { texto: listing.title },
              ]}
            />

            <div className={estilos.tarjeta}>
              <div className={estilos.grilla}>
                <div className={estilos.columnaFotos}>
                  {cantidadDeFotos === 0 ? (
                    <div className={estilos.marco} aria-hidden="true">
                      <IconoCamiseta tamanio={96} />
                    </div>
                  ) : (
                    <>
                      {/*
                        Las miniaturas son enlaces al ancla de cada foto: el carrusel
                        es scroll-snap nativo y anda sin JavaScript.
                      */}
                      {cantidadDeFotos > 1 && (
                        <ul className={estilos.miniaturas}>
                          {listing.images.map((imagen, indice) => (
                            <li key={imagen.url}>
                              <a href={`#foto-${indice + 1}`} className={estilos.miniatura}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={imagen.url} alt="" loading="lazy" decoding="async" />
                                <span className="solo-lectores">Ver foto {indice + 1}</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
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
                        <ul className={estilos.galeria}>
                          {listing.images.map((imagen, indice) => {
                            const esPortada = indice === 0;

                            return (
                              <li
                                key={imagen.url}
                                id={`foto-${indice + 1}`}
                                className={estilos.diapositiva}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  className={estilos.foto}
                                  src={imagen.url}
                                  alt={imagen.alt ?? `${listing.title}, foto ${indice + 1}`}
                                  loading={esPortada ? 'eager' : 'lazy'}
                                  fetchPriority={esPortada ? 'high' : 'auto'}
                                  decoding="async"
                                />
                                {cantidadDeFotos > 1 && (
                                  <span className={estilos.numero} aria-hidden="true">
                                    {indice + 1} de {cantidadDeFotos}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </>
                  )}
                </div>

                <header className={estilos.encabezado}>
                  <p className={estilos.atributos}>
                    {condicion(listing.condition)} · Talle {listing.sizeValue}
                  </p>
                  <h1 className={estilos.titulo}>{listing.title}</h1>
                  <Precio valor={importe} tamanio="display" className={estilos.precio} />

                  <dl className={estilos.resumen}>
                    {listing.kitType !== null && (
                      <Dato etiqueta="Tipo">{tipoDeCamiseta(listing.kitType)}</Dato>
                    )}
                    {listing.sleeve !== null && (
                      <Dato etiqueta="Mangas">{manga(listing.sleeve)}</Dato>
                    )}
                  </dl>

                  <div className={estilos.acciones}>
                    {user !== null && (
                      <form action={alternarFavorito}>
                        <input type="hidden" name="listingId" value={listing.id} />
                        <input type="hidden" name="volverA" value={volverAqui} />
                        <button
                          type="submit"
                          className={estilos.accion}
                          aria-pressed={guardada}
                          data-activo={guardada ? 'si' : undefined}
                        >
                          <IconoFavorito tamanio={18} />
                          {guardada ? 'Guardada' : 'Guardar'}
                        </button>
                      </form>
                    )}
                    <a
                      href={rutaDeCompartir}
                      className={estilos.accion}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Compartir por WhatsApp
                      <span className="solo-lectores"> (se abre en otra pestaña)</span>
                    </a>
                  </div>
                </header>

                <aside className={estilos.caja} id="acciones" aria-label="Comprar esta prenda">
                  <p className={estilos.renglon}>
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
                      <br />
                      <span className={estilos.tenue}>
                        Lo declara el vendedor: Offside no cotiza envíos.
                      </span>
                    </span>
                  </p>

                  {quedaPoco && <p className={estilos.stock}>{avisoDeStock}</p>}

                  {avisoDeFavorito && (
                    <Aviso tono="error">
                      No pudimos guardar la publicación. Probá de nuevo en un momento.
                    </Aviso>
                  )}

                  <BotonEnlace
                    href={rutaDeCompra}
                    tamanio="grande"
                    bloque
                    {...(user === null ? { etiquetaAccesible: 'Ingresar para comprar' } : {})}
                  >
                    Comprar
                  </BotonEnlace>

                  {user === null ? (
                    <p className={estilos.tenue}>Necesitás una cuenta para completar la compra.</p>
                  ) : (
                    <Formulario
                      accion={agregarAlCarrito}
                      enviar="Agregar al carrito"
                      variante="secundario"
                      tamanio="medio"
                      bloque
                    >
                      <CampoOculto nombre="listingId" valor={listing.id} />
                      <Seleccion
                        nombre="cantidad"
                        etiqueta="Cantidad"
                        opciones={cantidades}
                        defaultValue="1"
                      />
                    </Formulario>
                  )}

                  {reputacion !== null && (
                    <section className={estilos.vendedor} aria-labelledby="vendedor-titulo">
                      <p className={estilos.tenue}>Vendido por</p>
                      <h2 id="vendedor-titulo" className={estilos.vendedorNombre}>
                        <Link href={`/tienda/${listing.sellerId}`}>
                          {listing.sellerDisplayName}
                        </Link>
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
                            ...(frecuenciaDeRespuesta(respuestas, horas) === null
                              ? []
                              : [frecuenciaDeRespuesta(respuestas, horas)!]),
                          ]}
                        />
                        {nivel?.currentTier != null && (
                          <InsigniaDeNivel
                            nombre={nivel.currentTier.name}
                            tasa={porcentajeDeComision(nivel.currentTier.basisPoints)}
                          />
                        )}
                      </div>
                      <Estrellas
                        promedio={reputacion.ratingAvg}
                        cantidad={reputacion.ratingCount}
                      />
                      {ultimasResenas.length > 0 && (
                        <ul className={estilos.resenasBreves}>
                          {ultimasResenas.map((resena) => (
                            <li key={resena.id} className={estilos.resenaBreve}>
                              <p className={estilos.resenaBreveCabecera}>
                                <Estrellas promedio={resena.rating} cantidad={1} />
                                <span className={estilos.tenue}>
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
                    </section>
                  )}

                  {/*
                    ⚠️ ESTOS TEXTOS NO SON ADORNO: son lo que Offside puede afirmar.
                    Sin compra protegida ni verificacion de autenticidad, decirlo es
                    parte de la confianza (BR-003, SS-012).
                  */}
                  <section className={estilos.confianza} aria-label="Sobre esta compra">
                    <p className={estilos.renglon}>
                      <IconoAutenticado tamanio={18} />
                      <span>
                        Vendida por {listing.sellerDisplayName}, con email verificado y Mercado Pago
                        conectado.
                      </span>
                    </p>
                    <p className={estilos.renglon}>
                      <IconoTilde tamanio={18} />
                      <span>
                        El pago ocurre dentro de Mercado Pago. Offside nunca ve ni guarda los datos
                        de tu tarjeta, y el vendedor cobra en su propia cuenta.
                      </span>
                    </p>
                    <p className={estilos.renglon}>
                      <IconoEtiqueta tamanio={18} />
                      <span>La autenticidad la declara el vendedor. Offside no la verifica.</span>
                    </p>
                    <Link href="/como-funciona" className={estilos.enlace}>
                      Cómo funciona una compra
                    </Link>
                  </section>
                </aside>
              </div>

              {listing.description !== null && listing.description !== '' && (
                <section className={estilos.bloque} aria-labelledby="descripcion-titulo">
                  <h2 id="descripcion-titulo" className={estilos.tituloBloque}>
                    Lo que dice el vendedor
                  </h2>
                  <p className={estilos.descripcion}>{listing.description}</p>
                </section>
              )}

              <div className={estilos.bajo}>
                <section aria-labelledby="ficha-titulo">
                  <h2 id="ficha-titulo" className={estilos.tituloBloque}>
                    Características
                  </h2>
                  <dl className={estilos.fichaTecnica}>
                    <Dato etiqueta="Talle">{listing.sizeValue}</Dato>
                    <Dato etiqueta="Condición">{condicion(listing.condition)}</Dato>
                    {listing.kitType !== null && (
                      <Dato etiqueta="Tipo">{tipoDeCamiseta(listing.kitType)}</Dato>
                    )}
                    {listing.sleeve !== null && (
                      <Dato etiqueta="Mangas">{manga(listing.sleeve)}</Dato>
                    )}
                    <Dato etiqueta="Unidades">
                      {listing.stock === 1 ? 'Última unidad' : `${listing.stock} disponibles`}
                    </Dato>
                    <Dato etiqueta="Envío">{modoDeEnvioCorto(listing.shipping.shippingMode)}</Dato>
                  </dl>
                </section>

                <section aria-labelledby="preguntas-titulo">
                  <h2 id="preguntas-titulo" className={estilos.tituloBloque}>
                    Preguntas
                  </h2>
                  {preguntas.total === 0 ? (
                    <p className={estilos.sinPreguntas}>
                      Todavía nadie preguntó nada sobre esta publicación.
                    </p>
                  ) : (
                    <>
                      <Preguntas preguntas={preguntas.preguntas} />
                      {/*
                    ⚠️ LA PAGINACION CONSERVA EL RESTO DE LA URL. La ficha vuelve
                    acá con `?aviso=favorito` después del corazón: un enlace que
                    armara sólo `?preguntas=2` borraría ese aviso a mitad de
                    camino. Es el mismo criterio que la búsqueda con sus filtros.
                  */}
                      <Paginacion
                        actual={preguntas.pagina}
                        total={Math.ceil(preguntas.total / preguntas.porPagina)}
                        hrefDe={(n) => {
                          const query = new URLSearchParams();
                          for (const [clave, valor] of Object.entries(params2)) {
                            if (typeof valor === 'string' && clave !== 'preguntas') {
                              query.set(clave, valor);
                            }
                          }
                          if (n > 1) query.set('preguntas', String(n));

                          const cadena = query.toString();

                          return `/p/${listing.id}${cadena === '' ? '' : `?${cadena}`}#preguntas-titulo`;
                        }}
                      />
                    </>
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
                      <Formulario
                        accion={preguntar}
                        enviar="Preguntar"
                        tamanio="medio"
                        bloque={false}
                      >
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
                        className={estilos.enlace}
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
                      <Link href="/vendedor/preguntas" className={estilos.enlace}>
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
                        <Link href="/vendedor/publicaciones" className={estilos.enlace}>
                          tus publicaciones
                        </Link>
                        .
                      </p>
                    ) : user === null ? (
                      <p className={estilos.reportarNota}>
                        ¿Hay algo mal con esta publicación?{' '}
                        <Link
                          href={`/ingresar?next=${encodeURIComponent(`/p/${listing.id}`)}`}
                          className={estilos.enlace}
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
                </section>
              </div>
            </div>
          </div>
        </main>
      </Pantalla>

      <Footer />
    </>
  );
}
