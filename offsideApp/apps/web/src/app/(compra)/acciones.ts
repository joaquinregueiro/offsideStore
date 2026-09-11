'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { respuestaDeError } from '@/lib/errores';
import type { EstadoFormulario } from '@/lib/formulario';
import { exigirLimitePorUsuario } from '@/lib/rate-limit-actions';
import { requireVerifiedSessionUser } from '@/lib/session';
import {
  cancelPendingByBuyer,
  confirmDelivered,
  createOrder,
} from '@/modules/orders/services/order.service';
import { startCheckout } from '@/modules/payments/services/payment.service';

import { CAMPOS_DE_DIRECCION, resolverDireccion, texto } from './direccion';

/**
 * Server Actions de la compra.
 *
 * ⚠️ CADA ACCION EXIGE SESION VERIFICADA POR SU CUENTA. Son alcanzables por POST
 * directo sin pasar por la pantalla: que la pagina haya hecho el guard no
 * protege a la accion.
 *
 * ⚠️ NINGUNA DECIDE SI PUEDE HACERSE. La maquina de estados vive en
 * `orders.canTransition` y la propiedad de la orden se resuelve POR `user.id`
 * dentro de cada Service —una orden ajena es una orden inexistente—. Repetir la
 * regla aca seria arriesgarse a que las dos copias se separen.
 *
 * ⚠️ Y CADA UNA CONSUME SU LIMITE POR USUARIO, el MISMO contador que consume el
 * endpoint equivalente de la API. Crear ordenes escribe filas, arrancar el
 * checkout llama a Mercado Pago, y cancelar y confirmar mueven la maquina de
 * estados de una orden con plata adentro: repetirlo sin techo ensucia la base
 * con ordenes fantasma y castiga la reputacion de la cuenta ante el proveedor.
 * Cada familia cuenta APARTE: si cancelar y comprar compartieran contador,
 * arrepentirse de dos compras dejaria sin poder comprar.
 */

/**
 * ⚠️ ES UN ALIAS DEL CONTRATO COMPARTIDO. Era un tipo propio con solo `error`,
 * asi que este grupo no podia devolver errores por campo ni conservar lo
 * tipeado aunque el formulario ya supiera mostrarlos.
 */
export type EstadoCompra = EstadoFormulario;

/**
 * Cuantas unidades se pueden pedir de una vez.
 *
 * ⚠️ NO ES UN CUPO DE NEGOCIO —esos son ⚙️ del Config Store y siguen 🟡— sino
 * un techo de sanidad para que un POST directo no mande 10.000. El limite real
 * es el stock, y lo valida `createOrder` contra la fila de la publicacion.
 */
const MAX_UNIDADES = 99;

const cantidadSchema = z.coerce
  .number()
  .int('Elegí una cantidad válida')
  .min(1, 'Elegí al menos una unidad')
  .max(MAX_UNIDADES, `No podés pedir más de ${MAX_UNIDADES} unidades de una vez`);

const comprarSchema = z.object({
  listingId: z.string().uuid(),
  cantidad: cantidadSchema,
});

const ordenSchema = z.object({ orderId: z.string().uuid() });

/**
 * Crea la orden y lleva al pago.
 *
 * ⚠️ NO INICIA EL CHECKOUT ACA. La orden queda creada y la persona pasa a
 * `/checkout/{id}`, que es donde decide pagar. Encadenar las dos cosas dejaria
 * a alguien sin ninguna pantalla a la que volver si Mercado Pago falla: la
 * orden existiria y no habria forma de retomarla.
 *
 * ⚠️ EL ENVIO Y LA COMISION NO VIAJAN DESDE ACA. `createOrder` los resuelve
 * solo —el envio declarado por el vendedor y la tasa del tier o la promocion— y
 * los CONGELA en la orden (DEC-030). Mandarlos desde la pantalla seria dejar
 * que el cliente proponga cuanto se cobra.
 */
export async function comprar(_estado: EstadoCompra, formData: FormData): Promise<EstadoCompra> {
  let orderId: string;

  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('order-create', user.id);

    const { listingId, cantidad } = comprarSchema.parse({
      listingId: texto(formData, 'listingId'),
      cantidad: texto(formData, 'cantidad') ?? 1,
    });

    // La direccion se resuelve DESPUES de validar la publicacion y la cantidad:
    // guardar una direccion nueva para una compra que igual va a fallar deja
    // una fila en la libreta que nadie pidio.
    const shippingAddress = await resolverDireccion(user, formData);

    const order = await createOrder(user, { listingId, quantity: cantidad, shippingAddress });

    orderId = order.id;
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'compra',
      formData,
      preservar: CAMPOS_DE_DIRECCION,
    });
  }

  redirect(`/checkout/${orderId}`);
}

/**
 * Inicia el pago y manda a Mercado Pago.
 *
 * ⚠️ EL `initPoint` LO DEVUELVE EL SERVICE Y ACA SE REDIRIGE. El backend nunca
 * redirige por su cuenta (MP-PAY-014): devuelve la URL y quien la tiene navega.
 */
export async function pagar(_estado: EstadoCompra, formData: FormData): Promise<EstadoCompra> {
  let destino: string;

  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('checkout', user.id);

    const { orderId } = ordenSchema.parse({ orderId: texto(formData, 'orderId') });

    // `startCheckout` verifica que la orden sea del comprador, que este
    // pendiente de pago, que no haya vencido y que haya stock. No se repite
    // nada de eso aca: la regla vive en el Service.
    const { initPoint } = await startCheckout(user, orderId);
    destino = initPoint;
  } catch (error) {
    return respuestaDeError(error, { ambito: 'compra', formData, preservar: CAMPOS_DE_DIRECCION });
  }

  redirect(destino);
}

/**
 * `PENDING_PAYMENT → CANCELLED` por el comprador (DEC-029).
 *
 * ⚠️ SOLO ANTES DE PAGAR, y no porque esta accion lo decida: `canTransition`
 * solo habilita la cancelacion del comprador desde `PENDING_PAYMENT`. Una orden
 * ya pagada se devuelve por reembolso, que es del back-office.
 */
export async function cancelarOrden(
  _estado: EstadoCompra,
  formData: FormData,
): Promise<EstadoCompra> {
  let orderId: string;

  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('order-cancel', user.id);

    ({ orderId } = ordenSchema.parse({ orderId: texto(formData, 'orderId') }));

    await cancelPendingByBuyer(user, orderId);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'compra', formData });
  }

  revalidatePath(`/checkout/${orderId}`);
  revalidatePath('/cuenta/compras');

  return { ok: 'Cancelamos la orden. La unidad vuelve a estar disponible.' };
}

/**
 * `SHIPPED → DELIVERED`: la persona confirma que recibio el paquete.
 *
 * ⚠️ LO CONFIRMA QUIEN COMPRA Y NO EL SISTEMA, y es una consecuencia de que no
 * haya transportista: `marketplace-flow.md` §6 deriva la entrega del tracking
 * de Correo Argentino, que no existe. La unica persona que sabe que el paquete
 * llego es quien lo recibio.
 *
 * ⚠️ NO CIERRA LA ORDEN. Desde acá corre la ventana de protección (BR-033) y el
 * cierre lo hace el sistema: decir "completada" acá seria apurar el plazo que
 * protege a quien compró.
 */
export async function confirmarRecepcion(
  _estado: EstadoCompra,
  formData: FormData,
): Promise<EstadoCompra> {
  let orderId: string;

  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('order-confirm', user.id);

    ({ orderId } = ordenSchema.parse({ orderId: texto(formData, 'orderId') }));

    await confirmDelivered(user, orderId);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'compra', formData });
  }

  revalidatePath(`/checkout/${orderId}`);
  revalidatePath(`/cuenta/compras/${orderId}`);
  revalidatePath('/cuenta/compras');

  return { ok: '¡Listo! Registramos que recibiste el paquete.' };
}
