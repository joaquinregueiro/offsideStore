import { randomBytes } from 'node:crypto';

import { getDatabase, schema } from '@offside/database';
import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type * as AuthService from '../auth/services/auth.service';
import type { PublicUser } from '../auth/services/auth.service';
import type * as InappService from '../notifications/services/inapp-notification.service';
import type * as ListingEditingService from '../listings/services/listing-editing.service';
import type * as ListingService from '../listings/services/listing.service';
import type * as QuestionService from './services/question.service';
import type * as SellerService from '../sellers/services/seller.service';

/**
 * PREGUNTAS Y RESPUESTAS — integracion contra PostgreSQL REAL.
 * Requiere `docker compose up -d`.
 *
 * ⚠️ ESTE ARCHIVO NO EXISTIA Y EL CODIGO AFIRMABA QUE SI. El comentario de
 * `findListingForQuestion` decia, palabra por palabra, que "el test de
 * integracion fija que diga lo mismo (pregunta rechazada en una pausada y en un
 * vendedor desconectado)". No habia ningun test del modulo: lo unico cubierto
 * era el detector de contacto, que es una funcion pura. O sea que TODA la
 * autorizacion de preguntas y respuestas estaba sin red, y ademas documentada
 * como si la tuviera —que es peor que no tenerla, porque nadie la va a buscar—.
 *
 * Lo que se fija aca es, en orden de gravedad:
 *
 *  1. QUIEN PUEDE QUE: responder y ocultar son del dueño de la publicacion;
 *     retirar es de quien pregunto. Un id ajeno no alcanza.
 *  2. EL PREDICADO DE VISIBILIDAD: no se pregunta lo que no se puede comprar, y
 *     es el mismo que usa la vitrina —la duplicacion consciente que el codigo
 *     asume y nadie verificaba—.
 *  3. LA RESPUESTA ES UNA SOLA: el UPDATE condicionado a `open` gana la carrera.
 *  4. EL CUPO Y SU VALVULA DE ESCAPE.
 *  5. EL ANONIMATO de quien pregunta.
 *
 * Limpia todo lo que crea: sufijo `@qstest.offside`.
 */

const SUFIJO = '@qstest.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';

let authService: typeof AuthService;
let sellerService: typeof SellerService;
let listingService: typeof ListingService;
let listingEditing: typeof ListingEditingService;
let questionService: typeof QuestionService;
let inapp: typeof InappService;
let encryptToken: (plaintext: string) => string;
let closeRedis: () => Promise<void>;
let secuencia = 0;

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');

  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  loadRootEnv(import.meta.dirname);
  resetEnvCache();

  authService = await import('../auth/services/auth.service');
  sellerService = await import('../sellers/services/seller.service');
  listingService = await import('../listings/services/listing.service');
  listingEditing = await import('../listings/services/listing-editing.service');
  questionService = await import('./services/question.service');
  inapp = await import('../notifications/services/inapp-notification.service');

  const cipher = await import('../sellers/infrastructure/mercadopago/token-cipher');
  cipher.resetTokenCipherCache();
  encryptToken = cipher.encryptToken;

  ({ closeRedisConnections: closeRedis } = await import('@offside/jobs'));

  await limpiar();
});

afterAll(async () => {
  await limpiar();

  const { closeDatabase } = await import('@offside/database');
  await closeDatabase();
  await closeRedis();
});

async function limpiar(): Promise<void> {
  const db = getDatabase();
  const usuarios = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(like(schema.users.email, `%${SUFIJO}`));
  if (usuarios.length === 0) return;
  const ids = usuarios.map((u) => u.id);

  await db.delete(schema.listingQuestions).where(inArray(schema.listingQuestions.askerId, ids));

  const perfiles = await db
    .select({ id: schema.sellerProfiles.id })
    .from(schema.sellerProfiles)
    .where(inArray(schema.sellerProfiles.userId, ids));

  if (perfiles.length > 0) {
    const sellerIds = perfiles.map((p) => p.id);
    const publicaciones = await db
      .select({ id: schema.listings.id })
      .from(schema.listings)
      .where(inArray(schema.listings.sellerId, sellerIds));

    if (publicaciones.length > 0) {
      const listingIds = publicaciones.map((l) => l.id);
      // Las preguntas de OTROS sobre estas publicaciones: la FK es RESTRICT.
      await db
        .delete(schema.listingQuestions)
        .where(inArray(schema.listingQuestions.listingId, listingIds));
      await db
        .delete(schema.listingImages)
        .where(inArray(schema.listingImages.listingId, listingIds));
      await db.delete(schema.listings).where(inArray(schema.listings.id, listingIds));
    }

    await db
      .delete(schema.mercadopagoAccounts)
      .where(inArray(schema.mercadopagoAccounts.sellerId, sellerIds));
  }

  await db.delete(schema.notifications).where(inArray(schema.notifications.userId, ids));
  await db.delete(schema.auditLog).where(inArray(schema.auditLog.actorId, ids));
  await db.delete(schema.sellerProfiles).where(inArray(schema.sellerProfiles.userId, ids));
  await db.delete(schema.userHistoryEvents).where(inArray(schema.userHistoryEvents.userId, ids));
  await db.delete(schema.sessions).where(inArray(schema.sessions.userId, ids));
  await db
    .delete(schema.emailVerificationTokens)
    .where(inArray(schema.emailVerificationTokens.userId, ids));
  await db.delete(schema.users).where(inArray(schema.users.id, ids));
}

async function usuario(nombre: string): Promise<PublicUser> {
  const { emailVerificationToken } = await authService.register({
    email: email(nombre),
    password: PASSWORD,
    acceptedTerms: true,
  });

  return authService.verifyEmail(emailVerificationToken);
}

/**
 * Vendedor aprobado y con Mercado Pago conectado.
 *
 * La aprobacion y la conexion se escriben directo: TS-001 no tiene flujo y el
 * OAuth tiene sus propios tests. Es el mismo helper que `listings`.
 */
async function vendedor(
  nombre: string,
  opciones: { conectado?: boolean } = {},
): Promise<{ user: PublicUser; sellerId: string }> {
  const db = getDatabase();
  secuencia += 1;

  const user = await usuario(`${nombre}-seller`);
  const perfil = await sellerService.createSellerProfile(user, {
    displayName: `Tienda ${nombre}`,
    acceptedSellerTerms: true,
  });

  await db
    .update(schema.sellerProfiles)
    .set({ status: 'approved', approvedAt: new Date() })
    .where(eq(schema.sellerProfiles.id, perfil.id));

  if (opciones.conectado !== false) {
    await db.insert(schema.mercadopagoAccounts).values({
      sellerId: perfil.id,
      mpUserId: `4000000${secuencia}`,
      accessTokenEncrypted: encryptToken('valor-que-simula-un-access-token'),
      status: 'connected',
      connectedAt: new Date(),
    });
  }

  return { user, sellerId: perfil.id };
}

/** Se LEE la categoria que carga la migracion `0004`; `code` es UNIQUE. */
async function categoriaCamiseta(): Promise<string> {
  const [fila] = await getDatabase()
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.code, 'camiseta'))
    .limit(1);

  if (!fila) throw new Error("Falta la categoria 'camiseta'. Corre las migraciones (0004).");

  return fila.id;
}

/**
 * Publicacion activa y comprable.
 *
 * ⚠️ LA FOTO NO ES DECORACION: PS-010 exige una imagen, asi que sin ella la
 * publicacion se queda en borrador —y una en borrador no admite preguntas, que
 * es justamente una de las cosas que este archivo fija—.
 */
async function publicacionActiva(seller: PublicUser, titulo = 'Camiseta Boca 2001 titular') {
  const listing = await listingService.publishListing(seller, {
    categoryId: await categoriaCamiseta(),
    title: titulo,
    description: 'Original de epoca',
    priceAmount: BigInt('5000000'),
    stock: 3,
    sizeValue: 'L',
    condition: 'EXCELENTE',
    kitType: 'home',
    sleeve: 'short',
  });

  await getDatabase()
    .insert(schema.listingImages)
    .values({
      listingId: listing.id,
      storageKey: `listings/${listing.id}/test-large.webp`,
      url: null,
      variants: { large: `listings/${listing.id}/test-large.webp` },
      position: 0,
      hash: 'hash-de-prueba',
    });

  await getDatabase()
    .update(schema.listings)
    .set({ status: 'active' })
    .where(eq(schema.listings.id, listing.id));

  return listing;
}

/** Fija el valor global de una clave y devuelve como dejarla como estaba. */
async function conSetting(key: string, valor: unknown): Promise<() => Promise<void>> {
  const db = getDatabase();
  const donde = and(
    eq(schema.appSettings.scope, 'global'),
    isNull(schema.appSettings.scopeId),
    eq(schema.appSettings.key, key),
  );

  const [previa] = await db.select().from(schema.appSettings).where(donde).limit(1);
  if (previa === undefined) throw new Error(`Falta el setting global '${key}' (migracion 0011).`);

  await db.update(schema.appSettings).set({ value: valor }).where(donde);

  return async () => {
    await db.update(schema.appSettings).set({ value: previa.value }).where(donde);
  };
}

/* -------------------------------------------------------------------------- */

describe('preguntar', () => {
  it('publica la pregunta y le avisa al vendedor en la misma transaccion', async () => {
    const { user: seller } = await vendedor('avisa');
    const comprador = await usuario('avisa-buyer');
    const listing = await publicacionActiva(seller);

    const pregunta = await questionService.askQuestion(comprador, listing.id, '¿Es original?');

    expect(pregunta.status).toBe('open');
    expect(pregunta.answer).toBeNull();

    // El aviso al vendedor es lo que hace que la funcionalidad exista: sin el,
    // solo se entera si entra por su cuenta a la bandeja.
    const avisos = await inapp.listNotifications(seller);
    expect(avisos.notificaciones[0]?.title).toContain(listing.title);
  });

  it('⚠️ NO IDENTIFICA A QUIEN PREGUNTO en la vista publica', async () => {
    // En un marketplace la lista de quien pregunto por una camiseta es la lista
    // de quien la esta por comprar. El tipo publico directamente no lo trae.
    const { user: seller } = await vendedor('anon');
    const comprador = await usuario('anon-buyer');
    const listing = await publicacionActiva(seller);

    await questionService.askQuestion(comprador, listing.id, '¿Hace envios al interior?');

    const { preguntas } = await questionService.listPublicQuestions(listing.id);
    const [publica] = preguntas;

    expect(publica).toBeDefined();
    expect(JSON.stringify(publica)).not.toContain(comprador.id);
    expect(Object.keys(publica!)).not.toContain('askerId');
  });

  it('⚠️ rechaza en una publicacion PAUSADA (mismo predicado que la vitrina)', async () => {
    // Este es el caso que el comentario de `findListingForQuestion` afirmaba
    // tener cubierto. No se pregunta sobre lo que no se puede comprar: la
    // pregunta quedaria en una ficha que nadie ve.
    const { user: seller } = await vendedor('pausada');
    const comprador = await usuario('pausada-buyer');
    const listing = await publicacionActiva(seller);

    await listingEditing.pauseListing(seller, listing.id);

    await expect(questionService.askQuestion(comprador, listing.id, '¿Sigue?')).rejects.toThrow(
      /no está a la venta/i,
    );
  });

  it('⚠️ rechaza si el vendedor DESCONECTO Mercado Pago (SS-013)', async () => {
    // La otra mitad del predicado. La publicacion sigue `active`: lo que la saca
    // de la vitrina es que su vendedor no puede cobrar.
    const { user: seller, sellerId } = await vendedor('desconectado');
    const comprador = await usuario('desconectado-buyer');
    const listing = await publicacionActiva(seller);

    await getDatabase()
      .update(schema.mercadopagoAccounts)
      .set({ status: 'disconnected' })
      .where(eq(schema.mercadopagoAccounts.sellerId, sellerId));

    await expect(questionService.askQuestion(comprador, listing.id, '¿Sigue?')).rejects.toThrow(
      /no está a la venta/i,
    );

    // Y la publicacion NO se toco: el predicado es derivado (SS-013).
    const [fila] = await getDatabase()
      .select({ status: schema.listings.status })
      .from(schema.listings)
      .where(eq(schema.listings.id, listing.id));
    expect(fila?.status).toBe('active');
  });

  it('rechaza preguntar en la propia publicacion', async () => {
    const { user: seller } = await vendedor('propia');
    const listing = await publicacionActiva(seller);

    await expect(questionService.askQuestion(seller, listing.id, '¿Hola?')).rejects.toThrow(
      /tu propia publicación/i,
    );
  });

  it('⚠️ frena los datos de contacto ANTES de publicarlos', async () => {
    // La pregunta es publica: un telefono escrito ahi queda expuesto a
    // cualquiera. Y sacar la venta de Offside deja al comprador sin pago
    // registrado, sin reclamo y sin reembolso.
    const { user: seller } = await vendedor('contacto');
    const comprador = await usuario('contacto-buyer');
    const listing = await publicacionActiva(seller);

    await expect(
      questionService.askQuestion(comprador, listing.id, 'Escribime al 1155667788 y lo cerramos'),
    ).rejects.toThrow(/teléfono/i);

    // No quedo ninguna fila: se rechaza en el borde, no se guarda para moderar.
    expect((await questionService.listPublicQuestions(listing.id)).total).toBe(0);
  });

  it('NO confunde un año ni un precio con un telefono', async () => {
    // Un falso positivo rompe una venta honesta; el umbral de digitos esta
    // elegido para eso (8 y no 6).
    const { user: seller } = await vendedor('falsopos');
    const comprador = await usuario('falsopos-buyer');
    const listing = await publicacionActiva(seller);

    const pregunta = await questionService.askQuestion(
      comprador,
      listing.id,
      '¿Es la de 1996? ¿La dejas en 150000 y mide 56 cm de ancho?',
    );

    expect(pregunta.status).toBe('open');
  });

  it('no deja preguntar con la funcionalidad apagada (feature_questions ⚙️)', async () => {
    const restaurar = await conSetting(questionService.FEATURE_KEY, false);

    try {
      const { user: seller } = await vendedor('apagada');
      const comprador = await usuario('apagada-buyer');
      const listing = await publicacionActiva(seller);

      await expect(questionService.askQuestion(comprador, listing.id, '¿Hola?')).rejects.toThrow(
        /no están habilitadas/i,
      );
    } finally {
      await restaurar();
    }
  });
});

describe('responder', () => {
  it('⚠️ SOLO EL DUEÑO de la publicacion, y el ajeno recibe el mismo error que si no existiera', async () => {
    const { user: seller } = await vendedor('duenio');
    const { user: otro } = await vendedor('intruso');
    const comprador = await usuario('duenio-buyer');
    const listing = await publicacionActiva(seller);

    const pregunta = await questionService.askQuestion(comprador, listing.id, '¿Talle real?');

    // Un vendedor ajeno no puede responder preguntas de otro. Y el mensaje es
    // el mismo que para un id inexistente: distinguirlos dejaria enumerar
    // preguntas ajenas probando ids.
    await expect(
      questionService.answerQuestion(otro, pregunta.id, 'Si, talle real'),
    ).rejects.toThrow(/no existe/i);

    // Quien compra tampoco, aunque sea SU pregunta.
    await expect(
      questionService.answerQuestion(comprador, pregunta.id, 'Me contesto solo'),
    ).rejects.toThrow();

    const [sinTocar] = (await questionService.listPublicQuestions(listing.id)).preguntas;
    expect(sinTocar?.answer).toBeNull();
  });

  it('⚠️ LA RESPUESTA ES UNA SOLA: dos simultaneas, gana una (UPDATE condicionado a `open`)', async () => {
    const { user: seller } = await vendedor('carrera');
    const comprador = await usuario('carrera-buyer');
    const listing = await publicacionActiva(seller);
    const pregunta = await questionService.askQuestion(comprador, listing.id, '¿Cuanto mide?');

    const resultados = await Promise.allSettled([
      questionService.answerQuestion(seller, pregunta.id, 'Mide 56 de ancho'),
      questionService.answerQuestion(seller, pregunta.id, 'Mide 58 de ancho'),
    ]);

    const oks = resultados.filter((r) => r.status === 'fulfilled');
    expect(oks).toHaveLength(1);

    // Y la que perdio no dejo un aviso anunciando una respuesta que no existe:
    // el aviso va en la MISMA transaccion que el UPDATE.
    const avisos = await inapp.listNotifications(comprador);
    const deRespuesta = avisos.notificaciones.filter((a) => a.title.startsWith('Te respondieron'));
    expect(deRespuesta).toHaveLength(1);
  });

  it('se puede responder con la funcionalidad APAGADA', async () => {
    // Apagar frena preguntas nuevas; no deja a la gente sin respuesta.
    const { user: seller } = await vendedor('apagada-resp');
    const comprador = await usuario('apagada-resp-buyer');
    const listing = await publicacionActiva(seller);
    const pregunta = await questionService.askQuestion(comprador, listing.id, '¿Envias?');

    const restaurar = await conSetting(questionService.FEATURE_KEY, false);

    try {
      const respondida = await questionService.answerQuestion(seller, pregunta.id, 'Si, envio');
      expect(respondida.status).toBe('answered');
    } finally {
      await restaurar();
    }
  });

  it('se puede responder aunque la publicacion ya no este a la venta', async () => {
    // Pausar no puede dejar sin respuesta a quien ya pregunto.
    const { user: seller } = await vendedor('pausada-resp');
    const comprador = await usuario('pausada-resp-buyer');
    const listing = await publicacionActiva(seller);
    const pregunta = await questionService.askQuestion(comprador, listing.id, '¿Cuanto mide?');

    await listingEditing.pauseListing(seller, listing.id);

    const respondida = await questionService.answerQuestion(seller, pregunta.id, 'Mide 56');
    expect(respondida.answer).toBe('Mide 56');
  });

  it('⚠️ frena los datos de contacto TAMBIEN en la respuesta', async () => {
    // Es la punta que mas importa: el vendedor es quien mas motivo tiene para
    // sacar la venta de Offside —se ahorra la comision—.
    const { user: seller } = await vendedor('contacto-resp');
    const comprador = await usuario('contacto-resp-buyer');
    const listing = await publicacionActiva(seller);
    const pregunta = await questionService.askQuestion(comprador, listing.id, '¿Cuanto sale?');

    await expect(
      questionService.answerQuestion(
        seller,
        pregunta.id,
        'Pasame tu whatsapp y te lo dejo mas barato',
      ),
    ).rejects.toThrow(/red social/i);

    await expect(
      questionService.answerQuestion(seller, pregunta.id, 'Transferime al alias mi.alias.mp'),
    ).rejects.toThrow(/alias/i);
  });
});

describe('ocultar (del vendedor)', () => {
  it('la saca de la ficha y solo puede hacerlo el dueño', async () => {
    const { user: seller } = await vendedor('oculta');
    const { user: otro } = await vendedor('oculta-intruso');
    const comprador = await usuario('oculta-buyer');
    const listing = await publicacionActiva(seller);
    const pregunta = await questionService.askQuestion(comprador, listing.id, 'Texto cualquiera');

    await expect(questionService.hideQuestion(otro, pregunta.id)).rejects.toThrow(/no existe/i);

    await questionService.hideQuestion(seller, pregunta.id);

    expect((await questionService.listPublicQuestions(listing.id)).total).toBe(0);

    // Pero la fila sigue: es evidencia de lo que se hablo antes de una compra.
    const mias = await questionService.listMyQuestions(comprador);
    expect(mias.preguntas[0]?.status).toBe('hidden');
  });
});

describe('rastro de lo que se hace desaparecer', () => {
  it('⚠️ OCULTAR QUEDA EN `audit_log` Y SE LE AVISA A QUIEN PREGUNTO', async () => {
    // Es la unica accion del sitio con la que una parte hace desaparecer lo que
    // escribio la otra, y no dejaba ningun rastro: ni quien, ni cuando, ni
    // sobre que. BR-052 (MUST) exige registrar todo hecho sancionable.
    const { user: seller } = await vendedor('audita-oculta');
    const comprador = await usuario('audita-oculta-buyer');
    const listing = await publicacionActiva(seller);
    const pregunta = await questionService.askQuestion(comprador, listing.id, '¿Es original?');

    await questionService.hideQuestion(seller, pregunta.id);

    const [fila] = await getDatabase()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.entityId, pregunta.id),
          eq(schema.auditLog.action, 'QUESTION_HIDDEN'),
        ),
      );

    expect(fila).toBeDefined();
    expect(fila?.actorId).toBe(seller.id);
    expect(fila?.after).toMatchObject({ status: 'hidden' });

    // ⚠️ El TEXTO de la pregunta no se copia al log: alcanza con su id.
    expect(JSON.stringify(fila)).not.toContain('¿Es original?');

    // Y quien pregunto se entera, en vez de ver su pregunta evaporarse.
    const avisos = await inapp.listNotifications(comprador);
    const aviso = avisos.notificaciones.find((a) => a.title === 'Tu pregunta ya no se ve');
    expect(aviso).toBeDefined();
    expect(aviso?.body).toContain(listing.title);
  });

  it('⚠️ RETIRAR TAMBIEN, porque la fila no distingue una cosa de la otra', async () => {
    // Las dos acciones dejan `status = 'hidden'` y no hay columna que diga cual
    // fue. Sin el log, una pregunta que el vendedor borro es indistinguible de
    // una que su autor retiro — y esa es justo la diferencia que importa.
    const { user: seller } = await vendedor('audita-retira');
    const comprador = await usuario('audita-retira-buyer');
    const listing = await publicacionActiva(seller);
    const pregunta = await questionService.askQuestion(comprador, listing.id, '¿Cuanto mide?');

    await questionService.withdrawQuestion(comprador, pregunta.id);

    const [fila] = await getDatabase()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.entityId, pregunta.id),
          eq(schema.auditLog.action, 'QUESTION_WITHDRAWN'),
        ),
      );

    expect(fila).toBeDefined();
    expect(fila?.actorId).toBe(comprador.id);

    // Al vendedor NO se le avisa: una notificacion por cada arrepentimiento es
    // ruido en la misma campanita que trae las ventas.
    const avisos = await inapp.listNotifications(seller);
    expect(avisos.notificaciones.some((a) => a.title === 'Tu pregunta ya no se ve')).toBe(false);
  });

  it('⚠️ un intento RECHAZADO no deja auditoria ni aviso', async () => {
    // El log tiene que decir lo que PASO. Auditar un intento fallido convierte
    // el registro en una lista de ruido donde lo real se pierde.
    const { user: seller } = await vendedor('audita-fallo');
    const { user: otro } = await vendedor('audita-fallo-intruso');
    const comprador = await usuario('audita-fallo-buyer');
    const listing = await publicacionActiva(seller);
    const pregunta = await questionService.askQuestion(comprador, listing.id, '¿Hay stock?');

    await expect(questionService.hideQuestion(otro, pregunta.id)).rejects.toThrow();
    await expect(questionService.withdrawQuestion(otro, pregunta.id)).rejects.toThrow();

    const filas = await getDatabase()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, pregunta.id));

    expect(filas).toHaveLength(0);
    expect((await questionService.listPublicQuestions(listing.id)).total).toBe(1);
  });
});

describe('el cupo de preguntas abiertas', () => {
  it('⚠️ frena al llegar al tope ⚙️ y se libera al responder', async () => {
    const restaurar = await conSetting(questionService.MAX_OPEN_KEY, 2);

    try {
      const { user: seller } = await vendedor('cupo');
      const comprador = await usuario('cupo-buyer');
      const listing = await publicacionActiva(seller);

      const primera = await questionService.askQuestion(comprador, listing.id, '¿Pregunta una?');
      await questionService.askQuestion(comprador, listing.id, '¿Pregunta dos?');

      await expect(
        questionService.askQuestion(comprador, listing.id, '¿Pregunta tres?'),
      ).rejects.toThrow(/sin responder/i);

      // Responder una libera el lugar.
      await questionService.answerQuestion(seller, primera.id, 'Respuesta a la una');

      const tercera = await questionService.askQuestion(comprador, listing.id, '¿Pregunta tres?');
      expect(tercera.status).toBe('open');
    } finally {
      await restaurar();
    }
  });

  it('⚠️ RETIRAR LA PROPIA LIBERA EL CUPO, que es la unica salida que tiene quien pregunta', async () => {
    // Sin esto, el unico que podia destrabar a una persona era el vendedor que
    // no le contestaba: con el cupo lleno no podia preguntar en NINGUNA
    // publicacion del sitio.
    const restaurar = await conSetting(questionService.MAX_OPEN_KEY, 1);

    try {
      const { user: seller } = await vendedor('retira');
      const comprador = await usuario('retira-buyer');
      const listing = await publicacionActiva(seller);

      const primera = await questionService.askQuestion(comprador, listing.id, '¿Pregunta una?');
      await expect(
        questionService.askQuestion(comprador, listing.id, '¿Pregunta dos?'),
      ).rejects.toThrow(/sin responder/i);

      await questionService.withdrawQuestion(comprador, primera.id);

      const segunda = await questionService.askQuestion(comprador, listing.id, '¿Pregunta dos?');
      expect(segunda.status).toBe('open');

      // Y deja de verse en la ficha, sin borrar la fila.
      const publicas = await questionService.listPublicQuestions(listing.id);
      expect(publicas.preguntas.map((p) => p.id)).not.toContain(primera.id);
    } finally {
      await restaurar();
    }
  });

  it('⚠️ las de una publicacion ELIMINADA dejan de ocupar cupo', async () => {
    // Si el vendedor elimina la publicacion en vez de contestar, esa pregunta se
    // vuelve incontestable: sin este filtro ocupaba el cupo de quien pregunto
    // para siempre y no habia nada que esa persona pudiera hacer.
    const restaurar = await conSetting(questionService.MAX_OPEN_KEY, 1);

    try {
      const { user: seller } = await vendedor('eliminada-cupo');
      const comprador = await usuario('eliminada-cupo-buyer');
      const listing = await publicacionActiva(seller);
      const otra = await publicacionActiva(seller, 'Camiseta River 1996');

      await questionService.askQuestion(comprador, listing.id, '¿Pregunta que queda colgada?');
      await expect(questionService.askQuestion(comprador, otra.id, '¿Otra?')).rejects.toThrow(
        /sin responder/i,
      );

      await listingEditing.deleteListing(seller, listing.id);

      const segunda = await questionService.askQuestion(comprador, otra.id, '¿Otra?');
      expect(segunda.status).toBe('open');
    } finally {
      await restaurar();
    }
  });
});

describe('retirar (de quien pregunto)', () => {
  it('⚠️ SOLO EL AUTOR, y ni siquiera el vendedor de la publicacion', async () => {
    const { user: seller } = await vendedor('retira-auth');
    const comprador = await usuario('retira-auth-buyer');
    const ajeno = await usuario('retira-auth-ajeno');
    const listing = await publicacionActiva(seller);
    const pregunta = await questionService.askQuestion(comprador, listing.id, '¿Es original?');

    await expect(questionService.withdrawQuestion(ajeno, pregunta.id)).rejects.toThrow(
      /no existe/i,
    );
    // El vendedor tiene `hideQuestion`, que es otra cosa: esta es del autor.
    await expect(questionService.withdrawQuestion(seller, pregunta.id)).rejects.toThrow(
      /no existe/i,
    );

    expect((await questionService.listPublicQuestions(listing.id)).total).toBe(1);
  });

  it('⚠️ NO SE PUEDE RETIRAR UNA YA RESPONDIDA: esa respuesta es de otro', async () => {
    // El vendedor ya escribio publicamente y cualquiera pudo leerlo. Dejar que
    // quien pregunta lo borre seria darle un boton para borrar lo que dijo otro
    // —y una pregunta incomoda ya respondida es la que mas le sirve al proximo—.
    const { user: seller } = await vendedor('retira-resp');
    const comprador = await usuario('retira-resp-buyer');
    const listing = await publicacionActiva(seller);
    const pregunta = await questionService.askQuestion(comprador, listing.id, '¿Tiene manchas?');

    await questionService.answerQuestion(seller, pregunta.id, 'Ninguna, esta impecable');

    await expect(questionService.withdrawQuestion(comprador, pregunta.id)).rejects.toThrow(
      /no existe/i,
    );

    const [publica] = (await questionService.listPublicQuestions(listing.id)).preguntas;
    expect(publica?.answer).toBe('Ninguna, esta impecable');
  });
});

describe('la bandeja del vendedor', () => {
  it('lista solo las pendientes, la mas vieja primero', async () => {
    const { user: seller } = await vendedor('bandeja');
    const comprador = await usuario('bandeja-buyer');
    const listing = await publicacionActiva(seller);

    const primera = await questionService.askQuestion(comprador, listing.id, '¿La primera?');
    const segunda = await questionService.askQuestion(comprador, listing.id, '¿La segunda?');

    const pendientes = await questionService.listPendingForSeller(seller);
    expect(pendientes.preguntas.map((p) => p.id)).toEqual([primera.id, segunda.id]);
    expect(pendientes.preguntas[0]?.listingTitle).toBe(listing.title);

    await questionService.answerQuestion(seller, primera.id, 'Si');

    const despues = await questionService.listPendingForSeller(seller);
    expect(despues.preguntas.map((p) => p.id)).toEqual([segunda.id]);
  });

  it('⚠️ NO ARRASTRA LAS DE PUBLICACIONES ELIMINADAS, y el contador dice lo mismo', async () => {
    // Antes quedaban para siempre: responderlas no las lee nadie —la ficha ya
    // no existe— y el numerito del cajon nunca volvia a cero. Una cola de
    // trabajo que no se puede vaciar deja de leerse.
    const { user: seller } = await vendedor('bandeja-elim');
    const comprador = await usuario('bandeja-elim-buyer');
    const listing = await publicacionActiva(seller);
    const viva = await publicacionActiva(seller, 'Camiseta River 1996');

    await questionService.askQuestion(comprador, listing.id, '¿Sobre la que se elimina?');
    await questionService.askQuestion(comprador, viva.id, '¿Sobre la que queda?');

    expect(await questionService.countPendingForSeller(seller)).toBe(2);

    await listingEditing.deleteListing(seller, listing.id);

    const pendientes = await questionService.listPendingForSeller(seller);
    expect(pendientes.preguntas).toHaveLength(1);
    expect(pendientes.preguntas[0]?.listingTitle).toBe(viva.title);
    // El contador del cajon y la lista tienen que decir lo mismo.
    expect(await questionService.countPendingForSeller(seller)).toBe(1);
  });

  it('⚠️ SI mantiene las de una publicacion PAUSADA: esa puede volver', async () => {
    const { user: seller } = await vendedor('bandeja-pausa');
    const comprador = await usuario('bandeja-pausa-buyer');
    const listing = await publicacionActiva(seller);

    await questionService.askQuestion(comprador, listing.id, '¿Sigue disponible?');
    await listingEditing.pauseListing(seller, listing.id);

    expect(await questionService.countPendingForSeller(seller)).toBe(1);
  });
});

describe('paginado', () => {
  it('⚠️ LA FICHA NO TRAE TODAS: corta en una pagina y dice el total', async () => {
    // Quien controla cuantas preguntas tiene una publicacion NO es quien la
    // publico: cualquiera con sesion puede dejar las suyas. Sin techo, una ficha
    // con cientos las traia todas de la base y las imprimia todas en el HTML de
    // la pantalla que se comparte por WhatsApp.
    const { user: seller } = await vendedor('pagina-ficha');
    const comprador = await usuario('pagina-ficha-buyer');
    const listing = await publicacionActiva(seller);

    const cuantas = questionService.PREGUNTAS_POR_PAGINA_FICHA + 2;
    for (let i = 0; i < cuantas; i += 1) {
      // Se responde cada una para no chocar contra el cupo de abiertas ⚙️.
      const q = await questionService.askQuestion(comprador, listing.id, `Pregunta numero ${i}`);
      await questionService.answerQuestion(seller, q.id, `Respuesta numero ${i}`);
    }

    const primera = await questionService.listPublicQuestions(listing.id);
    expect(primera.preguntas).toHaveLength(questionService.PREGUNTAS_POR_PAGINA_FICHA);
    expect(primera.total).toBe(cuantas);
    expect(primera.pagina).toBe(1);

    const segunda = await questionService.listPublicQuestions(listing.id, 2);
    expect(segunda.preguntas).toHaveLength(2);
    expect(segunda.total).toBe(cuantas);

    // ⚠️ SIN SOLAPAMIENTO NI HUECOS. El ORDER BY desempata por `id`: sin ese
    // segundo criterio, dos preguntas del mismo instante podrian salir en las
    // dos paginas —o en ninguna—.
    const ids = new Set([...primera.preguntas, ...segunda.preguntas].map((p) => p.id));
    expect(ids.size).toBe(cuantas);
  });

  it('una pagina inventada en la URL cae en la primera, no rompe', async () => {
    // El numero llega de la URL: puede ser 0, negativo, decimal o basura.
    const { user: seller } = await vendedor('pagina-mala');
    const comprador = await usuario('pagina-mala-buyer');
    const listing = await publicacionActiva(seller);
    await questionService.askQuestion(comprador, listing.id, '¿Una sola?');

    for (const mala of [0, -3, 1.5, Number.NaN]) {
      const pagina = await questionService.listPublicQuestions(listing.id, mala);
      expect(pagina.pagina).toBe(1);
      expect(pagina.preguntas).toHaveLength(1);
    }
  });
});

describe('historial del vendedor', () => {
  it('⚠️ SEPARA LA COLA DE TRABAJO DEL ARCHIVO, y en ORDEN INVERSO', async () => {
    // Las pendientes son trabajo: la mas VIEJA primero, orden de llegada. El
    // historial es historia: la mas RECIENTE primero. Mezclarlos convertiria la
    // bandeja en un archivo y las pendientes quedarian sepultadas.
    const { user: seller } = await vendedor('historial');
    const comprador = await usuario('historial-buyer');
    const listing = await publicacionActiva(seller);

    const primera = await questionService.askQuestion(comprador, listing.id, '¿La primera?');
    const segunda = await questionService.askQuestion(comprador, listing.id, '¿La segunda?');
    const tercera = await questionService.askQuestion(comprador, listing.id, '¿La tercera?');

    await questionService.answerQuestion(seller, primera.id, 'Respuesta a la primera');
    await questionService.answerQuestion(seller, segunda.id, 'Respuesta a la segunda');

    const respondidas = await questionService.listAnsweredForSeller(seller);
    expect(respondidas.total).toBe(2);
    // Mas reciente primero: la segunda se respondio despues.
    expect(respondidas.preguntas.map((p) => p.id)).toEqual([segunda.id, primera.id]);
    expect(respondidas.preguntas[0]?.answer).toBe('Respuesta a la segunda');
    expect(respondidas.preguntas[0]?.listingTitle).toBe(listing.title);

    // Y la cola sigue teniendo solo lo que falta contestar.
    const pendientes = await questionService.listPendingForSeller(seller);
    expect(pendientes.preguntas.map((p) => p.id)).toEqual([tercera.id]);
  });

  it('⚠️ el historial TAMPOCO arrastra publicaciones eliminadas', async () => {
    // Mismo predicado que la cola: si contaran distinto, una solapa mostraria
    // preguntas sobre fichas que ya no existen y la otra no.
    const { user: seller } = await vendedor('historial-elim');
    const comprador = await usuario('historial-elim-buyer');
    const listing = await publicacionActiva(seller);

    const q = await questionService.askQuestion(comprador, listing.id, '¿Sobre la que se borra?');
    await questionService.answerQuestion(seller, q.id, 'Respondida antes de borrarla');

    expect((await questionService.listAnsweredForSeller(seller)).total).toBe(1);

    await listingEditing.deleteListing(seller, listing.id);

    expect((await questionService.listAnsweredForSeller(seller)).total).toBe(0);
  });

  it('⚠️ NO lo puede ver quien no es vendedor', async () => {
    const comprador = await usuario('historial-sinperfil');

    await expect(questionService.listAnsweredForSeller(comprador)).rejects.toThrow();
  });
});

describe('tiempo de respuesta', () => {
  it('devuelve null si nunca respondio: no se inventa un numero', async () => {
    const { user: seller, sellerId } = await vendedor('promedio');
    const comprador = await usuario('promedio-buyer');
    const listing = await publicacionActiva(seller);
    const pregunta = await questionService.askQuestion(comprador, listing.id, '¿Cuanto mide?');

    expect(await questionService.averageAnswerHours(sellerId)).toBeNull();

    await questionService.answerQuestion(seller, pregunta.id, 'Mide 56');

    const horas = await questionService.averageAnswerHours(sellerId);
    expect(horas).not.toBeNull();
    expect(horas).toBeGreaterThanOrEqual(0);
  });
});
