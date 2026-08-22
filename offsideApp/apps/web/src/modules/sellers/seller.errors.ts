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
  EMPTY: 'Ingresa tu numero de identificacion fiscal',
  INVALID_CHARACTERS: 'El numero solo puede contener digitos, guiones o puntos',
  INVALID_LENGTH: 'El numero debe tener 11 digitos',
  INVALID_CHECK_DIGIT: 'El numero no es valido. Revisa que lo hayas copiado bien',
};

export const sellerProfileNotFound = (): AuthError =>
  new AuthError('FORBIDDEN', 'Primero tenes que crear tu perfil de vendedor');

export const taxProfileNotFound = (): AuthError =>
  new AuthError('INVALID_TOKEN', 'Todavia no cargaste tus datos fiscales');

/**
 * Identificador sintacticamente invalido.
 *
 * ⚠️ El mensaje NUNCA incluye el numero ingresado: es un dato fiscal y no debe
 * viajar en mensajes de error ni terminar en logs.
 */
export const invalidTaxId = (reason: SyntaxValidationError): AuthError =>
  new AuthError('VALIDATION_FAILED', MESSAGES[reason]);

export const fiscalSourceUnavailable = (): AuthError =>
  new AuthError('FISCAL_SOURCE_UNAVAILABLE', 'La verificacion fiscal todavia no esta disponible');
