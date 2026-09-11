'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { exigirLimitePorUsuario } from '@/lib/rate-limit-actions';
import { respuestaDeError } from '@/lib/errores';
import type { EstadoFormulario } from '@/lib/formulario';
import { requireVerifiedSessionUser } from '@/lib/session';
import type { PublicUser } from '@/modules/auth/services/auth.service';
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
import { promoteListing } from '@/modules/listings/services/promotion.service';
import { cancelBySeller, markShipped } from '@/modules/orders/services/order.service';
import { answerQuestion, hideQuestion } from '@/modules/questions/services/question.service';
import { REPLY_MAX_LENGTH, replyToReview } from '@/modules/reviews/services/review.service';
import { respondAsSeller } from '@/modules/disputes/services/dispute.service';
import {
  disconnect,
  startConnection,
} from '@/modules/sellers/services/mercadopago-connection.service';
import {
  createSellerProfile,
  updateMySellerProfile,
} from '@/modules/sellers/services/seller.service';
import { submitTaxIdentity } from '@/modules/sellers/services/seller-tax-profile.service';
import { setVacation } from '@/modules/sellers/services/vacation.service';

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
 *
 * ⚠️ CADA UNA CONSUME SU LIMITE POR USUARIO, y aca es donde mas importa:
 * `publicar` y `agregarFotos` son **las operaciones mas caras del sistema**.
 * Cada foto se decodifica y se reescribe en tres tamaños con sharp, hasta ocho
 * por envio; sin techo, un bucle desde una sola cuenta agota la memoria del VPS
 * sin necesidad de explotar nada. El resto se limita por una razon mas modesta
 * pero real: `editar` escribe en `audit_log` y en `listing_price_history`, y un
 * bucle las llenaria de ruido hasta volver inutil el historial que BR-015 pide
 * conservar.
 *
 * Cada familia cuenta APARTE. Si publicar, editar y subir fotos compartieran
 * contador, ordenar el catalogo un domingo a la tarde dejaria al vendedor sin
 * poder publicar.
 */

/**
 * ⚠️ ES UN ALIAS DEL CONTRATO COMPARTIDO. Era un tipo propio con solo `error`,
 * asi que este grupo no podia devolver errores por campo ni conservar lo
 * tipeado aunque el formulario ya supiera mostrarlos.
 */
export type EstadoVendedor = EstadoFormulario;

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
    await exigirLimitePorUsuario('seller-create', user.id);

    const input = createSellerProfileSchema.parse({
      displayName: texto(formData, 'displayName'),
      bio: texto(formData, 'bio'),
      shippingPolicy: texto(formData, 'shippingPolicy'),
      /*
       * La casilla llega como `'on'` o no llega. El schema exige `true`.
       *
       * ⚠️ EL CAMPO SE LLAMA COMO LA CLAVE DEL SCHEMA, Y ES UN ARREGLO. Se
       * llamaba `terminos`, asi que el issue de Zod caia en `acceptedSellerTerms`
       * y el `<Casilla>` de la pantalla —que busca su error por `name`— no
       * encontraba ninguno: el alta sin tildar quedaba sin marca en el control.
       */
      acceptedSellerTerms: texto(formData, 'acceptedSellerTerms') !== undefined,
    });

    await createSellerProfile(user, input);
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'vendedor',
      formData,
      preservar: [
        'title',
        'description',
        'precioPesos',
        'stock',
        'sizeValue',
        'displayName',
        'bio',
        'shippingPolicy',
        'taxId',
      ],
    });
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
    await exigirLimitePorUsuario('tax-identity', user.id);

    const input = submitTaxIdentitySchema.parse({
      taxIdType: texto(formData, 'taxIdType'),
      taxId: texto(formData, 'taxId'),
    });

    await submitTaxIdentity(user, input);
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'vendedor',
      formData,
      preservar: [
        'title',
        'description',
        'precioPesos',
        'stock',
        'sizeValue',
        'displayName',
        'bio',
        'shippingPolicy',
        'taxId',
      ],
    });
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
    await exigirLimitePorUsuario('mp-connect', user.id);

    const { authorizationUrl } = await startConnection(user);
    destino = authorizationUrl;
  } catch (error) {
    // Esta accion no recibe campos: no hay nada que preservar.
    return respuestaDeError(error, { ambito: 'vendedor' });
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
    await exigirLimitePorUsuario('mp-disconnect', user.id);

    await disconnect(user);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'vendedor' });
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
  // Referencias de catalogo. OPCIONALES: exigirlas dejaria afuera cualquier
  // camiseta cuyo club o marca no este sembrado, y el flujo de propuestas de
  // catalogo (DEC-041) todavia no existe.
  clubId: z.string().uuid().optional(),
  nationalTeamId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  competitionId: z.string().uuid().optional(),
  seasonId: z.string().uuid().optional(),
  /**
   * Envio DECLARADO por el vendedor (delta al ERD §11).
   *
   * ⚠️ ES `string` Y NO UN ENUM CERRADO, A PROPOSITO. Los modos permitidos
   * dependen del Config Store (`shipping_pickup_allowed`,
   * `shipping_to_agree_allowed`) y quien decide es
   * `validateShippingDeclaration`, adentro del Service. Copiar la lista aca
   * seria una segunda definicion de que envio es valido, y la que se olvida de
   * actualizarse siempre es la copia.
   */
  shippingMode: z.string().trim().max(32).optional(),
  /**
   * ⚠️ EN PESOS, COMO EL PRECIO, y por el mismo motivo: no se le puede pedir a
   * una persona que escriba centavos. La conversion a `bigint` es la misma.
   */
  shippingCostPesos: z.coerce
    .number()
    .nonnegative('El costo del envío no puede ser negativo')
    .max(PRECIO_MAXIMO_PESOS, 'Ese costo de envío es demasiado alto')
    .optional(),
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
    await exigirLimitePorUsuario('listing-create', user.id);

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
      clubId: texto(formData, 'clubId'),
      nationalTeamId: texto(formData, 'nationalTeamId'),
      brandId: texto(formData, 'brandId'),
      competitionId: texto(formData, 'competitionId'),
      seasonId: texto(formData, 'seasonId'),
      shippingMode: texto(formData, 'shippingMode'),
      shippingCostPesos: texto(formData, 'shippingCostPesos'),
    });

    // Al publicar los cinco selectores de catalogo SI estan en el formulario,
    // asi que se mandan derecho: aca `null` significa "el vendedor no eligio
    // ninguno", que es un valor legitimo y no una perdida de dato.
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
      clubId: input.clubId ?? null,
      nationalTeamId: input.nationalTeamId ?? null,
      brandId: input.brandId ?? null,
      competitionId: input.competitionId ?? null,
      seasonId: input.seasonId ?? null,
      /*
       * ⚠️ `undefined` Y `null` SIGNIFICAN COSAS DISTINTAS ACA. Ausente = "el
       * vendedor no eligio", y el Service cae al `shipping_default_mode` del
       * Config Store; mandar `null` explicito le pediria al validador que trate
       * un campo vacio como una eleccion. Por eso van por spread y no con `??`.
       */
      ...(input.shippingMode === undefined ? {} : { shippingMode: input.shippingMode }),
      ...(input.shippingCostPesos === undefined
        ? {}
        : { shippingCostAmount: BigInt(Math.round(input.shippingCostPesos * 100)) }),
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
    return respuestaDeError(error, {
      ambito: 'vendedor',
      formData,
      preservar: [
        'title',
        'description',
        'precioPesos',
        'stock',
        'sizeValue',
        'displayName',
        'bio',
        'shippingPolicy',
        'taxId',
        'shippingMode',
        'shippingCostPesos',
      ],
    });
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
    await exigirLimitePorUsuario('listing-image', user.id);

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
    return respuestaDeError(error, {
      ambito: 'vendedor',
      formData,
      preservar: [
        'title',
        'description',
        'precioPesos',
        'stock',
        'sizeValue',
        'displayName',
        'bio',
        'shippingPolicy',
        'taxId',
      ],
    });
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
    await exigirLimitePorUsuario('listing-update', user.id);

    const input = borrarFotoSchema.parse({
      listingId: texto(formData, 'listingId'),
      imageId: texto(formData, 'imageId'),
    });

    await deleteImage(user, input.listingId, input.imageId);
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'vendedor',
      formData,
      preservar: [
        'title',
        'description',
        'precioPesos',
        'stock',
        'sizeValue',
        'displayName',
        'bio',
        'shippingPolicy',
        'taxId',
      ],
    });
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
  // Referencias de catalogo. OPCIONALES: exigirlas dejaria afuera cualquier
  // camiseta cuyo club o marca no este sembrado, y el flujo de propuestas de
  // catalogo (DEC-041) todavia no existe.
  clubId: z.string().uuid().optional(),
  nationalTeamId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  competitionId: z.string().uuid().optional(),
  seasonId: z.string().uuid().optional(),
});

/** Las cinco referencias de catalogo que puede llevar una publicacion. */
const CLAVES_DE_CATALOGO = [
  'clubId',
  'nationalTeamId',
  'brandId',
  'competitionId',
  'seasonId',
] as const;

type ClaveDeCatalogo = (typeof CLAVES_DE_CATALOGO)[number];

/**
 * Referencias de catalogo que hay que ESCRIBIR, distinguiendo "el formulario no
 * traia el campo" de "el campo vino vacio".
 *
 * ⚠️ ESTO ARREGLA UNA PERDIDA DE DATOS SILENCIOSA. El formulario de editar no
 * tiene los selectores de club, seleccion, marca, temporada ni competencia
 * —sólo los tiene el de publicar—, asi que esas cinco claves llegaban SIEMPRE
 * como `undefined`. La accion mandaba `clubId: input.clubId ?? null` y el
 * repositorio hace `.set({ ...values })`, que escribe el `null`: **corregir un
 * typo en el titulo borraba el club, la marca y la temporada de la
 * publicacion**.
 *
 * El efecto no se veia en ningun lado. La camiseta desaparecia de las facetas
 * de `/buscar`, perdia el peso `A` de los alias —o sea que "CARP" o
 * "Millonario" dejaban de encontrarla (PS-024)— y ni la pantalla lo avisaba ni
 * quedaba registro: los catalogos no se auditan.
 *
 * ⚠️ SE PREGUNTA POR `formData.has()` Y NO POR EL VALOR. `texto()` colapsa la
 * cadena vacia a `undefined`, asi que con el valor solo es imposible saber si
 * el vendedor VACIO el campo o si el campo no existia. Con `has()`, el dia que
 * el formulario incorpore los selectores, vaciar uno va a limpiarlo de verdad
 * sin tocar esta funcion.
 */
function catalogoAEscribir(
  formData: FormData,
  input: Partial<Record<ClaveDeCatalogo, string | undefined>>,
): Partial<Record<ClaveDeCatalogo, string | null>> {
  const salida: Partial<Record<ClaveDeCatalogo, string | null>> = {};

  for (const clave of CLAVES_DE_CATALOGO) {
    // El formulario no ofrece el campo: lo que haya en la base se respeta.
    if (!formData.has(clave)) continue;

    salida[clave] = input[clave] ?? null;
  }

  return salida;
}

export async function editar(_estado: EstadoVendedor, formData: FormData): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('listing-update', user.id);

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
      clubId: texto(formData, 'clubId'),
      nationalTeamId: texto(formData, 'nationalTeamId'),
      brandId: texto(formData, 'brandId'),
      competitionId: texto(formData, 'competitionId'),
      seasonId: texto(formData, 'seasonId'),
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
      ...catalogoAEscribir(formData, input),
    });
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'vendedor',
      formData,
      preservar: [
        'title',
        'description',
        'precioPesos',
        'stock',
        'sizeValue',
        'displayName',
        'bio',
        'shippingPolicy',
        'taxId',
      ],
    });
  }

  revalidatePath('/vendedor/publicaciones');

  return { ok: 'Guardamos los cambios.' };
}

const publicacionSchema = z.object({ listingId: z.string().uuid() });

export async function pausar(_estado: EstadoVendedor, formData: FormData): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('listing-update', user.id);

    const { listingId } = publicacionSchema.parse({ listingId: texto(formData, 'listingId') });

    await pauseListing(user, listingId);
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'vendedor',
      formData,
      preservar: [
        'title',
        'description',
        'precioPesos',
        'stock',
        'sizeValue',
        'displayName',
        'bio',
        'shippingPolicy',
        'taxId',
      ],
    });
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
    await exigirLimitePorUsuario('listing-update', user.id);

    const { listingId } = publicacionSchema.parse({ listingId: texto(formData, 'listingId') });

    await resumeListing(user, listingId);
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'vendedor',
      formData,
      preservar: [
        'title',
        'description',
        'precioPesos',
        'stock',
        'sizeValue',
        'displayName',
        'bio',
        'shippingPolicy',
        'taxId',
      ],
    });
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
    await exigirLimitePorUsuario('listing-update', user.id);

    const { listingId } = publicacionSchema.parse({ listingId: texto(formData, 'listingId') });

    await deleteListing(user, listingId);
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'vendedor',
      formData,
      preservar: [
        'title',
        'description',
        'precioPesos',
        'stock',
        'sizeValue',
        'displayName',
        'bio',
        'shippingPolicy',
        'taxId',
      ],
    });
  }

  revalidatePath('/vendedor/publicaciones');

  return { ok: 'La eliminamos.' };
}

/* -------------------------------------------------------------------------- */
/* Ciclo de la venta, promociones y tienda (2026-09-11)                        */
/* -------------------------------------------------------------------------- */

/**
 * Campos que se devuelven cuando una de las acciones nuevas falla.
 *
 * ⚠️ ES UNA LISTA APARTE Y NO LA DE ARRIBA. La de publicar preserva precio,
 * stock y talle; acá lo que se pierde al fallar es un numero de seguimiento
 * tipeado a mano desde el celular, el motivo de una cancelacion o la respuesta
 * a una reseña. Mezclarlas obligaria a mantener una lista de veinte claves que
 * ninguna pantalla usa entera.
 *
 * ⚠️ NO LLEVA NINGUN CAMPO SENSIBLE, y ademas `valoresDelFormulario` filtra las
 * claves prohibidas por su cuenta: dos redes, porque devolver un valor al
 * cliente lo deja escrito en el HTML de la respuesta.
 */
const PRESERVAR_PANEL = [
  'carrier',
  'trackingNumber',
  'motivo',
  'texto',
  'respuesta',
  'displayName',
  'bio',
  'shippingPolicy',
  'hasta',
] as const;

const ordenSchema = z.object({ orderId: z.string().uuid() });

/**
 * SS-080 — el vendedor despacha y declara CON QUIEN y CON QUE NUMERO.
 *
 * ⚠️ LOS DOS SON OBLIGATORIOS Y NO ES UNA FORMALIDAD. Sin transportista y sin
 * seguimiento el comprador no tiene forma de saber donde esta su paquete, y una
 * disputa de "no lo recibi" se queda sin la unica evidencia que SH-002 usa para
 * resolverla. El Service los exige igual; el schema lo dice en el borde, donde
 * la persona escribe.
 *
 * ⚠️ EL TRANSPORTISTA SALE DE `shipping_carriers` (⚙️ Config Store), asi que el
 * schema solo comprueba que haya algo: la lista cerrada la valida
 * `requireCarrier` contra la configuracion. Copiar los codigos acá seria fijar
 * en el codigo un catalogo que existe para poder cambiarse sin redeploy.
 */
const despacharSchema = ordenSchema.extend({
  carrier: z.string().trim().min(1, 'Elegí con qué transportista lo despachaste'),
  trackingNumber: z
    .string()
    .trim()
    .min(3, 'Ingresá el número de seguimiento que te dio el transportista')
    .max(64, 'Ese número de seguimiento es demasiado largo'),
});

export async function despachar(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('order-ship', user.id);

    const input = despacharSchema.parse({
      orderId: texto(formData, 'orderId'),
      carrier: texto(formData, 'carrier'),
      trackingNumber: texto(formData, 'trackingNumber'),
    });

    /*
     * ⚠️ LA PROPIEDAD DE LA ORDEN LA VERIFICA EL SERVICE, no esta accion:
     * `markShipped` resuelve el perfil POR `user.id` y compara contra
     * `order.sellerId`. Repetir la regla acá seria arriesgarse a que las dos
     * copias se separen — el mismo criterio que ya usan `publicar` y `editar`.
     */
    await markShipped(user, input.orderId, {
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
    });

    revalidatePath(`/vendedor/ventas/${input.orderId}`);
    revalidatePath('/vendedor/ventas');
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'vendedor',
      formData,
      preservar: PRESERVAR_PANEL,
    });
  }

  return { ok: 'Marcamos la venta como despachada. El comprador ya puede seguir el envío.' };
}

/**
 * SS-081 — el vendedor cancela una venta que todavia no despacho.
 *
 * ⚠️ SOLO ANTES DE DESPACHAR, y eso NO lo decide esta accion: lo decide la
 * maquina de estados (`canTransition`). Una orden ya despachada no se cancela,
 * se reclama.
 *
 * ⚠️ EL MOTIVO ES OBLIGATORIO PORQUE QUEDA EN EL HISTORIAL DE LA ORDEN Y EN
 * `audit_log`. Una cancelacion del vendedor le cuesta la compra a alguien que
 * ya pago: "sin motivo" no es una respuesta aceptable para el comprador ni para
 * quien despues tenga que resolver el reembolso.
 */
const cancelarVentaSchema = ordenSchema.extend({
  motivo: z
    .string()
    .trim()
    .min(5, 'Contá en una línea por qué la cancelás')
    .max(500, 'El motivo es demasiado largo'),
});

export async function cancelarVenta(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('order-cancel', user.id);

    const input = cancelarVentaSchema.parse({
      orderId: texto(formData, 'orderId'),
      motivo: texto(formData, 'motivo'),
    });

    await cancelBySeller(user, input.orderId, input.motivo);

    revalidatePath(`/vendedor/ventas/${input.orderId}`);
    revalidatePath('/vendedor/ventas');
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'vendedor',
      formData,
      preservar: PRESERVAR_PANEL,
    });
  }

  return {
    ok: 'Cancelamos la venta y repusimos el stock. El reembolso lo gestiona Offside.',
  };
}

/**
 * El vendedor promociona una publicacion.
 *
 * ⚠️ NO SE PUEDE CANCELAR ANTES DE TIEMPO, y la pantalla lo dice ANTES de que
 * se apriete. El motivo no es burocratico: sin eso, alguien promociona para
 * figurar primero, se lleva las visitas y cancela justo antes de vender para no
 * pagar la comision agravada. Terminarla es una accion de Admin, con motivo y
 * auditoria.
 */
export async function promocionar(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  let listingId: string;

  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('listing-promote', user.id);

    listingId = publicacionSchema.parse({ listingId: texto(formData, 'listingId') }).listingId;

    await promoteListing(user, listingId);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'vendedor', formData, preservar: PRESERVAR_PANEL });
  }

  revalidatePath('/vendedor/publicaciones');
  revalidatePath('/vendedor/promociones');

  redirect('/vendedor/promociones');
}

/* ------------------------------------------------------------- preguntas -- */

const preguntaSchema = z.object({ questionId: z.string().uuid() });

/**
 * Responder una pregunta (PS-031).
 *
 * ⚠️ LA RESPUESTA ES PUBLICA: queda en la ficha de la publicacion para todos,
 * no es un mensaje privado. La pantalla lo dice; la accion no puede hacerlo
 * cumplir de otra forma.
 *
 * ⚠️ EL LARGO MAXIMO REAL LO FIJA EL CONFIG STORE (`questions_max_length`) y lo
 * valida el Service. Acá solo se exige que no venga vacia: escribir el numero
 * en este schema seria hardcodear un valor ⚙️ que existe para poder cambiarse
 * desde Admin.
 */
const responderPreguntaSchema = preguntaSchema.extend({
  texto: z.string().trim().min(1, 'Escribí la respuesta'),
});

export async function responderPregunta(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('question-answer', user.id);

    const input = responderPreguntaSchema.parse({
      questionId: texto(formData, 'questionId'),
      texto: texto(formData, 'texto'),
    });

    await answerQuestion(user, input.questionId, input.texto);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'vendedor', formData, preservar: PRESERVAR_PANEL });
  }

  revalidatePath('/vendedor/preguntas');

  return { ok: 'Respondida. Ya se ve en la publicación.' };
}

/**
 * Ocultar una pregunta.
 *
 * ⚠️ OCULTAR NO ES RESPONDER: saca la pregunta de la ficha y de la bandeja sin
 * contestarla. Es para lo que no es una pregunta —insultos, spam—, y por eso la
 * pantalla la ofrece en segundo plano y en dos pasos.
 */
export async function ocultarPregunta(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('question-answer', user.id);

    const { questionId } = preguntaSchema.parse({ questionId: texto(formData, 'questionId') });

    await hideQuestion(user, questionId);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'vendedor', formData, preservar: PRESERVAR_PANEL });
  }

  revalidatePath('/vendedor/preguntas');

  return { ok: 'La ocultamos: ya no se ve en la publicación.' };
}

/* -------------------------------------------------------------- reseñas -- */

/**
 * Responder una reseña recibida (SS-022).
 *
 * ⚠️ SE RESPONDE UNA SOLA VEZ Y NO SE PUEDE EDITAR. Lo hace cumplir el Service
 * —`replyAlreadyExists`— con un UPDATE condicionado, asi que dos envios
 * simultaneos tampoco pisan la respuesta. La pantalla lo avisa antes.
 *
 * ⚠️ RESPONDER NO CAMBIA LA NOTA. Ni recalcula la reputacion ni emite ningun
 * hecho: la calificacion es del comprador y la respuesta es contexto.
 */
const responderReseniaSchema = z.object({
  reviewId: z.string().uuid(),
  respuesta: z
    .string()
    .trim()
    .min(1, 'Escribí tu respuesta')
    .max(REPLY_MAX_LENGTH, 'La respuesta es demasiado larga'),
});

export async function responderResenia(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('review-reply', user.id);

    const input = responderReseniaSchema.parse({
      reviewId: texto(formData, 'reviewId'),
      respuesta: texto(formData, 'respuesta'),
    });

    await replyToReview(user, input.reviewId, input.respuesta);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'vendedor', formData, preservar: PRESERVAR_PANEL });
  }

  revalidatePath('/vendedor/reputacion');

  return { ok: 'Publicamos tu respuesta.' };
}

/* -------------------------------------------------------------- reclamos -- */

/**
 * El vendedor responde un reclamo abierto en su contra.
 *
 * ⚠️ EL PLAZO CORRE Y NO RESPONDER TIENE CONSECUENCIA: pasado
 * `dispute_seller_response_days` el reclamo escala a revision de Offside con lo
 * que haya. La pantalla lo dice con la fecha exacta.
 */
const responderReclamoSchema = z.object({
  disputeId: z.string().uuid(),
  texto: z
    .string()
    .trim()
    .min(10, 'Contá qué pasó: con una línea no alcanza para resolverlo')
    .max(2_000, 'La respuesta es demasiado larga'),
});

export async function responderReclamo(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('dispute-respond', user.id);

    const input = responderReclamoSchema.parse({
      disputeId: texto(formData, 'disputeId'),
      texto: texto(formData, 'texto'),
    });

    await respondAsSeller(user, input.disputeId, input.texto);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'vendedor', formData, preservar: PRESERVAR_PANEL });
  }

  revalidatePath('/vendedor/ventas');

  return { ok: 'Mandamos tu respuesta. Offside la revisa junto con la del comprador.' };
}

/* ---------------------------------------------------------------- tienda -- */

/**
 * Datos visibles de la tienda (SS-020).
 *
 * ⚠️ `updateMySellerProfile` NO TOCA `status` NI `seller_tier_id`: el estado de
 * habilitacion y el nivel no se editan desde un formulario del vendedor. Esto
 * cambia el nombre visible, la bio y la politica de envios y nada mas.
 *
 * ⚠️ LA POLITICA DE ENVIOS ES TEXTO LIBRE Y NO UNA PROMESA DEL SISTEMA. Offside
 * no despacha ni hace seguimiento automatico: lo que se escriba acá lo cumple
 * quien vende.
 */
const tiendaSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(3, 'El nombre de tu tienda es muy corto')
    .max(80, 'El nombre de tu tienda es demasiado largo'),
  bio: z.string().trim().max(1_000, 'La descripción es demasiado larga').optional(),
  shippingPolicy: z.string().trim().max(1_000, 'El texto es demasiado largo').optional(),
});

export async function guardarTienda(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('seller-profile', user.id);

    const input = tiendaSchema.parse({
      displayName: texto(formData, 'displayName'),
      bio: texto(formData, 'bio'),
      shippingPolicy: texto(formData, 'shippingPolicy'),
    });

    /*
     * ⚠️ LAS CLAVES AUSENTES NO SE MANDAN. `updateMySellerProfile` recibe un
     * objeto parcial y el repositorio escribe lo que le llegue: pasar
     * `bio: undefined` explicito con `exactOptionalPropertyTypes` ni siquiera
     * compila, y pasar `null` borraria la bio de quien solo cambio el nombre.
     */
    await updateMySellerProfile(user.id, {
      displayName: input.displayName,
      ...(input.bio === undefined ? {} : { bio: input.bio }),
      ...(input.shippingPolicy === undefined ? {} : { shippingPolicy: input.shippingPolicy }),
    });
  } catch (error) {
    return respuestaDeError(error, { ambito: 'vendedor', formData, preservar: PRESERVAR_PANEL });
  }

  revalidatePath('/vendedor/tienda');
  revalidatePath('/vendedor');

  return { ok: 'Guardamos los datos de tu tienda.' };
}

/* ------------------------------------------------------------ vacaciones -- */

/**
 * Modo vacaciones: las publicaciones dejan de mostrarse y vuelven solas.
 *
 * ⚠️ ES UN PREDICADO DERIVADO, NO UN CAMBIO DE ESTADO DE LAS PUBLICACIONES, y
 * es la misma decision de diseño que SS-013. Si activar vacaciones las pasara a
 * `paused`, al volver seria imposible distinguir las que el vendedor habia
 * pausado a mano de las que apago el modo vacaciones, y se reactivarian
 * publicaciones que su dueño queria abajo.
 *
 * ⚠️ LA FECHA ES OBLIGATORIA Y SE MANDA COMO `date` NATIVO. Un `<input
 * type="date">` manda `YYYY-MM-DD`; se interpreta al FINAL de ese dia para que
 * "vuelvo el 20" signifique que el 20 todavia estas afuera, que es como lo lee
 * cualquiera.
 */
const vacacionesSchema = z.object({
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elegí hasta qué día'),
});

export async function activarVacaciones(
  _estado: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('seller-vacation', user.id);

    const { hasta } = vacacionesSchema.parse({ hasta: texto(formData, 'hasta') });

    // Fin del dia elegido, en la zona del servidor. `new Date('YYYY-MM-DD')`
    // pelado se interpreta como UTC medianoche, o sea el dia anterior a la
    // tarde en Argentina: el vendedor volveria un dia antes de lo que pidio.
    const [anio, mes, dia] = hasta.split('-').map(Number) as [number, number, number];
    const limite = new Date(anio, mes - 1, dia, 23, 59, 59, 999);

    if (Number.isNaN(limite.getTime())) throw new z.ZodError([]);

    await setVacation(user, limite);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'vendedor', formData, preservar: PRESERVAR_PANEL });
  }

  revalidatePath('/vendedor/vacaciones');
  revalidatePath('/vendedor');

  return { ok: 'Activamos el modo vacaciones. Tus publicaciones vuelven solas.' };
}

export async function desactivarVacaciones(
  _estado: EstadoVendedor,
  _formData: FormData,
): Promise<EstadoVendedor> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('seller-vacation', user.id);

    await setVacation(user, null);
  } catch (error) {
    // Esta accion no recibe campos: no hay nada que preservar.
    return respuestaDeError(error, { ambito: 'vendedor' });
  }

  revalidatePath('/vendedor/vacaciones');
  revalidatePath('/vendedor');

  return { ok: 'Volviste. Tus publicaciones ya se muestran de nuevo.' };
}
