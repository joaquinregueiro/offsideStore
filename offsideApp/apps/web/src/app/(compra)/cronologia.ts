import type { Hito } from '@/components/ui';
import { fechaYHora } from '@/lib/formato';
import type { OrderStatus, TimelineEntry } from '@/modules/orders/services/order.service';

/**
 * El recorrido de una orden, del punto de vista de QUIEN COMPRO.
 *
 * ⚠️ NO ES EL HISTORIAL CRUDO. `order_status_history` guarda transiciones —"de
 * PAID a PROCESSING"—, y eso no es lo que una persona necesita leer cuando
 * entra a ver su compra. Lo que necesita es el recorrido completo: que paso, en
 * que punto esta y que falta. Por eso los hitos se arman sobre la SECUENCIA de
 * DEC-029 y el historial solo aporta la fecha y quien lo hizo.
 *
 * ⚠️ LOS TITULOS NO SON LOS DE `estadoDeOrden()`, y no es una inconsistencia:
 * ahi son ESTADOS ("Enviada", "Entregada") y aca son HECHOS en el tiempo ("La
 * despachó el vendedor"). La `<Etiqueta>` de la pantalla sigue diciendo el
 * estado con las palabras del sistema.
 */

/** Los seis hitos del camino feliz, en orden (DEC-029). */
const SECUENCIA: readonly { estado: OrderStatus; titulo: string }[] = [
  { estado: 'PENDING_PAYMENT', titulo: 'Orden creada' },
  { estado: 'PAID', titulo: 'Pago acreditado' },
  { estado: 'PROCESSING', titulo: 'El vendedor la prepara' },
  { estado: 'SHIPPED', titulo: 'Despachada' },
  { estado: 'DELIVERED', titulo: 'La recibiste' },
  { estado: 'COMPLETED', titulo: 'Compra completada' },
];

/**
 * Quien produjo el hecho, en castellano y desde el lado del comprador.
 *
 * ⚠️ EL NOMBRE CARGADO GANA SOBRE EL ROL: si el historial guardo quien fue, eso
 * es mas util que "el vendedor". Y `user` es SIEMPRE quien compra en esta
 * pantalla —el ERD mapea al comprador como `user` (§11.3)—, asi que se dice
 * "vos": leer "usuario" sobre la propia accion es leer un sistema hablando de
 * uno mismo en tercera persona.
 */
function actorDe(entrada: TimelineEntry): string | undefined {
  if (entrada.actorDisplayName !== null && entrada.actorType !== 'user') {
    return entrada.actorDisplayName;
  }

  if (entrada.actorType === 'user') return 'vos';
  if (entrada.actorType === 'seller') return 'el vendedor';
  if (entrada.actorType === 'admin') return 'Offside';

  return undefined;
}

/** La primera vez que la orden entro a ese estado, si entro. */
function primeraEntrada(
  timeline: readonly TimelineEntry[],
  estado: OrderStatus,
): TimelineEntry | undefined {
  return timeline.find((entrada) => entrada.toStatus === estado);
}

/**
 * Los hitos de la orden, listos para `<Cronologia>`.
 *
 * @param estado Estado actual de la orden.
 * @param timeline Historial ya autorizado (`getMyOrderDetail`).
 * @param creadaEn Fecha de creacion: el primer hito NO tiene transicion propia
 *   —una orden nace en `PENDING_PAYMENT`, no transiciona hacia ahi— asi que sin
 *   esto el hito "Orden creada" quedaba sin fecha en TODAS las ordenes.
 */
export function hitosDeLaOrden(
  estado: OrderStatus,
  timeline: readonly TimelineEntry[],
  creadaEn: string,
): Hito[] {
  const cancelada = estado === 'CANCELLED';

  /*
   * Hasta donde llego la orden. Con una cancelacion, el estado actual no esta
   * en la secuencia: lo que manda es el ultimo hito que SI ocurrio.
   */
  const indiceActual = SECUENCIA.findIndex((paso) => paso.estado === estado);
  const alcanzado = SECUENCIA.reduce(
    (maximo, paso, indice) =>
      primeraEntrada(timeline, paso.estado) === undefined ? maximo : indice,
    0,
  );

  const hitos: Hito[] = [];

  for (const [indice, paso] of SECUENCIA.entries()) {
    const entrada = primeraEntrada(timeline, paso.estado);
    const ocurrio = indice === 0 || entrada !== undefined;

    /*
     * ⚠️ DESPUES DE UNA CANCELACION NO SE DIBUJA NADA, ni siquiera apagado.
     * Mostrar "Despachada — pendiente" abajo de una orden cancelada prometeria
     * un recorrido que ya no existe.
     */
    if (cancelada && indice > alcanzado) break;

    const estadoDelHito = cancelada
      ? 'hecho'
      : indice === indiceActual
        ? 'actual'
        : ocurrio
          ? 'hecho'
          : 'futuro';

    hitos.push({
      clave: paso.estado,
      titulo: paso.titulo,
      estado: estadoDelHito,
      ...(indice === 0
        ? { fecha: fechaYHora(creadaEn), actor: 'vos' }
        : entrada === undefined
          ? {}
          : { fecha: fechaYHora(entrada.createdAt), actor: actorDe(entrada) }),
      ...(entrada?.note === undefined || entrada.note === null ? {} : { nota: entrada.note }),
    });
  }

  if (cancelada) {
    const entrada = primeraEntrada(timeline, 'CANCELLED');

    hitos.push({
      clave: 'CANCELLED',
      titulo: 'Orden cancelada',
      estado: 'cancelado',
      ...(entrada === undefined
        ? {}
        : { fecha: fechaYHora(entrada.createdAt), actor: actorDe(entrada) }),
      ...(entrada?.note === undefined || entrada.note === null ? {} : { nota: entrada.note }),
    });
  }

  return hitos;
}
