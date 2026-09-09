import type { Metadata } from 'next';

import { CampoOculto, Formulario } from '@/components/form';
import { Aviso, BotonEnlace, EstadoVacio, Etiqueta } from '@/components/ui';
import { condicion, estadoDePublicacion, precio } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { listMyListings } from '@/modules/listings/services/listing.service';
import { getConnectionStatus } from '@/modules/sellers/services/mercadopago-connection.service';

import { eliminar, pausar, reactivar } from '../../acciones';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mis publicaciones — Offside Store' };
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

  /**
   * Cuantas dejaron de verse por la desconexion.
   *
   * Solo las `active`: una pausada o un borrador tampoco se muestran, pero eso
   * lo decidio el vendedor y meterlas en la cuenta convertiria el aviso en un
   * numero que no explica nada.
   */
  const activas = publicaciones.filter((p) => p.status === 'active').length;

  return (
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
  );
}
