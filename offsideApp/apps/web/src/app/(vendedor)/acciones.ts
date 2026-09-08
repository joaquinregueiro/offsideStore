'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireVerifiedSessionUser } from '@/lib/session';
import type { PublicUser } from '@/modules/auth/services/auth.service';
import { AuthError } from '@/modules/auth/auth.errors';
import { createSellerProfileSchema, submitTaxIdentitySchema } from '@/modules/auth/auth.schemas';
import {
  deleteListing,
  editListing,
  pauseListing,
  resumeListing,
} from '@/modules/listings/services/listing-editing.service';
import { publishListing } from '@/modules/listings/services/listing.service';
import {
  activateListing,
  deleteImage,
  uploadImage,
} from '@/modules/listings/services/listing-image.service';
import {
  disconnect,
  startConnection,
} from '@/modules/sellers/services/mercadopago-connection.service';
import { createSellerProfile } from '@/modules/sellers/services/seller.service';
import { submitTaxIdentity } from '@/modules/sellers/services/seller-tax-profile.service';

/**
 * Server Actions del vendedor.
 *
 * ⚠️ CADA ACCION EXIGE SESION VERIFICADA POR SU CUENTA. Son alcanzables por POST
 * directo sin pasar por la pantalla: que la pagina haya hecho el guard no
 * protege a la accion.
 *
 * ⚠️ NINGUNA DE ESTAS ACCIONES AUTORIZA POR SI MISMA. La autorizacion de
 * vendedor vive en los Services —`requireOwnSellerProfile` resuelve el perfil
 * POR `user.id`, y `canSellerOperate` decide si puede publicar—. Repetir la
 * regla aca seria arriesgarse a que las dos copias se separen.
 */

export interface EstadoVendedor {
  error?: string;
  ok?: string;
}

/**
 * Lee un campo del formulario.
 *
 * Devuelve `undefined` tanto si falta como si vino vacio: para un `<input>` no
 * completado el navegador manda cadena vacia, y los schemas esperan ausencia.
 * `FormData.get` puede devolver un `File`, que sin este control se convertiria
 * en el texto `"[object File]"`.
 */
function texto(formData: FormData, nombre: string): string | undefined {
  const valor = formData.get(nombre);

  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}

function mensajeDeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? 'Revisá los datos ingresados.';
  }

  if (error instanceof AuthError) return error.message;

  console.error('[vendedor] error inesperado en una accion:', error);

  return 'Tuvimos un problema. Probá de nuevo en un momento.';
}

/* ------------------------------------------------------------------ alta -- */

/**
 * SS-001/SS-002 — habilita el rol vendedor sobre la cuenta que ya existe.
 *
 * ⚠️ SE REUSA `createSellerProfileSchema`, el MISMO que valida el endpoint de la
 * API. Un schema propio para el formulario habria creado una segunda definicion
 * de que es un alta valida, y nada garantizaria que las dos digan lo mismo con
 * el tiempo.
 *
 * ⚠️ LOS TERMINOS SE EXIGEN DE VERDAD, no solo con `required` en el HTML: un
 * POST directo se saltea el atributo. El schema pide `acceptedSellerTerms`
 * literal `true`, asi que sin la casilla no se llega al Service. El registro de
 * CUANDO se aceptaron lo escribe `createSellerProfile` en `audit_log` (TS-010).
 */
export async function habilitarVendedor(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();

    const input = createSellerProfileSchema.parse({
      displayName: texto(formData, 'displayName'),
      bio: texto(formData, 'bio'),
      shippingPolicy: texto(formData, 'shippingPolicy'),
      // La casilla llega como `'on'` o no llega. El schema exige `true`.
      acceptedSellerTerms: texto(formData, 'terminos') !== undefined,
    });

    await createSellerProfile(user, input);
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  redirect('/vendedor');
}

/* ---------------------------------------------------------------- fiscal -- */

/**
 * Declara la identidad fiscal: una de las tres señales de TS-001.
 *
 * ⚠️ EL SERVICE VALIDA SINTAXIS Y DIGITO VERIFICADOR, NO TITULARIDAD. No hay
 * integracion con ARCA (DEC-011 pendiente de asesoramiento profesional), asi
 * que esto identifica; no prueba de quien es el numero.
 */
export async function declararIdentidadFiscal(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();

    const input = submitTaxIdentitySchema.parse({
      taxIdType: texto(formData, 'taxIdType'),
      taxId: texto(formData, 'taxId'),
    });

    await submitTaxIdentity(user, input);
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  redirect('/vendedor');
}

/* ---------------------------------------------------------- mercado pago -- */

/**
 * Inicia el OAuth de Mercado Pago.
 *
 * ⚠️ EL SERVICE DEVUELVE LA URL Y ACA SE NAVEGA (MP-OAUTH-014). El backend no
 * redirige por su cuenta: el browser tiene que ir de verdad a la pantalla de
 * Mercado Pago, que es de otro origen.
 *
 * El retorno NO vuelve a esta accion: Mercado Pago llama al `redirect_uri`
 * —`/api/sellers/mercadopago/callback`—, que a su vez manda a
 * `/vendedor/mercadopago?status=…`.
 */
export async function conectarMercadoPago(
  _estado: EstadoVendedor,
  _formData: FormData,
): Promise<EstadoVendedor> {
  let destino: string;

  try {
    const user = await requireVerifiedSessionUser();
    const { authorizationUrl } = await startConnection(user);
    destino = authorizationUrl;
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  redirect(destino);
}

/**
 * Desvincula la cuenta de Mercado Pago.
 *
 * ⚠️ NO DEGRADA LA APROBACION. El vendedor sigue `approved`, pero `canSell`
 * pasa a false y no puede publicar ni cobrar. Revocar una aprobacion es TS-011
 * y sus reglas siguen pendientes.
 */
export async function desconectarMercadoPago(
  _estado: EstadoVendedor,
  _formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    await disconnect(user);
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  redirect('/vendedor/mercadopago?status=disconnected');
}

/* -------------------------------------------------------------- publicar -- */

/**
 * ⚠️ EL PRECIO SE INGRESA EN PESOS Y SE GUARDA EN CENTAVOS. El ERD exige
 * `bigint` en centavos para todo importe, pero el formulario no puede pedirle a
 * una persona que escriba centavos. La conversion es `Math.round(pesos * 100)`
 * y pasa por `number` un solo instante; el tope la mantiene exacta muy por
 * debajo de `Number.MAX_SAFE_INTEGER`.
 *
 * ⚠️ El endpoint JSON de la API recibe centavos como string, no pesos. Son dos
 * bordes distintos del mismo Service y cada uno valida lo que realmente recibe.
 */
const PRECIO_MAXIMO_PESOS = 50_000_000;

const publicarSchema = z.object({
  categoryId: z.string().uuid('Elegí una categoría'),
  title: z.string().trim().min(3, 'El título es muy corto').max(140),
  description: z.string().trim().max(5_000).optional(),
  precioPesos: z.coerce
    .number()
    .positive('El precio tiene que ser mayor a cero')
    .max(PRECIO_MAXIMO_PESOS, 'Ese precio es demasiado alto'),
  stock: z.coerce
    .number()
    .int('El stock tiene que ser un número entero')
    .positive('Tenés que tener al menos una unidad')
    .max(1_000),
  sizeValue: z.string().trim().min(1, 'Ingresá el talle').max(20),
  condition: z.enum(['NUEVO', 'COMO_NUEVO', 'EXCELENTE', 'MUY_BUENO', 'BUENO', 'ACEPTABLE']),
  // Obligatorios para camiseta; lo valida el Service, que es quien conoce la
  // categoria (ERD §9.1).
  kitType: z.enum(['home', 'away', 'third', 'goalkeeper', 'special']).optional(),
  sleeve: z.enum(['short', 'long']).optional(),
});

/**
 * SS-030/SS-031 — publica una prenda.
 *
 * ⚠️ SIN FOTOS. SS-031 pide al menos una y el almacenamiento S3 no existe. Es
 * la carencia mas visible de esta pantalla, y por eso se avisa EN la pantalla
 * en vez de dejar que el vendedor lo descubra despues de publicar.
 */
export async function publicar(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();

    const input = publicarSchema.parse({
      categoryId: texto(formData, 'categoryId'),
      title: texto(formData, 'title'),
      description: texto(formData, 'description'),
      precioPesos: texto(formData, 'precioPesos'),
      stock: texto(formData, 'stock'),
      sizeValue: texto(formData, 'sizeValue'),
      condition: texto(formData, 'condition'),
      kitType: texto(formData, 'kitType'),
      sleeve: texto(formData, 'sleeve'),
    });

    const listing = await publishListing(user, {
      categoryId: input.categoryId,
      title: input.title,
      description: input.description ?? null,
      priceAmount: BigInt(Math.round(input.precioPesos * 100)),
      stock: input.stock,
      sizeValue: input.sizeValue,
      condition: input.condition,
      kitType: input.kitType ?? null,
      sleeve: input.sleeve ?? null,
    });

    /**
     * ⚠️ LA PUBLICACION NACE EN BORRADOR y se activa recien si quedo con al
     * menos una foto (PS-010 / SS-032). No se puede validar antes: las fotos
     * necesitan que la publicacion exista, por la FK.
     *
     * Si ninguna foto entra, la publicacion NO se pierde: queda en borrador,
     * fuera de la vitrina, y el vendedor la completa desde sus publicaciones.
     * Tirarla abajo le haria perder todo lo que escribio por un problema de
     * una imagen.
     */
    const fallidas = await subirFotos(user, listing.id, formData);
    const activada = await activateListing(user, listing.id);

    if (!activada) {
      return {
        error:
          'Guardamos tu publicación como borrador, pero no pudimos subir ninguna foto. ' +
          'Necesita al menos una para salir a la venta: agregala desde tus publicaciones.',
      };
    }

    if (fallidas > 0) {
      return {
        ok: `Publicamos tu prenda. ${fallidas === 1 ? 'Una foto no se pudo subir' : `${fallidas} fotos no se pudieron subir`}: agregala desde tus publicaciones.`,
      };
    }
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  redirect('/vendedor/publicaciones');
}

/**
 * Sube las fotos que vinieron en el formulario. Devuelve cuantas fallaron.
 *
 * ⚠️ UNA POR UNA, NO EN PARALELO. Cada una decodifica y genera tres variantes;
 * ocho a la vez en un VPS chico es un pico de memoria evitable. La diferencia
 * de tiempo la paga una persona que ya esta esperando, no un lote.
 *
 * ⚠️ NO SE VALIDA EL TIPO ACA. `File.type` lo declara el navegador y el
 * Service no le cree: decodifica los bytes. Filtrar aca por `type` seria una
 * comodidad, nunca una garantia.
 */
async function subirFotos(
  user: PublicUser,
  listingId: string,
  formData: FormData,
): Promise<number> {
  const archivos = formData
    .getAll('fotos')
    .filter((v): v is File => v instanceof File && v.size > 0);

  let fallidas = 0;

  for (const archivo of archivos) {
    try {
      await uploadImage(user, {
        listingId,
        bytes: Buffer.from(await archivo.arrayBuffer()),
      });
    } catch (error) {
      fallidas += 1;
      console.error(
        '[vendedor] no se pudo subir una foto:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return fallidas;
}

/* ----------------------------------------------------------------- fotos -- */

const fotosSchema = z.object({ listingId: z.string().uuid() });

/** Agrega fotos a una publicacion que ya existe. */
export async function agregarFotos(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    const { listingId } = fotosSchema.parse({ listingId: texto(formData, 'listingId') });

    const archivos = formData
      .getAll('fotos')
      .filter((v): v is File => v instanceof File && v.size > 0);

    if (archivos.length === 0) return { error: 'Elegí al menos una foto.' };

    const fallidas = await subirFotos(user, listingId, formData);

    if (fallidas === archivos.length) {
      return { error: 'No pudimos subir ninguna de las fotos. Revisá que sean JPG, PNG o WebP.' };
    }

    // Si estaba en borrador por no tener fotos, ahora ya puede salir a la
    // vitrina. Es idempotente: si ya estaba activa no hace nada.
    const activada = await activateListing(user, listingId);

    if (fallidas > 0) return { error: `${fallidas} de las fotos no se pudieron subir.` };

    if (activada) {
      revalidatePath('/vendedor/publicaciones');
      return { ok: 'Listo, subimos las fotos. Tu publicación ya está a la venta.' };
    }
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  revalidatePath('/vendedor/publicaciones');

  return { ok: 'Listo, subimos las fotos.' };
}

const borrarFotoSchema = z.object({
  listingId: z.string().uuid(),
  imageId: z.string().uuid(),
});

/** Borra una foto de una publicacion. */
export async function borrarFoto(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();

    const input = borrarFotoSchema.parse({
      listingId: texto(formData, 'listingId'),
      imageId: texto(formData, 'imageId'),
    });

    await deleteImage(user, input.listingId, input.imageId);
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  revalidatePath('/vendedor/publicaciones');

  return { ok: 'Foto borrada.' };
}

/* --------------------------------------------- editar / pausar / eliminar -- */

/**
 * Campos editables (SS-040).
 *
 * ⚠️ LA CATEGORIA NO ESTA. Cambiarla puede volver obligatorios atributos que
 * la publicacion no tiene (ERD §9.1); si hace falta, se publica de nuevo.
 */
const editarSchema = z.object({
  listingId: z.string().uuid(),
  title: z.string().trim().min(3, 'El título es muy corto').max(140),
  description: z.string().trim().max(5_000).optional(),
  precioPesos: z.coerce
    .number()
    .positive('El precio tiene que ser mayor a cero')
    .max(PRECIO_MAXIMO_PESOS, 'Ese precio es demasiado alto'),
  stock: z.coerce
    .number()
    .int('El stock tiene que ser un número entero')
    .min(0, 'El stock no puede ser negativo')
    .max(1_000),
  sizeValue: z.string().trim().min(1, 'Ingresá el talle').max(20),
  condition: z.enum(['NUEVO', 'COMO_NUEVO', 'EXCELENTE', 'MUY_BUENO', 'BUENO', 'ACEPTABLE']),
  kitType: z.enum(['home', 'away', 'third', 'goalkeeper', 'special']).optional(),
  sleeve: z.enum(['short', 'long']).optional(),
});

export async function editar(_estado: EstadoVendedor, formData: FormData): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();

    const input = editarSchema.parse({
      listingId: texto(formData, 'listingId'),
      title: texto(formData, 'title'),
      description: texto(formData, 'description'),
      precioPesos: texto(formData, 'precioPesos'),
      stock: texto(formData, 'stock'),
      sizeValue: texto(formData, 'sizeValue'),
      condition: texto(formData, 'condition'),
      kitType: texto(formData, 'kitType'),
      sleeve: texto(formData, 'sleeve'),
    });

    await editListing(user, input.listingId, {
      title: input.title,
      description: input.description ?? null,
      priceAmount: BigInt(Math.round(input.precioPesos * 100)),
      stock: input.stock,
      sizeValue: input.sizeValue,
      condition: input.condition,
      kitType: input.kitType ?? null,
      sleeve: input.sleeve ?? null,
    });
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  revalidatePath('/vendedor/publicaciones');

  return { ok: 'Guardamos los cambios.' };
}

const publicacionSchema = z.object({ listingId: z.string().uuid() });

export async function pausar(_estado: EstadoVendedor, formData: FormData): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    const { listingId } = publicacionSchema.parse({ listingId: texto(formData, 'listingId') });

    await pauseListing(user, listingId);
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  revalidatePath('/vendedor/publicaciones');

  return { ok: 'La pausamos: ya no aparece en la vitrina.' };
}

export async function reactivar(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    const { listingId } = publicacionSchema.parse({ listingId: texto(formData, 'listingId') });

    await resumeListing(user, listingId);
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  revalidatePath('/vendedor/publicaciones');

  return { ok: 'Volvió a la venta.' };
}

/**
 * Elimina una publicacion (SS-050).
 *
 * ⚠️ ES IRREVERSIBLE y la pantalla lo dice antes de que se apriete. El
 * borrado es logico —`order_items` referencia la publicacion—, pero para el
 * vendedor no hay vuelta atras.
 */
export async function eliminar(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    const { listingId } = publicacionSchema.parse({ listingId: texto(formData, 'listingId') });

    await deleteListing(user, listingId);
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  revalidatePath('/vendedor/publicaciones');

  return { ok: 'La eliminamos.' };
}
