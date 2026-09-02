import type { Metadata } from 'next';

import { EstadoVacio, Etiqueta } from '@/components/ui';
import { estadoDeOrden, fecha, precio } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { listMySales } from '@/modules/orders/services/order.service';

import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mis ventas — Offside Store' };
export const dynamic = 'force-dynamic';

/**
 * Bandeja de ventas (SS-070).
 *
 * ⚠️ LOS IMPORTES SON EL SNAPSHOT DE LA ORDEN, no un cálculo de ahora. La
 * comisión se congeló al crearse la orden (DEC-030): si mañana cambia la tasa,
 * estas ventas siguen mostrando la que efectivamente se aplicó.
 *
 * ⚠️ NO HAY DETALLE NI ACCIONES (SS-071, SS-080). Despachar exige el módulo de
 * envíos con Correo Argentino, que no existe, y mostrar los datos del comprador
 * sin una pantalla que los use sería exponer datos personales sin motivo.
 */
export default async function MisVentas() {
  const user = await requireSellerSessionUser('/vendedor/ventas');
  const ventas = await listMySales(user);

  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Mis ventas</h1>

      {ventas.length === 0 ? (
        <EstadoVacio titulo="Todavía no vendiste nada">
          Cuando alguien te compre, la orden va a aparecer acá con su estado y lo que te queda.
        </EstadoVacio>
      ) : (
        ventas.map((venta) => (
          <article key={venta.id} className={estilos.tarjeta}>
            <div className={estilos.linea}>
              <span>Orden {venta.orderNumber}</span>
              <Etiqueta aviso={venta.status === 'CANCELLED'}>
                {estadoDeOrden(venta.status)}
              </Etiqueta>
            </div>
            <div className={estilos.linea}>
              <span className={estilos.concepto}>{fecha(venta.createdAt)}</span>
              <span>{precio(venta.totalAmount, venta.currency)}</span>
            </div>
            <div className={estilos.linea}>
              <span className={estilos.concepto}>Comisión de Offside</span>
              <span>−{precio(venta.commissionAmount, venta.currency)}</span>
            </div>
            <div className={estilos.linea}>
              <span className={estilos.concepto}>Te queda</span>
              <span>{precio(venta.sellerAmount, venta.currency)}</span>
            </div>
          </article>
        ))
      )}

      {/*
        ⚠️ "Te queda" ES ANTES DEL COSTO DE MERCADO PAGO. DEC-043: el costo de MP
        se descuenta del lado del vendedor, y Offside no lo conoce al crear la
        orden. Prometer un neto exacto sería mentir.
      */}
      <p className={estilos.nota}>
        Mercado Pago cobra además su propio costo de procesamiento, que se descuenta de tu parte al
        acreditarse el pago.
      </p>
    </main>
  );
}
