import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CampoOculto, Formulario } from '@/components/form';
import { Aviso, BotonEnlace, Etiqueta } from '@/components/ui';
import { estadoDeOrden, precio } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { getMyOrder } from '@/modules/orders/services/order.service';

import { pagar } from '../../acciones';
import estilos from '../../resumen.module.css';

export const metadata: Metadata = { title: 'Pago — Offside Store' };
export const dynamic = 'force-dynamic';

/**
 * Pago de una orden. Esta pantalla cumple DOS papeles:
 *
 *  1. ANTES de pagar: resumen y boton que lleva a Mercado Pago.
 *  2. AL VOLVER de Mercado Pago: es la `back_url` que la preferencia declara
 *     (`/checkout/{orderId}?status=success|pending|failure`).
 *
 * Son la misma pantalla a proposito: el estado de la orden ya distingue los dos
 * momentos, y tener dos paginas obligaria a mantener dos resumenes iguales.
 */
export default async function Checkout({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ orderId }, { status }] = await Promise.all([params, searchParams]);

  const user = await requireVerifiedSessionUser(`/checkout/${orderId}`);
  const order = await getMyOrder(user, orderId);

  // Una orden ajena devuelve `null` igual que una inexistente: no se distinguen.
  if (order === null) notFound();

  const pendiente = order.status === 'PENDING_PAYMENT';
  const vencida =
    order.paymentDeadline !== null && new Date(order.paymentDeadline).getTime() <= Date.now();

  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Orden {order.orderNumber}</h1>

      {/*
        ⚠️ EL RETORNO DE MERCADO PAGO NO CONFIRMA NADA (BS-072 / DEC-028). MP
        devuelve al comprador apenas termina, pero la fuente de verdad es el
        WEBHOOK, que puede tardar segundos. Decir "pagado" porque la URL trae
        `status=success` seria afirmar algo que todavia no sabemos.
      */}
      {status === 'success' && pendiente && (
        <div style={{ marginBottom: 24 }}>
          <Aviso>
            Estamos confirmando tu pago con Mercado Pago. Puede tardar unos segundos; actualizá esta
            página en un momento.
          </Aviso>
        </div>
      )}

      {status === 'failure' && pendiente && (
        <div style={{ marginBottom: 24 }}>
          {/*
            ⚠️ Un pago rechazado NO cancela la orden (DEC-033 / UC-MF-2): sigue
            en PENDING_PAYMENT y se puede reintentar dentro de la ventana.
          */}
          <Aviso error>El pago no se pudo completar. Podés intentar de nuevo.</Aviso>
        </div>
      )}

      <div className={estilos.resumen}>
        {order.items.map((item) => (
          <div key={item.id} className={estilos.linea}>
            <span>
              {item.title}
              {item.quantity > 1 && ` × ${item.quantity}`}
            </span>
            <span>{precio(item.unitPriceAmount, order.currency)}</span>
          </div>
        ))}

        <div className={`${estilos.linea} ${estilos.lineaTotal}`}>
          <span className={estilos.concepto}>Total</span>
          <span className={estilos.total}>{precio(order.totalAmount, order.currency)}</span>
        </div>

        <div className={estilos.linea}>
          <span className={estilos.concepto}>Estado</span>
          <Etiqueta aviso={order.status === 'CANCELLED'}>{estadoDeOrden(order.status)}</Etiqueta>
        </div>
      </div>

      {pendiente && !vencida && (
        <Formulario accion={pagar} enviar="Pagar con Mercado Pago">
          <CampoOculto nombre="orderId" valor={order.id} />
        </Formulario>
      )}

      {pendiente && vencida && (
        <>
          <Aviso error>La ventana de pago de esta orden venció.</Aviso>
          <p className={estilos.nota}>
            <BotonEnlace href="/" variante="secundario">
              Volver al catálogo
            </BotonEnlace>
          </p>
        </>
      )}

      {!pendiente && (
        <>
          {order.status === 'PAID' && (
            <Aviso>Recibimos tu pago. El vendedor ya puede preparar el envío.</Aviso>
          )}
          <p className={estilos.nota}>
            <BotonEnlace href="/mis-compras" variante="secundario">
              Ver mis compras
            </BotonEnlace>
          </p>
        </>
      )}
    </main>
  );
}
