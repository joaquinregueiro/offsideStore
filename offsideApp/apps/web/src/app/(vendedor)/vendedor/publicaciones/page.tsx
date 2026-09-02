import type { Metadata } from 'next';

import { Aviso, BotonEnlace, EstadoVacio, Etiqueta } from '@/components/ui';
import { condicion, estadoDePublicacion, precio } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { listMyListings } from '@/modules/listings/services/listing.service';
import { getConnectionStatus } from '@/modules/sellers/services/mercadopago-connection.service';

import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mis publicaciones — Offside Store' };
export const dynamic = 'force-dynamic';

/**
 * Inventario del vendedor (SS-060).
 *
 * ⚠️ SOLO LECTURA POR AHORA. SS-040 (editar) y SS-050 (pausar, reactivar,
 * eliminar) son MVP y NO estan implementados: no existe el Service que los
 * haga, y SS-040 ademas exige auditar los cambios sensibles de precio y
 * autenticidad (BR-015). Se avisa en la pantalla en vez de mostrar botones que
 * no hacen nada.
 */
export default async function MisPublicaciones() {
  const user = await requireSellerSessionUser('/vendedor/publicaciones');

  const [publicaciones, conexion] = await Promise.all([
    listMyListings(user),
    getConnectionStatus(user),
  ]);

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
          </article>
        ))
      )}

      <p className={estilos.nota}>
        Todavía no se puede editar, pausar ni eliminar una publicación desde acá. Si necesitás bajar
        algo, escribinos.
      </p>
    </main>
  );
}
