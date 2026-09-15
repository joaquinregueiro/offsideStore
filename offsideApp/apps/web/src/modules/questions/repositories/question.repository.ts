import { getDatabase, schema, type Database } from '@offside/database';
import { and, asc, avg, count, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

/**
 * Acceso a `listing_questions` (delta al ERD v1.3, 2026-09-10). Sin reglas
 * de negocio.
 *
 * `status` es `text` con CHECK (`open | answered | hidden`), no un enum de
 * dominio: ver el comentario de la tabla en `schema/questions.ts`.
 */

export type QuestionRow = typeof schema.listingQuestions.$inferSelect;
export type QuestionStatus = 'open' | 'answered' | 'hidden';

const conn = (db?: Database): Database => db ?? getDatabase();

/**
 * La publicacion no esta ELIMINADA.
 *
 * ⚠️ NO ES LO MISMO QUE "no se ve en la vitrina", y la diferencia importa. Una
 * publicacion PAUSADA o AGOTADA puede volver: su pregunta sigue valiendo la pena
 * responderla, porque la respuesta va a estar ahi cuando vuelva. Una ELIMINADA
 * es terminal (`listing-editing.service`: `status = 'deleted'`, sin vuelta), su
 * ficha ya no se muestra y la respuesta no la leeria nadie.
 *
 * ⚠️ SE MIRA `status`, NO `deleted_at`. Eliminar una publicacion es LOGICO y se
 * implementa moviendo el `status`; la columna `deleted_at` de `listings` hoy no
 * la escribe nadie. Filtrar por ella —lo intuitivo— no filtraria absolutamente
 * nada.
 */
const publicacionVigente = () => ne(schema.listings.status, 'deleted');

/** Lo que hace falta saber de una publicacion para preguntar sobre ella. */
export interface ListingForQuestionRow {
  id: string;
  title: string;
  sellerId: string;
  sellerUserId: string;
  status: string;
  /**
   * Si se ve en la vitrina: ERD §9.1 (`active` + `APPROVED` + stock) y el
   * vendedor operativo (SS-013).
   *
   * ⚠️ ES EL MISMO PREDICADO QUE `findPublicById` DE `listings`, EN SQL.
   * Es la duplicacion consciente que ya existe entre `isPurchasable()`, el
   * WHERE del catalogo y `favorites`: un solo lugar por modulo, y el test de
   * integracion fija que diga lo mismo (pregunta rechazada en una pausada y
   * en un vendedor desconectado).
   */
  visible: boolean;
}

export async function findListingForQuestion(
  listingId: string,
  db?: Database,
): Promise<ListingForQuestionRow | undefined> {
  const [row] = await conn(db)
    .select({
      id: schema.listings.id,
      title: schema.listings.title,
      sellerId: schema.listings.sellerId,
      sellerUserId: schema.sellerProfiles.userId,
      status: schema.listings.status,
      visible: sql<boolean>`COALESCE((
        ${schema.listings.status} = 'active'
        AND ${schema.listings.moderationStatus} = 'APPROVED'
        AND ${schema.listings.stock} >= 1
        AND ${schema.sellerProfiles.status} = 'approved'
        AND ${schema.mercadopagoAccounts.status} = 'connected'
      ), false)`,
    })
    .from(schema.listings)
    .innerJoin(schema.sellerProfiles, eq(schema.listings.sellerId, schema.sellerProfiles.id))
    .leftJoin(
      schema.mercadopagoAccounts,
      eq(schema.mercadopagoAccounts.sellerId, schema.sellerProfiles.id),
    )
    .where(and(eq(schema.listings.id, listingId), isNull(schema.listings.deletedAt)))
    .limit(1);

  return row;
}

/**
 * Valor vigente de una clave GLOBAL de `app_settings`.
 *
 * ⚠️ DUPLICA `app-setting.repository.findCurrent` DE `config`, a proposito:
 * un modulo no importa el repository de otro (`modules/README.md`) y el
 * Service de config solo expone la comision. Cuando exista
 * `settingsService.getSetting(key)`, esto se borra y se llama a eso.
 */
export async function findGlobalSetting(key: string, db?: Database): Promise<unknown> {
  const [row] = await conn(db)
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(
      and(
        eq(schema.appSettings.scope, 'global'),
        isNull(schema.appSettings.scopeId),
        eq(schema.appSettings.key, key),
      ),
    )
    .orderBy(desc(schema.appSettings.version))
    .limit(1);

  return row?.value;
}

/**
 * Cuantas preguntas SIN RESPONDER tiene abiertas una cuenta, en total.
 *
 * ⚠️ NO CUENTA LAS DE PUBLICACIONES ELIMINADAS, y es la mitad de la valvula de
 * escape del cupo. Este numero es lo unico que puede dejar a una persona sin
 * poder preguntar EN TODO EL SITIO, y quien lo baja es el vendedor —respondiendo
 * u ocultando—. Si el vendedor elimina la publicacion en vez de contestar, esa
 * pregunta se vuelve incontestable y sin este filtro seguiria ocupando el cupo
 * de quien pregunto **para siempre**, sin que ella pueda hacer nada.
 */
export async function countOpenByAskerId(askerId: string, db?: Database): Promise<number> {
  const [fila] = await conn(db)
    .select({ cantidad: count() })
    .from(schema.listingQuestions)
    .innerJoin(schema.listings, eq(schema.listingQuestions.listingId, schema.listings.id))
    .where(
      and(
        eq(schema.listingQuestions.askerId, askerId),
        eq(schema.listingQuestions.status, 'open'),
        isNull(schema.listingQuestions.deletedAt),
        publicacionVigente(),
      ),
    );

  return Number(fila?.cantidad ?? 0);
}

export async function insert(
  values: { listingId: string; askerId: string; question: string },
  db?: Database,
): Promise<QuestionRow> {
  const [row] = await conn(db)
    .insert(schema.listingQuestions)
    .values({ ...values, status: 'open' })
    .returning();

  return row!;
}

/** Una pregunta con el vendedor de su publicacion, para autorizar. */
export interface QuestionWithSellerRow extends QuestionRow {
  sellerId: string;
  sellerUserId: string;
  listingTitle: string;
}

export async function findByIdWithSeller(
  id: string,
  db?: Database,
): Promise<QuestionWithSellerRow | undefined> {
  const [row] = await conn(db)
    .select({
      pregunta: schema.listingQuestions,
      sellerId: schema.listings.sellerId,
      sellerUserId: schema.sellerProfiles.userId,
      listingTitle: schema.listings.title,
    })
    .from(schema.listingQuestions)
    .innerJoin(schema.listings, eq(schema.listingQuestions.listingId, schema.listings.id))
    .innerJoin(schema.sellerProfiles, eq(schema.listings.sellerId, schema.sellerProfiles.id))
    .where(and(eq(schema.listingQuestions.id, id), isNull(schema.listingQuestions.deletedAt)))
    .limit(1);

  if (row === undefined) return undefined;

  return {
    ...row.pregunta,
    sellerId: row.sellerId,
    sellerUserId: row.sellerUserId,
    listingTitle: row.listingTitle,
  };
}

/**
 * Responde una pregunta. CONDICIONADO a `status = 'open'`: dos respuestas
 * simultaneas no pueden pisarse; la segunda ve `undefined`.
 */
export async function answer(
  id: string,
  values: { answer: string; answeredBy: string },
  db?: Database,
): Promise<QuestionRow | undefined> {
  const [row] = await conn(db)
    .update(schema.listingQuestions)
    .set({
      answer: values.answer,
      answeredBy: values.answeredBy,
      answeredAt: new Date(),
      status: 'answered',
    })
    .where(and(eq(schema.listingQuestions.id, id), eq(schema.listingQuestions.status, 'open')))
    .returning();

  return row;
}

/** Oculta una pregunta (abierta o respondida). Sigue en la tabla como evidencia. */
export async function hide(id: string, db?: Database): Promise<QuestionRow | undefined> {
  const [row] = await conn(db)
    .update(schema.listingQuestions)
    .set({ status: 'hidden' })
    .where(
      and(
        eq(schema.listingQuestions.id, id),
        inArray(schema.listingQuestions.status, ['open', 'answered']),
      ),
    )
    .returning();

  return row;
}

/**
 * Retira una pregunta: la esconde a pedido de QUIEN LA HIZO.
 *
 * ⚠️ EL `asker_id` VA EN EL WHERE, no se comprueba antes en el Service. Es la
 * misma razon por la que `answer` condiciona a `status = 'open'`: una
 * autorizacion que viaja en el WHERE no puede perderse entre la lectura y la
 * escritura. Aca ademas es gratis, porque hay indice por `asker_id`.
 *
 * ⚠️ SOLO `open`. Una vez respondida, la respuesta del vendedor ya es publica y
 * puede haber sido leida: retirarla seria borrar lo que dijo otra persona. Para
 * eso esta `hide`, que es del dueño de la publicacion.
 */
export async function withdraw(
  id: string,
  askerId: string,
  db?: Database,
): Promise<QuestionRow | undefined> {
  const [row] = await conn(db)
    .update(schema.listingQuestions)
    .set({ status: 'hidden' })
    .where(
      and(
        eq(schema.listingQuestions.id, id),
        eq(schema.listingQuestions.askerId, askerId),
        eq(schema.listingQuestions.status, 'open'),
        isNull(schema.listingQuestions.deletedAt),
      ),
    )
    .returning();

  return row;
}

/**
 * Preguntas visibles en la ficha: abiertas y respondidas, mas nueva primero.
 *
 * ⚠️ EL `ORDER BY` NO ES COSMETICO: responder hace un UPDATE y sin orden
 * explicito PostgreSQL reordena las filas.
 */
export async function findPublicByListingId(
  listingId: string,
  db?: Database,
): Promise<QuestionRow[]> {
  return conn(db)
    .select()
    .from(schema.listingQuestions)
    .where(
      and(
        eq(schema.listingQuestions.listingId, listingId),
        inArray(schema.listingQuestions.status, ['open', 'answered']),
        isNull(schema.listingQuestions.deletedAt),
      ),
    )
    .orderBy(desc(schema.listingQuestions.createdAt), desc(schema.listingQuestions.id));
}

/** Una pregunta con el titulo de su publicacion, para las bandejas. */
export interface QuestionWithListingRow extends QuestionRow {
  listingTitle: string;
}

/**
 * Preguntas sin responder sobre las publicaciones de un vendedor, la mas
 * vieja primero: es una cola de trabajo y se atiende en orden de llegada.
 *
 * ⚠️ NO ENTRAN LAS DE PUBLICACIONES ELIMINADAS. Sin este filtro la bandeja
 * mostraba —y el numerito del cajon contaba— preguntas cuya ficha ya no existe:
 * responderlas no las lee nadie, ocultarlas es trabajo por nada, y el contador
 * NUNCA volvia a cero. Una cola de trabajo que no se puede vaciar deja de
 * leerse, y con ella se pierden las preguntas que si importan.
 *
 * ⚠️ LAS PAUSADAS SI ENTRAN: esa publicacion puede volver y la respuesta va a
 * estar ahi cuando vuelva.
 */
export async function findPendingBySellerId(
  sellerId: string,
  db?: Database,
): Promise<QuestionWithListingRow[]> {
  const filas = await conn(db)
    .select({ pregunta: schema.listingQuestions, listingTitle: schema.listings.title })
    .from(schema.listingQuestions)
    .innerJoin(schema.listings, eq(schema.listingQuestions.listingId, schema.listings.id))
    .where(
      and(
        eq(schema.listings.sellerId, sellerId),
        eq(schema.listingQuestions.status, 'open'),
        isNull(schema.listingQuestions.deletedAt),
        publicacionVigente(),
      ),
    )
    .orderBy(asc(schema.listingQuestions.createdAt), asc(schema.listingQuestions.id));

  return filas.map((fila) => ({ ...fila.pregunta, listingTitle: fila.listingTitle }));
}

/**
 * El numerito del cajon. ⚠️ MISMO PREDICADO QUE `findPendingBySellerId`: si
 * contara distinto, el cajon diria "3 pendientes" y la bandeja mostraria dos.
 */
export async function countPendingBySellerId(sellerId: string, db?: Database): Promise<number> {
  const [fila] = await conn(db)
    .select({ cantidad: count() })
    .from(schema.listingQuestions)
    .innerJoin(schema.listings, eq(schema.listingQuestions.listingId, schema.listings.id))
    .where(
      and(
        eq(schema.listings.sellerId, sellerId),
        eq(schema.listingQuestions.status, 'open'),
        isNull(schema.listingQuestions.deletedAt),
        publicacionVigente(),
      ),
    );

  return Number(fila?.cantidad ?? 0);
}

/** "Mis preguntas" de quien pregunta, mas nueva primero. Incluye las ocultas. */
export async function findByAskerId(
  askerId: string,
  db?: Database,
): Promise<QuestionWithListingRow[]> {
  const filas = await conn(db)
    .select({ pregunta: schema.listingQuestions, listingTitle: schema.listings.title })
    .from(schema.listingQuestions)
    .innerJoin(schema.listings, eq(schema.listingQuestions.listingId, schema.listings.id))
    .where(
      and(eq(schema.listingQuestions.askerId, askerId), isNull(schema.listingQuestions.deletedAt)),
    )
    .orderBy(desc(schema.listingQuestions.createdAt), desc(schema.listingQuestions.id));

  return filas.map((fila) => ({ ...fila.pregunta, listingTitle: fila.listingTitle }));
}

/**
 * Horas promedio que tarda un vendedor en responder, sobre TODAS sus
 * respondidas. `null` si nunca respondio.
 *
 * Se calcula en la base con `AVG(EXTRACT(EPOCH ...))`: traer las filas para
 * promediar en memoria crece con el historial y esto se muestra en cada
 * ficha.
 */
export async function averageAnswerHours(sellerId: string, db?: Database): Promise<number | null> {
  const [fila] = await conn(db)
    .select({
      horas: avg(
        sql`EXTRACT(EPOCH FROM (${schema.listingQuestions.answeredAt} - ${schema.listingQuestions.createdAt})) / 3600`,
      ),
    })
    .from(schema.listingQuestions)
    .innerJoin(schema.listings, eq(schema.listingQuestions.listingId, schema.listings.id))
    .where(
      and(
        eq(schema.listings.sellerId, sellerId),
        eq(schema.listingQuestions.status, 'answered'),
        isNull(schema.listingQuestions.deletedAt),
      ),
    );

  if (fila?.horas === null || fila?.horas === undefined) return null;

  return Number(fila.horas);
}
