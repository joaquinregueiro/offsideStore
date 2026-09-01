import type { Metadata } from 'next';

import { BotonEnlace, Etiqueta, EstadoVacio } from '@/components/ui';
import { estadoDeOrden, fecha, precio } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { listMyOrders } from '@/modules/orders/services/order.service';

import estilos from '../resumen.module.css';

export const metadata: Metadata = { title: 'Mis compras — Offside Store' };
export const dynamic = 'force-dynamic';

/** Historial de compras (BS-080). */
export default async function MisCompras() {
  const user = await requireVerifiedSessionUser('/mis-compras');
  const ordenes = await listMyOrders(user);

  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Mis compras</h1>

      {ordenes.length === 0 ? (
        <EstadoVacio titulo="Todavía no compraste nada">
          <p style={{ marginBottom: 24 }}>Cuando compres una camiseta, la vas a ver acá.</p>
          <BotonEnlace href="/">Ver el catálogo</BotonEnlace>
        </EstadoVacio>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {ordenes.map((orden) => (
            <li key={orden.id} className={estilos.resumen}>
              <div className={estilos.linea}>
                <a href={`/checkout/${orden.id}`}>Orden {orden.orderNumber}</a>
                <Etiqueta>{estadoDeOrden(orden.status)}</Etiqueta>
              </div>
              <div className={estilos.linea}>
                <span className={estilos.concepto}>{fecha(orden.createdAt)}</span>
                <span>{precio(orden.totalAmount, orden.currency)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
