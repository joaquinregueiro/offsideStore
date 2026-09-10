import type { Metadata } from 'next';
<<<<<<< HEAD
import Link from 'next/link';

import { CampoOculto, Formulario } from '@/components/form';
import { IconoCamiseta } from '@/components/iconos';
import { FotoCompartida, Pantalla } from '@/components/movimiento';
import { Aviso, BotonEnlace, Confirmar, EstadoVacio, Etiqueta, Seccion } from '@/components/ui';
import { condicion, estadoDePublicacion, precio, tonoDePublicacion } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { coverUrls, listMyListings } from '@/modules/listings/services/listing.service';
import { getConnectionStatus } from '@/modules/sellers/services/mercadopago-connection.service';

import { eliminar, pausar, reactivar } from '../../acciones';
import { Chapa } from '../../chapa';
import { NavDelVendedor } from '../../nav';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mis publicaciones' };
=======

import { CampoOculto, Formulario } from '@/components/form';
import { Aviso, BotonEnlace, EstadoVacio, Etiqueta } from '@/components/ui';
import { condicion, estadoDePublicacion, precio } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { listMyListings } from '@/modules/listings/services/listing.service';
import { getConnectionStatus } from '@/modules/sellers/services/mercadopago-connection.service';

import { eliminar, pausar, reactivar } from '../../acciones';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mis publicaciones — Offside Store' };
>>>>>>> origin/main
export const dynamic = 'force-dynamic';

/**
 * Inventario del vendedor (SS-060).
 *
 * ⚠️ ESTA PANTALLA NO FILTRA POR SS-013, y es lo contrario de la vitrina a
 * proposito. Si un vendedor desconecta Mercado Pago, sus publicaciones
 * desaparecen del catalogo publico pero **siguen siendo suyas y siguen aca**:
 * esconderselas a el tambien seria hacerle creer que las perdio.
 *
 * Lo que si cambia es el aviso: SS-013 pide "detectar y COMUNICAR" ese estado, y
 * comunicarlo es justamente lo que faltaba —la vitrina se apagaba y el vendedor
 * no tenia forma de enterarse—.
 */
export default async function MisPublicaciones() {
  const user = await requireSellerSessionUser('/vendedor/publicaciones');

  const [publicaciones, conexion] = await Promise.all([
    listMyListings(user),
    getConnectionStatus(user),
  ]);

<<<<<<< HEAD
  // Las portadas de todo el inventario en una sola consulta.
  const portadas = await coverUrls(publicaciones.map((item) => item.id));

=======
>>>>>>> origin/main
  /**
   * Cuantas dejaron de verse por la desconexion.
   *
   * Solo las `active`: una pausada o un borrador tampoco se muestran, pero eso
   * lo decidio el vendedor y meterlas en la cuenta convertiria el aviso en un
   * numero que no explica nada.
   */
  const activas = publicaciones.filter((p) => p.status === 'active').length;

  return (
<<<<<<< HEAD
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Chapa
          rotulo="Inventario"
          titulo="Mis publicaciones"
          chica
          accion={
            conexion.canSell ? (
              <BotonEnlace href="/vendedor/publicaciones/nueva" flecha>
                Publicar
              </BotonEnlace>
            ) : undefined
          }
        />

        <NavDelVendedor activo="publicaciones" publicaciones={publicaciones.length} />

        {!conexion.canSell && (
          <Aviso tono="error">
            {activas > 0 &&
              (activas === 1 ? (
                <>
                  <strong>Tu publicación activa no se está mostrando.</strong> Mientras Mercado Pago
                  no esté conectado nadie puede verla ni comprarla, porque no podríamos cobrarte la
                  venta. <strong>Vuelve sola al reconectar</strong>: no hace falta que la
                  republiques ni que toques nada.{' '}
                </>
              ) : (
                <>
                  <strong>Tus {activas} publicaciones activas no se están mostrando.</strong>{' '}
                  Mientras Mercado Pago no esté conectado nadie puede verlas ni comprarlas, porque
                  no podríamos cobrarte la venta. <strong>Vuelven solas al reconectar</strong>: no
                  hace falta que las republiques ni que toques nada.{' '}
                </>
              ))}
            Para publicar necesitás estar habilitado y tener Mercado Pago conectado.{' '}
            <a href="/vendedor">Ver qué te falta</a>.
          </Aviso>
        )}

        {publicaciones.length === 0 ? (
          <EstadoVacio titulo="Todavía no publicaste nada" icono={<IconoCamiseta tamanio={40} />}>
            <p>Cuando publiques una camiseta va a aparecer acá, con su stock y su estado.</p>
            {conexion.canSell && (
              <BotonEnlace href="/vendedor/publicaciones/nueva" flecha>
                Publicar la primera
              </BotonEnlace>
            )}
          </EstadoVacio>
        ) : (
          <Seccion
            titulo="Inventario"
            dato={
              publicaciones.length === 1 ? '1 publicación' : `${publicaciones.length} publicaciones`
            }
          >
            <ul className={`${estilos.inventario} revela-grilla`}>
              {publicaciones.map((publicacion) => {
                const portada = portadas.get(publicacion.id);

                return (
                  <li
                    key={publicacion.id}
                    className={estilos.fila}
                    /*
                      ⚠️ EL ESTADO VIAJA COMO ATRIBUTO, NO COMO CLASE CALCULADA.
                      Así el CSS decide cómo se ve cada estado sin que esta
                      pantalla tenga que conocer la paleta, y agregar un estado al
                      enum no obliga a tocar el `.tsx`.
                    */
                    data-estado={publicacion.status}
                  >
                    {/*
                      ⚠️ LA FOTO ES LO QUE HACE RECONOCIBLE UNA FILA. Un
                      inventario de quince camisetas donde todas se llaman
                      "Camiseta River 1996" obliga a leer el título entero de cada
                      una; con la miniatura se encuentra la que se busca de un
                      vistazo.

                      ⚠️ EL MARCO ES EL QUE RECORTA, NO LA FILA: el acercamiento
                      de la foto necesita un `overflow: hidden`, y ponerlo en la
                      fila le comería el anillo de foco a los cinco controles que
                      tiene adentro.
                    */}
                    <FotoCompartida id={publicacion.id}>
                      <span className={estilos.filaMarco}>
                        {portada === undefined ? (
                          <span className={estilos.filaPatron} aria-hidden="true" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className={estilos.filaFoto}
                            src={portada}
                            alt=""
                            width={84}
                            height={105}
                            loading="lazy"
                            decoding="async"
                          />
                        )}
                      </span>
                    </FotoCompartida>

                    <div className={estilos.filaCuerpo}>
                      <div className={estilos.filaTitulo}>
                        {/*
                          ⚠️ EL SUBRAYADO SE DIBUJA CON EL FONDO, NO CON UN
                          `::after`. Un pseudo subraya el RECTÁNGULO del enlace:
                          si el título parte en dos líneas, la raya cruza el aire
                          a la derecha de la primera.
                        */}
                        <Link
                          href={`/p/${publicacion.id}`}
                          className="subraya"
                          transitionTypes={['avanza']}
                        >
                          {publicacion.title}
                        </Link>
                        <Etiqueta tono={tonoDePublicacion(publicacion.status)}>
                          {estadoDePublicacion(publicacion.status)}
                        </Etiqueta>
                      </div>

                      {/*
                        ⚠️ EL STOCK SE DICE SIEMPRE Y CON EL NUMERO. Sacarlo de
                        acá para dejarlo sólo en el chip de "última unidad" deja
                        sin ningún dato de stock a una publicación pausada o en
                        borrador con una sola unidad — que es justo el caso donde
                        el vendedor está decidiendo si reactivarla.
                      */}
                      <p className={estilos.filaMeta}>
                        Talle {publicacion.sizeValue} · {condicion(publicacion.condition)} ·{' '}
                        {publicacion.stock === 1 ? '1 unidad' : `${publicacion.stock} unidades`}
                      </p>

                      {/*
                        ⚠️ EL PULSO SÓLO EN LO QUE ESTÁ A LA VENTA, y es legítimo
                        únicamente porque NO es la información: el chip lo dice
                        con texto y con color (`--color-alerta`, 4.88:1 sobre
                        blanco) y la línea de arriba ya dio el número. Quien no ve
                        la animación no se pierde nada. Late TRES veces y para
                        —WCAG 2.2.2 exige poder detener cualquier movimiento de
                        más de cinco segundos, y algo que late para siempre al
                        lado de un precio es una alarma—.
                      */}
                      {publicacion.stock === 1 && (
                        <p className={estilos.filaMeta}>
                          <span
                            className={[
                              estilos.chipUltima,
                              publicacion.status === 'active' ? 'pulso-atencion' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            Última unidad
                          </span>
                        </p>
                      )}

                      {/*
                        ⚠️ EL PRECIO EN LA TIPOGRAFIA DE TITULARES, igual que en
                        la vitrina. Es el dato que el vendedor viene a mirar
                        cuando entra al inventario, y perdido dentro de la linea
                        de metadatos no se distingue del talle.
                      */}
                      <p className={estilos.filaPrecio}>
                        {precio(publicacion.priceAmount, publicacion.currency)}
                      </p>

                      {/*
                        ⚠️ UN BORRADOR NO SE VE EN LA VITRINA, y el vendedor
                        tiene que saber por que. Sin este aviso, una publicacion
                        que quedo sin fotos parece publicada y no vende, sin
                        explicacion.
                      */}
                      {publicacion.status === 'draft' && (
                        <p className={estilos.filaAviso}>
                          Sin fotos: no está a la venta hasta que subas al menos una.
                        </p>
                      )}

                      {/*
                        SS-050. Cada accion es un formulario propio: son
                        mutaciones y van por POST, no por enlace —un GET que
                        cambia estado se dispara con el prefetch del navegador—.
                      */}
                      <div className={estilos.filaAcciones}>
                        <BotonEnlace
                          href={`/vendedor/publicaciones/${publicacion.id}/editar`}
                          variante="fantasma"
                          tamanio="chico"
                        >
                          Editar
                        </BotonEnlace>
                        <BotonEnlace
                          href={`/vendedor/publicaciones/${publicacion.id}/fotos`}
                          variante="fantasma"
                          tamanio="chico"
                        >
                          Fotos
                        </BotonEnlace>

                        {(publicacion.status === 'active' || publicacion.status === 'sold_out') && (
                          <Formulario
                            accion={pausar}
                            enviar="Pausar"
                            variante="fantasma"
                            tamanio="chico"
                            bloque={false}
                          >
                            <CampoOculto nombre="listingId" valor={publicacion.id} />
                          </Formulario>
                        )}

                        {publicacion.status === 'paused' && (
                          <Formulario
                            accion={reactivar}
                            enviar="Volver a la venta"
                            variante="secundario"
                            tamanio="chico"
                            bloque={false}
                          >
                            <CampoOculto nombre="listingId" valor={publicacion.id} />
                          </Formulario>
                        )}

                        {/*
                          ⚠️ ELIMINAR VA EN DOS PASOS. Es irreversible y hasta
                          ahora pasaba con un solo clic, en una fila donde el
                          boton de al lado es "Pausar" —que si se deshace—. El
                          aviso de consecuencia se lee ANTES de decidir, no en
                          una nota al pie.
                        */}
                        <Confirmar
                          etiqueta="Eliminar"
                          pregunta="Se saca de la venta para siempre. El historial de quien ya la compró no se toca, pero vos no podés recuperarla."
                        >
                          <Formulario
                            accion={eliminar}
                            enviar="Sí, eliminar"
                            variante="peligro"
                            tamanio="chico"
                            bloque={false}
                          >
                            <CampoOculto nombre="listingId" valor={publicacion.id} />
                          </Formulario>
                        </Confirmar>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Seccion>
        )}

        {/*
          ⚠️ LAS TRES REGLAS QUE MAS IMPORTAN DE ESTA PANTALLA ESTABAN EN GRIS DE
          13px AL PIE. Que eliminar sea definitivo y que cambiar el precio no
          toque las órdenes ya hechas (BR-023 / SS-041) son cosas que hay que
          leer, no que hay que encontrar.
        */}
        <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
          <p className={estilos.nota}>
            Pausar la saca de la vitrina y podés volver a activarla cuando quieras. Eliminar es
            definitivo. Cambiar el precio no afecta a las órdenes ya hechas.
          </p>
        </div>
      </main>
    </Pantalla>
=======
    <main className={estilos.pagina}>
      <div className={estilos.encabezado}>
        <h1 className={estilos.titulo}>Mis publicaciones</h1>
        {conexion.canSell && (
          <BotonEnlace href="/vendedor/publicaciones/nueva">Publicar</BotonEnlace>
        )}
      </div>

      {!conexion.canSell && (
        <Aviso error>
          {activas > 0 &&
            (activas === 1 ? (
              <>
                <strong>Tu publicación activa no se está mostrando.</strong> Mientras Mercado Pago
                no esté conectado nadie puede verla ni comprarla, porque no podríamos cobrarte la
                venta. <strong>Vuelve sola al reconectar</strong>: no hace falta que la republiques
                ni que toques nada.{' '}
              </>
            ) : (
              <>
                <strong>Tus {activas} publicaciones activas no se están mostrando.</strong> Mientras
                Mercado Pago no esté conectado nadie puede verlas ni comprarlas, porque no podríamos
                cobrarte la venta. <strong>Vuelven solas al reconectar</strong>: no hace falta que
                las republiques ni que toques nada.{' '}
              </>
            ))}
          Para publicar necesitás estar habilitado y tener Mercado Pago conectado.{' '}
          <a href="/vendedor">Ver qué te falta</a>.
        </Aviso>
      )}

      {publicaciones.length === 0 ? (
        <EstadoVacio titulo="Todavía no publicaste nada">
          Cuando publiques una camiseta va a aparecer acá, con su stock y su estado.
        </EstadoVacio>
      ) : (
        publicaciones.map((publicacion) => (
          <article key={publicacion.id} className={estilos.tarjeta}>
            <div className={estilos.linea}>
              <a href={`/p/${publicacion.id}`}>{publicacion.title}</a>
              <Etiqueta aviso={publicacion.status !== 'active'}>
                {estadoDePublicacion(publicacion.status)}
              </Etiqueta>
            </div>
            <div className={estilos.linea}>
              <span className={estilos.concepto}>
                Talle {publicacion.sizeValue} · {condicion(publicacion.condition)} · stock{' '}
                {publicacion.stock}
              </span>
              <span>{precio(publicacion.priceAmount, publicacion.currency)}</span>
            </div>
            <div className={estilos.linea}>
              <a href={`/vendedor/publicaciones/${publicacion.id}/editar`}>Editar</a>
              <a href={`/vendedor/publicaciones/${publicacion.id}/fotos`}>Fotos</a>
            </div>

            {/*
              ⚠️ UN BORRADOR NO SE VE EN LA VITRINA, y el vendedor tiene que
              saber por que. Sin este aviso, una publicacion que quedo sin fotos
              parece publicada y no vende, sin explicacion.
            */}
            {publicacion.status === 'draft' && (
              <p className={estilos.pasoDetalle}>
                Sin fotos: no está a la venta hasta que subas al menos una.
              </p>
            )}

            {/*
              SS-050. Cada accion es un formulario propio: son mutaciones y van
              por POST, no por enlace —un GET que cambia estado se dispara con
              el prefetch del navegador—.
            */}
            <div className={estilos.acciones}>
              {(publicacion.status === 'active' || publicacion.status === 'sold_out') && (
                <Formulario accion={pausar} enviar="Pausar">
                  <CampoOculto nombre="listingId" valor={publicacion.id} />
                </Formulario>
              )}

              {publicacion.status === 'paused' && (
                <Formulario accion={reactivar} enviar="Volver a la venta">
                  <CampoOculto nombre="listingId" valor={publicacion.id} />
                </Formulario>
              )}

              {/*
                ⚠️ ELIMINAR ES IRREVERSIBLE para el vendedor. Se avisa ANTES,
                junto al boton, no en un cartel que se lee despues.
              */}
              <Formulario accion={eliminar} enviar="Eliminar">
                <CampoOculto nombre="listingId" valor={publicacion.id} />
                <p className={estilos.pasoDetalle}>Eliminar no se puede deshacer.</p>
              </Formulario>
            </div>
          </article>
        ))
      )}

      <p className={estilos.nota}>
        Pausar la saca de la vitrina y podés volver a activarla cuando quieras. Eliminar es
        definitivo. Cambiar el precio no afecta a las órdenes ya hechas.
      </p>
    </main>
>>>>>>> origin/main
  );
}
