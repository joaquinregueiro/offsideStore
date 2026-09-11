'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { respuestaDeError } from '@/lib/errores';
import type { EstadoFormulario } from '@/lib/formulario';
import { exigirLimitePorUsuario } from '@/lib/rate-limit-actions';
import { requireVerifiedSessionUser } from '@/lib/session';
import {
  createAddress,
  deleteAddress,
  setDefaultAddress,
  updateAddress,
} from '@/modules/addresses/services/address.service';
import { openDispute } from '@/modules/disputes/services/dispute.service';
import { toggleFavorite } from '@/modules/favorites/services/favorite.service';
import { markAllRead, markRead } from '@/modules/notifications/services/inapp-notification.service';
import { cancelPendingByBuyer, confirmDelivered } from '@/modules/orders/services/order.service';
import { createReview } from '@/modules/reviews/services/review.service';

/**
 * Server Actions del panel del comprador.
 *
 * ⚠️ CADA ACCIÓN EXIGE SESIÓN VERIFICADA POR SU CUENTA. Son alcanzables por POST
 * directo sin pasar por la pantalla: que la página haya hecho el guard no
 * protege a la acción.
 *
 * ⚠️ LA PERTENENCIA LA DECIDE EL SERVICE, NO ESTA CAPA, y es deliberado.
 * `cancelPendingByBuyer`, `confirmDelivered`, `openDispute`, `createReview`,
 * `markRead` y toda la libreta de direcciones resuelven contra `user.id` y
 * tratan lo ajeno como inexistente. Repetir la regla acá sería arriesgarse a
 * que las dos copias se separen: la buena queda en el dominio y esta se
 * limitaría a adivinar. Lo que sí se hace acá es no darle NUNCA al Service un
 * identificador de usuario que venga del formulario — el único `user` posible
 * es el de la sesión.
 *
 * ⚠️ CADA UNA CONSUME SU LÍMITE POR USUARIO, con el scope de su familia y
 * contando aparte: si cancelar, reclamar y marcar avisos compartieran contador,
 * ponerse al día con veinte notificaciones dejaría a alguien sin poder cancelar
 * una compra. Se cuenta por usuario y no por IP porque acá ya hay sesión
 * verificada, que es una clave estrictamente mejor: no la comparte media
 * oficina detrás de un NAT y no se rota gratis.
 *
 * ⚠️ EL LÍMITE VA DESPUÉS DE RESOLVER LA SESIÓN —no se puede contar por usuario
 * sin saber quién es— y ANTES de parsear el formulario y de tocar la base.
 */

/** ⚠️ ES UN ALIAS DEL CONTRATO COMPARTIDO, no un tipo propio: errores por campo y valores conservados. */
export type EstadoCuenta = EstadoFormulario;

/**
 * Lee un campo del formulario.
 *
 * Devuelve `undefined` tanto si falta como si vino vacío: para un `<input>` no
 * completado el navegador manda cadena vacía y los schemas esperan ausencia.
 * `FormData.get` puede devolver un `File`, que sin este control se convertiría
 * en el texto `"[object File]"`.
 */
function texto(formData: FormData, nombre: string): string | undefined {
  const valor = formData.get(nombre);

  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}

const ordenSchema = z.object({ orderId: z.string().uuid() });

/* ========================================================= compras ======== */

/**
 * BS-081 — el comprador cancela una orden que todavía no pagó.
 *
 * ⚠️ NO SE VALIDA ACÁ QUE LA ORDEN SEA CANCELABLE. `cancelPendingByBuyer`
 * conoce la máquina de estados (DEC-029) y es el único lugar donde vive; un
 * chequeo previo en la pantalla sería una segunda definición de "cancelable"
 * que el día que cambie se olvida de actualizar.
 */
export async function cancelarCompra(
  _estado: EstadoCuenta,
  formData: FormData,
): Promise<EstadoCuenta> {
  let orderId: string;

  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('order-cancel', user.id);

    orderId = ordenSchema.parse({ orderId: texto(formData, 'orderId') }).orderId;

    await cancelPendingByBuyer(user, orderId);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'cuenta' });
  }

  revalidatePath('/cuenta/compras');
  revalidatePath(`/cuenta/compras/${orderId}`);

  return { ok: 'Cancelamos la compra.' };
}

/**
 * MF-030 — "lo recibí". Pasa la orden a `DELIVERED`.
 *
 * ⚠️ ES IRREVERSIBLE Y ARRANCA UN RELOJ: desde la entrega corre la ventana de
 * protección al comprador (BR-033/034), vencida la cual la orden se completa
 * sola. Por eso la pantalla lo pide con `Confirmar`, en dos pasos.
 */
export async function confirmarRecepcion(
  _estado: EstadoCuenta,
  formData: FormData,
): Promise<EstadoCuenta> {
  let orderId: string;

  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('order-confirm', user.id);

    orderId = ordenSchema.parse({ orderId: texto(formData, 'orderId') }).orderId;

    await confirmDelivered(user, orderId);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'cuenta' });
  }

  revalidatePath('/cuenta/compras');
  revalidatePath(`/cuenta/compras/${orderId}`);

  return { ok: 'Confirmamos que la recibiste.' };
}

/* ========================================================= reclamos ======= */

/**
 * TS-050 — el comprador abre un reclamo.
 *
 * ⚠️ LAS EVIDENCIAS VIAJAN COMO TEXTO, UNA POR LÍNEA, y no como archivos. Subir
 * imágenes a un reclamo exige un puerto de almacenamiento con su propio control
 * de tipo y de tamaño, y `disputes` acepta `type: 'url' | 'text'`: lo que se
 * puede hacer hoy sin inventar nada es dejar escribir. Queda anotado como
 * faltante, no simulado.
 *
 * ⚠️ EL MOTIVO NO SE VALIDA CONTRA UNA LISTA ESCRITA ACÁ. `openDispute` lo
 * compara contra `DISPUTE_REASONS`, que sale del enum del ERD; una copia en la
 * pantalla sería una segunda lista que envejece sola.
 */
export async function abrirReclamo(
  _estado: EstadoCuenta,
  formData: FormData,
): Promise<EstadoCuenta> {
  let disputeId: string;

  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('dispute-open', user.id);

    const orderId = ordenSchema.parse({ orderId: texto(formData, 'orderId') }).orderId;

    /*
     * ⚠️ ZOD SÓLO CHEQUEA LA FORMA —que el motivo esté y que haya texto—, para
     * poder devolver el error CON EL NOMBRE DEL CAMPO. Los largos reales y el
     * conjunto de motivos válidos los decide `dispute-rules.ts`.
     */
    const input = z
      .object({
        reason: z.string().min(1, 'Elegí un motivo'),
        description: z.string().trim().min(10, 'Contanos qué pasó con un poco más de detalle'),
      })
      .parse({
        reason: texto(formData, 'reason'),
        description: texto(formData, 'description'),
      });

    const reclamo = await openDispute(user, {
      orderId,
      reason: input.reason,
      description: input.description,
      evidencias: lineas(texto(formData, 'evidencias')),
    });

    disputeId = reclamo.id;
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'cuenta',
      formData,
      // Un motivo mal elegido no puede costar los cuatro párrafos que alguien
      // acaba de escribir explicando que su camiseta llegó rota.
      preservar: ['reason', 'description', 'evidencias'],
    });
  }

  revalidatePath('/cuenta/reclamos');

  redirect(`/cuenta/reclamos/${disputeId}`);
}

/**
 * Un textarea de varias líneas a la lista de evidencias.
 *
 * ⚠️ SE DEVUELVE `undefined` Y NO `[]` CUANDO NO HAY NINGUNA. `openDispute`
 * distingue los dos casos en su firma (`evidencias?: readonly unknown[]`), y
 * mandar un arreglo vacío es decir "mandé evidencias, cero" en vez de "no
 * mandé".
 */
function lineas(valor: string | undefined): string[] | undefined {
  if (valor === undefined) return undefined;

  const items = valor
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '');

  return items.length === 0 ? undefined : items;
}

/* ========================================================= reseñas ======== */

/**
 * BS-100 — el comprador califica al vendedor de una orden completada.
 *
 * ⚠️ EL PUNTAJE LLEGA COMO TEXTO DE UN RADIO. `z.coerce.number()` lo convierte y
 * el Service lo vuelve a validar contra `RATING_MIN`/`RATING_MAX`: acá se
 * convierte para poder nombrar el campo en el error, allá se decide si vale.
 */
export async function calificar(_estado: EstadoCuenta, formData: FormData): Promise<EstadoCuenta> {
  let orderId: string;

  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('review-create', user.id);

    const input = z
      .object({
        orderId: z.string().uuid(),
        rating: z.coerce
          .number()
          .int('Elegí cuántas estrellas')
          .min(1, 'Elegí cuántas estrellas')
          .max(5, 'El puntaje va de 1 a 5 estrellas'),
        comment: z.string().trim().max(1000).optional(),
      })
      .parse({
        orderId: texto(formData, 'orderId'),
        rating: texto(formData, 'rating'),
        comment: texto(formData, 'comment'),
      });

    orderId = input.orderId;

    await createReview(user, {
      orderId: input.orderId,
      rating: input.rating,
      comment: input.comment ?? null,
    });
  } catch (error) {
    return respuestaDeError(error, { ambito: 'cuenta', formData, preservar: ['comment'] });
  }

  revalidatePath('/cuenta/resenas');
  revalidatePath(`/cuenta/compras/${orderId}`);

  redirect(`/cuenta/compras/${orderId}/calificar`);
}

/* ======================================================== favoritos ======= */

/**
 * BS-050 — saca una publicación de favoritos.
 *
 * ⚠️ EL SERVICE ES UN TOGGLE Y ACÁ SE USA PARA QUITAR. Es correcto porque el
 * botón sólo existe en la lista de favoritos, o sea que la publicación ESTÁ
 * guardada: el toggle sólo puede ir en una dirección. Si alguien repitiera el
 * POST volvería a agregarla, que es exactamente lo que hace tocar dos veces un
 * corazón, y `UNIQUE(user_id, listing_id)` impide duplicar.
 */
export async function quitarDeFavoritos(
  _estado: EstadoCuenta,
  formData: FormData,
): Promise<EstadoCuenta> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('favorite-toggle', user.id);

    const { listingId } = z
      .object({ listingId: z.string().uuid() })
      .parse({ listingId: texto(formData, 'listingId') });

    await toggleFavorite(user, listingId);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'cuenta' });
  }

  revalidatePath('/cuenta/favoritos');

  return { ok: 'La sacamos de tus favoritos.' };
}

/* ====================================================== direcciones ======= */

/**
 * Los campos de la libreta (ERD §6.1).
 *
 * ⚠️ ZOD VALIDA PRESENCIA Y LARGO; LA NORMALIZACIÓN LA HACE
 * `validateAddressInput`. Sin este paso el Service igual rechazaría, pero con
 * un `VALIDATION_FAILED` sin nombre de campo: en un formulario de nueve
 * controles, "La calle es obligatoria" aparecería arriba de todo sin decir cuál
 * de los nueve es. Es exactamente el agujero que `erroresDeZod` vino a tapar.
 *
 * ⚠️ EL CÓDIGO POSTAL NO SE "ARREGLA" ACÁ: es la clave con la que se cotiza y
 * se despacha el envío, y las dos formas válidas —4 cifras o CPA de 8— las
 * decide `normalizarCodigoPostal`.
 */
const direccionSchema = z.object({
  etiqueta: z.string().trim().max(40, 'La etiqueta admite hasta 40 caracteres').optional(),
  nombre: z
    .string()
    .trim()
    .min(2, 'Poné a nombre de quién va el envío')
    .max(120, 'El nombre admite hasta 120 caracteres'),
  telefono: z.string().trim().max(40).optional(),
  calle: z
    .string()
    .trim()
    .min(2, 'Ingresá la calle')
    .max(200, 'La calle admite hasta 200 caracteres'),
  numero: z.string().trim().max(20, 'El número admite hasta 20 caracteres').optional(),
  departamento: z.string().trim().max(50, 'El piso/depto admite hasta 50 caracteres').optional(),
  ciudad: z.string().trim().min(2, 'Ingresá la localidad').max(120),
  provincia: z.string().trim().min(1, 'Elegí una provincia de la lista'),
  codigoPostal: z.string().trim().min(4, 'El código postal es obligatorio').max(10),
});

/** Las nueve claves que se devuelven al formulario cuando algo falla. */
const CAMPOS_DE_DIRECCION = [
  'etiqueta',
  'nombre',
  'telefono',
  'calle',
  'numero',
  'departamento',
  'ciudad',
  'provincia',
  'codigoPostal',
] as const;

function leerDireccion(formData: FormData): z.infer<typeof direccionSchema> {
  return direccionSchema.parse({
    etiqueta: texto(formData, 'etiqueta'),
    nombre: texto(formData, 'nombre'),
    telefono: texto(formData, 'telefono'),
    calle: texto(formData, 'calle'),
    numero: texto(formData, 'numero'),
    departamento: texto(formData, 'departamento'),
    ciudad: texto(formData, 'ciudad'),
    provincia: texto(formData, 'provincia'),
    codigoPostal: texto(formData, 'codigoPostal'),
  });
}

/** BS-020 — guarda una dirección nueva en la libreta. */
export async function guardarDireccion(
  _estado: EstadoCuenta,
  formData: FormData,
): Promise<EstadoCuenta> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('address-write', user.id);

    await createAddress(user, {
      ...leerDireccion(formData),
      predeterminada: texto(formData, 'predeterminada') !== undefined,
    });
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'cuenta',
      formData,
      preservar: CAMPOS_DE_DIRECCION,
    });
  }

  revalidatePath('/cuenta/direcciones');

  return { ok: 'Guardamos la dirección.' };
}

/**
 * Edita una dirección.
 *
 * ⚠️ CAMBIAR UNA DIRECCIÓN NO CAMBIA NINGUNA ORDEN. La orden congeló su
 * `shipping_address` como snapshot al crearse (DEC-030) y el snapshot no lleva
 * el `id` de la libreta justamente para que no pueda volver: una compra sigue
 * diciendo a dónde se despachó.
 */
export async function editarDireccion(
  _estado: EstadoCuenta,
  formData: FormData,
): Promise<EstadoCuenta> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('address-write', user.id);

    const { addressId } = z
      .object({ addressId: z.string().uuid() })
      .parse({ addressId: texto(formData, 'addressId') });

    await updateAddress(user, addressId, leerDireccion(formData));
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'cuenta',
      formData,
      preservar: CAMPOS_DE_DIRECCION,
    });
  }

  revalidatePath('/cuenta/direcciones');

  return { ok: 'Guardamos los cambios.' };
}

/**
 * Borra una dirección. Es BORRADO FÍSICO y el Service lo asume: la libreta es
 * efímera (ERD §20.10) y cada orden ya tiene su snapshot.
 */
export async function borrarDireccion(
  _estado: EstadoCuenta,
  formData: FormData,
): Promise<EstadoCuenta> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('address-write', user.id);

    const { addressId } = z
      .object({ addressId: z.string().uuid() })
      .parse({ addressId: texto(formData, 'addressId') });

    await deleteAddress(user, addressId);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'cuenta' });
  }

  revalidatePath('/cuenta/direcciones');

  redirect('/cuenta/direcciones');
}

/** Marca una dirección como predeterminada y desmarca la anterior, atómicamente. */
export async function usarPorDefecto(
  _estado: EstadoCuenta,
  formData: FormData,
): Promise<EstadoCuenta> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('address-write', user.id);

    const { addressId } = z
      .object({ addressId: z.string().uuid() })
      .parse({ addressId: texto(formData, 'addressId') });

    await setDefaultAddress(user, addressId);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'cuenta' });
  }

  revalidatePath('/cuenta/direcciones');

  return { ok: 'Ahora es tu dirección predeterminada.' };
}

/* ==================================================== notificaciones ====== */

/**
 * Marca un aviso como leído.
 *
 * ⚠️ MARCAR UNO YA LEÍDO NO ES UN ERROR: el Service lo trata como idempotente,
 * que es lo que un doble clic merece.
 */
export async function marcarLeida(
  _estado: EstadoCuenta,
  formData: FormData,
): Promise<EstadoCuenta> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('notification-read', user.id);

    const { notificationId } = z
      .object({ notificationId: z.string().uuid() })
      .parse({ notificationId: texto(formData, 'notificationId') });

    await markRead(user, notificationId);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'cuenta' });
  }

  /*
   * ⚠️ SE REVALIDA TAMBIÉN LA RAÍZ: el conteo de la campanita vive en la barra
   * superior, que renderiza el layout de TODAS las rutas. Sin esto el aviso
   * queda marcado y el numerito sigue diciendo lo mismo.
   */
  revalidatePath('/', 'layout');

  return { ok: 'Listo.' };
}

/** Marca todos los avisos como leídos. */
export async function marcarTodasLeidas(
  _estado: EstadoCuenta,
  _formData: FormData,
): Promise<EstadoCuenta> {
  let cuantas: number;

  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('notification-read', user.id);

    cuantas = await markAllRead(user);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'cuenta' });
  }

  revalidatePath('/', 'layout');

  return {
    ok: cuantas === 0 ? 'No tenías avisos sin leer.' : 'Marcamos todos tus avisos como leídos.',
  };
}
