import {
  findShippingCarrier,
  getShippingCarriers,
  trackingUrlFor,
} from '../../config/services/setting-store.service';
import type { ShippingCarrier } from '../../config/services/settings-registry';
import * as errors from '../shipments.errors';

/**
 * Catalogo de transportistas para el despacho MANUAL (SH-010 sin Correo
 * Argentino: el vendedor despacha por su cuenta y declara con quien).
 *
 * =============================================================================
 * ⚠️ ESTE ARCHIVO ERA CINCO DUPLICACIONES DEL MODULO `config`
 * =============================================================================
 *
 * Tenia su propio lector de `app_settings`, su propio schema de validacion, su
 * propia lista por defecto, su propia constante `{tracking}` y su propia
 * `trackingUrlFor`. `config` ya tenia las cinco, y las suyas son las buenas:
 *
 *  - la validacion vive en el REGISTRO, asi que es la misma que se aplica
 *    cuando un administrador guarda la lista desde el back-office —antes eran
 *    dos schemas parecidos y NO IGUALES: el de aca aceptaba un `code` que
 *    empieza con digito y un `name` de hasta 64, el registro exige empezar con
 *    letra y admite 80—;
 *  - la lista por defecto estaba COPIADA palabra por palabra en los dos
 *    lugares, que es la forma mas silenciosa de que un dia dejen de coincidir;
 *  - su `trackingUrlFor` usa `replaceAll` y recorta el numero, contra el
 *    `replace` de aca que reemplazaba SOLO EL PRIMER `{tracking}` de la
 *    plantilla.
 *
 * Lo que queda es lo unico que es de ESTE modulo: traducir "no esta en la
 * lista" al error de dominio de `shipments`.
 *
 * ⚠️ `trackingUrlFor` SE RE-EXPORTA en vez de que los consumidores importen de
 * `config`: `manual-shipment.service` y la pantalla de una venta piden "la URL
 * de seguimiento de este envio", no "una utilidad del Config Store". El dia que
 * el seguimiento lo resuelva el adaptador de Correo Argentino, cambia acá.
 */

/** El transportista tal como lo valida el registro del Config Store. */
export type Carrier = ShippingCarrier;

export { trackingUrlFor };

/** Los transportistas ofrecidos hoy. Para el formulario de despacho. */
export async function getCarriers(): Promise<Carrier[]> {
  return getShippingCarriers();
}

/**
 * El transportista por su codigo, o `VALIDATION_FAILED` si no esta en la lista.
 *
 * ⚠️ ES LA UNICA RAZON POR LA QUE ESTE ARCHIVO SIGUE EXISTIENDO. `config`
 * devuelve `undefined` —no sabe nada de despachos—; que un codigo desconocido
 * sea un error de VALIDACION del vendedor es una regla de `shipments`.
 */
export async function requireCarrier(code: string): Promise<Carrier> {
  const carrier = await findShippingCarrier(code);
  if (carrier === undefined) throw errors.carrierUnknown();

  return carrier;
}
