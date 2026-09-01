'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireVerifiedSessionUser } from '@/lib/session';
import { AuthError } from '@/modules/auth/auth.errors';
import { createOrder } from '@/modules/orders/services/order.service';
import { startCheckout } from '@/modules/payments/services/payment.service';

/**
 * Server Actions de la compra.
 *
 * ⚠️ CADA ACCION EXIGE SESION VERIFICADA POR SU CUENTA. Son alcanzables por POST
 * directo sin pasar por la pantalla: que la pagina haya hecho el guard no
 * protege a la accion.
 */

export interface EstadoCompra {
  error?: string;
}

/**
 * Direccion de envio.
 *
 * ⚠️ ESTO ES DEUDA CONOCIDA, NO EL DISEÑO FINAL. El ERD tiene `user_addresses`
 * como libreta de direcciones (§6.1) y esta VACIA: no hay modulo que la use.
 * `createOrder` acepta un objeto libre justamente porque la forma canonica
 * todavia no existe, y este schema es el minimo para poder despachar.
 *
 * Cuando exista la libreta, esta pantalla deberia ELEGIR una direccion guardada
 * en vez de pedirla de nuevo en cada compra, y la orden seguiria guardando su
 * snapshot igual (el ERD lo pide asi: en `orders` la direccion NO es FK).
 */
const direccionSchema = z.object({
  nombre: z.string().trim().min(2, 'Poné a nombre de quién va el envío').max(120),
  calle: z.string().trim().min(3, 'Ingresá la calle y el número').max(200),
  ciudad: z.string().trim().min(2, 'Ingresá la localidad').max(120),
  provincia: z.string().trim().min(2, 'Ingresá la provincia').max(120),
  // Clave para cotizar el envio cuando exista el modulo (ERD §6.1).
  codigoPostal: z.string().trim().min(4, 'El código postal es obligatorio').max(10),
  telefono: z.string().trim().min(6, 'Dejá un teléfono de contacto').max(40),
});

const comprarSchema = direccionSchema.extend({
  listingId: z.string().uuid(),
});

function texto(formData: FormData, nombre: string): string | undefined {
  const valor = formData.get(nombre);

  return typeof valor === 'string' ? valor : undefined;
}

function mensajeDeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? 'Revisá los datos ingresados.';
  }

  if (error instanceof AuthError) return error.message;

  console.error('[compra] error inesperado en una accion:', error);

  return 'Tuvimos un problema. Probá de nuevo en un momento.';
}

/**
 * Crea la orden y lleva al pago.
 *
 * ⚠️ NO INICIA EL CHECKOUT ACA. La orden queda creada y la persona pasa a
 * `/checkout/{id}`, que es donde decide pagar. Encadenar las dos cosas dejaria
 * a alguien sin ninguna pantalla a la que volver si Mercado Pago falla: la
 * orden existiria y no habria forma de retomarla.
 */
export async function comprar(_estado: EstadoCompra, formData: FormData): Promise<EstadoCompra> {
  let orderId: string;

  try {
    const user = await requireVerifiedSessionUser();

    const input = comprarSchema.parse({
      listingId: texto(formData, 'listingId'),
      nombre: texto(formData, 'nombre'),
      calle: texto(formData, 'calle'),
      ciudad: texto(formData, 'ciudad'),
      provincia: texto(formData, 'provincia'),
      codigoPostal: texto(formData, 'codigoPostal'),
      telefono: texto(formData, 'telefono'),
    });

    const { listingId, ...direccion } = input;

    const order = await createOrder(user, {
      listingId,
      // Compra directa: una unidad. El carrito (BS-060) no existe, y DEC-026
      // hace que una orden sea siempre de un solo vendedor.
      quantity: 1,
      shippingAddress: direccion,
    });

    orderId = order.id;
  } catch (error) {
    return { error: mensajeDeError(error) };
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
    const orderId = z.string().uuid().parse(texto(formData, 'orderId'));

    // `startCheckout` verifica que la orden sea del comprador, que este
    // pendiente de pago, que no haya vencido y que haya stock. No se repite
    // nada de eso aca: la regla vive en el Service.
    const { initPoint } = await startCheckout(user, orderId);
    destino = initPoint;
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  redirect(destino);
}
