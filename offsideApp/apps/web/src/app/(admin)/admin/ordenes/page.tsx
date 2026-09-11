import type { Metadata } from 'next';
import Link from 'next/link';

import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  Boton,
  BotonEnlace,
  Cronologia,
  Definiciones,
  EstadoVacio,
  Etiqueta,
  Tabla,
  type Hito,
} from '@/components/ui';
import { estadoDeOrden, fechaYHora, precio, tonoDeOrden } from '@/lib/formato';
import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';
import {
  findByOrderNumber,
  getOrderTimeline,
  listPaidWithoutStock,
  type TimelineEntry,
} from '@/modules/orders/services/order.service';

import { Consola } from '../../consola';
import estilos from '../../admin.module.css';

export const metadata: Metadata = { title: 'Órdenes' };
export const dynamic = 'force-dynamic';

/**
 * Consola de órdenes.
 *
 * ⚠️ SE BUSCA POR NUMERO, NO SE LISTA TODO. Mismo criterio que la consola de
 * pagos: un padrón de todas las compras de la plataforma no sirve para operar y
 * es una fuga esperando. El caso real es "quien compró la OFF-XXXX escribe".
 *
 * ⚠️ LA UNICA LISTA QUE SI SE MUESTRA ES LA COLA DE TRABAJO: las órdenes que
 * quedaron `PAID` sin pasar a `PROCESSING`. Cada una tiene un pago aprobado y
 * nada que despachar —el stock se agotó entre el checkout y la aprobación—, y
 * resolverlas (reembolso, reposición) es una decisión manual. Es la única
 * pantalla del back-office donde una lista completa es la herramienta.
 *
 * ⚠️ DESDE ACA NO SE CAMBIA EL ESTADO DE UNA ORDEN, y es deliberado: mover una
 * orden a mano es exactamente lo que la máquina de estados existe para impedir.
 * El reembolso se emite en Pagos; el despacho lo hace el vendedor.
 */

/**
 * El ciclo de DEC-029, para dibujarlo entero aunque la orden esté a mitad.
 *
 * ⚠️ `PAID` ES UN INSTANTE: el pago aprobado deja la orden en `PROCESSING`
 * salvo que falte stock. Se dibuja igual porque es el hito que explica de dónde
 * salió la plata, y porque una orden trabada en `PAID` es justamente el caso
 * que esta pantalla existe para encontrar.
 */
const SECUENCIA = [
  { clave: 'PENDING_PAYMENT', titulo: 'Esperando el pago' },
  { clave: 'PAID', titulo: 'Pago acreditado' },
  { clave: 'PROCESSING', titulo: 'Lista para despachar' },
  { clave: 'SHIPPED', titulo: 'Despachada' },
  { clave: 'DELIVERED', titulo: 'Entregada' },
  { clave: 'COMPLETED', titulo: 'Completada' },
] as const;

const ACTORES: Record<string, string> = {
  user: 'quien compró',
  seller: 'el vendedor',
  admin: 'Offside',
  system: 'el sistema',
};

/**
 * Arma la línea de tiempo a partir del historial REAL, no de las fechas de la
 * orden.
 *
 * ⚠️ `order_status_history` ES LA FUENTE, y no las columnas `*_at`. El
 * historial dice además QUIEN hizo cada transición y con qué nota, que es lo
 * que se viene a mirar cuando una orden quedó donde no debía.
 *
 * ⚠️ UNA CANCELACION CORTA LA LINEA. No se dibujan los hitos siguientes
 * apagados: después de una cancelación no hay recorrido que prometer.
 */
function hitosDeLaOrden(estado: string, creada: string, historial: TimelineEntry[]): Hito[] {
  const porEstado = new Map(historial.map((entrada) => [entrada.toStatus, entrada]));
  const cancelada = estado === 'CANCELLED';

  const hitos: Hito[] = [];

  for (const paso of SECUENCIA) {
    const entrada = porEstado.get(paso.clave);
    const alcanzado = paso.clave === 'PENDING_PAYMENT' || entrada !== undefined;

    if (cancelada && !alcanzado) break;

    const fechaDelPaso = paso.clave === 'PENDING_PAYMENT' ? creada : entrada?.createdAt;

    hitos.push({
      clave: paso.clave,
      titulo: paso.titulo,
      estado: !alcanzado ? 'futuro' : paso.clave === estado ? 'actual' : 'hecho',
      ...(fechaDelPaso === undefined ? {} : { fecha: fechaYHora(fechaDelPaso) }),
      ...(entrada === undefined
        ? {}
        : {
            actor: entrada.actorDisplayName ?? ACTORES[entrada.actorType] ?? entrada.actorType,
            ...(entrada.note === null ? {} : { nota: entrada.note }),
          }),
    });
  }

  if (cancelada) {
    const entrada = porEstado.get('CANCELLED');
    hitos.push({
      clave: 'CANCELLED',
      titulo: 'Cancelada',
      estado: 'cancelado',
      ...(entrada === undefined
        ? {}
        : {
            fecha: fechaYHora(entrada.createdAt),
            actor: entrada.actorDisplayName ?? ACTORES[entrada.actorType] ?? entrada.actorType,
            ...(entrada.note === null ? {} : { nota: entrada.note }),
          }),
    });
  }

  return hitos;
}

export default async function Ordenes({
  searchParams,
}: {
  searchParams: Promise<{ orden?: string }>;
}) {
  const [{ orden }, admin] = await Promise.all([
    searchParams,
    requireCapabilitySessionUser(CAPABILITIES.SYSTEM_CONFIG_MANAGE, '/admin/ordenes'),
  ]);

  const buscado = orden?.trim().toUpperCase() ?? '';
  const hallada = buscado === '' ? null : await findByOrderNumber(buscado);

  const [historial, trabadas] = await Promise.all([
    hallada === null ? Promise.resolve<TimelineEntry[]>([]) : getOrderTimeline(hallada.id),
    listPaidWithoutStock(50),
  ]);

  const buscador = (
    <form
      method="get"
      className={
        hallada === null ? `${estilos.buscador} ${estilos.buscadorHeroe}` : estilos.buscador
      }
    >
      <div className={estilos.buscadorCampo}>
        <label htmlFor="orden" className={estilos.etiquetaCampo}>
          Número de orden
        </label>
        <input
          id="orden"
          name="orden"
          className={estilos.control}
          defaultValue={buscado}
          placeholder="OFF-XXXXXXXXXX"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <Boton type="submit" className="presiona">
        Buscar
      </Boton>

      {hallada === null && (
        <p className={estilos.ayudaBuscador}>
          Se escribe completo, con el prefijo <code>OFF-</code>.
        </p>
      )}
    </form>
  );

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Consola rol={admin.adminRole} email={admin.email} activo="ordenes" titulo="Órdenes">
          {buscador}
        </Consola>

        <div className={estilos.hoja}>
          {buscado !== '' && hallada === null && (
            <EstadoVacio titulo="No encontramos esa orden">
              Revisá el número. Se escribe completo, con el prefijo <code>OFF-</code>.
            </EstadoVacio>
          )}

          {hallada !== null && (
            <>
              <article className={`${estilos.tarjeta} ${estilos.fichaNeutra}`}>
                <div className={estilos.tarjetaCabecera}>
                  <span className={estilos.numeroDeOrden}>{hallada.orderNumber}</span>
                  <span className={estilos.estadoGrupo}>
                    <span className={estilos.rotuloEstado}>Estado de la orden</span>
                    <Etiqueta tono={tonoDeOrden(hallada.status)}>
                      {estadoDeOrden(hallada.status)}
                    </Etiqueta>
                  </span>
                </div>

                <Definiciones
                  items={[
                    { termino: 'Producto', valor: precio(hallada.productAmount, hallada.currency) },
                    { termino: 'Envío', valor: precio(hallada.shippingAmount, hallada.currency) },
                    { termino: 'Total', valor: precio(hallada.totalAmount, hallada.currency) },
                    {
                      termino: 'Comisión de Offside',
                      valor: precio(hallada.commissionAmount, hallada.currency),
                    },
                    {
                      termino: 'Para el vendedor',
                      valor: precio(hallada.sellerAmount, hallada.currency),
                    },
                    { termino: 'Creada', valor: fechaYHora(hallada.createdAt) },
                  ]}
                />
              </article>

              <h2 className={estilos.subtitulo}>Cronología</h2>
              <Cronologia
                hitos={hitosDeLaOrden(hallada.status, hallada.createdAt, historial)}
                etiqueta={`Recorrido de la orden ${hallada.orderNumber}`}
              />

              <p className={estilos.nota}>
                <span>
                  Desde acá no se cambia el estado de una orden. El reembolso se emite en{' '}
                  <Link href={`/admin/pagos?orden=${hallada.orderNumber}`}>Pagos</Link> y el
                  despacho lo hace el vendedor.
                </span>
              </p>
            </>
          )}

          <h2 className={estilos.subtitulo}>Pagadas sin stock</h2>

          <div className={estilos.avisoDeConsola}>
            <Aviso tono="error">
              Estas órdenes tienen el pago <strong>aprobado</strong> y no hay unidades para
              despachar: quedaron en <code>PAID</code> sin pasar a <code>PROCESSING</code>. Cada una
              necesita una decisión manual —reembolsar o reponer— y mientras tanto hay plata cobrada
              contra algo que no se puede entregar.
            </Aviso>
          </div>

          {trabadas.length === 0 ? (
            <EstadoVacio titulo="No hay ninguna orden trabada">
              Es el estado normal: el stock se descuenta en la misma transacción que aprueba el
              pago.
            </EstadoVacio>
          ) : (
            <div className={estilos.historial}>
              <Tabla titulo="Órdenes pagadas sin stock" tituloVisible>
                <thead>
                  <tr>
                    <th scope="col">Orden</th>
                    <th scope="col">Qué se compró</th>
                    <th scope="col">Total</th>
                    <th scope="col">Pagada</th>
                  </tr>
                </thead>
                <tbody>
                  {trabadas.map((orden) => (
                    <tr key={orden.id}>
                      <td>
                        <Link href={`/admin/ordenes?orden=${orden.orderNumber}`}>
                          {orden.orderNumber}
                        </Link>
                      </td>
                      <td>
                        {/*
                          ⚠️ EL TITULO ES EL SNAPSHOT DE LA ORDEN, no el de la
                          publicación de hoy: la publicación puede haber
                          cambiado de título o estar eliminada, y lo que se
                          compró fue esto.
                        */}
                        {orden.items.map((item) => (
                          <span key={item.id} className={estilos.metaFila}>
                            {item.quantity} × {item.title}
                          </span>
                        ))}
                      </td>
                      <td>{precio(orden.totalAmount, orden.currency)}</td>
                      <td>{orden.paidAt === null ? '—' : fechaYHora(orden.paidAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            </div>
          )}

          <div className={estilos.pie}>
            <BotonEnlace href="/admin" variante="secundario">
              Volver
            </BotonEnlace>
          </div>
        </div>
      </main>
    </Pantalla>
  );
}
