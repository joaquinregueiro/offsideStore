'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { respuestaDeError } from '@/lib/errores';
import type { EstadoFormulario } from '@/lib/formulario';
import { exigirLimitePorUsuario } from '@/lib/rate-limit-actions';
import { requireVerifiedSessionUser } from '@/lib/session';
import {
  addToCart,
  checkoutCart,
  MAX_QUANTITY_PER_LINE,
  removeFromCart,
  updateQuantity,
} from '@/modules/cart/services/cart.service';

import { CAMPOS_DE_DIRECCION, resolverDireccion, texto } from '../(compra)/direccion';

/**
 * Server Actions del carrito (BS-060/061/062, DEC-026).
 *
 * ⚠️ EL CARRITO NO RESERVA NADA. Agregar es guardar una intencion: el stock se
 * valida al agregar y se REVALIDA al comprar, y recien se descuenta con el pago
 * aprobado (MF-022). Ninguna de estas acciones puede prometer disponibilidad.
 *
 * ⚠️ LA BANDERA `feature_cart` LA EXIGE EL SERVICE, no estas acciones. Si la
 * perilla se apaga con gente adentro del carrito, `addToCart`, `updateQuantity`
 * y `checkoutCart` fallan cerrado — `removeFromCart` no, a proposito: vaciar lo
 * que ya se guardo tiene que seguir siendo posible.
 *
 * ⚠️ CADA ACCION EXIGE SESION VERIFICADA POR SU CUENTA y consume su limite por
 * usuario. Escribir el carrito es barato pero no gratis, y el checkout crea UNA
 * ORDEN POR VENDEDOR: sin techo, un bucle deja diez ordenes pendientes de pago.
 */

export type EstadoCarrito = EstadoFormulario;

const lineaSchema = z.object({ listingId: z.string().uuid() });

const cantidadSchema = z.coerce
  .number()
  .int('Elegí una cantidad válida')
  .min(1, 'Elegí al menos una unidad')
  .max(MAX_QUANTITY_PER_LINE, `No podés pedir más de ${MAX_QUANTITY_PER_LINE} unidades`);

/**
 * Agrega una publicacion al carrito y lleva a verlo.
 *
 * ⚠️ TERMINA EN `/carrito` Y NO EN UN CARTEL. Sin JavaScript no hay forma de
 * avisar "se agrego" sin recargar algo, y el carrito es justamente la pantalla
 * donde se ajusta la cantidad y se ve el subtotal por vendedor. Un aviso en la
 * ficha dejaria a la persona sin saber cuanto lleva acumulado.
 */
export async function agregarAlCarrito(
  _estado: EstadoCarrito,
  formData: FormData,
): Promise<EstadoCarrito> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('cart-write', user.id);

    const { listingId } = lineaSchema.parse({ listingId: texto(formData, 'listingId') });
    const cantidad = cantidadSchema.parse(texto(formData, 'cantidad') ?? 1);

    await addToCart(user, listingId, cantidad);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'carrito', formData, preservar: ['cantidad'] });
  }

  revalidatePath('/carrito');

  redirect('/carrito');
}

/**
 * Cambia las unidades de una linea. Cero la saca: es lo que hace el Service y
 * asi un `0` tipeado a mano no queda como una linea invisible de cero unidades.
 */
export async function cambiarCantidad(
  _estado: EstadoCarrito,
  formData: FormData,
): Promise<EstadoCarrito> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('cart-write', user.id);

    const { listingId } = lineaSchema.parse({ listingId: texto(formData, 'listingId') });
    const cantidad = cantidadSchema.parse(texto(formData, 'cantidad'));

    await updateQuantity(user, listingId, cantidad);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'carrito', formData, preservar: ['cantidad'] });
  }

  revalidatePath('/carrito');

  return { ok: 'Actualizamos la cantidad.' };
}

/** Saca una publicacion del carrito. Sacar lo que ya no esta no es un error. */
export async function quitarDelCarrito(
  _estado: EstadoCarrito,
  formData: FormData,
): Promise<EstadoCarrito> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('cart-write', user.id);

    const { listingId } = lineaSchema.parse({ listingId: texto(formData, 'listingId') });

    await removeFromCart(user, listingId);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'carrito', formData });
  }

  revalidatePath('/carrito');

  return { ok: 'La sacamos del carrito.' };
}

/**
 * Convierte el carrito en ordenes (DEC-026: una por vendedor) y lleva a la
 * pantalla que las lista.
 *
 * ⚠️ CONSUME `order-create`, NO `cart-write`: lo que hace es crear ordenes
 * —varias— y tiene que contar contra el mismo techo que la compra directa. Un
 * carrito de diez lineas que esquivara ese contador seria la puerta de atras al
 * limite de creacion de ordenes.
 *
 * ⚠️ SI NO SE CREO NINGUNA, NO SE REDIRIGE. `checkoutCart` revalida todo antes
 * de crear nada y, si algo quedo sin poder comprarse, lo devuelve en
 * `rechazadas` con su motivo: llevar a una pantalla de "listo" con cero ordenes
 * seria decir que salio bien.
 */
export async function comprarCarrito(
  _estado: EstadoCarrito,
  formData: FormData,
): Promise<EstadoCarrito> {
  let destino: string;

  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('order-create', user.id);

    const direccion = await resolverDireccion(user, formData);
    const { ordenes, rechazadas } = await checkoutCart(user, direccion);

    if (ordenes.length === 0) {
      const primera = rechazadas[0];

      return {
        error:
          primera?.message ?? 'No pudimos crear las órdenes. Revisá el carrito y probá de nuevo.',
      };
    }

    const ids = ordenes.map((orden) => orden.id).join(',');
    destino =
      rechazadas.length === 0
        ? `/carrito/listo?ordenes=${ids}`
        : `/carrito/listo?ordenes=${ids}&quedaron=${rechazadas.length}`;
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'carrito',
      formData,
      preservar: CAMPOS_DE_DIRECCION,
    });
  }

  revalidatePath('/carrito');

  redirect(destino);
}
