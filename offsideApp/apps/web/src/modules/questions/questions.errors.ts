import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo questions (preguntas y respuestas en la ficha; delta al
 * ERD del 2026-09-10, tabla `listing_questions`).
 *
 * Reutilizan `AuthError` con los codigos existentes que traducen al HTTP
 * correcto, igual que `listings` y `favorites`: `AuthErrorCode` es cerrada y
 * vive en `auth`. Cuando incorpore `QUESTION_NOT_FOUND`, `QUESTION_LIMIT_REACHED`
 * y `FEATURE_DISABLED`, migrar es cambiar el codigo aca.
 */

/** La publicacion no existe, esta eliminada o no se ve en la vitrina. */
export const listingNotFound = (): AuthError =>
  new AuthError('LISTING_NOT_FOUND', 'Esa publicación no existe');

/**
 * La publicacion existe pero no esta a la venta (pausada, agotada, vendedor
 * sin Mercado Pago). No se pregunta sobre lo que no se puede comprar.
 */
export const listingNotAvailable = (): AuthError =>
  new AuthError('LISTING_NOT_AVAILABLE', 'Esa publicación no está a la venta en este momento');

/** `feature_questions` esta en `false` en el Config Store. */
export const questionsDisabled = (): AuthError =>
  new AuthError('FORBIDDEN', 'Las preguntas no están habilitadas por el momento');

/** Preguntar en la propia publicacion. */
export const cannotAskOwnListing = (): AuthError =>
  new AuthError('FORBIDDEN', 'No podés preguntar en tu propia publicación');

/**
 * La pregunta no existe O no es de una publicacion de quien la quiere
 * responder.
 *
 * ⚠️ UN SOLO ERROR PARA LOS DOS CASOS: distinguirlos permitiria enumerar
 * preguntas ajenas probando ids. Va como `VALIDATION_FAILED` (422): el id
 * llega de un formulario del panel del vendedor y ahi es un dato invalido.
 */
export const questionNotFound = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Esa pregunta no existe');

export const questionInvalid = (motivo: string): AuthError =>
  new AuthError('VALIDATION_FAILED', motivo);

/** Ya fue respondida u ocultada: la respuesta es una sola y no se edita. */
export const questionNotOpen = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Esa pregunta ya no está abierta');

/** Tope ⚙️ de preguntas sin responder por cuenta (`questions_max_open_per_user`). */
export const tooManyOpenQuestions = (maximo: number): AuthError =>
  new AuthError(
    'VALIDATION_FAILED',
    `Ya tenés ${maximo} preguntas sin responder. Esperá a que te contesten antes de hacer otra`,
  );

/** La configuracion de preguntas no esta cargada en `app_settings`. */
export const settingNotConfigured = (key: string): AuthError =>
  new AuthError('SETTING_NOT_CONFIGURED', `La configuración "${key}" no está cargada`);
