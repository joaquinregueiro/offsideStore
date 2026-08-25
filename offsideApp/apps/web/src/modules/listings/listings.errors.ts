import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo listings.
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 */

export const invalidCategory = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'La categoria no existe o no esta activa');

/**
 * Faltan los atributos obligatorios de camiseta.
 *
 * El ERD §9.1 marca `kit_type` y `sleeve` como obligatorios para la categoria
 * `camiseta` y aclara que **se valida en la app, no con un CHECK**. Esto es esa
 * validacion; no es una regla nueva.
 */
export const missingShirtAttributes = (): AuthError =>
  new AuthError(
    'VALIDATION_FAILED',
    'Para una camiseta hay que indicar el tipo de kit (kitType) y la manga (sleeve)',
  );

/**
 * El vendedor no puede operar: sin aprobar o sin Mercado Pago conectado.
 *
 * ⚠️ Mensaje generico a proposito, igual que en `orders`.
 */
export const sellerNotOperational = (): AuthError =>
  new AuthError('SELLER_NOT_OPERATIONAL', 'Todavia no podes publicar: tu cuenta no esta operativa');
