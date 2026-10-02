import { getSessionUser } from '@/lib/session';
import { getSaleDetail } from '@/modules/orders/services/order.service';
import { createShipping, ShippingError } from '@/modules/shipments/infrastructure/shipping';

/**
 * LA ETIQUETA DEL ENVIO, en PDF, para imprimir y pegar en el paquete.
 *
 * ⚠️ PASA POR OFFSIDE Y NO ES UN ENLACE A ANDREANI: la API de etiquetas exige
 * el token de la cuenta, y ese token no puede salir del servidor. Offside la
 * pide con su sesion y la entrega tal cual.
 *
 * ⚠️ SIN SESION O SIN SER EL VENDEDOR, 404, NO 401 NI 403. La etiqueta lleva
 * nombre, telefono y domicilio del comprador: confirmar que una orden existe
 * a quien no es su vendedor ya es decir de mas. `getSaleDetail` trata lo ajeno
 * como inexistente y se respeta eso.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  const { orderId } = await params;
  const user = await getSessionUser();
  if (user === null) return new Response('No encontrado', { status: 404 });

  const venta = await getSaleDetail(user, orderId).catch(() => null);
  if (venta === null) return new Response('No encontrado', { status: 404 });

  const envio = venta.shipment;
  if (envio === null || !envio.etiquetaDisponible || envio.trackingNumber === null) {
    return new Response(
      'La etiqueta todavía no está disponible: aparece cuando Andreani asigna el número de seguimiento.',
      { status: 409, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  try {
    const etiqueta = await createShipping().getLabel(envio.trackingNumber);
    const extension = etiqueta.contentType.includes('pdf') ? 'pdf' : 'txt';

    return new Response(new Uint8Array(etiqueta.content), {
      headers: {
        'Content-Type': etiqueta.contentType,
        'Content-Disposition': `attachment; filename="etiqueta-${venta.orderNumber}.${extension}"`,
        // Datos personales del comprador: que ningun proxy la guarde.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    const mensaje =
      error instanceof ShippingError ? error.message : 'No pudimos traer la etiqueta de Andreani.';
    console.error('[etiqueta]', error instanceof Error ? error.message : String(error));

    return new Response(mensaje, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
