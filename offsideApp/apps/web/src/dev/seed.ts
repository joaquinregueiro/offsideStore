/**
 * Seed de DESARROLLO — deja `offside_dev` con datos para recorrer todas las
 * pantallas con sesion de comprador, de vendedor y de admin.
 *
 *     npm run db:seed:dev        (desde offsideApp/)
 *
 * =============================================================================
 * REGLAS QUE GOBIERNAN ESTE ARCHIVO
 * =============================================================================
 *
 *  1. SE SIEMBRA A TRAVES DE LOS SERVICES. Registro, verificacion de email,
 *     alta de vendedor, identidad fiscal, publicaciones, fotos (pasando por el
 *     procesador de imagenes real) y ordenes entran por el mismo camino que
 *     usa la app. Asi el seed ejercita las reglas de negocio en vez de
 *     saltearlas, y si un Service cambia, el seed se rompe ACA y no en una
 *     pantalla.
 *
 *  2. Solo se escribe por fuera de un Service lo que ningun Service puede crear
 *     desde adentro del proceso: la conexion con Mercado Pago (el OAuth exige
 *     el navegador y una cuenta real), los roles de admin (se asignan solo por
 *     SQL a proposito, DEC-023), la aprobacion de un pago (el webhook reconsulta
 *     el pago a la API de Mercado Pago, y aca no hay Mercado Pago) y la
 *     cancelacion de una orden (no existe el flujo todavia). Cada uno de esos
 *     casos esta marcado con "DIRECTO" en su comentario.
 *
 *  3. NUNCA EN PRODUCCION. Aborta si `APP_ENV` es `production` o si
 *     `DATABASE_URL` no apunta a `offside_dev`. Un seed que borra usuarios no
 *     puede depender de que alguien se acuerde de no correrlo.
 *
 *  4. IDEMPOTENTE. Todo lo sembrado lleva un email que termina en
 *     `@seed.offside.local`; al arrancar se borra lo que quedo de la corrida
 *     anterior, en el orden que las FKs permiten. Correrlo dos veces deja el
 *     mismo estado.
 *
 *  5. SIN SECRETOS REALES. La password es fija y visible, y se imprime al
 *     final junto con los emails. Los tokens de Mercado Pago son cadenas
 *     inventadas cifradas con la clave del `.env`.
 *
 * ⚠️ ESTE ARCHIVO NO ES PARTE DE LA APP. Vive en `src/dev/` para que lo cubran
 * tsconfig, eslint y prettier, pero ninguna pantalla ni ningun Service lo
 * importa.
 */

// ⚠️ TIENE QUE SER EL PRIMER IMPORT: fija el cwd antes de que se cargue la app.
import './seed-cwd';

import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { getEnv, loadRootEnv } from '@offside/config';
import { closeDatabase, getDatabase, schema } from '@offside/database';
import { closeQueues, closeRedisConnections, getQueue, QUEUE_NAMES } from '@offside/jobs';
import { and, count, eq, inArray, like, or } from 'drizzle-orm';
import sharp from 'sharp';

import * as audit from '../modules/audit/services/audit.service';
import * as authService from '../modules/auth/services/auth.service';
import type { PublicUser } from '../modules/auth/services/auth.service';
import * as listingRepo from '../modules/listings/repositories/listing.repository';
import * as listingEditingService from '../modules/listings/services/listing-editing.service';
import * as listingImageService from '../modules/listings/services/listing-image.service';
import * as listingService from '../modules/listings/services/listing.service';
import * as searchService from '../modules/listings/services/search.service';
import type { EmailJobData } from '../modules/notifications/services/email.service';
import * as orderRepo from '../modules/orders/repositories/order.repository';
import * as orderService from '../modules/orders/services/order.service';
import * as webhookRepo from '../modules/payments/repositories/payment-webhook.repository';
import * as paymentRepo from '../modules/payments/repositories/payment.repository';
import * as webhookService from '../modules/payments/services/payment-webhook.service';
import * as cipher from '../modules/sellers/infrastructure/mercadopago/token-cipher';
import * as mpRepo from '../modules/sellers/repositories/mercadopago-account.repository';
import * as fiscal from '../modules/sellers/services/fiscal-identity.service';
import * as approvalService from '../modules/sellers/services/seller-approval.service';
import * as taxService from '../modules/sellers/services/seller-tax-profile.service';
import * as sellerService from '../modules/sellers/services/seller.service';
import * as tierService from '../modules/sellers/services/seller-tier.service';
import * as vacationService from '../modules/sellers/services/vacation.service';
import * as promotionService from '../modules/listings/services/promotion.service';
import * as questionService from '../modules/questions/services/question.service';
import * as favoriteService from '../modules/favorites/services/favorite.service';
import * as addressService from '../modules/addresses/services/address.service';
import * as cartService from '../modules/cart/services/cart.service';
import * as reviewService from '../modules/reviews/services/review.service';
import * as disputeService from '../modules/disputes/services/dispute.service';
import * as sanctionService from '../modules/trust/services/sanction.service';
import * as reputationService from '../modules/reputation/services/reputation.service';
import * as inappService from '../modules/notifications/services/inapp-notification.service';

/* -------------------------------------------------------------------------- */
/* Constantes                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Marca de todo lo sembrado. Es lo que permite borrarlo despues sin tocar
 * nada que haya creado una persona a mano en la misma base.
 */
const SUFIJO = '@seed.offside.local';

/** Password de desarrollo. Fija y visible a proposito: se imprime al final. */
const PASSWORD = 'Seed-2026-Offside!';

/**
 * Raiz de `apps/web`. Se calcula desde este archivo y NO desde `process.cwd()`
 * porque el comando documentado corre desde `offsideApp/`.
 */
const RAIZ_APP_WEB = resolve(import.meta.dirname, '..', '..');

/**
 * Costo de Mercado Pago que informa el proveedor SIMULADO, en basis points.
 *
 * ⚠️ NO ES CONFIGURACION NI REGLA DE NEGOCIO (DEC-030 prohibe hardcodear la
 * tasa de MP). Es lo que "respondio" un Mercado Pago inventado en el payload
 * fabricado del pago aprobado, igual que en la prueba real del 2026-08-26
 * (4100 sobre 100000). Solo sirve para que `payment_splits` tenga un reparto
 * verosimil en la consola de pagos.
 */
const COSTO_MP_SIMULADO_BP = 410n;
const BASIS_POINTS_TOTAL = 10_000n;

/** Direccion completa, con la forma que exige `direccionSchema` de la pantalla de compra. */
const DIRECCION = {
  nombre: 'Lucia Fernandez',
  calle: 'Av. Rivadavia 4520, 3° B',
  ciudad: 'Ciudad Autonoma de Buenos Aires',
  provincia: 'CABA',
  codigoPostal: 'C1205AAN',
  telefono: '+54 11 5555-0102',
};

const DIRECCION_2 = {
  nombre: 'Martin Sosa',
  calle: 'Bv. Oroño 1180',
  ciudad: 'Rosario',
  provincia: 'Santa Fe',
  codigoPostal: 'S2000DSB',
  telefono: '+54 341 555-0199',
};

/** Salida por stdout. Es un script de consola: imprimir ES su resultado. */
function imprimir(linea = ''): void {
  process.stdout.write(`${linea}\n`);
}

function email(local: string): string {
  return `${local}${SUFIJO}`;
}

/* -------------------------------------------------------------------------- */
/* Guardas                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Se niega a correr contra cualquier cosa que no sea la base de desarrollo.
 *
 * Las dos condiciones se exigen JUNTAS: `APP_ENV` puede venir mal seteado en
 * una maquina de desarrollo apuntando a una base remota, y el nombre de la
 * base es lo unico que no depende de una variable que alguien pudo copiar mal.
 */
function asegurarEntornoDeDesarrollo(): void {
  loadRootEnv(process.cwd());
  const env = getEnv();

  if (env.APP_ENV === 'production') {
    throw new Error('El seed de desarrollo NO corre con APP_ENV=production.');
  }

  if (!env.DATABASE_URL.includes('offside_dev')) {
    throw new Error(
      'El seed de desarrollo solo corre contra la base `offside_dev`. ' +
        'DATABASE_URL apunta a otra base y no se toca.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Limpieza                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Borra TODO lo que dejo una corrida anterior, en el orden que las FKs
 * permiten (hijos antes que padres).
 *
 * Se parte de los usuarios con el sufijo y desde ahi se derivan vendedores,
 * publicaciones, ordenes y pagos. Se incluyen tablas que el seed no escribe
 * pero que una persona pudo escribir DESDE LA APP sobre datos sembrados
 * (reembolsos desde la consola de admin, favoritos): si no se borran, la FK
 * frena el borrado del usuario y el seed deja de ser idempotente.
 */
async function limpiar(): Promise<void> {
  const conn = getDatabase();

  const usuarios = await conn
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(like(schema.users.email, `%${SUFIJO}`));
  const userIds = usuarios.map((u) => u.id);

  // Los eventos de webhook no cuelgan de ningun usuario: se reconocen por la
  // clave de idempotencia que fabrica `aprobarPago`.
  await conn
    .delete(schema.paymentWebhookEvents)
    .where(like(schema.paymentWebhookEvents.idempotencyKey, 'mercadopago:seed-%'));

  await vaciarColaDeEmails();

  if (userIds.length === 0) {
    imprimir('[seed] no habia datos sembrados previos');
    return;
  }

  const perfiles = await conn
    .select({ id: schema.sellerProfiles.id })
    .from(schema.sellerProfiles)
    .where(inArray(schema.sellerProfiles.userId, userIds));
  const sellerIds = perfiles.map((p) => p.id);

  const ordenes = await conn
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(
      sellerIds.length === 0
        ? inArray(schema.orders.buyerId, userIds)
        : or(inArray(schema.orders.buyerId, userIds), inArray(schema.orders.sellerId, sellerIds)),
    );
  const orderIds = ordenes.map((o) => o.id);

  const listingIds =
    sellerIds.length === 0
      ? []
      : (
          await conn
            .select({ id: schema.listings.id })
            .from(schema.listings)
            .where(inArray(schema.listings.sellerId, sellerIds))
        ).map((l) => l.id);

  let paymentIds: string[] = [];

  if (orderIds.length > 0) {
    /*
     * ⚠️ ORDEN DE BORRADO DE LO NUEVO (2026-09-11), Y NO ES ARBITRARIO. Las
     * FKs son RESTRICT por defecto (CLAUDE.md §6), asi que se borra de la hoja
     * a la raiz: acciones y evidencias cuelgan de la disputa; la sancion
     * REFERENCIA la disputa, asi que se va antes que ella; la disputa y la
     * reseña cuelgan de la orden. Las promociones se borran despues de las
     * ordenes, porque `orders.listing_promotion_id` las referencia.
     */
    const disputaIds = (
      await conn
        .select({ id: schema.disputes.id })
        .from(schema.disputes)
        .where(inArray(schema.disputes.orderId, orderIds))
    ).map((d) => d.id);

    if (disputaIds.length > 0) {
      await conn
        .delete(schema.disputeActions)
        .where(inArray(schema.disputeActions.disputeId, disputaIds));
      await conn
        .delete(schema.disputeEvidences)
        .where(inArray(schema.disputeEvidences.disputeId, disputaIds));
      await conn.delete(schema.sanctions).where(inArray(schema.sanctions.disputeId, disputaIds));
    }

    await conn.delete(schema.reviews).where(inArray(schema.reviews.orderId, orderIds));
    await conn.delete(schema.disputes).where(inArray(schema.disputes.orderId, orderIds));

    // El envio manual del vendedor: `shipments.order_id` es RESTRICT.
    const envioIds = (
      await conn
        .select({ id: schema.shipments.id })
        .from(schema.shipments)
        .where(inArray(schema.shipments.orderId, orderIds))
    ).map((e) => e.id);

    if (envioIds.length > 0) {
      await conn
        .delete(schema.shipmentTrackingEvents)
        .where(inArray(schema.shipmentTrackingEvents.shipmentId, envioIds));
      await conn.delete(schema.shipments).where(inArray(schema.shipments.id, envioIds));
    }

    paymentIds = (
      await conn
        .select({ id: schema.payments.id })
        .from(schema.payments)
        .where(inArray(schema.payments.orderId, orderIds))
    ).map((p) => p.id);

    // Un admin pudo reembolsar una orden sembrada desde la consola.
    await conn
      .delete(schema.sellerLiabilities)
      .where(inArray(schema.sellerLiabilities.orderId, orderIds));
    await conn.delete(schema.refunds).where(inArray(schema.refunds.orderId, orderIds));

    if (paymentIds.length > 0) {
      await conn
        .delete(schema.paymentSplits)
        .where(inArray(schema.paymentSplits.paymentId, paymentIds));
    }

    await conn.delete(schema.payments).where(inArray(schema.payments.orderId, orderIds));
    await conn
      .delete(schema.orderStatusHistory)
      .where(inArray(schema.orderStatusHistory.orderId, orderIds));
    await conn.delete(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds));
    await conn.delete(schema.orders).where(inArray(schema.orders.id, orderIds));
  }

  if (listingIds.length > 0) {
    // Las fotos del adaptador local viven en `public/uploads/listings/<id>/`.
    // Se borran ANTES que las filas: sin la fila, despues no hay forma de
    // saber que carpeta era del seed.
    await Promise.all(
      listingIds.map((id) =>
        rm(resolve(RAIZ_APP_WEB, 'public', 'uploads', 'listings', id), {
          recursive: true,
          force: true,
        }),
      ),
    );

    // `cart_items` referencia `listings` con RESTRICT; `favorites`,
    // `listing_images` y `listing_price_history` caen en cascada.
    await conn.delete(schema.cartItems).where(inArray(schema.cartItems.listingId, listingIds));

    // Despues de las ordenes: `orders.listing_promotion_id` las referencia.
    await conn
      .delete(schema.listingPromotions)
      .where(inArray(schema.listingPromotions.listingId, listingIds));
    await conn
      .delete(schema.listingQuestions)
      .where(inArray(schema.listingQuestions.listingId, listingIds));
    await conn
      .delete(schema.listingReports)
      .where(inArray(schema.listingReports.listingId, listingIds));
    await conn.delete(schema.listings).where(inArray(schema.listings.id, listingIds));
  }

  if (sellerIds.length > 0) {
    // Las que no venian de una disputa (una sancion aplicada a mano).
    await conn.delete(schema.sanctions).where(inArray(schema.sanctions.sellerId, sellerIds));
    await conn
      .delete(schema.mercadopagoAccounts)
      .where(inArray(schema.mercadopagoAccounts.sellerId, sellerIds));
    await conn
      .delete(schema.sellerTaxProfiles)
      .where(inArray(schema.sellerTaxProfiles.sellerId, sellerIds));
    await conn
      .delete(schema.sellerReputations)
      .where(inArray(schema.sellerReputations.sellerId, sellerIds));
  }

  // `audit_log` es append-only por diseno (ERD §19.1) y por eso NO se borra
  // desde la app. Aca si, y solo lo del seed: la FK `actor_id` es RESTRICT y
  // sin esto el usuario no se puede borrar. Se limpian tambien las entradas
  // del sistema sobre entidades sembradas, para que la auditoria no acumule
  // filas huerfanas corrida tras corrida.
  const entidades = [...userIds, ...sellerIds, ...listingIds, ...orderIds, ...paymentIds];
  await conn
    .delete(schema.auditLog)
    .where(
      or(inArray(schema.auditLog.actorId, userIds), inArray(schema.auditLog.entityId, entidades)),
    );

  /**
   * ⚠️ `app_settings.updated_by` es RESTRICT. Si el admin sembrado cambio la
   * comision desde `/admin/comision`, esa version queda apuntando a el. No se
   * borra la version —romperia el historial del Config Store— sino que se
   * desliga el autor. Se avisa, porque es el unico rastro que se pierde.
   */
  const configTocada = await conn
    .update(schema.appSettings)
    .set({ updatedBy: null })
    .where(inArray(schema.appSettings.updatedBy, userIds))
    .returning({ key: schema.appSettings.key });

  if (configTocada.length > 0) {
    imprimir(
      `[seed] ⚠️ ${configTocada.length} version(es) de app_settings las habia escrito un usuario ` +
        'sembrado; se les quito el autor para poder borrarlo.',
    );
  }

  /*
   * ⚠️ TAMBIEN POR USUARIO, NO SOLO POR PUBLICACION. Las preguntas y las
   * denuncias se borran mas arriba junto con sus publicaciones, pero un
   * usuario sembrado puede haber preguntado o denunciado sobre una publicacion
   * que NO es del seed —alguien probando a mano, otra sesion—. Esas filas
   * sobreviven, y como `asker_id` / `reporter_id` son RESTRICT, bloquean el
   * borrado del usuario con un error que no dice que fila lo causa.
   */
  await conn
    .delete(schema.listingQuestions)
    .where(
      or(
        inArray(schema.listingQuestions.askerId, userIds),
        inArray(schema.listingQuestions.answeredBy, userIds),
      ),
    );
  await conn
    .delete(schema.listingReports)
    .where(
      or(
        inArray(schema.listingReports.reporterId, userIds),
        inArray(schema.listingReports.reviewedBy, userIds),
      ),
    );
  await conn.delete(schema.notifications).where(inArray(schema.notifications.userId, userIds));
  await conn.delete(schema.userAddresses).where(inArray(schema.userAddresses.userId, userIds));
  await conn
    .delete(schema.userLevelHistory)
    .where(inArray(schema.userLevelHistory.userId, userIds));
  await conn.delete(schema.carts).where(inArray(schema.carts.userId, userIds));
  await conn
    .delete(schema.identityVerifications)
    .where(inArray(schema.identityVerifications.userId, userIds));
  await conn.delete(schema.sellerProfiles).where(inArray(schema.sellerProfiles.userId, userIds));
  await conn
    .delete(schema.userHistoryEvents)
    .where(inArray(schema.userHistoryEvents.userId, userIds));
  await conn.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds));
  await conn
    .delete(schema.emailVerificationTokens)
    .where(inArray(schema.emailVerificationTokens.userId, userIds));
  await conn
    .delete(schema.passwordResetTokens)
    .where(inArray(schema.passwordResetTokens.userId, userIds));
  await conn
    .delete(schema.emailSuppressions)
    .where(like(schema.emailSuppressions.email, `%${SUFIJO}`));
  await conn.delete(schema.users).where(inArray(schema.users.id, userIds));

  // Se lee de vuelta por si un usuario sembrado sobrevivio por una FK que
  // este listado no contempla: mejor fallar aca que dejar el seed a medias.
  const sobrevivientes = await conn
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email('admin')));

  if (sobrevivientes.length > 0) {
    throw new Error('La limpieza no pudo borrar los usuarios sembrados: revisar las FKs.');
  }

  imprimir(
    `[seed] limpieza: ${userIds.length} usuarios, ${sellerIds.length} vendedores, ` +
      `${listingIds.length} publicaciones, ${orderIds.length} ordenes y ${paymentIds.length} pagos`,
  );
}

/**
 * Saca de la cola los emails encolados hacia direcciones sembradas.
 *
 * `register` encola la verificacion por BullMQ, y eso esta bien: es el flujo
 * real. Pero `@seed.offside.local` no existe, y si el worker de `next dev`
 * tuviera SES configurado, cada corrida mandaria emails que rebotan y
 * terminarian en `email_suppressions`. Se descartan antes de que un worker los
 * vea.
 */
async function vaciarColaDeEmails(): Promise<void> {
  const cola = getQueue<EmailJobData>(QUEUE_NAMES.NOTIFICATIONS_SEND);
  const pendientes = await cola.getJobs(['waiting', 'delayed', 'prioritized', 'failed']);
  let descartados = 0;

  for (const job of pendientes) {
    if (job.data.to.endsWith(SUFIJO)) {
      await job.remove();
      descartados += 1;
    }
  }

  if (descartados > 0)
    imprimir(`[seed] ${descartados} email(s) a direcciones sembradas sacados de la cola`);
}

/* -------------------------------------------------------------------------- */
/* Usuarios y vendedores                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Registro + verificacion de email, por el Service.
 *
 * `register` devuelve el token en claro justamente para que el llamador lo
 * envie; aca en vez de enviarlo se consume, que es lo que haria la persona al
 * abrir el enlace.
 */
async function usuarioVerificado(local: string, displayName: string): Promise<PublicUser> {
  const { emailVerificationToken } = await authService.register({
    email: email(local),
    password: PASSWORD,
    displayName,
    acceptedTerms: true,
  });

  return authService.verifyEmail(emailVerificationToken);
}

/**
 * DIRECTO: rol administrativo.
 *
 * Los roles se asignan SOLO por SQL a proposito (DEC-023, `authorization-module.md`):
 * no hay endpoint ni Service que los escriba, porque seria una via de escalada.
 * El seed hace exactamente lo que haria el owner a mano.
 */
/**
 * Asigna el rol administrativo y devuelve el usuario YA con el rol puesto.
 *
 * ⚠️ DEVOLVER EL USUARIO NO ES COMODIDAD: el `PublicUser` que produjo el
 * registro trae `adminRole: null`, y los Services que exigen una capacidad lo
 * leen de ESE objeto, no de la base. Sembrar una resolucion de reclamo con el
 * objeto viejo fallaba con "ese reclamo no existe", que es exactamente lo que
 * el Service le contesta a quien no tiene la capacidad.
 */
async function asignarRol(user: PublicUser, rol: 'ADMIN' | 'FINANCE'): Promise<PublicUser> {
  await getDatabase()
    .update(schema.users)
    .set({ adminRole: rol, updatedAt: new Date() })
    .where(eq(schema.users.id, user.id));

  return { ...user, adminRole: rol };
}

/**
 * CUIT sintacticamente valido a partir de un prefijo y un cuerpo fijos.
 *
 * El digito verificador se calcula con el MISMO algoritmo que valida
 * `fiscal-identity.service`: asi el seed no puede desincronizarse de la
 * validacion. Los numeros son fijos para que el seed sea determinista.
 */
function cuit(prefijo: string, cuerpo: string): string {
  const primeros10 = `${prefijo}${cuerpo}`;
  const verificador = fiscal.calculateCheckDigit(primeros10);

  return `${prefijo}-${cuerpo}-${verificador}`;
}

/**
 * DIRECTO: conexion con Mercado Pago.
 *
 * `completeConnection` necesita un `code` de OAuth que solo entrega Mercado Pago
 * despues de que una persona autorice en el navegador. Se replica lo que ese
 * Service persiste al final del flujo —upsert de la cuenta con los tokens
 * CIFRADOS por el helper del propio modulo, auditoria en la misma transaccion
 * y reevaluacion de la aprobacion— con credenciales inventadas.
 */
async function conectarMercadoPago(
  user: PublicUser,
  sellerId: string,
  mpUserId: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
  const scopes = ['offline_access', 'read', 'write'];

  await getDatabase().transaction(async (tx) => {
    await mpRepo.upsertConnectedAccount(
      sellerId,
      {
        mpUserId,
        encryptedAccessToken: cipher.encryptToken(`SEED-ACCESS-TOKEN-${mpUserId}`),
        encryptedRefreshToken: cipher.encryptToken(`SEED-REFRESH-TOKEN-${mpUserId}`),
        expiresAt,
        scopes,
        publicKey: `SEED-PUBLIC-KEY-${mpUserId}`,
      },
      tx,
    );

    await audit.record(
      {
        actorType: 'user',
        actorId: user.id,
        action: 'MP_CONNECTION_SUCCEEDED',
        entityType: 'mercadopago_account',
        entityId: sellerId,
        metadata: {
          mpUserId,
          scopes,
          expiresAt: expiresAt.toISOString(),
          liveMode: false,
          seed: true,
        },
      },
      tx,
    );
  });

  // Conectar Mercado Pago es la ultima senal de TS-001: con email verificado y
  // CUIT declarado, esta evaluacion es la que aprueba al vendedor (DEC-044).
  await approvalService.evaluate(user);
}

/**
 * DIRECTO: vence la conexion de Mercado Pago.
 *
 * Es lo que hace el barrido diario de refresh cuando Mercado Pago rechaza
 * renovar el token (`mercadopago-refresh.service`): estado `expired` y una
 * entrada de auditoria. No hay Service publico para forzarlo.
 */
async function vencerMercadoPago(sellerId: string): Promise<void> {
  await mpRepo.updateStatus(sellerId, 'expired');

  await audit.record({
    actorType: 'system',
    action: 'MP_TOKEN_REFRESH_FAILED',
    entityType: 'mercadopago_account',
    entityId: sellerId,
    metadata: { sellerId, expired: true, failure: 'invalid_grant', seed: true },
  });
}

interface Vendedor {
  user: PublicUser;
  sellerId: string;
}

async function vendedor(
  local: string,
  tienda: string,
  opciones: { cuit: string; mercadoPago: 'conectado' | 'sin-conectar'; mpUserId?: string },
): Promise<Vendedor> {
  const user = await usuarioVerificado(local, tienda);

  const perfil = await sellerService.createSellerProfile(user, {
    displayName: tienda,
    bio: `Coleccion personal de camisetas argentinas. Tienda sembrada para desarrollo (${local}).`,
    shippingPolicy: 'Despacho dentro de las 48 hs habiles de acreditado el pago.',
    acceptedSellerTerms: true,
  });

  await taxService.submitTaxIdentity(user, { taxIdType: 'CUIT', taxId: opciones.cuit });

  // Un vendedor "expirado" es uno que ESTUVO conectado: se conecta aca y el
  // vencimiento se aplica en `sembrar()`, despues de que publico como
  // cualquier vendedor operativo.
  if (opciones.mercadoPago !== 'sin-conectar') {
    await conectarMercadoPago(user, perfil.id, opciones.mpUserId ?? `seed-${local}`);
  }

  return { user, sellerId: perfil.id };
}

/* -------------------------------------------------------------------------- */
/* Fotos                                                                       */
/* -------------------------------------------------------------------------- */

type Patron = 'liso' | 'rayas' | 'banda' | 'mitades' | 'celeste-blanca';

interface Colores {
  base: string;
  secundario: string;
  detalle: string;
}

/**
 * Dibuja una camiseta como SVG y la rasteriza a PNG de 800x1000 con sharp.
 *
 * Es una imagen REAL (bytes de PNG decodificables), asi que pasa por
 * `procesarImagen` como cualquier foto subida: se valida el formato, se
 * generan las tres variantes y se recodifica a WebP. Cada foto de una misma
 * publicacion lleva un texto distinto para que su hash —y por lo tanto su
 * clave en el storage— sea distinto.
 */
async function fotoDeCamiseta(
  colores: Colores,
  patron: Patron,
  numero: number,
  etiqueta: string,
): Promise<Buffer> {
  const cuerpo =
    'M 250 170 L 400 120 L 550 170 L 720 270 L 645 380 L 565 335 L 565 890 L 235 890 L 235 335 L 155 380 L 80 270 Z';

  let relleno = '';
  switch (patron) {
    case 'rayas':
      relleno = [0, 1, 2, 3, 4]
        .map(
          (i) =>
            `<rect x="${140 + i * 104}" y="100" width="52" height="820" fill="${colores.secundario}"/>`,
        )
        .join('');
      break;
    case 'banda':
      relleno = `<polygon points="80,560 720,240 720,400 80,720" fill="${colores.secundario}"/>`;
      break;
    case 'mitades':
      relleno = `<rect x="400" y="100" width="340" height="820" fill="${colores.secundario}"/>`;
      break;
    case 'celeste-blanca':
      relleno = [0, 2, 4]
        .map(
          (i) =>
            `<rect x="${110 + i * 98}" y="100" width="98" height="820" fill="${colores.secundario}"/>`,
        )
        .join('');
      break;
    case 'liso':
      break;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
  <rect width="800" height="1000" fill="#f2efe6"/>
  <defs><clipPath id="c"><path d="${cuerpo}"/></clipPath></defs>
  <path d="${cuerpo}" fill="${colores.base}"/>
  <g clip-path="url(#c)">${relleno}</g>
  <path d="${cuerpo}" fill="none" stroke="#1d1d1b" stroke-width="10" stroke-linejoin="round"/>
  <path d="M 330 140 Q 400 200 470 140" fill="none" stroke="${colores.detalle}" stroke-width="22"/>
  <path d="M 80 270 L 155 380 L 235 335" fill="none" stroke="${colores.detalle}" stroke-width="12"/>
  <path d="M 720 270 L 645 380 L 565 335" fill="none" stroke="${colores.detalle}" stroke-width="12"/>
  <text x="400" y="640" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="260" fill="${colores.detalle}" stroke="#1d1d1b" stroke-width="6">${numero}</text>
  <text x="400" y="960" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#1d1d1b">${etiqueta}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Vistas que se van alternando para que cada foto sea distinta. */
const VISTAS = ['Frente', 'Dorso', 'Detalle del escudo', 'Etiqueta'] as const;

async function subirFotos(
  user: PublicUser,
  listingId: string,
  def: Pick<DefinicionDePublicacion, 'colores' | 'patron' | 'numero' | 'fotos' | 'titulo'>,
): Promise<void> {
  for (let i = 0; i < def.fotos; i++) {
    const vista = VISTAS[i % VISTAS.length]!;
    const bytes = await fotoDeCamiseta(def.colores, def.patron, def.numero + i, `${vista} · seed`);

    await listingImageService.uploadImage(user, {
      listingId,
      bytes,
      alt: `${def.titulo} — ${vista.toLowerCase()}`,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Publicaciones                                                               */
/* -------------------------------------------------------------------------- */

type Categoria = 'camiseta' | 'short' | 'buzo' | 'campera' | 'conjunto' | 'entrenamiento';
type Condicion = listingRepo.ListingRow['condition'];
type KitType = NonNullable<listingRepo.ListingRow['kitType']>;
type Manga = NonNullable<listingRepo.ListingRow['sleeve']>;

interface DefinicionDePublicacion {
  /** Identificador interno para enlazar ordenes con publicaciones. */
  clave: string;
  titulo: string;
  descripcion: string;
  categoria: Categoria;
  /** Pesos argentinos ENTEROS; se convierten a centavos al publicar. */
  precioArs: number;
  stock: number;
  talle: string;
  condicion: Condicion;
  kitType: KitType | null;
  manga: Manga | null;
  club?: string;
  seleccion?: string;
  marca?: string;
  competicion?: string;
  temporada?: string;
  fotos: number;
  colores: Colores;
  patron: Patron;
  numero: number;
  /** Estado final buscado. `sold_out` se alcanza vendiendo la ultima unidad. */
  estado: 'active' | 'paused' | 'draft';
}

const AZUL_ORO: Colores = { base: '#0a3d91', secundario: '#f2c318', detalle: '#f2c318' };
const BLANCO_ROJO: Colores = { base: '#ffffff', secundario: '#d81e2b', detalle: '#d81e2b' };
const CELESTE: Colores = { base: '#ffffff', secundario: '#75aadb', detalle: '#1d3f8f' };
const ROJO: Colores = { base: '#d81e2b', secundario: '#ffffff', detalle: '#ffffff' };
const CELESTE_BLANCA_RACING: Colores = {
  base: '#ffffff',
  secundario: '#59b3e8',
  detalle: '#1d3f8f',
};
const AZUL_ROJO: Colores = { base: '#1c3f94', secundario: '#c8102e', detalle: '#ffffff' };
const AMARILLO_AZUL: Colores = { base: '#ffd500', secundario: '#0b2a7a', detalle: '#0b2a7a' };
const ROJO_NEGRO: Colores = { base: '#d81e2b', secundario: '#111111', detalle: '#ffffff' };
const BLANCO_AZUL: Colores = { base: '#ffffff', secundario: '#1d3f8f', detalle: '#1d3f8f' };
const VERDE: Colores = { base: '#1f7a3a', secundario: '#ffffff', detalle: '#ffffff' };
const NEGRO_ORO: Colores = { base: '#161616', secundario: '#f2c318', detalle: '#f2c318' };
const AZUL_BLANCO: Colores = { base: '#1d3f8f', secundario: '#ffffff', detalle: '#ffffff' };
const GRIS: Colores = { base: '#6b6b6b', secundario: '#f2c318', detalle: '#111111' };

/**
 * Catalogo del vendedor conectado. Titulos reales de camisetas argentinas;
 * club, marca, temporada y competicion se resuelven contra los catalogos que
 * sembro la migracion 0007 (por slug), nunca por id.
 */
const PUBLICACIONES_CONECTADO: DefinicionDePublicacion[] = [
  {
    clave: 'boca-2001',
    titulo: 'Camiseta Boca Juniors titular 2001 Nike',
    descripcion:
      'La de la Intercontinental contra el Bayern. Talle L, sin roturas, estampados intactos. Sponsor Quilmes original.',
    categoria: 'camiseta',
    precioArs: 185_000,
    stock: 2,
    talle: 'L',
    condicion: 'EXCELENTE',
    kitType: 'home',
    manga: 'short',
    club: 'boca-juniors',
    marca: 'nike',
    competicion: 'copa-libertadores',
    temporada: '2001',
    fotos: 4,
    colores: AZUL_ORO,
    patron: 'banda',
    numero: 10,
    estado: 'active',
  },
  {
    clave: 'river-1996',
    titulo: 'Camiseta River Plate titular 1996 Adidas',
    descripcion:
      'La de la Libertadores del 96, con la banda ancha y el sponsor Quilmes. Talle M, uso de epoca, sin manchas.',
    categoria: 'camiseta',
    precioArs: 240_000,
    stock: 1,
    talle: 'M',
    condicion: 'MUY_BUENO',
    kitType: 'home',
    manga: 'short',
    club: 'river-plate',
    marca: 'adidas',
    competicion: 'copa-libertadores',
    temporada: '1996',
    fotos: 3,
    colores: BLANCO_ROJO,
    patron: 'banda',
    numero: 9,
    estado: 'active',
  },
  {
    clave: 'argentina-2022',
    titulo: 'Camiseta Argentina titular 2022 Adidas tres estrellas',
    descripcion:
      'Version aficionado (Aeroready), nueva con etiquetas. Parche de campeon del mundo.',
    categoria: 'camiseta',
    precioArs: 95_000,
    stock: 5,
    talle: 'L',
    condicion: 'NUEVO',
    kitType: 'home',
    manga: 'short',
    seleccion: 'argentina',
    marca: 'adidas',
    competicion: 'mundial',
    temporada: '2022-23',
    fotos: 2,
    colores: CELESTE,
    patron: 'celeste-blanca',
    numero: 10,
    estado: 'active',
  },
  {
    clave: 'argentina-1986',
    titulo: 'Camiseta Argentina suplente 1986 Le Coq Sportif',
    descripcion:
      'La azul de la semifinal y de la mano de Dios. Reedicion de epoca, talle XL. Tiene algo de desgaste en el cuello.',
    categoria: 'camiseta',
    precioArs: 320_000,
    stock: 1,
    talle: 'XL',
    condicion: 'BUENO',
    kitType: 'away',
    manga: 'short',
    seleccion: 'argentina',
    marca: 'le-coq-sportif',
    competicion: 'mundial',
    temporada: '1986',
    fotos: 3,
    colores: AZUL_BLANCO,
    patron: 'liso',
    numero: 10,
    estado: 'active',
  },
  {
    clave: 'independiente-1984',
    titulo: 'Camiseta Independiente titular 1984 Adidas',
    descripcion:
      'La del Rojo campeon de America e Intercontinental. Reedicion de coleccion, manga larga.',
    categoria: 'camiseta',
    precioArs: 150_000,
    stock: 2,
    talle: 'M',
    condicion: 'MUY_BUENO',
    kitType: 'home',
    manga: 'long',
    club: 'independiente',
    marca: 'adidas',
    competicion: 'copa-libertadores',
    temporada: '1984',
    fotos: 2,
    colores: ROJO,
    patron: 'liso',
    numero: 10,
    estado: 'active',
  },
  {
    clave: 'racing-2001',
    titulo: 'Camiseta Racing Club titular 2001 Topper',
    descripcion: 'La del Apertura 2001, el campeonato despues de 35 anos. Talle L, muy cuidada.',
    categoria: 'camiseta',
    precioArs: 130_000,
    stock: 3,
    talle: 'L',
    condicion: 'EXCELENTE',
    kitType: 'home',
    manga: 'short',
    club: 'racing-club',
    marca: 'topper',
    competicion: 'liga-profesional',
    temporada: '2001',
    fotos: 3,
    colores: CELESTE_BLANCA_RACING,
    patron: 'celeste-blanca',
    numero: 8,
    estado: 'active',
  },
  {
    clave: 'san-lorenzo-2014',
    titulo: 'Camiseta San Lorenzo titular 2014 Lotto',
    descripcion: 'La de la primera Libertadores del Ciclon. Talle M, con el parche de la Conmebol.',
    categoria: 'camiseta',
    precioArs: 110_000,
    stock: 2,
    talle: 'M',
    condicion: 'EXCELENTE',
    kitType: 'home',
    manga: 'short',
    club: 'san-lorenzo',
    marca: 'lotto',
    competicion: 'copa-libertadores',
    temporada: '2014',
    fotos: 2,
    colores: AZUL_ROJO,
    patron: 'rayas',
    numero: 11,
    estado: 'active',
  },
  {
    clave: 'rosario-central-2023',
    titulo: 'Camiseta Rosario Central titular 2023',
    descripcion: 'La del Canalla campeon de la Copa de la Liga 2023. Talle L, un solo uso.',
    categoria: 'camiseta',
    precioArs: 72_000,
    stock: 4,
    talle: 'L',
    condicion: 'COMO_NUEVO',
    kitType: 'home',
    manga: 'short',
    club: 'rosario-central',
    competicion: 'copa-de-la-liga',
    temporada: '2023',
    fotos: 1,
    colores: AMARILLO_AZUL,
    patron: 'rayas',
    numero: 5,
    estado: 'active',
  },
  {
    clave: 'newells-2013',
    titulo: "Camiseta Newell's Old Boys titular 2013 Topper",
    descripcion: 'La del Torneo Final 2013 con el Tata Martino. Talle S, roja y negra a bastones.',
    categoria: 'camiseta',
    precioArs: 98_000,
    stock: 2,
    talle: 'S',
    condicion: 'MUY_BUENO',
    kitType: 'home',
    manga: 'short',
    club: 'newells-old-boys',
    marca: 'topper',
    competicion: 'liga-profesional',
    temporada: '2013',
    fotos: 2,
    colores: ROJO_NEGRO,
    patron: 'mitades',
    numero: 7,
    estado: 'active',
  },
  {
    clave: 'velez-1994',
    titulo: 'Camiseta Velez Sarsfield titular 1994 Olympikus',
    descripcion:
      'La de la Libertadores y la Intercontinental contra el Milan. Talle L, con la V azul original.',
    categoria: 'camiseta',
    precioArs: 165_000,
    stock: 2,
    talle: 'L',
    condicion: 'BUENO',
    kitType: 'home',
    manga: 'short',
    club: 'velez-sarsfield',
    marca: 'olympikus',
    competicion: 'copa-libertadores',
    temporada: '1994',
    fotos: 3,
    colores: BLANCO_AZUL,
    patron: 'banda',
    numero: 1,
    estado: 'active',
  },
  {
    clave: 'estudiantes-2009',
    titulo: 'Camiseta Estudiantes de La Plata titular 2009 Adidas',
    descripcion: 'La de la cuarta Libertadores del Pincha, con Veron. Talle XL, impecable.',
    categoria: 'camiseta',
    precioArs: 125_000,
    stock: 2,
    talle: 'XL',
    condicion: 'EXCELENTE',
    kitType: 'home',
    manga: 'short',
    club: 'estudiantes-la-plata',
    marca: 'adidas',
    competicion: 'copa-libertadores',
    temporada: '2009',
    fotos: 2,
    colores: BLANCO_ROJO,
    patron: 'rayas',
    numero: 11,
    estado: 'active',
  },
  {
    clave: 'talleres-2022',
    titulo: 'Camiseta Talleres de Cordoba alternativa 2022',
    descripcion: 'Alternativa negra de la Libertadores 2022. Talle M, sin uso.',
    categoria: 'camiseta',
    precioArs: 68_000,
    stock: 3,
    talle: 'M',
    condicion: 'NUEVO',
    kitType: 'away',
    manga: 'short',
    club: 'talleres',
    competicion: 'copa-libertadores',
    temporada: '2022',
    fotos: 1,
    colores: NEGRO_ORO,
    patron: 'liso',
    numero: 26,
    estado: 'active',
  },
  {
    clave: 'argentina-1990-arquero',
    titulo: 'Camiseta Argentina arquero 1990 Adidas Goycochea',
    descripcion: 'La gris del Goyco en Italia 90, manga larga. Talle L, reedicion de coleccion.',
    categoria: 'camiseta',
    precioArs: 140_000,
    stock: 2,
    talle: 'L',
    condicion: 'MUY_BUENO',
    kitType: 'goalkeeper',
    manga: 'long',
    seleccion: 'argentina',
    marca: 'adidas',
    competicion: 'mundial',
    temporada: '1990',
    fotos: 2,
    colores: GRIS,
    patron: 'liso',
    numero: 12,
    estado: 'active',
  },
  {
    clave: 'boca-2007',
    titulo: 'Camiseta Boca Juniors suplente 2007 Nike',
    descripcion: 'La blanca de la Libertadores 2007 con Riquelme. Talle L, dos usos.',
    categoria: 'camiseta',
    precioArs: 115_000,
    stock: 3,
    talle: 'L',
    condicion: 'COMO_NUEVO',
    kitType: 'away',
    manga: 'short',
    club: 'boca-juniors',
    marca: 'nike',
    competicion: 'copa-libertadores',
    temporada: '2007',
    fotos: 2,
    colores: { base: '#ffffff', secundario: '#0a3d91', detalle: '#f2c318' },
    patron: 'banda',
    numero: 10,
    estado: 'active',
  },
  {
    clave: 'buzo-racing-2019',
    titulo: 'Buzo de entrenamiento Racing Club 2019 Kappa',
    descripcion: 'Buzo de salida del plantel campeon de la Superliga 2018/19. Talle L.',
    categoria: 'buzo',
    precioArs: 55_000,
    stock: 2,
    talle: 'L',
    condicion: 'BUENO',
    kitType: null,
    manga: null,
    club: 'racing-club',
    marca: 'kappa',
    competicion: 'liga-profesional',
    temporada: '2018-19',
    fotos: 1,
    colores: { base: '#1d3f8f', secundario: '#59b3e8', detalle: '#ffffff' },
    patron: 'liso',
    numero: 19,
    estado: 'active',
  },
  {
    clave: 'short-river-2018',
    titulo: 'Short River Plate titular 2018 Adidas',
    descripcion: 'Short de la final de Madrid. Talle M, sin uso.',
    categoria: 'short',
    precioArs: 38_000,
    stock: 4,
    talle: 'M',
    condicion: 'NUEVO',
    kitType: null,
    manga: null,
    club: 'river-plate',
    marca: 'adidas',
    competicion: 'copa-libertadores',
    temporada: '2018',
    fotos: 1,
    colores: { base: '#111111', secundario: '#d81e2b', detalle: '#ffffff' },
    patron: 'liso',
    numero: 18,
    estado: 'active',
  },
  {
    clave: 'huracan-2015',
    titulo: 'Camiseta Huracan titular 2015 Nike',
    descripcion:
      'La de la Supercopa Argentina 2014 jugada en 2015. Talle M. PAUSADA por el vendedor.',
    categoria: 'camiseta',
    precioArs: 80_000,
    stock: 2,
    talle: 'M',
    condicion: 'MUY_BUENO',
    kitType: 'home',
    manga: 'short',
    club: 'huracan',
    marca: 'nike',
    competicion: 'supercopa-argentina',
    temporada: '2015',
    fotos: 2,
    colores: { base: '#ffffff', secundario: '#d81e2b', detalle: '#d81e2b' },
    patron: 'liso',
    numero: 10,
    estado: 'paused',
  },
  {
    clave: 'lanus-2016',
    titulo: 'Camiseta Lanus titular 2016 Nike',
    descripcion: 'La del Granate campeon del Transicion 2016. Talle L. BORRADOR sin fotos.',
    categoria: 'camiseta',
    precioArs: 70_000,
    stock: 1,
    talle: 'L',
    condicion: 'EXCELENTE',
    kitType: 'home',
    manga: 'short',
    club: 'lanus',
    marca: 'nike',
    competicion: 'liga-profesional',
    temporada: '2016',
    fotos: 0,
    colores: { base: '#7a1f2b', secundario: '#ffffff', detalle: '#ffffff' },
    patron: 'liso',
    numero: 9,
    estado: 'draft',
  },
  {
    clave: 'gimnasia-2021',
    titulo: 'Camiseta Gimnasia y Esgrima La Plata titular 2021 Le Coq Sportif',
    descripcion: 'Ultima unidad: se vende con la orden pagada del seed y queda AGOTADA (SS-051).',
    categoria: 'camiseta',
    precioArs: 62_000,
    stock: 1,
    talle: 'M',
    condicion: 'COMO_NUEVO',
    kitType: 'home',
    manga: 'short',
    club: 'gimnasia-la-plata',
    marca: 'le-coq-sportif',
    competicion: 'liga-profesional',
    temporada: '2021',
    fotos: 2,
    colores: BLANCO_AZUL,
    patron: 'rayas',
    numero: 6,
    estado: 'active',
  },
];

/** Publicaciones del vendedor SIN Mercado Pago: activas, pero la vitrina las esconde (SS-013). */
const PUBLICACIONES_SIN_MP: DefinicionDePublicacion[] = [
  {
    clave: 'sinmp-colon-2021',
    titulo: 'Camiseta Colon de Santa Fe titular 2021 Kelme',
    descripcion: 'La del Sabalero campeon de la Copa de la Liga 2021. Talle L.',
    categoria: 'camiseta',
    precioArs: 75_000,
    stock: 2,
    talle: 'L',
    condicion: 'EXCELENTE',
    kitType: 'home',
    manga: 'short',
    club: 'colon',
    competicion: 'copa-de-la-liga',
    temporada: '2021',
    fotos: 2,
    colores: ROJO_NEGRO,
    patron: 'rayas',
    numero: 7,
    estado: 'active',
  },
  {
    clave: 'sinmp-banfield-2009',
    titulo: 'Camiseta Banfield titular 2009 Penalty',
    descripcion: 'La del Taladro campeon del Apertura 2009. Talle M.',
    categoria: 'camiseta',
    precioArs: 90_000,
    stock: 1,
    talle: 'M',
    condicion: 'MUY_BUENO',
    kitType: 'home',
    manga: 'short',
    club: 'banfield',
    marca: 'penalty',
    competicion: 'liga-profesional',
    temporada: '2009',
    fotos: 1,
    colores: VERDE,
    patron: 'liso',
    numero: 10,
    estado: 'active',
  },
  {
    clave: 'sinmp-argentina-2014',
    titulo: 'Camiseta Argentina suplente 2014 Adidas',
    descripcion: 'La azul del Mundial de Brasil. Talle L, con etiquetas.',
    categoria: 'camiseta',
    precioArs: 85_000,
    stock: 3,
    talle: 'L',
    condicion: 'NUEVO',
    kitType: 'away',
    manga: 'short',
    seleccion: 'argentina',
    marca: 'adidas',
    competicion: 'mundial',
    temporada: '2014',
    fotos: 1,
    colores: AZUL_BLANCO,
    patron: 'liso',
    numero: 10,
    estado: 'active',
  },
];

/** Publicaciones del vendedor con la conexion VENCIDA: mismo efecto en la vitrina. */
const PUBLICACIONES_EXPIRADO: DefinicionDePublicacion[] = [
  {
    clave: 'exp-quilmes-1991',
    titulo: 'Camiseta Quilmes titular 1991 Adidas',
    descripcion: 'La cervecera del Nacional B 91. Talle L, uso de epoca.',
    categoria: 'camiseta',
    precioArs: 60_000,
    stock: 1,
    talle: 'L',
    condicion: 'BUENO',
    kitType: 'home',
    manga: 'short',
    club: 'quilmes',
    marca: 'adidas',
    temporada: '1991',
    fotos: 1,
    colores: { base: '#ffffff', secundario: '#1d3f8f', detalle: '#1d3f8f' },
    patron: 'liso',
    numero: 9,
    estado: 'active',
  },
  {
    clave: 'exp-tigre-2019',
    titulo: 'Camiseta Tigre titular 2019 Kappa',
    descripcion: 'La del Matador campeon de la Copa de la Superliga 2019. Talle M.',
    categoria: 'camiseta',
    precioArs: 58_000,
    stock: 2,
    talle: 'M',
    condicion: 'COMO_NUEVO',
    kitType: 'home',
    manga: 'short',
    club: 'tigre',
    marca: 'kappa',
    competicion: 'copa-de-la-liga',
    temporada: '2019',
    fotos: 2,
    colores: { base: '#0a3d91', secundario: '#d81e2b', detalle: '#ffffff' },
    patron: 'rayas',
    numero: 10,
    estado: 'active',
  },
];

/** Ids de catalogo indexados por slug, para resolver las definiciones. */
interface Catalogos {
  categorias: Map<Categoria, string>;
  clubes: Map<string, string>;
  selecciones: Map<string, string>;
  marcas: Map<string, string>;
  competiciones: Map<string, string>;
  temporadas: Map<string, string>;
}

async function cargarCatalogos(): Promise<Catalogos> {
  const porSlug = (filas: { id: string; slug: string }[]) =>
    new Map(filas.map((fila) => [fila.slug, fila.id]));

  const categorias = await listingService.listActiveCategories();
  const catalogos = await listingService.listCatalogs();

  return {
    categorias: new Map(categorias.map((c) => [c.code as Categoria, c.id])),
    clubes: porSlug(catalogos.clubes),
    selecciones: porSlug(catalogos.selecciones),
    marcas: porSlug(catalogos.marcas),
    competiciones: porSlug(catalogos.competiciones),
    temporadas: porSlug(catalogos.temporadas),
  };
}

/**
 * Resuelve un slug contra su catalogo. Un slug que no existe es un error del
 * seed, no un dato opcional: se corta para no sembrar una publicacion sin el
 * club que el titulo promete.
 */
function idDeCatalogo(
  mapa: Map<string, string>,
  slug: string | undefined,
  nombre: string,
): string | null {
  if (slug === undefined) return null;

  const id = mapa.get(slug);
  if (id === undefined) throw new Error(`No existe ${nombre} '${slug}' en el catalogo sembrado`);

  return id;
}

function inputDePublicacion(
  def: DefinicionDePublicacion,
  catalogos: Catalogos,
): listingService.PublishListingInput {
  const categoryId = catalogos.categorias.get(def.categoria);
  if (categoryId === undefined) throw new Error(`No existe la categoria '${def.categoria}'`);

  return {
    categoryId,
    title: def.titulo,
    description: def.descripcion,
    // Centavos, como todo el dinero del ERD (§1).
    priceAmount: BigInt(def.precioArs) * 100n,
    stock: def.stock,
    sizeValue: def.talle,
    condition: def.condicion,
    kitType: def.kitType,
    sleeve: def.manga,
    clubId: idDeCatalogo(catalogos.clubes, def.club, 'el club'),
    nationalTeamId: idDeCatalogo(catalogos.selecciones, def.seleccion, 'la seleccion'),
    brandId: idDeCatalogo(catalogos.marcas, def.marca, 'la marca'),
    competitionId: idDeCatalogo(catalogos.competiciones, def.competicion, 'la competicion'),
    seasonId: idDeCatalogo(catalogos.temporadas, def.temporada, 'la temporada'),
  };
}

/**
 * Fotos + activacion + estado final, todo por Services.
 *
 * Refleja SS-032 tal cual: la publicacion nace en borrador, se activa recien
 * con una foto (PS-010) y despues, si corresponde, el vendedor la pausa.
 */
async function completarPublicacion(
  user: PublicUser,
  listingId: string,
  def: DefinicionDePublicacion,
): Promise<void> {
  if (def.estado === 'draft') return;

  await subirFotos(user, listingId, def);

  const activada = await listingImageService.activateListing(user, listingId);
  if (!activada) throw new Error(`No se pudo activar '${def.titulo}'`);

  if (def.estado === 'paused') {
    await listingEditingService.pauseListing(user, listingId);
  }
}

/** Publica por el Service: exige vendedor aprobado con Mercado Pago conectado. */
async function publicar(
  vendedor: Vendedor,
  definiciones: DefinicionDePublicacion[],
  catalogos: Catalogos,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const def of definiciones) {
    const creada = await listingService.publishListing(
      vendedor.user,
      inputDePublicacion(def, catalogos),
    );
    await completarPublicacion(vendedor.user, creada.id, def);
    ids.set(def.clave, creada.id);
  }

  return ids;
}

/**
 * DIRECTO (repositorio): publicaciones de un vendedor que NO puede operar.
 *
 * `publishListing` rechaza con `SELLER_NOT_OPERATIONAL` a quien no tiene
 * Mercado Pago conectado, y eso es correcto. Pero para probar que la vitrina
 * ESCONDE esas publicaciones (SS-013) hace falta que existan activas, y el
 * unico camino es insertar la fila como lo hace el Service —misma moderacion
 * automatica, mismo reindexado— sin pasar por su guard. Las fotos y la
 * activacion SI van por los Services, que solo exigen ser el dueno.
 */
async function publicarSinOperar(
  vendedor: Vendedor,
  definiciones: DefinicionDePublicacion[],
  catalogos: Catalogos,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const def of definiciones) {
    const input = inputDePublicacion(def, catalogos);

    const creada = await listingRepo.insertListing({
      sellerId: vendedor.sellerId,
      categoryId: input.categoryId,
      title: input.title,
      description: input.description,
      priceAmount: input.priceAmount,
      currency: 'ARS',
      // Envio declarado (delta §11): el camino directo no pasa por el Service,
      // asi que copia lo que el Service escribiria con la configuracion por
      // defecto.
      shippingMode: 'included',
      shippingCostAmount: null,
      stock: input.stock,
      sizeValue: input.sizeValue,
      condition: input.condition,
      kitType: input.kitType,
      sleeve: input.sleeve,
      clubId: input.clubId ?? null,
      nationalTeamId: input.nationalTeamId ?? null,
      brandId: input.brandId ?? null,
      competitionId: input.competitionId ?? null,
      seasonId: input.seasonId ?? null,
      // Mismo valor que escribe `publishListing`: decision transitoria del owner.
      moderationStatus: 'APPROVED',
    });

    await searchService.reindex(creada.id);
    await completarPublicacion(vendedor.user, creada.id, def);
    ids.set(def.clave, creada.id);
  }

  return ids;
}

/* -------------------------------------------------------------------------- */
/* Ordenes y pagos                                                             */
/* -------------------------------------------------------------------------- */

function idDe(ids: Map<string, string>, clave: string): string {
  const id = ids.get(clave);
  if (id === undefined) throw new Error(`No se sembro la publicacion '${clave}'`);

  return id;
}

/**
 * DIRECTO (repositorios de `payments` + Services de `orders`): pago aprobado.
 *
 * El camino real es `handleNotification` → `syncPaymentFromMercadoPago`, que
 * RECONSULTA el pago a la API de Mercado Pago con el token del vendedor
 * (PC-041): nunca confia en el payload. Sin Mercado Pago no hay nada que
 * reconsultar, asi que no se puede reusar ni con un payload fabricado y firma
 * valida. Se replica lo que ese Service hace despues de la reconsulta, en la
 * MISMA transaccion que el real:
 *
 *   1. registra el evento de webhook (clave de idempotencia `seed-*`)
 *   2. vuelca el estado de MP en `payments`
 *   3. pasa la orden a PAID con `orderService.markAsPaid`
 *   4. descuenta stock con `orderService.decrementStockForOrder` —que es lo
 *      que marca `sold_out` a la publicacion que vende su ultima unidad—
 *   5. registra el reparto en `payment_splits`
 *   6. audita
 */
async function aprobarPago(orderId: string, mpUserId: string): Promise<void> {
  const encontrada = await orderService.getOrderForPayment(orderId);
  if (encontrada === null) throw new Error(`No existe la orden ${orderId}`);

  const { order } = encontrada;
  if (order.commissionAmount === null || order.sellerAmount === null) {
    throw new Error(`La orden ${order.orderNumber} no tiene snapshot de comision`);
  }

  // Id numerico como los de Mercado Pago, derivado de la orden para que dos
  // corridas no choquen entre si ni con un pago real.
  const mpPaymentId = String(1_000_000_000 + (parseInt(order.id.slice(0, 8), 16) % 900_000_000));
  const approvedAt = new Date();

  const total = order.totalAmount;
  const comision = order.commissionAmount;
  const costoMp = (total * COSTO_MP_SIMULADO_BP) / BASIS_POINTS_TOTAL;
  const netoVendedor = total - comision - costoMp;
  const pesos = (centavos: bigint) => Number(centavos) / 100;

  /** Imita la respuesta de `GET /v1/payments/:id`. Marcado como fabricado. */
  const raw = {
    id: Number(mpPaymentId),
    status: 'approved',
    status_detail: 'accredited',
    external_reference: order.id,
    transaction_amount: pesos(total),
    currency_id: order.currency,
    payment_method_id: 'visa',
    payment_type_id: 'credit_card',
    installments: 1,
    date_approved: approvedAt.toISOString(),
    marketplace_fee: pesos(comision),
    transaction_details: { net_received_amount: pesos(netoVendedor) },
    fee_details: [
      { type: 'mercadopago_fee', amount: pesos(costoMp), fee_payer: 'collector' },
      { type: 'application_fee', amount: pesos(comision), fee_payer: 'collector' },
    ],
    collector_id: mpUserId,
    seed: true,
  };

  const pago = await paymentRepo.insertPending({
    orderId: order.id,
    amount: total,
    currency: order.currency,
    idempotencyKey: randomUUID(),
  });
  await paymentRepo.attachPreference(pago.id, `seed-pref-${mpPaymentId}`);

  const notificacion: webhookService.WebhookNotification = {
    type: 'payment',
    action: 'payment.updated',
    dataId: mpPaymentId,
    notificationId: `seed-${mpPaymentId}`,
    mpUserId,
  };

  const evento = await webhookRepo.recordIfNew({
    provider: 'mercadopago',
    eventType: 'payment.updated',
    resourceId: mpPaymentId,
    idempotencyKey: webhookService.buildEventKey(notificacion),
    signatureValid: true,
    payload: { action: 'payment.updated', type: 'payment', data: { id: mpPaymentId }, seed: true },
  });
  if (evento === null) throw new Error(`El evento de webhook ${mpPaymentId} ya existia`);

  await getDatabase().transaction(async (tx) => {
    await paymentRepo.applyMercadoPagoState(
      pago.id,
      {
        status: 'APPROVED',
        mpPaymentId,
        mpStatus: 'approved',
        mpStatusDetail: 'accredited',
        paymentMethod: 'visa',
        installments: 1,
        approvedAt,
        raw,
      },
      tx,
    );

    const transiciono = await orderService.markAsPaid(order.id, approvedAt, tx);
    if (!transiciono) throw new Error(`La orden ${order.orderNumber} no estaba PENDING_PAYMENT`);

    const faltantes = await orderService.decrementStockForOrder(order.id, tx);
    if (faltantes.length > 0) {
      throw new Error(`Sin stock para la orden ${order.orderNumber}: ${JSON.stringify(faltantes)}`);
    }

    await paymentRepo.insertSplit(
      {
        paymentId: pago.id,
        sellerAmount: netoVendedor,
        marketplaceFeeAmount: comision,
        mpFeeAmount: costoMp,
        currency: order.currency,
        raw,
      },
      tx,
    );

    await audit.record(
      {
        actorType: 'system',
        action: 'PAYMENT_APPROVED',
        entityType: 'payment',
        entityId: pago.id,
        metadata: {
          orderId: order.id,
          mpPaymentId,
          amount: total.toString(),
          mpStatus: 'approved',
          seed: true,
        },
      },
      tx,
    );

    await audit.record(
      {
        actorType: 'system',
        action: 'PAYMENT_STATUS_CHANGED',
        entityType: 'payment',
        entityId: pago.id,
        before: { status: 'PENDING' },
        after: { status: 'APPROVED' },
        metadata: { origin: 'webhook', mpStatus: 'approved', seed: true },
      },
      tx,
    );
  });

  await webhookRepo.markProcessed(evento.id, {});
}

/**
 * DIRECTO: cancelacion de una orden.
 *
 * DEC-029 fija `CANCELLED` como estado y `orders-and-refunds.md` describe la
 * cancelacion, pero el flujo no esta implementado —no hay Service, accion ni
 * pantalla—. Se escribe la transicion minima que el ERD §11.3 exige: el
 * estado, `cancelled_at` y la fila de `order_status_history` por el
 * repositorio de `orders`.
 */
async function cancelarOrden(orderId: string, comprador: PublicUser): Promise<void> {
  const canceladas = await getDatabase()
    .update(schema.orders)
    .set({ status: 'CANCELLED', cancelledAt: new Date() })
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, 'PENDING_PAYMENT')))
    .returning({ id: schema.orders.id });

  if (canceladas.length !== 1) throw new Error(`La orden ${orderId} no se pudo cancelar`);

  await orderRepo.appendStatusHistory({
    orderId,
    fromStatus: 'PENDING_PAYMENT',
    toStatus: 'CANCELLED',
    actorType: 'user',
    actorId: comprador.id,
    note: 'Cancelada por el comprador antes de pagar (seed)',
  });
}

/* -------------------------------------------------------------------------- */
/* Resumen                                                                     */
/* -------------------------------------------------------------------------- */

interface Credencial {
  email: string;
  rol: string;
}

async function resumen(credenciales: Credencial[]): Promise<void> {
  const conn = getDatabase();

  const userIds = (
    await conn
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(like(schema.users.email, `%${SUFIJO}`))
  ).map((u) => u.id);

  const sellerIds = (
    await conn
      .select({ id: schema.sellerProfiles.id })
      .from(schema.sellerProfiles)
      .where(inArray(schema.sellerProfiles.userId, userIds))
  ).map((s) => s.id);

  const publicaciones = await conn
    .select({ status: schema.listings.status, cantidad: count() })
    .from(schema.listings)
    .where(inArray(schema.listings.sellerId, sellerIds))
    .groupBy(schema.listings.status);

  const listingIds = (
    await conn
      .select({ id: schema.listings.id })
      .from(schema.listings)
      .where(inArray(schema.listings.sellerId, sellerIds))
  ).map((l) => l.id);

  const [fotos] = await conn
    .select({ cantidad: count() })
    .from(schema.listingImages)
    .where(inArray(schema.listingImages.listingId, listingIds));

  const ordenes = await conn
    .select({ status: schema.orders.status, cantidad: count() })
    .from(schema.orders)
    .where(inArray(schema.orders.sellerId, sellerIds))
    .groupBy(schema.orders.status);

  const [pagos] = await conn
    .select({ cantidad: count() })
    .from(schema.payments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.payments.orderId))
    .where(and(inArray(schema.orders.sellerId, sellerIds), eq(schema.payments.status, 'APPROVED')));

  const [visibles] = await conn
    .select({ cantidad: count() })
    .from(schema.listings)
    .innerJoin(
      schema.mercadopagoAccounts,
      eq(schema.mercadopagoAccounts.sellerId, schema.listings.sellerId),
    )
    .where(
      and(
        inArray(schema.listings.sellerId, sellerIds),
        eq(schema.listings.status, 'active'),
        eq(schema.mercadopagoAccounts.status, 'connected'),
      ),
    );

  imprimir();
  imprimir('=== Seed de desarrollo listo ===');
  imprimir(`usuarios: ${userIds.length} · vendedores: ${sellerIds.length}`);
  imprimir(
    `publicaciones: ${publicaciones.map((p) => `${p.status}=${p.cantidad}`).join(' · ')} ` +
      `(visibles en la vitrina: ${visibles?.cantidad ?? 0}) · fotos: ${fotos?.cantidad ?? 0}`,
  );
  imprimir(
    `ordenes: ${ordenes.map((o) => `${o.status}=${o.cantidad}`).join(' · ')} · pagos aprobados: ${pagos?.cantidad ?? 0}`,
  );
  imprimir();
  imprimir(`Credenciales (password para todos: ${PASSWORD})`);
  for (const c of credenciales) imprimir(`  ${c.email.padEnd(42)} ${c.rol}`);
  imprimir();
  imprimir(
    'Ingresar por /ingresar. Las fotos se sirven desde apps/web/public/uploads/ con `next dev`.',
  );
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

async function sembrar(): Promise<Credencial[]> {
  const credenciales: Credencial[] = [];

  // --- Admins -----------------------------------------------------------------
  const admin = await asignarRol(await usuarioVerificado('admin', 'Admin Offside'), 'ADMIN');
  credenciales.push({ email: admin.email, rol: 'ADMIN (back-office completo)' });

  const finanzas = await asignarRol(
    await usuarioVerificado('finanzas', 'Finanzas Offside'),
    'FINANCE',
  );
  credenciales.push({ email: finanzas.email, rol: 'FINANCE (consola de pagos)' });

  // --- Vendedores -------------------------------------------------------------
  const conectado = await vendedor('vendedor-conectado', 'Retro Cancha', {
    cuit: cuit('20', '30111222'),
    mercadoPago: 'conectado',
    mpUserId: '300000001',
  });
  credenciales.push({
    email: conectado.user.email,
    rol: 'vendedor aprobado, Mercado Pago conectado',
  });

  const sinMp = await vendedor('vendedor-sin-mp', 'La Vitrina de Palermo', {
    cuit: cuit('27', '28444555'),
    mercadoPago: 'sin-conectar',
  });
  credenciales.push({ email: sinMp.user.email, rol: 'vendedor pendiente, sin Mercado Pago' });

  const expirado = await vendedor('vendedor-expirado', 'Camisetas del Sur', {
    cuit: cuit('30', '71555666'),
    mercadoPago: 'conectado',
    mpUserId: '300000003',
  });
  credenciales.push({ email: expirado.user.email, rol: 'vendedor aprobado, Mercado Pago vencido' });

  // --- Compradores ------------------------------------------------------------
  const comprador = await usuarioVerificado('comprador', 'Lucia Fernandez');
  credenciales.push({ email: comprador.email, rol: 'comprador (3 ordenes)' });

  const comprador2 = await usuarioVerificado('comprador2', 'Martin Sosa');
  credenciales.push({ email: comprador2.email, rol: 'comprador (1 orden pagada)' });

  // --- Publicaciones ----------------------------------------------------------
  const catalogos = await cargarCatalogos();

  const ids = await publicar(conectado, PUBLICACIONES_CONECTADO, catalogos);
  imprimir(`[seed] ${ids.size} publicaciones del vendedor conectado`);

  const idsSinMp = await publicarSinOperar(sinMp, PUBLICACIONES_SIN_MP, catalogos);
  imprimir(
    `[seed] ${idsSinMp.size} publicaciones del vendedor sin Mercado Pago (ocultas en la vitrina)`,
  );

  // El vendedor expirado publico MIENTRAS estaba conectado —por el Service,
  // como cualquiera— y el vencimiento vino despues. Por eso la conexion se
  // vence recien aca y no en `vendedor()`.
  const idsExpirado = await publicar(expirado, PUBLICACIONES_EXPIRADO, catalogos);
  await vencerMercadoPago(expirado.sellerId);
  imprimir(`[seed] ${idsExpirado.size} publicaciones del vendedor con Mercado Pago vencido`);

  // --- Ordenes ----------------------------------------------------------------
  const pendiente = await orderService.createOrder(comprador, {
    listingId: idDe(ids, 'argentina-2022'),
    quantity: 1,
    shippingAddress: DIRECCION,
  });

  const pagada = await orderService.createOrder(comprador, {
    listingId: idDe(ids, 'gimnasia-2021'),
    quantity: 1,
    shippingAddress: DIRECCION,
  });
  await aprobarPago(pagada.id, '300000001');

  const cancelada = await orderService.createOrder(comprador, {
    listingId: idDe(ids, 'san-lorenzo-2014'),
    quantity: 1,
    shippingAddress: DIRECCION,
  });
  await cancelarOrden(cancelada.id, comprador);

  const pagada2 = await orderService.createOrder(comprador2, {
    listingId: idDe(ids, 'boca-2007'),
    quantity: 1,
    shippingAddress: DIRECCION_2,
  });
  await aprobarPago(pagada2.id, '300000001');

  imprimir(
    `[seed] ordenes base: ${pendiente.orderNumber} (esperando pago) · ${pagada.orderNumber} · ` +
      `${cancelada.orderNumber} (cancelada) · ${pagada2.orderNumber}`,
  );

  await sembrarCicloCompleto({ conectado, comprador, comprador2, admin, sinMp, ids, pagada });

  // `register` encolo una verificacion por cada usuario: se descartan.
  await vaciarColaDeEmails();

  return credenciales;
}

/* -------------------------------------------------------------------------- */
/* Ciclo completo: tiers, promocion, envio, reseñas, reclamos, panel           */
/* -------------------------------------------------------------------------- */

/**
 * Todo lo que el marketplace hace DESPUES de cobrar, sembrado por los Services
 * reales: niveles de vendedor, publicacion promocionada, el ciclo de la orden
 * hasta `COMPLETED`, reseña con respuesta, reclamo abierto y reclamo resuelto,
 * preguntas, favoritos, direcciones, notificaciones, carrito, vacaciones y una
 * sancion.
 *
 * ⚠️ NO HAY UN SOLO `INSERT` A MANO ACA. Cada fila pasa por el Service que la
 * escribe en produccion, asi que si una regla cambia, el seed falla en vez de
 * quedar con datos que el codigo real nunca produciria. La unica excepcion
 * sigue siendo la de siempre: el pago aprobado, que replica la transaccion del
 * webhook porque sin Mercado Pago no hay que reconsultar.
 *
 * ⚠️ TODO ESTO ES IDEMPOTENTE POR ARRASTRE: `limpiar()` borra las filas
 * sembradas antes de empezar, incluidas las tablas nuevas.
 */
async function sembrarCicloCompleto(datos: {
  conectado: Vendedor;
  comprador: PublicUser;
  comprador2: PublicUser;
  admin: PublicUser;
  sinMp: Vendedor;
  ids: Map<string, string>;
  pagada: { id: string; orderNumber: string };
}): Promise<void> {
  const { conectado, comprador, comprador2, admin, sinMp, ids } = datos;

  // --- Nivel del vendedor -----------------------------------------------------
  await tierService.assignInitialTier(conectado.sellerId);
  await tierService.assignInitialTier(sinMp.sellerId);

  // --- Direcciones ------------------------------------------------------------
  await addressService.createAddress(comprador, {
    etiqueta: 'Casa',
    nombre: DIRECCION.nombre,
    telefono: DIRECCION.telefono,
    calle: 'Av. Rivadavia',
    numero: '4520',
    departamento: '3° B',
    ciudad: DIRECCION.ciudad,
    provincia: 'CABA',
    codigoPostal: DIRECCION.codigoPostal,
    predeterminada: true,
  });
  await addressService.createAddress(comprador, {
    etiqueta: 'Trabajo',
    nombre: DIRECCION.nombre,
    calle: 'Reconquista',
    numero: '350',
    ciudad: DIRECCION.ciudad,
    provincia: 'CABA',
    codigoPostal: 'C1003ABH',
  });
  await addressService.createAddress(comprador2, {
    etiqueta: 'Casa',
    nombre: DIRECCION_2.nombre,
    telefono: DIRECCION_2.telefono,
    calle: 'Bv. Oroño',
    numero: '1180',
    ciudad: DIRECCION_2.ciudad,
    provincia: 'Santa Fe',
    codigoPostal: DIRECCION_2.codigoPostal,
    predeterminada: true,
  });

  /*
   * --- Publicaciones promocionadas -------------------------------------------
   *
   * ⚠️ SON DOS Y NO UNA, Y LA RAZON ES UN BUG QUE ESTE SEED YA TUVO. La
   * primera se VENDE mas abajo, en el ciclo completo, para que exista una
   * orden con la comision agravada y su snapshot (`commission_source =
   * 'promoted'`). Pero venderla agota su unica unidad: la publicacion pasa a
   * `sold_out`, desaparece de la vitrina y la seccion "Promocionadas" de la
   * home quedaba vacia. La segunda se queda a la venta para que esa seccion,
   * el distintivo en la grilla y el orden de la busqueda se puedan mirar.
   */
  const promocionada = idDe(ids, 'river-1996');
  await promotionService.promoteListing(conectado.user, promocionada);

  const enVidriera = idDe(ids, 'boca-2001');
  await promotionService.promoteListing(conectado.user, enVidriera);
  imprimir(
    '[seed] 2 publicaciones promocionadas (una se vende, la otra queda en vidriera): ' +
      'comisión agravada por el multiplicador ⚙️',
  );

  // --- Una venta que recorre TODO el ciclo ------------------------------------
  const completada = await orderService.createOrder(comprador, {
    listingId: promocionada,
    quantity: 1,
    shippingAddress: DIRECCION,
  });
  await aprobarPago(completada.id, '300000001');
  await orderService.markShipped(conectado.user, completada.id, {
    carrier: 'andreani',
    trackingNumber: 'AR-SEED-00012345',
  });
  await orderService.confirmDelivered(comprador, completada.id);
  await orderService.completeOrder(completada.id, { type: 'system' });

  // --- Reseña con respuesta del vendedor --------------------------------------
  const resena = await reviewService.createReview(comprador, {
    orderId: completada.id,
    rating: 5,
    comment: 'Llegó impecable y antes de lo que esperaba. La camiseta es tal cual las fotos.',
  });
  await reviewService.replyToReview(
    conectado.user,
    resena.id,
    '¡Gracias! Cualquier cosa que necesites, escribime.',
  );

  // --- Una venta en camino y otra en preparacion ------------------------------
  const enCamino = await orderService.createOrder(comprador2, {
    listingId: idDe(ids, 'racing-2001'),
    quantity: 1,
    shippingAddress: DIRECCION_2,
  });
  await aprobarPago(enCamino.id, '300000001');
  await orderService.markShipped(conectado.user, enCamino.id, {
    carrier: 'correo_argentino',
    trackingNumber: 'CA-SEED-99887766',
  });

  // --- Reclamo ABIERTO sobre la que esta en camino ----------------------------
  await disputeService.openDispute(comprador2, {
    orderId: enCamino.id,
    reason: 'not_received',
    description:
      'Hace seis días que figura despachada y el seguimiento no se movió. ¿Podés fijarte?',
    evidencias: ['El número de seguimiento no aparece en la web del correo.'],
  });

  // --- Reclamo RESUELTO sobre la ya completada --------------------------------
  const resuelto = await disputeService.openDispute(comprador, {
    orderId: completada.id,
    reason: 'condition_mismatch',
    description: 'La camiseta tiene una mancha chica en el dorso que no estaba en las fotos.',
    evidencias: ['Se ve a contraluz, cerca del número.'],
  });
  await disputeService.respondAsSeller(
    conectado.user,
    resuelto.id,
    'Tenés razón, no la vi al fotografiarla. Te devuelvo una parte y quedamos bien.',
  );

  /*
   * ⚠️ SE RESUELVE SIN REEMBOLSO, Y NO ES PEREZA: ejecutar uno llamaria a
   * Mercado Pago, que en desarrollo no existe. `no_action` deja el reclamo
   * cerrado y con su linea de tiempo completa, que es lo que las pantallas
   * necesitan mostrar.
   */
  await disputeService.resolve(admin, resuelto.id, {
    resolution: 'no_action',
    note: 'Las partes acordaron por fuera. Queda registrado para la reputación del vendedor.',
  });

  // --- Preguntas --------------------------------------------------------------
  const preguntada = idDe(ids, 'boca-2007');
  const pregunta = await questionService.askQuestion(
    comprador2,
    preguntada,
    '¿El talle L es de la época o entallado moderno?',
  );
  await questionService.answerQuestion(
    conectado.user,
    pregunta.id,
    'Es de la época, corte holgado. Mide 56 cm de ancho de pecho.',
  );
  await questionService.askQuestion(
    comprador,
    idDe(ids, 'independiente-1984'),
    '¿Hacés envío a Córdoba? ¿Tenés más fotos del cuello?',
  );

  // --- Favoritos --------------------------------------------------------------
  await favoriteService.toggleFavorite(comprador, idDe(ids, 'independiente-1984'));
  await favoriteService.toggleFavorite(comprador, idDe(ids, 'velez-1994'));
  await favoriteService.toggleFavorite(comprador2, promocionada);

  // --- Carrito con dos vendedores (DEC-026: una orden por vendedor) -----------
  await cartService.addToCart(comprador2, idDe(ids, 'talleres-2022'), 1);
  await cartService.addToCart(comprador2, idDe(ids, 'rosario-central-2023'), 1);

  // --- Reputacion y nivel de usuario ------------------------------------------
  await reputationService.recomputeSellerReputation(conectado.sellerId);
  await tierService.evaluateSellerTier(conectado.sellerId);

  // --- Vacaciones y sancion ---------------------------------------------------
  const hastaElDomingo = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await vacationService.setVacation(sinMp.user, hastaElDomingo);

  await sanctionService.applySanction(
    admin,
    sinMp.sellerId,
    'warning',
    'Fotos de catálogo en dos publicaciones. Aviso, sin limitación de venta.',
    {},
  );

  // --- Notificaciones in-app --------------------------------------------------
  await inappService.notify(
    comprador.id,
    'system',
    'Bienvenida a Offside',
    'Tu cuenta quedó verificada. Ya podés comprar y vender.',
    { kind: 'welcome' },
  );

  imprimir(
    '[seed] ciclo completo: venta COMPLETADA con reseña y respuesta, venta EN CAMINO con ' +
      'reclamo abierto, reclamo resuelto, 2 preguntas, 3 favoritos, 3 direcciones, ' +
      'carrito de 2 vendedores, 1 vendedor de vacaciones y 1 sanción',
  );
}

/**
 * Silencia el eco de consultas de Drizzle.
 *
 * `packages/database` activa el logger de Drizzle en desarrollo, y eso esta
 * bien para `next dev`. Para un seed son cientos de lineas de SQL que tapan el
 * resumen y las credenciales, que son lo unico que importa leer. Se filtran
 * SOLO esas lineas; cualquier otro `console.log` sigue saliendo.
 */
function silenciarLoggerDeDrizzle(): void {
  // eslint-disable-next-line no-console -- se envuelve el log, no se usa para imprimir
  const original = console.log.bind(console);

  // eslint-disable-next-line no-console -- idem
  console.log = (...args: unknown[]): void => {
    if (typeof args[0] === 'string' && args[0].startsWith('Query:')) return;
    original(...args);
  };
}

async function main(): Promise<void> {
  asegurarEntornoDeDesarrollo();
  silenciarLoggerDeDrizzle();

  try {
    await limpiar();
    const credenciales = await sembrar();
    await resumen(credenciales);
  } finally {
    await closeQueues();
    await closeRedisConnections();
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] fallo:', error);
  process.exit(1);
});
