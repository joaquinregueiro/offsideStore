import type { Metadata } from 'next';
<<<<<<< HEAD
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { IconoAutenticado, IconoEtiqueta, IconoLlave, IconoTilde } from '@/components/iconos';
import { FotoCompartida, Pantalla } from '@/components/movimiento';
import { BotonEnlace, Etiqueta, Migas, Pliego, Precio } from '@/components/ui';
import { condicion, manga, precio, tipoDeCamiseta } from '@/lib/formato';
=======
import { notFound } from 'next/navigation';

import { Header } from '@/components/header';
import { BotonEnlace, Etiqueta } from '@/components/ui';
import { condicion, precio } from '@/lib/formato';
>>>>>>> origin/main
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

<<<<<<< HEAD
/**
 * ⚠️ SE LEE `process.env` DIRECTO Y NO `getEnv()`, POR LA MISMA RAZON QUE
 * `app/layout.tsx`: `getEnv()` valida el entorno ENTERO y tira si falta
 * cualquier variable. La ficha publica no deberia dejar de servirse porque no
 * este configurado Mercado Pago. Aca solo hace falta una URL base para armar el
 * enlace que se comparte, y si no esta, localhost sirve.
 */
const URL_BASE = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

=======
>>>>>>> origin/main
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await findPublicListing(id);

<<<<<<< HEAD
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

=======
  if (listing === null) return { title: 'Publicación no encontrada — Offside Store' };

  return {
    title: `${listing.title} — Offside Store`,
    description: listing.description ?? 'Camiseta de fútbol en Offside Store.',
  };
}

>>>>>>> origin/main
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
<<<<<<< HEAD
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
=======
>>>>>>> origin/main

  return (
    <>
      <Header />

<<<<<<< HEAD
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
                <Dato etiqueta="Vendedor">{listing.sellerDisplayName}</Dato>
              </dl>
            </div>
          </Pliego>

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
=======
      <main className={estilos.contenedor}>
        <a href="/" className={estilos.volver}>
          ← Volver al catálogo
        </a>

        <div className={estilos.grilla}>
          {/*
            Galeria. Sin fotos, el patron de la identidad §05 reserva el mismo
            espacio para que la ficha no cambie de forma segun tenga o no.

            ⚠️ SIN JAVASCRIPT: las fotos se apilan y se desplazan con scroll,
            no hay carrusel. Un carrusel exige JS y esconde detras de flechas
            justamente lo que un comprador de camisetas usadas necesita ver
            —etiqueta, defectos, dorso—.

            ⚠️ La PRIMERA carga con `eager` y las demas con `lazy`: la portada
            es lo primero que se ve y esperar a que el navegador decida
            retrasaria lo unico que importa al abrir la pagina.
          */}
          {listing.images.length === 0 ? (
            <div className={estilos.marco} aria-hidden="true" />
          ) : (
            <div className={estilos.galeria}>
              {listing.images.map((imagen, indice) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={imagen.url}
                  className={estilos.foto}
                  src={imagen.url}
                  alt={imagen.alt ?? `${listing.title} — foto ${indice + 1}`}
                  loading={indice === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                />
              ))}
            </div>
          )}

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
>>>>>>> origin/main
    </>
  );
}
