import { getDatabase } from '@offside/database';

import type { PublicUser } from '../../auth/services/auth.service';
import {
  getQuestionSettings,
  getSetting,
  isFeatureEnabled,
} from '../../config/services/setting-store.service';
import * as audit from '../../audit/services/audit.service';
import * as inapp from '../../notifications/services/inapp-notification.service';
import * as orderEmails from '../../notifications/services/order-emails.service';
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
 * pendientes de confirmacion). Se leen en cada llamada, POR EL SERVICE DE
 * `config` —no por un lector propio—, asi que pasan por el registro y su
 * validacion como cualquier otra clave del sistema.
 *
 * ⚠️ AUTORIZACION: responder y ocultar resuelven el perfil del vendedor POR
 * `user.id` con el mismo helper que el resto del sistema y comparan contra
 * el `seller_id` de la publicacion. "No existe" y "no es tuya" devuelven el
 * MISMO error.
 */

/**
 * Tamaños de pagina.
 *
 * ⚠️ NO SON ⚙️ CONFIGURABLES, y es deliberado: cuantas preguntas entran en una
 * pantalla es una decision de presentacion, no una regla de negocio. Lo que si
 * es ⚙️ —cuantas puede tener abiertas una cuenta— ya vive en el Config Store.
 *
 * ⚠️ LA FICHA LLEVA MENOS QUE LAS BANDEJAS. Es la pantalla que se comparte por
 * WhatsApp y la que mas pesa: ahi las preguntas son contexto para decidir una
 * compra, no una lista para recorrer. Las bandejas SI son listas de trabajo.
 */
export const PREGUNTAS_POR_PAGINA_FICHA = 10;
export const PREGUNTAS_POR_PAGINA = 20;

/** Una pagina de preguntas: lo que la pantalla necesita para dibujar el pie. */
export interface PaginaDePreguntas<T> {
  preguntas: T[];
  total: number;
  pagina: number;
  porPagina: number;
}

/** Pagina valida: entero >= 1. Cualquier otra cosa es la primera. */
export function normalizarPagina(pagina: number | undefined): number {
  if (pagina === undefined || !Number.isInteger(pagina) || pagina < 1) return 1;

  return pagina;
}

const ventana = (pagina: number, porPagina: number) => ({
  limite: porPagina,
  offset: (pagina - 1) * porPagina,
});

/**
 * Las claves ⚙️ de este modulo, para quien necesite nombrarlas (los tests).
 *
 * ⚠️ EL SERVICE YA NO LAS LEE A MANO. Hasta hoy `questions` tenia su PROPIO
 * lector de `app_settings` —un `findGlobalSetting` en su repositorio— que
 * consultaba solo el ambito global y salteaba el registro, la precedencia de
 * ambitos y la validacion del Config Store. Era deuda anotada en el codigo
 * ("cuando exista `settingsService.getSetting(key)`, esto se borra y se llama a
 * eso"): existe, y esto es ese borrado. Dos lectores del mismo valor terminan
 * dando dos respuestas distintas.
 */
export const FEATURE_KEY = 'feature_questions';
export const MAX_LENGTH_KEY = 'questions_max_length';
export const MAX_OPEN_KEY = 'questions_max_open_per_user';

/** `payload.kind` del aviso in-app que recibe quien pregunto. */
export /** Clave del payload: la pantalla de avisos decide con esto a donde lleva. */
const QUESTION_ASKED_KIND = 'question_asked';

const QUESTION_ANSWERED_KIND = 'question_answered';

/** El vendedor oculto una pregunta: se le avisa a quien la hizo. */
const QUESTION_HIDDEN_KIND = 'question_hidden';

/** `entity_type` de este modulo en `audit_log`. */
const ENTITY_TYPE = 'listing_question';

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

async function exigirHabilitado(): Promise<void> {
  if (!(await isFeatureEnabled('questions'))) throw errors.questionsDisabled();
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
 * AVISA AL VENDEDOR POR DOS CANALES: la campanita (en la misma transaccion que
 * la fila) y un email (despues de commitear). Los dos, porque cumplen cosas
 * distintas: la campanita ordena el trabajo de quien ya esta adentro; el email
 * es lo unico que alcanza a quien no entro.
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

  const ajustes = await getQuestionSettings();

  const question = validateQuestionText(texto, ajustes.maxLength, 'La pregunta');

  const maximoAbiertas = ajustes.maxOpenPerUser;
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

  /*
   * ⚠️ EL EMAIL VA DESPUES DE COMMITEAR, FUERA DE LA TRANSACCION. Mandar "te
   * preguntaron" por una fila que todavia puede revertirse es peor que tardar
   * un segundo mas —un email no se puede deshacer—. Es la misma regla que
   * siguen todos los emails de orden.
   *
   * ⚠️ NO PUEDE VOLTEAR LA PREGUNTA. `preguntaRecibida` ya atrapa sus propios
   * fallos y devuelve `null`, pero el `catch` queda igual: la pregunta YA esta
   * publicada y el aviso in-app YA se escribio; que la cola de emails este
   * caida no puede convertir eso en un error en la cara de quien pregunto.
   *
   * ⚠️ POR QUE EXISTE: la campanita no alcanza. Un vendedor que no entra al
   * sitio no se enteraba, y el TIEMPO DE RESPUESTA es una de las metricas que
   * su reputacion publica muestra —se lo medía por algo que no tenia forma de
   * saber—.
   */
  try {
    await orderEmails.preguntaRecibida(
      { email: listing.sellerEmail, nombre: listing.sellerDisplayName },
      { publicacion: listing.title, texto: question },
    );
  } catch (error) {
    console.error(
      '[questions] no se pudo encolar el email de pregunta:',
      error instanceof Error ? error.message : String(error),
    );
  }

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

  const answer = validateQuestionText(
    texto,
    await getSetting('questions_max_length'),
    'La respuesta',
  );

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
 *
 * ⚠️ SE AUDITA, Y NO ES BUROCRACIA: BR-052 (MUST) exige que todo hecho
 * sancionable quede registrado. Ocultar es la unica accion del sitio con la que
 * una parte hace desaparecer lo que escribio la otra, y hasta hoy no dejaba
 * NINGUN rastro —ni quien, ni cuando, ni sobre que—. Para spam esta bien; para
 * una pregunta incomoda ("¿es original?") era una herramienta de silenciar sin
 * registro, y sin el log no hay forma de notar el patron.
 *
 * ⚠️ SE LE AVISA A QUIEN PREGUNTO. Su pregunta desaparecia de la ficha en
 * silencio y solo se enteraba si volvia a "Mis preguntas". El aviso no dice que
 * hizo mal —no hay motivo cargado y no se va a inventar uno—: dice que ya no se
 * ve y que puede volver a preguntar, que es lo unico accionable.
 *
 * ⚠️ LAS TRES ESCRITURAS VAN EN LA MISMA TRANSACCION. Una auditoria que se
 * escribe cuando el UPDATE se revierte miente sobre lo que paso, y un aviso sin
 * su hecho anuncia algo que no ocurrio.
 *
 * ⚠️ EL TEXTO DE LA PREGUNTA NO ENTRA AL `audit_log`. Alcanza con su id: quien
 * investigue la tiene en la tabla, y copiarla ademas al log la duplica en un
 * lugar que nadie depura.
 */
export async function hideQuestion(user: PublicUser, questionId: string): Promise<void> {
  const question = await requireOwnQuestion(user, questionId);
  if (question.status === 'hidden') return;

  await getDatabase().transaction(async (tx) => {
    const oculta = await questionRepo.hide(question.id, tx);
    /*
     * Si otro camino la oculto entre la lectura y el UPDATE, no hay hecho nuevo
     * que auditar ni que avisar: se sale sin escribir nada, igual que arriba.
     */
    if (oculta === undefined) return;

    await audit.record(
      {
        actorType: 'user',
        actorId: user.id,
        action: 'QUESTION_HIDDEN',
        entityType: ENTITY_TYPE,
        entityId: question.id,
        before: { status: question.status },
        after: { status: 'hidden' },
        metadata: { listingId: question.listingId },
      },
      tx,
    );

    await inapp.notify(
      question.askerId,
      'system',
      'Tu pregunta ya no se ve',
      `El vendedor ocultó tu pregunta sobre ${question.listingTitle}. Podés volver a preguntar.`,
      { kind: QUESTION_HIDDEN_KIND, listingId: question.listingId, questionId: question.id },
      tx,
    );
  });
}

/**
 * Retira una pregunta propia: deja de verse en la ficha y libera el cupo.
 *
 * ⚠️ ES LA VALVULA DE ESCAPE DEL CUPO, no una comodidad. `questions_max_open_per_user`
 * puede dejar a una persona sin poder preguntar EN TODO EL SITIO, y hasta ahora
 * el unico que podia bajar ese numero era el vendedor —respondiendo u
 * ocultando—: quien preguntaba quedaba esperando algo que tal vez nunca pasa,
 * sin ninguna accion disponible. El schema de `listing_questions` ya decia que
 * `hidden` la pone "quien pregunto, el vendedor o moderacion"; de los tres,
 * solo el vendedor tenia codigo.
 *
 * ⚠️ SOLO MIENTRAS ESTA SIN RESPONDER. Con respuesta, el texto del vendedor ya
 * es publico y pudo haberlo leido cualquiera: retirarlo seria darle a quien
 * pregunta un boton para borrar lo que dijo otro. Y una pregunta incomoda ya
 * respondida es justamente la que mas le sirve al proximo comprador.
 *
 * ⚠️ NO AVISA AL VENDEDOR. Si estaba por responderla, la va a encontrar fuera de
 * la bandeja; una notificacion por cada arrepentimiento es ruido en la unica
 * campanita que tambien trae las ventas.
 *
 * ⚠️ NO BORRA LA FILA: la pregunta queda como evidencia de lo que se hablo antes
 * de una compra, igual que al ocultarla el vendedor.
 */
export async function withdrawQuestion(user: PublicUser, questionId: string): Promise<void> {
  await getDatabase().transaction(async (tx) => {
    const retirada = await questionRepo.withdraw(questionId, user.id, tx);

    /*
     * ⚠️ UN SOLO ERROR PARA LOS TRES CASOS —no existe, no es tuya, ya no esta
     * abierta—. Distinguirlos dejaria probar ids ajenos para averiguar cuales
     * existen, que es lo mismo que evita `questionNotFound` en el lado del
     * vendedor.
     */
    if (retirada === undefined) throw errors.questionNotFound();

    /*
     * ⚠️ TAMBIEN SE AUDITA, aunque la haga su propio autor. Las dos acciones
     * dejan la fila en `hidden` y la fila NO guarda cual de las dos fue: sin
     * este registro, una pregunta oculta es indistinguible de una retirada, y
     * la diferencia es justamente la que importa —una la borro el vendedor, la
     * otra la persona que pregunto—.
     */
    await audit.record(
      {
        actorType: 'user',
        actorId: user.id,
        action: 'QUESTION_WITHDRAWN',
        entityType: ENTITY_TYPE,
        entityId: retirada.id,
        before: { status: 'open' },
        after: { status: 'hidden' },
        metadata: { listingId: retirada.listingId },
      },
      tx,
    );
  });
}

/**
 * Preguntas visibles en la ficha (abiertas y respondidas). No exige sesion.
 *
 * ⚠️ PAGINA, Y EL TECHO NO ES COSMETICO. Quien controla cuantas preguntas tiene
 * una publicacion NO es quien la publico: cualquiera con sesion puede dejar las
 * suyas. Sin limite, una ficha con cientos de preguntas las traia todas de la
 * base y las imprimia todas en el HTML de la pantalla mas compartida del sitio.
 */
export async function listPublicQuestions(
  listingId: string,
  pagina?: number,
): Promise<PaginaDePreguntas<PublicQuestion>> {
  const actual = normalizarPagina(pagina);

  const [rows, total] = await Promise.all([
    questionRepo.findPublicByListingId(listingId, ventana(actual, PREGUNTAS_POR_PAGINA_FICHA)),
    questionRepo.countPublicByListingId(listingId),
  ]);

  return {
    preguntas: rows.map(toPublicQuestion),
    total,
    pagina: actual,
    porPagina: PREGUNTAS_POR_PAGINA_FICHA,
  };
}

/** Cola de preguntas sin responder del vendedor autenticado, la mas vieja primero. */
export async function listPendingForSeller(
  user: PublicUser,
  pagina?: number,
): Promise<PaginaDePreguntas<QuestionWithListing>> {
  const seller = await requireOwnSellerProfile(user);
  const actual = normalizarPagina(pagina);

  const [rows, total] = await Promise.all([
    questionRepo.findPendingBySellerId(seller.id, ventana(actual, PREGUNTAS_POR_PAGINA)),
    questionRepo.countPendingBySellerId(seller.id),
  ]);

  return {
    preguntas: rows.map(conListing),
    total,
    pagina: actual,
    porPagina: PREGUNTAS_POR_PAGINA,
  };
}

/**
 * Las que el vendedor YA respondio.
 *
 * ⚠️ EXISTE PORQUE LA BANDEJA SOLO TENIA PENDIENTES. Para ver que habia
 * contestado —y con que palabras, que es lo que importa cuando un comprador
 * vuelve a preguntar lo mismo— habia que entrar publicacion por publicacion.
 *
 * ⚠️ NO REEMPLAZA A LA COLA NI SE MEZCLA CON ELLA. Son dos cosas distintas: una
 * es trabajo por hacer y la otra es historia. Mezclarlas convertiria la bandeja
 * en un archivo, que es justamente lo que el comentario original evitaba.
 */
export async function listAnsweredForSeller(
  user: PublicUser,
  pagina?: number,
): Promise<PaginaDePreguntas<QuestionWithListing>> {
  const seller = await requireOwnSellerProfile(user);
  const actual = normalizarPagina(pagina);

  const [rows, total] = await Promise.all([
    questionRepo.findAnsweredBySellerId(seller.id, ventana(actual, PREGUNTAS_POR_PAGINA)),
    questionRepo.countAnsweredBySellerId(seller.id),
  ]);

  return {
    preguntas: rows.map(conListing),
    total,
    pagina: actual,
    porPagina: PREGUNTAS_POR_PAGINA,
  };
}

/** Cuantas sin responder. Para el numerito del panel. */
export async function countPendingForSeller(user: PublicUser): Promise<number> {
  const seller = await requireOwnSellerProfile(user);

  return questionRepo.countPendingBySellerId(seller.id);
}

/** Las preguntas que hizo el usuario autenticado, mas nueva primero. */
export async function listMyQuestions(
  user: PublicUser,
  pagina?: number,
): Promise<PaginaDePreguntas<QuestionWithListing>> {
  const actual = normalizarPagina(pagina);

  const [rows, total] = await Promise.all([
    questionRepo.findByAskerId(user.id, ventana(actual, PREGUNTAS_POR_PAGINA)),
    questionRepo.countByAskerId(user.id),
  ]);

  return {
    preguntas: rows.map(conListing),
    total,
    pagina: actual,
    porPagina: PREGUNTAS_POR_PAGINA,
  };
}

/**
 * Dias de la ventana sobre la que se mide como responde un vendedor.
 *
 * ⚠️ HAY VENTANA, Y ANTES NO HABIA. Una respuesta de hace un año pesaba igual
 * que la de ayer, asi que un vendedor que fue bueno y dejo de serlo seguia
 * mostrando el numero viejo en la pantalla donde alguien decide comprarle.
 *
 * ⚠️ 90 Y NO 30: con poco volumen —y este marketplace es nuevo— una sola
 * pregunta mueve el porcentaje entero. Con 30 dias, dos preguntas y una sin
 * responder dan 50%.
 *
 * ⚠️ NO ES ⚙️ CONFIGURABLE. Cambiarlo cambia lo que un numero PUBLICO significa
 * sobre una persona; que se pueda mover desde Admin sin dejar rastro es peor
 * que tenerlo fijo. Si alguna vez tiene que moverse, es una decision de
 * producto con su registro.
 */
export const VENTANA_DE_RESPUESTA_DIAS = 90;

export interface AnswerStats {
  /** Proporcion respondida, 0..1. */
  tasa: number;
  /** Horas promedio de las respondidas. `null` si no respondio ninguna. */
  horas: number | null;
  /** Preguntas que entraron en la cuenta. */
  total: number;
}

/**
 * Como responde un vendedor, para la ficha y la tienda.
 *
 * `null` cuando NO LE PREGUNTARON NADA en la ventana: ahi no hay nada que
 * decir, y "responde el 0%" sobre alguien a quien nadie pregunto seria una
 * acusacion inventada. Distinto es no responder lo que SI le preguntaron, que
 * es justamente lo que esto vino a hacer visible.
 */
export async function answerStats(sellerId: string): Promise<AnswerStats | null> {
  const desde = new Date(Date.now() - VENTANA_DE_RESPUESTA_DIAS * 24 * 60 * 60 * 1000);
  const fila = await questionRepo.answerStatsBySellerId(sellerId, desde);

  if (fila.total === 0) return null;

  return {
    tasa: fila.respondidas / fila.total,
    // Redondeado a una decimal; menos que eso es ruido.
    horas: fila.horas === null ? null : Math.round(fila.horas * 10) / 10,
    total: fila.total,
  };
}

/**
 * La frase que ve el comprador, armada UNA sola vez.
 *
 * ⚠️ VIVE ACA Y NO EN CADA PANTALLA. La ficha y la tienda muestran el mismo
 * dato; con dos redacciones, el dia que cambie la regla —o el umbral— una de
 * las dos queda vieja y nadie se entera. Es la misma razon por la que las seis
 * secciones del cajon se definen una vez.
 *
 * ⚠️ CON POCAS PREGUNTAS NO SE PUBLICA UN PORCENTAJE. Con dos preguntas y una
 * sin responder, "responde el 50%" suena a veredicto y es una moneda al aire.
 * Debajo del minimo se dice el tiempo, si respondio alguna, y nada mas.
 *
 * ⚠️ NO SE REDONDEA HACIA ARRIBA. `Math.floor`: prometer 90% cuando es 89,6%
 * es inflar, sobre la reputacion de otra persona, en la pantalla donde alguien
 * decide transferir plata.
 */
export const MINIMO_PARA_LA_TASA = 5;

/**
 * El tiempo de respuesta con SU PROPIO marcador de aproximacion.
 *
 * ⚠️ EL `~` LO DECIDE ESTE LUGAR Y NO QUIEN LO IMPRIME. Las pantallas escribian
 * `~{horas(...)}` a mano, y cuando el promedio cae por debajo de una hora el
 * formateador devuelve "menos de 1 h": el resultado era "en ~menos de 1 h". Una
 * aproximacion sobre otra. Con la regla acá, las dos pantallas dicen lo mismo y
 * no hay forma de que una quede vieja.
 */
export function tiempoDeRespuesta(
  horas: number,
  formatearHoras: (horas: number) => string,
): string {
  const formateado = formatearHoras(horas);

  return horas < 1 ? formateado : `~${formateado}`;
}

export function frecuenciaDeRespuesta(
  stats: AnswerStats | null,
  formatearHoras: (horas: number) => string,
): string | null {
  if (stats === null) return null;

  const tiempo =
    stats.horas === null ? null : `en ${tiempoDeRespuesta(stats.horas, formatearHoras)}`;

  if (stats.total < MINIMO_PARA_LA_TASA) {
    return tiempo === null ? null : `responde preguntas ${tiempo}`;
  }

  const porcentaje = Math.floor(stats.tasa * 100);
  const cuantas = `responde el ${porcentaje}% de las preguntas`;

  return tiempo === null ? cuantas : `${cuantas}, ${tiempo}`;
}
