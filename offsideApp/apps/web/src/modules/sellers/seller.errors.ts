import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo sellers.
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 */

import type { SyntaxValidationError } from './services/fiscal-identity.service';

/** Mensajes accionables: le dicen al vendedor QUE revisar. */
const MESSAGES: Record<SyntaxValidationError, string> = {
<<<<<<< HEAD
  EMPTY: 'Ingresá tu número de identificación fiscal',
  INVALID_CHARACTERS: 'El número sólo puede tener dígitos, guiones o puntos',
  INVALID_LENGTH: 'El número tiene que tener 11 dígitos',
  INVALID_CHECK_DIGIT: 'Ese número no es válido. Revisá que lo hayas copiado bien',
};

export const sellerProfileNotFound = (): AuthError =>
  new AuthError('FORBIDDEN', 'Primero tenés que crear tu perfil de vendedor');

export const taxProfileNotFound = (): AuthError =>
  new AuthError('INVALID_TOKEN', 'Todavía no cargaste tu identificación fiscal');
=======
  EMPTY: 'Ingresa tu numero de identificacion fiscal',
  INVALID_CHARACTERS: 'El numero solo puede contener digitos, guiones o puntos',
  INVALID_LENGTH: 'El numero debe tener 11 digitos',
  INVALID_CHECK_DIGIT: 'El numero no es valido. Revisa que lo hayas copiado bien',
};

export const sellerProfileNotFound = (): AuthError =>
  new AuthError('FORBIDDEN', 'Primero tenes que crear tu perfil de vendedor');

export const taxProfileNotFound = (): AuthError =>
  new AuthError('INVALID_TOKEN', 'Todavia no cargaste tus datos fiscales');
>>>>>>> origin/main

/**
 * Identificador sintacticamente invalido.
 *
 * ⚠️ El mensaje NUNCA incluye el numero ingresado: es un dato fiscal y no debe
 * viajar en mensajes de error ni terminar en logs.
 */
export const invalidTaxId = (reason: SyntaxValidationError): AuthError =>
  new AuthError('VALIDATION_FAILED', MESSAGES[reason]);

export const fiscalSourceUnavailable = (): AuthError =>
<<<<<<< HEAD
  new AuthError('FISCAL_SOURCE_UNAVAILABLE', 'La verificación fiscal todavía no está disponible');
=======
  new AuthError('FISCAL_SOURCE_UNAVAILABLE', 'La verificacion fiscal todavia no esta disponible');
>>>>>>> origin/main

/* -------------------------------------------------------------------------- */
/* Conexion con Mercado Pago (mercadopago-oauth-spec.md §13)                   */
/* -------------------------------------------------------------------------- */

/**
 * El vendedor todavia no esta aprobado (spec §4, paso 5).
 *
 * ⚠️ Hoy le pasa a TODOS los vendedores: la aprobacion depende de TS-001, que
 * sigue 🟡 PENDIENTE. El mensaje lo dice sin prometer plazos.
 */
export const sellerNotApproved = (): AuthError =>
  new AuthError(
    'MP_SELLER_NOT_APPROVED',
<<<<<<< HEAD
    'Tu cuenta de vendedor todavía no está aprobada. Vas a poder conectar Mercado Pago cuando lo esté',
  );

export const mercadoPagoAlreadyConnected = (): AuthError =>
  new AuthError('MP_ALREADY_CONNECTED', 'Ya tenés una cuenta de Mercado Pago conectada');

export const mercadoPagoNotConnected = (): AuthError =>
  new AuthError('MP_NOT_CONNECTED', 'No tenés ninguna cuenta de Mercado Pago conectada');
=======
    'Tu cuenta de vendedor todavia no esta aprobada. Vas a poder conectar Mercado Pago cuando lo este',
  );

export const mercadoPagoAlreadyConnected = (): AuthError =>
  new AuthError('MP_ALREADY_CONNECTED', 'Ya tenes una cuenta de Mercado Pago conectada');

export const mercadoPagoNotConnected = (): AuthError =>
  new AuthError('MP_NOT_CONNECTED', 'No tenes ninguna cuenta de Mercado Pago conectada');
>>>>>>> origin/main

/**
 * `state` invalido, vencido, ya usado o perteneciente a otra sesion.
 *
 * ⚠️ Mensaje DELIBERADAMENTE unico para los cuatro casos: distinguirlos le
 * diria a un atacante si un `state` existio alguna vez (spec §15).
 */
export const mercadoPagoInvalidState = (): AuthError =>
  new AuthError(
    'MP_INVALID_STATE',
<<<<<<< HEAD
    'La solicitud de conexión no sirve o ya venció. Volvé a intentarlo desde Offside',
=======
    'La solicitud de conexion no es valida o expiro. Volve a intentarlo desde Offside',
>>>>>>> origin/main
  );

export const mercadoPagoExchangeFailed = (): AuthError =>
  new AuthError(
    'MP_EXCHANGE_FAILED',
<<<<<<< HEAD
    'No se pudo completar la conexión con Mercado Pago. Volvé a intentarlo',
=======
    'No se pudo completar la conexion con Mercado Pago. Volve a intentarlo',
>>>>>>> origin/main
  );

/**
 * La cuenta de Mercado Pago ya pertenece a otro vendedor (caso D, spec §9).
 *
 * ⚠️ El mensaje JAMAS dice "esa cuenta pertenece a otro vendedor": eso
 * permitiria descubrir que cuentas de Mercado Pago estan registradas en Offside
 * (spec §14).
 */
export const mercadoPagoAccountConflict = (): AuthError =>
  new AuthError(
    'MP_ACCOUNT_CONFLICT',
<<<<<<< HEAD
    'No se pudo vincular esa cuenta de Mercado Pago. Revisá con qué cuenta iniciaste sesión',
=======
    'No se pudo vincular esa cuenta de Mercado Pago. Revisa con que cuenta iniciaste sesion',
>>>>>>> origin/main
  );

/** No se pudo guardar el contexto del flujo OAuth. */
export const mercadoPagoStateNotStored = (): AuthError =>
  new AuthError(
    'MP_CONNECTION_UNAVAILABLE',
<<<<<<< HEAD
    'No se pudo iniciar la conexión con Mercado Pago. Volvé a intentarlo en unos minutos',
=======
    'No se pudo iniciar la conexion con Mercado Pago. Volve a intentarlo en unos minutos',
>>>>>>> origin/main
  );
