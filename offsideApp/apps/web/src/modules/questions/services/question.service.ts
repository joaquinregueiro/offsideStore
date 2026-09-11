import { getDatabase } from '@offside/database';

import type { PublicUser } from '../../auth/services/auth.service';
import { parseSettingValue } from '../../config/services/settings-registry';
import * as inapp from '../../notifications/services/inapp-notification.service';
import { requireOwnSellerProfile } from '../../sellers/services/seller.service';
import * as errors from '../questions.errors';
import { detectarContacto, mensajeDeContacto } from './contacto-fuera-de-offside';
import * as questionRepo from '../repositories/question.repository';

/**
 * Preguntas y respuestas en la ficha de una publicacion.
 *
 * Modelo de PREGUNTA CON UNA RESPUESTA, como la ficha de Mercado Libre: no es
 * un hilo ni un chat (BR-053 deja la mensajeria in-app 🟡). El comprador
 * pregunta, el dueño de la publicacion responde una vez, y la respuesta es
 * publica.
 *
 * ⚠️ TRES PARAMETROS SALEN DEL CONFIG STORE Y NINGUNO DE UNA CONSTANTE:
 * `feature_questions` (apagar todo desde Admin), `questions_max_length` y
 * `questions_max_open_per_user` (migracion `0011`, valores ASUMIDOS y
 * pendientes de confirmacion). Se leen en cada llamada.
 *
 * ⚠️ AUTORIZACION: responder y ocultar resuelven el perfil del vendedor POR
 * `user.id` con el mismo helper que el resto del sistema y comparan contra
 * el `seller_id` de la publicacion. "No existe" y "no es tuya" devuelven el
 * MISMO error.
 */

export const FEATURE_KEY = 'feature_questions';
export const MAX_LENGTH_KEY = 'questions_max_length';
export const MAX_OPEN_KEY = 'questions_max_open_per_user';

/** `payload.kind` del aviso in-app que recibe quien pregunto. */
export /** Clave del payload: la pantalla de avisos decide con esto a donde lleva. */
const QUESTION_ASKED_KIND = 'question_asked';

const QUESTION_ANSWERED_KIND = 'question_answered';

/** Una pregunta tal como se ve en la ficha. NUNCA identifica a quien pregunto. */
export interface PublicQuestion {
  id: string;
  listingId: string;
  question: string;
  answer: string | null;
  status: questionRepo.QuestionStatus;
  createdAt: string;
  answeredAt: string | null;
}

/** Una pregunta en una bandeja (del vendedor o de quien pregunto). */
export interface QuestionWithListing extends PublicQuestion {
  listingTitle: string;
}

export function toPublicQuestion(row: questionRepo.QuestionRow): PublicQuestion {
  return {
    id: row.id,
    listingId: row.listingId,
    question: row.question,
    answer: row.answer,
    status: row.status as questionRepo.QuestionStatus,
    createdAt: row.createdAt.toISOString(),
    answeredAt: row.answeredAt?.toISOString() ?? null,
  };
}

function conListing(row: questionRepo.QuestionWithListingRow): QuestionWithListing {
  return { ...toPublicQuestion(row), listingTitle: row.listingTitle };
}

/**
 * Normaliza y valida el texto de una pregunta o una respuesta.
 *
 * FUNCION PURA: recibe el maximo en vez de leerlo, para poder testearla sin
 * base. Colapsa espacios repetidos y saltos de linea multiples porque el
 * texto se muestra en una ficha, no en un editor.
 */
export function validateQuestionText(texto: string, maxLength: number, que: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();

  if (limpio === '') throw errors.questionInvalid(`${que} no puede estar vacía`);
  if (limpio.length > maxLength) {
    throw errors.questionInvalid(`${que} no puede superar los ${maxLength} caracteres`);
  }

  /*
   * ⚠️ SE CHEQUEA EN LAS DOS PUNTAS, pregunta Y respuesta, y no solo en la
   * pregunta. El vendedor es quien mas motivo tiene para escribir "pasame tu
   * WhatsApp y te lo dejo sin comision": sacar la venta de Offside le ahorra la
   * comision a el y le saca al comprador el pago por Mercado Pago, el reclamo y
   * el reembolso. Chequear un solo lado seria dejar abierta justo la puerta
   * grande.
   */
  const contacto = detectarContacto(limpio);
  if (contacto.hay) throw errors.questionInvalid(mensajeDeContacto(contacto));

  return limpio;
}

async function leerSetting<
  K extends 'feature_questions' | 'questions_max_length' | 'questions_max_open_per_user',
>(key: K) {
  const crudo = await questionRepo.findGlobalSetting(key);
  if (crudo === undefined) throw errors.settingNotConfigured(key);

  return parseSettingValue(key, crudo);
}

async function exigirHabilitado(): Promise<void> {
  if (!(await leerSetting(FEATURE_KEY))) throw errors.questionsDisabled();
}

/**
 * Pregunta sobre una publicacion.
 *
 * Reglas, en orden del mas barato al mas caro:
 *  - la funcionalidad esta encendida (⚙️);
 *  - la publicacion existe y SE VE en la vitrina (misma regla que la ficha:
 *    una pausada o de un vendedor desconectado no admite preguntas, porque
 *    no se puede comprar);
 *  - no es del propio vendedor;
 *  - el texto entra en `questions_max_length`;
 *  - la cuenta no supera `questions_max_open_per_user` sin responder.
 *
 * ⚠️ NO AVISA AL VENDEDOR POR AHORA: su panel tiene `countPendingForSeller`.
 * Un aviso in-app por pregunta es un `notify` mas si se pide.
 */
export async function askQuestion(
  user: PublicUser,
  listingId: string,
  texto: string,
): Promise<PublicQuestion> {
  await exigirHabilitado();

  const listing = await questionRepo.findListingForQuestion(listingId);
  if (listing === undefined || listing.status === 'deleted') throw errors.listingNotFound();
  if (!listing.visible) throw errors.listingNotAvailable();
  if (listing.sellerUserId === user.id) throw errors.cannotAskOwnListing();

  const question = validateQuestionText(texto, await leerSetting(MAX_LENGTH_KEY), 'La pregunta');

  const maximoAbiertas = await leerSetting(MAX_OPEN_KEY);
  if ((await questionRepo.countOpenByAskerId(user.id)) >= maximoAbiertas) {
    throw errors.tooManyOpenQuestions(maximoAbiertas);
  }

  const row = await getDatabase().transaction(async (tx) => {
    const creada = await questionRepo.insert(
      { listingId: listing.id, askerId: user.id, question },
      tx,
    );

    /*
     * ⚠️ EL AVISO AL VENDEDOR FALTABA, Y ERA EL AGUJERO DEL FLUJO. La respuesta
     * si avisaba a quien pregunto, pero la pregunta no avisaba a quien tiene
     * que contestarla: el vendedor solo se enteraba si entraba por su cuenta a
     * la bandeja. O sea que la funcionalidad existia y en la practica no
     * funcionaba —las preguntas se quedaban sin responder hasta que alguien se
     * acordaba de mirar—, y el tiempo de respuesta es una de las metricas que
     * su reputacion publica muestra.
     *
     * ⚠️ VA EN LA MISMA TRANSACCION QUE LA FILA, igual que la respuesta: una
     * pregunta escrita sin aviso es una pregunta que nadie ve.
     *
     * ⚠️ `notification_type` ES UN ENUM CERRADO y no tiene 'question': va como
     * 'system' con el detalle en el payload, igual que la respuesta.
     */
    await inapp.notify(
      listing.sellerUserId,
      'system',
      `Te preguntaron: ${listing.title}`,
      question,
      { kind: QUESTION_ASKED_KIND, listingId: listing.id, questionId: creada.id },
      tx,
    );

    return creada;
  });

  return toPublicQuestion(row);
}

/** La pregunta, si es de una publicacion del vendedor autenticado. */
async function requireOwnQuestion(
  user: PublicUser,
  questionId: string,
): Promise<questionRepo.QuestionWithSellerRow> {
  const seller = await requireOwnSellerProfile(user);
  const question = await questionRepo.findByIdWithSeller(questionId);

  if (question?.sellerId !== seller.id) throw errors.questionNotFound();

  return question;
}

/**
 * Responde una pregunta (solo el dueño de la publicacion) y avisa in-app a
 * quien pregunto.
 *
 * LA RESPUESTA Y EL AVISO VAN EN LA MISMA TRANSACCION: si la escritura se
 * revierte, no queda una campanita anunciando una respuesta que no existe.
 * El aviso es `type = 'system'` con `payload.kind = 'question_answered'`
 * porque `notification_type` es un enum cerrado sin valor para preguntas.
 *
 * La respuesta es UNA y no se edita: el UPDATE va condicionado a `open` y
 * la segunda respuesta ve `QUESTION_NOT_OPEN`. Se puede responder aunque la
 * funcionalidad este apagada: apagarla frena preguntas nuevas, no deja a la
 * gente sin respuesta.
 */
export async function answerQuestion(
  user: PublicUser,
  questionId: string,
  texto: string,
): Promise<PublicQuestion> {
  const question = await requireOwnQuestion(user, questionId);
  if (question.status !== 'open') throw errors.questionNotOpen();

  const answer = validateQuestionText(texto, await leerSetting(MAX_LENGTH_KEY), 'La respuesta');

  const row = await getDatabase().transaction(async (tx) => {
    const respondida = await questionRepo.answer(question.id, { answer, answeredBy: user.id }, tx);
    if (respondida === undefined) throw errors.questionNotOpen();

    await inapp.notify(
      question.askerId,
      'system',
      `Te respondieron: ${question.listingTitle}`,
      answer,
      { kind: QUESTION_ANSWERED_KIND, listingId: question.listingId, questionId: question.id },
      tx,
    );

    return respondida;
  });

  return toPublicQuestion(row);
}

/**
 * Oculta una pregunta de la ficha (solo el dueño de la publicacion). Sirve
 * para spam o datos personales; la fila queda como evidencia.
 */
export async function hideQuestion(user: PublicUser, questionId: string): Promise<void> {
  const question = await requireOwnQuestion(user, questionId);
  if (question.status === 'hidden') return;

  await questionRepo.hide(question.id);
}

/** Preguntas visibles en la ficha (abiertas y respondidas). No exige sesion. */
export async function listPublicQuestions(listingId: string): Promise<PublicQuestion[]> {
  const rows = await questionRepo.findPublicByListingId(listingId);

  return rows.map(toPublicQuestion);
}

/** Cola de preguntas sin responder del vendedor autenticado, la mas vieja primero. */
export async function listPendingForSeller(user: PublicUser): Promise<QuestionWithListing[]> {
  const seller = await requireOwnSellerProfile(user);
  const rows = await questionRepo.findPendingBySellerId(seller.id);

  return rows.map(conListing);
}

/** Cuantas sin responder. Para el numerito del panel. */
export async function countPendingForSeller(user: PublicUser): Promise<number> {
  const seller = await requireOwnSellerProfile(user);

  return questionRepo.countPendingBySellerId(seller.id);
}

/** Las preguntas que hizo el usuario autenticado, mas nueva primero. */
export async function listMyQuestions(user: PublicUser): Promise<QuestionWithListing[]> {
  const rows = await questionRepo.findByAskerId(user.id);

  return rows.map(conListing);
}

/**
 * Horas promedio que tarda el vendedor en responder, para "responde en ~X h"
 * en la ficha. `null` si nunca respondio: no se muestra nada, no se inventa
 * un numero. Redondeado a una decimal; menos que eso es ruido.
 */
export async function averageAnswerHours(sellerId: string): Promise<number | null> {
  const horas = await questionRepo.averageAnswerHours(sellerId);
  if (horas === null) return null;

  return Math.round(horas * 10) / 10;
}
