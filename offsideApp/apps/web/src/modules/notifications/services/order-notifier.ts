import { getBuyerProtectionDays } from '../../config/services/setting-store.service';
import { onOrderTransition, type OrderTransitionEvent } from '../../orders/services/order-events';
import {
  findOrderNotificationContext,
  type OrderNotificationContext,
} from '../repositories/order-notification.repository';
import { notify } from './inapp-notification.service';
import * as emails from './order-emails.service';

/**
 * AVISOS de las transiciones de una orden: campanita in-app + email.
 *
 * Se engancha a `orders` por su registro de listeners (`order-events.ts`), no
 * al reves: `orders` no importa este archivo ni sabe que existe. Lo registra
 * `instrumentation.ts` al arrancar el proceso.
 *
 * ⚠️ NADA DE LO QUE PASA ACA PUEDE ROMPER UNA TRANSICION. La orden ya cambio
 * de estado y esta commiteada cuando este codigo corre: un email que no sale
 * no puede hacer que una venta "no haya ocurrido". Cada aviso va en su propio
 * try/catch y lo peor que produce es una linea en el log.
 *
 * ⚠️ EL EMAIL SE ENCOLA, NO SE MANDA. `order-emails.service` pone un job en
 * BullMQ y vuelve; el worker lo entrega y reintenta. Mandarlo en linea ataria
 * el tiempo de respuesta de "Despachar" a la latencia de Amazon SES.
 *
 * ⚠️ `notification_type` ES UN ENUM CERRADO (order | payment | shipment |
 * dispute | price_alert | system). Lo que no encaja va como `system` con el
 * detalle en `payload`; no se agregan valores al enum desde acá.
 */

/** Contacto como lo espera `order-emails`. */
function destinatario(parte: { email: string; displayName: string | null }): {
  email: string;
  nombre?: string | null;
} {
  return { email: parte.email, nombre: parte.displayName };
}

/** La orden como la esperan las plantillas. */
function ordenParaEmail(contexto: OrderNotificationContext, paraVendedor: boolean) {
  return {
    id: contexto.orderId,
    numero: contexto.orderNumber,
    total: contexto.totalAmount.toString(),
    moneda: contexto.currency,
    articulos: contexto.items,
    ...(paraVendedor ? { importeVendedor: contexto.sellerAmount?.toString() ?? null } : {}),
  };
}

/** Un aviso que no puede tumbar nada: lo peor que hace es escribir en el log. */
async function seguro(que: string, accion: () => Promise<unknown>): Promise<void> {
  try {
    await accion();
  } catch (error) {
    console.error(
      `[notifications] no se pudo ${que}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Que se avisa en cada transicion.
 *
 * ⚠️ NO SE AVISA TODO. `PENDING_PAYMENT → PAID` y `PAID → PROCESSING` ocurren
 * dentro de la transaccion de `payments` y `orders` no las anuncia (ver el
 * encabezado de `order-events.ts`): las cubre el aviso de `PROCESSING`, que es
 * el primero que el vendedor necesita —"vendiste, despachá"—. Y una orden
 * `CANCELLED` desde `PENDING_PAYMENT` por vencimiento no le manda un email a
 * nadie: nadie pago nada y un aviso de "cancelamos tu compra" sobre algo que
 * la persona abandono es ruido.
 */
async function avisar(evento: OrderTransitionEvent): Promise<void> {
  const contexto = await findOrderNotificationContext(evento.orderId);
  if (contexto === undefined) return;

  const comprador = destinatario(contexto.buyer);
  const vendedor = contexto.seller === undefined ? undefined : destinatario(contexto.seller);
  const paraComprador = ordenParaEmail(contexto, false);
  const paraVendedor = ordenParaEmail(contexto, true);

  switch (evento.to) {
    case 'PROCESSING': {
      // La venta recien empieza a existir para el vendedor: hay que despachar.
      if (contexto.seller !== undefined && vendedor !== undefined) {
        await seguro('avisar la venta nueva', () => emails.nuevaVenta(vendedor, paraVendedor));
        await seguro('notificar la venta nueva', () =>
          notify(
            contexto.seller!.userId,
            'order',
            'Vendiste una camiseta',
            `La orden ${contexto.orderNumber} está lista para despachar.`,
            { kind: 'sale_new', orderId: contexto.orderId },
          ),
        );
      }

      await seguro('confirmar la compra', () => emails.compraConfirmada(comprador, paraComprador));
      await seguro('notificar la compra confirmada', () =>
        notify(
          contexto.buyer.userId,
          'order',
          'Tu compra está confirmada',
          `El vendedor ya puede despachar la orden ${contexto.orderNumber}.`,
          { kind: 'purchase_confirmed', orderId: contexto.orderId },
        ),
      );

      return;
    }

    case 'SHIPPED': {
      const numero = contexto.envio?.trackingNumber ?? null;
      const transportista = contexto.envio?.transportista ?? null;

      // Sin numero de seguimiento no hay email de despacho: la plantilla
      // existe para decir "seguilo con este numero". `markShipped` lo exige,
      // asi que no deberia pasar; si pasa, queda la campanita.
      if (numero !== null) {
        await seguro('avisar el despacho', () =>
          emails.pedidoDespachado(comprador, paraComprador, { numero, transportista }),
        );
      }
      await seguro('notificar el despacho', () =>
        notify(
          contexto.buyer.userId,
          'shipment',
          'Tu pedido está en camino',
          numero === null
            ? `El vendedor despachó la orden ${contexto.orderNumber}.`
            : `Seguimiento ${numero}${transportista === null ? '' : ` (${transportista})`}.`,
          { kind: 'order_shipped', orderId: contexto.orderId },
        ),
      );

      return;
    }

    case 'DELIVERED': {
      // El comprador confirmó: al vendedor le importa, y al comprador le queda
      // la ventana para calificar o reclamar.
      if (contexto.seller !== undefined) {
        await seguro('notificar la entrega al vendedor', () =>
          notify(
            contexto.seller!.userId,
            'shipment',
            'Confirmaron la entrega',
            `El comprador recibió la orden ${contexto.orderNumber}.`,
            { kind: 'order_delivered', orderId: contexto.orderId },
          ),
        );
      }

      /*
       * ⚠️ LOS DIAS RESTANTES SALEN DEL CONFIG STORE, no de un numero escrito
       * acá: es la ventana de proteccion (`buyer_protection_days`), la misma
       * que usa el barrido que cierra la orden sola. Si no se puede leer, el
       * email no sale: prometer "tenés 7 días" cuando la configuracion dice
       * otra cosa es peor que no avisar.
       */
      await seguro('pedir la confirmacion de recepcion', async () => {
        const dias = await getBuyerProtectionDays();

        return emails.confirmaRecepcion(comprador, paraComprador, dias);
      });

      return;
    }

    case 'COMPLETED': {
      if (vendedor !== undefined) {
        await seguro('avisar la venta completada', () =>
          emails.ventaCompletada(vendedor, paraVendedor),
        );
      }

      if (contexto.seller !== undefined) {
        await seguro('notificar la venta completada', () =>
          notify(
            contexto.seller!.userId,
            'order',
            'Venta completada',
            `La orden ${contexto.orderNumber} se cerró.`,
            { kind: 'sale_completed', orderId: contexto.orderId },
          ),
        );
      }

      await seguro('invitar a calificar', () =>
        notify(
          contexto.buyer.userId,
          'order',
          '¿Cómo te fue con la compra?',
          `Podés calificar al vendedor de la orden ${contexto.orderNumber}.`,
          { kind: 'review_invite', orderId: contexto.orderId },
        ),
      );

      return;
    }

    case 'CANCELLED': {
      // Una orden que nunca se pago no genera aviso: ver el encabezado.
      if (evento.from === 'PENDING_PAYMENT' && evento.actor === 'system') return;

      const pagoAcreditado = evento.from !== 'PENDING_PAYMENT';

      await seguro('avisar la cancelacion al comprador', () =>
        emails.ordenCancelada(comprador, paraComprador, { parte: 'comprador', pagoAcreditado }),
      );
      await seguro('notificar la cancelacion al comprador', () =>
        notify(
          contexto.buyer.userId,
          'order',
          'Se canceló tu compra',
          evento.note ?? `La orden ${contexto.orderNumber} se canceló.`,
          { kind: 'order_cancelled', orderId: contexto.orderId },
        ),
      );

      if (vendedor !== undefined && contexto.seller !== undefined) {
        await seguro('avisar la cancelacion al vendedor', () =>
          emails.ordenCancelada(vendedor, paraVendedor, { parte: 'vendedor', pagoAcreditado }),
        );
        await seguro('notificar la cancelacion al vendedor', () =>
          notify(
            contexto.seller!.userId,
            'order',
            'Se canceló una venta',
            evento.note ?? `La orden ${contexto.orderNumber} se canceló.`,
            { kind: 'order_cancelled', orderId: contexto.orderId },
          ),
        );
      }

      return;
    }

    default:
      return;
  }
}

let registrado = false;

/**
 * Engancha los avisos al ciclo de la orden. Idempotente: en desarrollo el
 * modulo se recarga y registrar dos veces mandaria todo por duplicado.
 */
export function registerOrderNotifications(): void {
  if (registrado) return;
  registrado = true;

  onOrderTransition(async (evento) => {
    await seguro(`avisar la transicion ${evento.from} → ${evento.to}`, () => avisar(evento));
  });
}
