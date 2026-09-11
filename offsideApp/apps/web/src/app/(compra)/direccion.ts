import { z } from 'zod';

import { exigirLimitePorUsuario } from '@/lib/rate-limit-actions';
import type { PublicUser } from '@/modules/auth/services/auth.service';
import {
  createAddress,
  getAddress,
  PROVINCIAS,
  toShippingSnapshot,
  type ShippingAddressSnapshot,
} from '@/modules/addresses/services/address.service';

/**
 * La direccion de envio de una compra, resuelta desde el formulario.
 *
 * ⚠️ NO ES UN `'use server'`. En un modulo de acciones TODO lo exportado queda
 * expuesto como endpoint; esto son helpers compartidos entre `/comprar` y el
 * checkout del carrito, y exponerlos crearia dos puertas mas sin dueño.
 *
 * ⚠️ LA DIRECCION SE COPIA A LA ORDEN, NO SE REFERENCIA (ERD §6.1 / §20.2):
 * `orders.shipping_address` es un snapshot jsonb. Editar o borrar la direccion
 * despues NO puede cambiar a donde se despacho una orden ya creada.
 */

/**
 * Los campos que se devuelven al formulario cuando algo falla.
 *
 * ⚠️ SON TODOS, Y ESO ES EL ARREGLO. Un codigo postal de tres cifras borraba
 * las lineas de direccion tipeadas en un telefono, justo despues de decidir
 * comprar.
 */
export const CAMPOS_DE_DIRECCION = [
  'direccionId',
  'cantidad',
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

/** Los codigos ISO de las 24 jurisdicciones, para el `<select>` y para el schema. */
const CODIGOS = PROVINCIAS.map((provincia) => provincia.codigo);

/**
 * Codigo postal argentino: 4 cifras o CPA de 8 caracteres.
 *
 * ⚠️ SE VALIDA ACA ADEMAS DE EN EL SERVICE, y no es duplicacion ociosa:
 * `validateAddressInput` lanza un `AuthError` con un mensaje suelto, asi que la
 * pantalla no podria marcar CUAL de los campos esta mal. Zod da el error por
 * campo; el Service sigue siendo el que manda y vuelve a validar todo.
 */
const CODIGO_POSTAL = /^(\d{4}|[A-Z]\d{4}[A-Z]{3})$/;

export const direccionNuevaSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, 'Poné a nombre de quién va el envío')
    .max(120, 'El nombre es demasiado largo'),
  calle: z.string().trim().min(2, 'Ingresá la calle').max(200, 'La calle es demasiado larga'),
  numero: z.string().trim().max(20, 'El número es demasiado largo').optional(),
  departamento: z.string().trim().max(50, 'El piso/depto es demasiado largo').optional(),
  ciudad: z
    .string()
    .trim()
    .min(2, 'Ingresá la localidad')
    .max(120, 'La localidad es demasiado larga'),
  provincia: z
    .string()
    .trim()
    .refine((valor) => CODIGOS.includes(valor as (typeof CODIGOS)[number]), {
      message: 'Elegí una provincia de la lista',
    }),
  codigoPostal: z
    .string()
    .trim()
    .transform((valor) => valor.replace(/\s+/g, '').toUpperCase())
    .refine((valor) => CODIGO_POSTAL.test(valor), {
      message: 'Son 4 cifras (1425) o el CPA de 8 caracteres (C1425ABC)',
    }),
  telefono: z
    .string()
    .trim()
    .refine((valor) => /^\+?[\d\s().-]{8,25}$/.test(valor), {
      message: 'Dejá un teléfono de 8 a 15 cifras',
    }),
  etiqueta: z.string().trim().max(40, 'La etiqueta es demasiado larga').optional(),
});

export type DireccionNueva = z.infer<typeof direccionNuevaSchema>;

/** Lee un campo de texto. Vacio se trata como ausente: el navegador manda `''`. */
export function texto(formData: FormData, nombre: string): string | undefined {
  const valor = formData.get(nombre);

  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}

/** El nombre completo de la jurisdiccion, que es lo que se guarda (ERD §6.1). */
function nombreDeProvincia(codigo: string): string {
  return PROVINCIAS.find((provincia) => provincia.codigo === codigo)?.nombre ?? codigo;
}

/**
 * Si el formulario trae una direccion tipeada.
 *
 * ⚠️ ES LO QUE EVITA UN RADIO "USAR OTRA" QUE HAY QUE ACORDARSE DE TOCAR. Los
 * campos viven adentro de un `<details>`; si alguien los completo, esa
 * direccion GANA sobre la elegida arriba. Sin esto, completar el formulario
 * entero y no tocar el radio despachaba a la direccion vieja —al lugar
 * equivocado— sin ningun aviso.
 */
function hayDireccionTipeada(formData: FormData): boolean {
  return (
    texto(formData, 'nombre') !== undefined ||
    texto(formData, 'calle') !== undefined ||
    texto(formData, 'ciudad') !== undefined ||
    texto(formData, 'codigoPostal') !== undefined
  );
}

/**
 * La direccion de envio que le corresponde a esta compra.
 *
 * Tres caminos, en este orden:
 *  1. Campos completados → se valida y, si se pidio, se guarda en la libreta.
 *  2. `direccionId` de la libreta → se lee del usuario autenticado.
 *  3. Ninguno → error, porque sin direccion no hay envio.
 *
 * ⚠️ `getAddress` FILTRA POR `user.id`: una direccion ajena no existe para esta
 * sesion, asi que un POST directo con el uuid de otra persona no despacha nada.
 */
export async function resolverDireccion(
  user: PublicUser,
  formData: FormData,
): Promise<ShippingAddressSnapshot> {
  if (hayDireccionTipeada(formData)) {
    const datos = direccionNuevaSchema.parse({
      nombre: texto(formData, 'nombre'),
      calle: texto(formData, 'calle'),
      numero: texto(formData, 'numero'),
      departamento: texto(formData, 'departamento'),
      ciudad: texto(formData, 'ciudad'),
      provincia: texto(formData, 'provincia'),
      codigoPostal: texto(formData, 'codigoPostal'),
      telefono: texto(formData, 'telefono'),
      etiqueta: texto(formData, 'etiqueta'),
    });

    // Guardarla es OPCIONAL y consume su propio cupo: escribe una fila.
    if (texto(formData, 'guardarDireccion') !== undefined) {
      await exigirLimitePorUsuario('address-write', user.id);

      const guardada = await createAddress(user, {
        nombre: datos.nombre,
        calle: datos.calle,
        ciudad: datos.ciudad,
        provincia: datos.provincia,
        codigoPostal: datos.codigoPostal,
        telefono: datos.telefono,
        ...(datos.numero === undefined ? {} : { numero: datos.numero }),
        ...(datos.departamento === undefined ? {} : { departamento: datos.departamento }),
        ...(datos.etiqueta === undefined ? {} : { etiqueta: datos.etiqueta }),
      });

      return toShippingSnapshot(guardada);
    }

    return {
      nombre: datos.nombre,
      calle: datos.calle,
      numero: datos.numero ?? null,
      departamento: datos.departamento ?? null,
      ciudad: datos.ciudad,
      provincia: nombreDeProvincia(datos.provincia),
      codigoPostal: datos.codigoPostal,
      telefono: datos.telefono,
      etiqueta: datos.etiqueta ?? null,
    };
  }

  const direccionId = texto(formData, 'direccionId');
  if (direccionId !== undefined && direccionId !== 'nueva') {
    const guardada = await getAddress(
      user,
      z.string().uuid('Elegí una dirección de envío').parse(direccionId),
    );

    return toShippingSnapshot(guardada);
  }

  /*
   * ⚠️ EL ERROR SE EMITE COMO UN ISSUE DE ZOD SOBRE `nombre`, y no como un
   * `Error` suelto: asi el formulario lo muestra PEGADO al primer campo que hay
   * que completar en vez de arriba de todo, que es donde nadie lo relaciona con
   * los ocho controles de abajo.
   */
  throw new z.ZodError([
    {
      code: 'custom',
      path: ['nombre'],
      message: 'Elegí una dirección guardada o completá una nueva',
      input: undefined,
    },
  ]);
}
