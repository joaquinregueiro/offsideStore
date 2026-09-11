import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { IconoPausa, IconoTienda } from '@/components/iconos';
import { ListingCard, type EstadoDeFavorito } from '@/components/listing-card';
import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  Estrellas,
  InsigniaDeNivel,
  InsigniaDeReputacion,
  Migas,
  Paginacion,
} from '@/components/ui';
import { cantidad, fecha, horas, nivelDeUsuario, porcentajeDeComision } from '@/lib/formato';
import { getSessionUser } from '@/lib/session';
import { favoriteIdsOf } from '@/modules/favorites/services/favorite.service';
import { listPublicSellerCatalog } from '@/modules/listings/services/listing.service';
import { averageAnswerHours } from '@/modules/questions/services/question.service';
import { getSellerReputation } from '@/modules/reputation/services/reputation.service';
import { listSellerReviews } from '@/modules/reviews/services/review.service';
import { getTierProgress } from '@/modules/sellers/services/seller-tier.service';
import { isOnVacation } from '@/modules/sellers/services/vacation.service';

import estilos from './page.module.css';

/**
 * TIENDA PUBLICA DE UN VENDEDOR (SS-020).
 *
 * ⚠️ LA RUTA ES `/tienda/[sellerId]` Y NO `/tienda/[username]`, Y NO ES UNA
 * PREFERENCIA. `users.username` existe en el esquema pero esta en NULL para
 * todas las cuentas y no hay ninguna pantalla que lo escriba; `seller_profiles`
 * no tiene `slug`. Una URL legible —`/tienda/retro-cancha`— necesita una columna
 * nueva y unica, que es un cambio de ERD y requiere autorizacion del dueño
 * (CLAUDE.md §5). El id del perfil ya viaja en los datos que la ficha tiene, asi
 * que la tienda funciona hoy y la URL linda es una decision pendiente.
 *
 * ⚠️ NO EXIGE SESION. Es parte de la vitrina: quien mira una camiseta tiene que
 * poder ver a quien se la vende sin registrarse.
 *
 * ⚠️ TODO LO QUE SE MUESTRA ES MEDIBLE (DEC-036 / TS-020). Ventas completadas,
 * reclamos, cancelaciones, cuanto tarda en responder, promedio de reseñas. El
 * `score` derivado NO se muestra: no decide nada y un numero sin unidad al lado
 * de una tienda se lee como un veredicto de Offside.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sellerId: string }>;
}): Promise<Metadata> {
  const { sellerId } = await params;
  const reputacion = await leerReputacion(sellerId);

  if (reputacion === null) return { title: 'Tienda no encontrada' };

  return {
    title: `${reputacion.sellerDisplayName} — tienda`,
    description: `Reputación y reseñas de ${reputacion.sellerDisplayName} en Offside Store.`,
  };
}

/**
 * La reputacion, o `null` si el vendedor no existe.
 *
 * ⚠️ EL SERVICE TIRA `sellerNotFound` PARA UN ID QUE NO EXISTE, y un id invalido
 * —cualquier texto en la URL— puede hacer fallar la consulta antes. Las dos
 * cosas significan lo mismo para esta pantalla: 404. Distinguirlas convertiria
 * la ruta en un oraculo de que ids de vendedor existen.
 */
async function leerReputacion(sellerId: string) {
  try {
    return await getSellerReputation(sellerId);
  } catch {
    return null;
  }
}

/** Una metrica cruda: se muestra sólo si aporta. */
function metricasDe(
  reputacion: Awaited<ReturnType<typeof getSellerReputation>>,
  horasDeRespuesta: number | null,
): string[] {
  const metricas: string[] = [
    reputacion.salesCount === 0
      ? 'Sin ventas completadas'
      : cantidad(reputacion.salesCount, 'venta completada', 'ventas completadas'),
  ];

  /*
    ⚠️ LOS RECLAMOS Y LAS CANCELACIONES SOLO SE MUESTRAN SI HAY. "0 reclamos" en
    una tienda sin ninguna venta no es un mérito: es una tienda vacía. Con
    ventas, en cambio, el cero SÍ dice algo y por eso se muestra.
  */
  if (reputacion.salesCount > 0) {
    metricas.push(cantidad(reputacion.claimsCount, 'reclamo'));
  } else if (reputacion.claimsCount > 0) {
    metricas.push(cantidad(reputacion.claimsCount, 'reclamo'));
  }

  if (reputacion.cancellationsCount > 0) {
    metricas.push(cantidad(reputacion.cancellationsCount, 'venta cancelada', 'ventas canceladas'));
  }

  // ⚠️ "responde en ~X" sólo si alguna vez respondió. Sin respuestas no se
  // inventa un número: el Service devuelve `null` justamente para eso.
  if (horasDeRespuesta !== null) {
    metricas.push(`responde preguntas en ~${horas(horasDeRespuesta)}`);
  }

  return metricas;
}

function Dato({ termino, children }: { termino: string; children: ReactNode }) {
  return (
    <div className={estilos.dato}>
      <dt className={estilos.datoTermino}>{termino}</dt>
      <dd className={estilos.datoValor}>{children}</dd>
    </div>
  );
}

export default async function TiendaPublica({
  params,
  searchParams,
}: {
  params: Promise<{ sellerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sellerId } = await params;
  /*
    Mismo criterio que la home: `searchParams` se espera PRIMERO y solo. Dentro
    de un `Promise.all` junto a una lectura de cookie, la sesión vuelve nula.
  */
  const consulta = await searchParams;
  const uno = (clave: string): string | undefined => {
    const valor = consulta[clave];

    return Array.isArray(valor) ? valor[0] : valor;
  };
  const aPagina = (texto: string | undefined): number =>
    Math.max(1, Number.parseInt(texto ?? '1', 10) || 1);

  /**
   * ⚠️ DOS PAGINACIONES INDEPENDIENTES Y DOS PARAMETROS DISTINTOS. Las
   * publicaciones y las reseñas se paginan por separado: con un solo `pagina`,
   * pasar a la página 2 de las reseñas saltearía las primeras 24 camisetas, y
   * al revés. Cada una lleva el otro parámetro puesto para no reiniciarlo.
   */
  const pagina = aPagina(uno('pagina'));
  const paginaDeResenas = aPagina(uno('resenas'));

  const avisoDeFavorito = uno('aviso') === 'favorito';

  const reputacion = await leerReputacion(sellerId);
  if (reputacion === null) notFound();

  /**
   * ⚠️ LAS CUATRO LECTURAS DE ALREDEDOR VAN EN PARALELO Y NINGUNA PUEDE VOLTEAR
   * LA PANTALLA. El nivel del vendedor tira si `seller_tiers` está vacía, las
   * vacaciones y las horas de respuesta son datos accesorios, y las reseñas son
   * una sección. El contrato de esta pantalla es "quién es este vendedor y qué
   * hizo", y eso ya lo trajo la reputación.
   */
  const [progreso, deVacaciones, horasDeRespuesta, resenas, catalogo, user] = await Promise.all([
    getTierProgress(sellerId).catch((error: unknown) => {
      console.error('[tienda] no se pudo leer el nivel', error);

      return null;
    }),
    isOnVacation(sellerId).catch(() => false),
    averageAnswerHours(sellerId).catch(() => null),
    listSellerReviews(sellerId, paginaDeResenas).catch((error: unknown) => {
      console.error('[tienda] no se pudieron leer las reseñas', error);

      return null;
    }),
    /*
      ⚠️ EL CATALOGO USA EL MISMO FILTRO DE VISIBILIDAD QUE LA VITRINA, asi que
      un vendedor desconectado de Mercado Pago, de vacaciones o sancionado tiene
      la tienda VACIA, no escondida: la pagina existe y explica por que no hay
      nada. Esconderla dejaria roto cada enlace que alguien compartio.
    */
    listPublicSellerCatalog(sellerId, { pagina }).catch((error: unknown) => {
      console.error('[tienda] no se pudo leer el catálogo del vendedor', error);

      return null;
    }),
    getSessionUser(),
  ]);

  /** Una consulta para toda la página; sin sesión no se hace ninguna. */
  const favoritos =
    user === null || catalogo === null
      ? new Set<string>()
      : await favoriteIdsOf(
          user,
          catalogo.listings.map((item) => item.id),
        );

  const metricas = metricasDe(reputacion, horasDeRespuesta);

  /**
   * Los enlaces de las dos paginaciones.
   *
   * ⚠️ CADA UNA CONSERVA EL PARAMETRO DE LA OTRA Y NINGUNA ARRASTRA `aviso`. Un
   * cartel de "no pudimos guardar" copiado a los enlaces de paginación
   * reaparecería en cada página aunque no hubiera fallado nada.
   */
  const href = (partes: { pagina?: number; resenas?: number }): string => {
    const query = new URLSearchParams();
    const p = partes.pagina ?? pagina;
    const r = partes.resenas ?? paginaDeResenas;

    if (p > 1) query.set('pagina', String(p));
    if (r > 1) query.set('resenas', String(r));

    const texto = query.toString();

    return texto === '' ? `/tienda/${sellerId}` : `/tienda/${sellerId}?${texto}`;
  };

  /** Lo que la ficha necesita para su corazón, o `undefined` si no hay sesión. */
  const favoritoDe = (idDeLaPublicacion: string): EstadoDeFavorito | undefined =>
    user === null
      ? undefined
      : {
          activo: favoritos.has(idDeLaPublicacion),
          volverA: `${href({})}#publicaciones`,
        };

  return (
    <>
      <Header />

      <Pantalla>
        <main id="contenido" className={estilos.pagina}>
          <div className={estilos.contenedor}>
            <Migas
              items={[
                { texto: 'Catálogo', href: '/' },
                { texto: 'Buscar', href: '/buscar' },
                { texto: reputacion.sellerDisplayName },
              ]}
            />

            {/* ------------------------------------------------ encabezado */}
            <header className={`${estilos.encabezado} entra-largo`}>
              <span className={estilos.marca} aria-hidden="true">
                <IconoTienda tamanio={30} />
              </span>

              <div className={estilos.identidad}>
                <h1 className={`display display-3 titular-degradado ${estilos.titulo}`}>
                  {reputacion.sellerDisplayName}
                </h1>

                {/*
                  ⚠️ LAS TRES INSIGNIAS DICEN COSAS DISTINTAS Y NO SE MEZCLAN
                  (DEC-022): la etiqueta de reputación sale de las ventas, el
                  nivel de usuario es el eje de la CUENTA y el nivel de vendedor
                  es el de la COMISIÓN. Juntarlas en un solo sello sería inventar
                  una categoría que la documentación separa a propósito.
                */}
                <div className={estilos.insignias}>
                  <InsigniaDeReputacion etiqueta={reputacion.label} metricas={metricas} />

                  {progreso?.currentTier != null && (
                    <InsigniaDeNivel
                      nombre={progreso.currentTier.name}
                      tasa={porcentajeDeComision(progreso.currentTier.basisPoints)}
                    />
                  )}
                </div>

                <Estrellas
                  promedio={reputacion.ratingAvg}
                  cantidad={reputacion.ratingCount}
                  tamanio="grande"
                />
              </div>
            </header>

            {/*
              ⚠️ VACACIONES SE AVISA ARRIBA DE TODO Y CON TEXTO, NO CON UN CHIP
              GRIS. Un vendedor ausente NO aparece en la vitrina (mismo predicado
              que SS-013), así que quien llega acá lo hizo por un enlace guardado
              o compartido: sin este aviso, la tienda se ve vacía y parece que el
              vendedor se fue del sitio.

              ⚠️ NO SE DICE HASTA CUÁNDO. `isOnVacation` devuelve un booleano;
              `getVacation` trae la fecha pero exige la sesión DEL PROPIO
              vendedor. Prometer una fecha que no tenemos sería peor que no
              decirla.
            */}
            {deVacaciones && (
              <div className={estilos.avisoVacaciones}>
                {/*
                  ⚠️ ES UN `Aviso` Y NO UN `Panel`. `Panel` pinta su título como
                  `<h1>`, y esta pantalla ya tiene el suyo —el nombre de la
                  tienda—: dos `<h1>` dejan a quien navega por encabezados sin
                  saber cuál es el título de la página.
                */}
                <Aviso tono="error">
                  <span className={estilos.avisoIcono} aria-hidden="true">
                    <IconoPausa tamanio={18} />
                  </span>
                  Esta tienda está de vacaciones: sus publicaciones no se pueden comprar hasta que
                  vuelva. Las que tengas guardadas siguen ahí y vuelven solas.
                </Aviso>
              </div>
            )}

            {/* -------------------------------------------------- métricas */}
            <section className={estilos.bloque} aria-labelledby="metricas-titulo">
              <h2 id="metricas-titulo" className={estilos.bloqueTitulo}>
                Lo que hizo en Offside
              </h2>

              {/*
                ⚠️ NÚMEROS CRUDOS, SIN VEREDICTO. `seller_reputations.score` es
                derivado y NO decide nada (DEC-036): se guarda para ordenar y
                analizar, no para etiquetar a una persona en su propia tienda.
                Lo que se publica acá es exactamente lo que pasó.
              */}
              <dl className={estilos.datos}>
                <Dato termino="Ventas completadas">{reputacion.salesCount}</Dato>
                <Dato termino="Reclamos recibidos">{reputacion.claimsCount}</Dato>
                <Dato termino="Ventas canceladas por él">{reputacion.cancellationsCount}</Dato>
                <Dato termino="Nivel de la cuenta">{nivelDeUsuario(reputacion.userLevel)}</Dato>
                {reputacion.avgDispatchHours !== null && (
                  <Dato termino="Tarda en despachar">{horas(reputacion.avgDispatchHours)}</Dato>
                )}
                {reputacion.onTimeDispatchRate !== null && (
                  <Dato termino="Despachos en plazo">
                    {Math.round(reputacion.onTimeDispatchRate * 100)}%{' '}
                    <span className={estilos.datoNota}>
                      sobre {cantidad(reputacion.dispatchedCount, 'envío', 'envíos')}
                    </span>
                  </Dato>
                )}
                {horasDeRespuesta !== null && (
                  <Dato termino="Responde preguntas en">~{horas(horasDeRespuesta)}</Dato>
                )}
              </dl>

              {reputacion.salesCount === 0 && (
                <p className={estilos.nota}>
                  Todavía no completó ninguna venta. Que sea nuevo no significa que sea riesgoso:
                  significa que no hay historial para mirar.
                </p>
              )}
            </section>

            {/* --------------------------------------------- publicaciones */}
            <section
              className={estilos.bloque}
              id="publicaciones"
              aria-labelledby="publicaciones-titulo"
            >
              <h2 id="publicaciones-titulo" className={estilos.bloqueTitulo}>
                {catalogo === null || catalogo.total === 0
                  ? 'Publicaciones'
                  : `${cantidad(catalogo.total, 'publicación', 'publicaciones')} a la venta`}
              </h2>

              {avisoDeFavorito && (
                <div className={estilos.avisoVacaciones}>
                  <Aviso tono="error">
                    No pudimos guardar la publicación. Probá de nuevo en un momento.
                  </Aviso>
                </div>
              )}

              {catalogo === null ? (
                <Aviso tono="error">
                  No pudimos cargar sus publicaciones en este momento. Probá de nuevo en un rato.
                </Aviso>
              ) : catalogo.listings.length === 0 ? (
                /*
                  ⚠️ EL VACIO DICE POR QUE, Y SON DOS MOTIVOS DISTINTOS. De
                  vacaciones, las publicaciones existen y vuelven solas: decir
                  "no tiene nada" sería falso y encima haría que la persona deje
                  de esperar. Sin vacaciones, es lo que parece.
                */
                <p className={estilos.nota}>
                  {deVacaciones
                    ? 'Mientras esté de vacaciones no se muestra nada acá. Sus publicaciones no se perdieron: vuelven solas cuando active la tienda.'
                    : 'Todavía no tiene ninguna publicación a la venta.'}
                </p>
              ) : (
                <>
                  {/*
                    ⚠️ LA MISMA FICHA QUE LA VITRINA, CON SU CORAZON Y SU
                    DISTINTIVO. Una grilla propia para la tienda sería un tercer
                    dibujo del mismo objeto: el día que cambie el precio o el
                    aviso de "Última unidad", este quedaría viejo sin que nada
                    avise.

                    ⚠️ `promocionada` NO SE PASA. `CatalogListing` no trae el
                    dato —el Service lo dejó igual a propósito— y, dentro de la
                    tienda de UN vendedor, el distintivo no ordena nada: sirve
                    para explicar por qué algo aparece antes que lo de OTRO
                    vendedor. Queda anotado.
                  */}
                  <ul className={`${estilos.grilla} enfoca-hermanos revela-grilla-materia`}>
                    {catalogo.listings.map((item) => (
                      <li key={item.id}>
                        <ListingCard listing={item} favorito={favoritoDe(item.id)} />
                      </li>
                    ))}
                  </ul>

                  <Paginacion
                    actual={catalogo.pagina}
                    total={catalogo.paginas}
                    hrefDe={(n) => `${href({ pagina: n })}#publicaciones`}
                  />
                </>
              )}
            </section>

            {/* --------------------------------------------------- reseñas */}
            <section className={estilos.bloque} id="resenas" aria-labelledby="resenas-titulo">
              <h2 id="resenas-titulo" className={estilos.bloqueTitulo}>
                Reseñas
              </h2>

              {resenas === null ? (
                <Aviso tono="error">
                  No pudimos cargar las reseñas en este momento. Probá de nuevo en un rato.
                </Aviso>
              ) : resenas.items.length === 0 ? (
                <p className={estilos.nota}>
                  Todavía nadie lo calificó. Sólo puede dejar una reseña quien le compró y recibió
                  el pedido.
                </p>
              ) : (
                <>
                  <ol className={estilos.resenas}>
                    {resenas.items.map((resena) => (
                      <li key={resena.id} className={estilos.resena}>
                        <div className={estilos.resenaCabecera}>
                          <Estrellas promedio={resena.rating} cantidad={1} />
                          <p className={estilos.resenaAutor}>
                            {/*
                              ⚠️ EL NOMBRE PUEDE FALTAR Y NO SE INVENTA UNO. La
                              cuenta puede no haber cargado su nombre visible;
                              "Anónimo" es preferible a un alias fabricado, que
                              además no sería estable entre reseñas.
                            */}
                            {resena.raterDisplayName ?? 'Compra verificada'}
                            <span className={estilos.resenaFecha}>
                              {' · '}
                              {fecha(resena.createdAt.toISOString())}
                            </span>
                          </p>
                        </div>

                        {resena.comment !== null && resena.comment !== '' && (
                          <p className={estilos.resenaTexto}>{resena.comment}</p>
                        )}

                        {/*
                          ⚠️ LA RESPUESTA DEL VENDEDOR VA SANGRADA Y ROTULADA. Es
                          la otra voz de la conversación, y sin la marca las dos
                          se leen como una sola opinión. El vendedor responde UNA
                          vez y no puede editarla: por eso queda abajo y no en
                          lugar de la reseña.
                        */}
                        {resena.sellerReply !== null && resena.sellerReply !== '' && (
                          <div className={estilos.respuesta}>
                            <p className={estilos.respuestaRotulo}>
                              Respondió {reputacion.sellerDisplayName}
                              {resena.sellerRepliedAt !== null && (
                                <span className={estilos.resenaFecha}>
                                  {' · '}
                                  {fecha(resena.sellerRepliedAt.toISOString())}
                                </span>
                              )}
                            </p>
                            <p className={estilos.respuestaTexto}>{resena.sellerReply}</p>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>

                  <Paginacion
                    actual={resenas.pagina}
                    total={resenas.totalPaginas}
                    hrefDe={(n) => `${href({ resenas: n })}#resenas`}
                  />
                </>
              )}
            </section>
          </div>
        </main>
      </Pantalla>

      <Footer />
    </>
  );
}
