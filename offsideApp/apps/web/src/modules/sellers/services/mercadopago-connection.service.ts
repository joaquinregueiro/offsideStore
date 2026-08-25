import { getDatabase, schema } from '@offside/database';
import { eq } from 'drizzle-orm';

import type { PublicUser } from '../../auth/services/auth.service';
import * as audit from '../../audit/services/audit.service';
import {
  requestWithEncryptedToken,
  type AuthorizedRequest,
  type AuthorizedResponse,
} from '../infrastructure/mercadopago/mercadopago-api.client';
import { createMercadoPagoOAuthClient } from '../infrastructure/mercadopago/mercadopago-oauth.client';
import {
  MercadoPagoOAuthError,
  type MercadoPagoOAuthPort,
} from '../infrastructure/mercadopago/mercadopago-oauth.port';
import * as stateStore from '../infrastructure/mercadopago/oauth-state.store';
import * as mpRepo from '../repositories/mercadopago-account.repository';
import type { SellerProfileRow } from '../repositories/seller.repository';
import * as errors from '../seller.errors';
import { deriveCodeChallenge, generateCodeVerifier, generateState } from './pkce';
import { requireOwnSellerProfile } from './seller.service';

/**
 * Conexion de la cuenta de Mercado Pago de un vendedor.
 *
 * Implementa `docs-implementation/mercadopago-oauth-spec.md`. Esta es la capa
 * de DOMINIO: decide, pero no sabe HTTP ni sabe hablar con Mercado Pago.
 *
 * ⚠️ FRONTERA DE SECRETOS (spec §2 y §8). Este archivo NUNCA ve:
 *   - `access_token` ni `refresh_token` en claro — los recibe ya cifrados;
 *   - `client_secret` — vive en `infrastructure/`;
 *   - `code_verifier` en el callback — lo lee del contexto y lo pasa a
 *     infraestructura sin tocarlo ni registrarlo.
 * El `authorization_code` no se persiste, no se audita y no se loguea (spec §7).
 *
 * ⚠️ ALCANCE: SOLO la conexion. Fuera de alcance por decision explicita —
 * refresh de tokens (spec §10), webhook `mp-connect` (§11) y Payments (§17).
 *
 * ⚠️ CONECTAR MERCADO PAGO NO APRUEBA AL VENDEDOR ni le da confianza
 * (BR-003 / SS-012). Es un requisito para vender, no un sello.
 */

const ENTITY_TYPE = 'mercadopago_account';

/** Estado de la conexion tal como se expone por API. NUNCA incluye tokens. */
export interface PublicMercadoPagoConnection {
  /** `null` si el vendedor nunca inicio una conexion. */
  status: mpRepo.MercadoPagoAccountStatus | null;
  connectedAt: string | null;
  expiresAt: string | null;
  mpUserId: string | null;
  canSell: boolean;
}

/**
 * `can_sell` es un PREDICADO DERIVADO, no una columna (spec §3).
 *
 * Un `can_sell` almacenado seria una tercera fuente de verdad que habria que
 * mantener sincronizada con las otras dos; Mercado Pago puede revocar la
 * autorizacion en cualquier momento y Offside se entera despues. Un predicado
 * calculado no puede desincronizarse.
 *
 * ⚠️ `limited` NO entra: el enum lo incluye pero la documentacion no define que
 * limita, y suponerlo seria inventar una regla de negocio (spec §3, 🟡).
 */
export function canSell(
  sellerStatus: SellerProfileRow['status'],
  mpStatus: mpRepo.MercadoPagoAccountStatus | null,
): boolean {
  return sellerStatus === 'approved' && mpStatus === 'connected';
}

function toPublicConnection(
  seller: SellerProfileRow,
  row: mpRepo.MercadoPagoAccountRow | undefined,
): PublicMercadoPagoConnection {
  return {
    status: row?.status ?? null,
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    expiresAt: row?.tokenExpiresAt?.toISOString() ?? null,
    mpUserId: row?.mpUserId ?? null,
    canSell: canSell(seller.status, row?.status ?? null),
  };
}

/**
 * Vendedor habilitado a conectar.
 *
 * ⚠️ EXIGE `approved` (spec §4 paso 5). Hoy NINGUN vendedor puede alcanzar ese
 * estado: la aprobacion depende de TS-001 —"que significa identidad
 * verificada"—, que sigue 🟡 PENDIENTE. Relajar este gate a `pending` seria
 * inventar la decision de negocio que TS-001 todavia no tomo, y contradiria
 * BR-003/SS-012.
 */
async function requireApprovedSeller(user: PublicUser): Promise<SellerProfileRow> {
  const seller = await requireOwnSellerProfile(user);
  if (seller.status !== 'approved') throw errors.sellerNotApproved();
  return seller;
}

/** Cliente por defecto. Inyectable para poder testear sin salir a la red. */
const defaultClient = (): MercadoPagoOAuthPort => createMercadoPagoOAuthClient();

export interface StartConnectionResult {
  authorizationUrl: string;
}

/**
 * Paso 1 — inicia la vinculacion (spec §4, pasos 1 a 13).
 *
 * ⚠️ DEVUELVE LA URL, NO REDIRIGE (MP-OAUTH-014). Un `fetch()` no puede seguir
 * un redirect cross-origin hacia la pantalla de login de un tercero: el browser
 * tiene que navegar de verdad, y eso lo hace el frontend.
 */
export async function startConnection(
  user: PublicUser,
  client: MercadoPagoOAuthPort = defaultClient(),
): Promise<StartConnectionResult> {
  const seller = await requireApprovedSeller(user);

  const existing = await mpRepo.findBySellerId(seller.id);
  if (existing?.status === 'connected') throw errors.mercadoPagoAlreadyConnected();

  const state = generateState();
  const codeVerifier = generateCodeVerifier();

  const saved = await stateStore.saveState(state, {
    userId: user.id,
    sellerId: seller.id,
    codeVerifier,
    createdAt: new Date().toISOString(),
  });

  // `NX` fallo: la clave ya existia. Con 256 bits de entropia es practicamente
  // imposible, y justamente por eso no se sobrescribe: se aborta.
  if (!saved) throw errors.mercadoPagoStateNotStored();

  await audit.record({
    actorType: 'user',
    actorId: user.id,
    action: 'MP_CONNECTION_STARTED',
    entityType: ENTITY_TYPE,
    entityId: seller.id,
    metadata: { sellerId: seller.id },
  });

  return {
    authorizationUrl: client.buildAuthorizationUrl({
      state,
      codeChallenge: deriveCodeChallenge(codeVerifier),
    }),
  };
}

/**
 * Descarta el contexto de un flujo que no se va a completar (cancelacion o
 * error devuelto por Mercado Pago).
 *
 * No valida nada ni informa nada: un `state` desconocido simplemente no existe.
 * Existe para que un flujo abandonado no deje su `code_verifier` esperando en
 * Redis los 600 segundos completos.
 */
export async function discardPendingState(state: string): Promise<void> {
  await stateStore.consumeState(state);
}

/** Registra un intento fallido. El motivo NUNCA incluye datos de la request. */
async function auditFailure(
  user: PublicUser,
  reason: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await audit.record({
    actorType: 'user',
    actorId: user.id,
    action: 'MP_CONNECTION_FAILED',
    entityType: ENTITY_TYPE,
    metadata: { reason, ...metadata },
  });
}

export interface CompleteConnectionInput {
  /** ⚠️ Credencial de un solo uso. No se persiste ni se audita (spec §7). */
  code: string;
  state: string;
}

/**
 * Paso 2 — completa la vinculacion (spec §4, pasos 16 a 25).
 */
export async function completeConnection(
  user: PublicUser,
  input: CompleteConnectionInput,
  client: MercadoPagoOAuthPort = defaultClient(),
): Promise<PublicMercadoPagoConnection> {
  // GETDEL atomico: el `state` es de un solo uso. Un replay del callback no
  // encuentra nada (spec §6 y §15).
  const context = await stateStore.consumeState(input.state);

  if (context === null) {
    await auditFailure(user, 'state_invalid');
    throw errors.mercadoPagoInvalidState();
  }

  // Impide vincular una cuenta de Mercado Pago usando el callback de otra
  // sesion (spec §15, account takeover).
  if (context.userId !== user.id) {
    await auditFailure(user, 'state_invalid');
    throw errors.mercadoPagoInvalidState();
  }

  // Se vuelve a resolver el vendedor: entre `connect` y el callback pudo pasar
  // cualquier cosa (una suspension, por ejemplo). El estado se verifica AHORA.
  const seller = await requireApprovedSeller(user);

  if (seller.id !== context.sellerId) {
    await auditFailure(user, 'state_invalid');
    throw errors.mercadoPagoInvalidState();
  }

  let credentials;
  try {
    credentials = await client.exchangeAuthorizationCode({
      code: input.code,
      codeVerifier: context.codeVerifier,
    });
  } catch (error) {
    // Se registra la CATEGORIA del fallo y el estado HTTP; nunca el cuerpo de
    // la respuesta ni ningun parametro de la request (spec §8 y §16).
    const detail =
      error instanceof MercadoPagoOAuthError
        ? {
            failure: error.failure,
            ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
          }
        : // No es un error de Mercado Pago: reviento algo nuestro dentro del
          // intercambio (tipicamente la clave de cifrado). Se guarda el NOMBRE
          // de la clase para poder distinguirlo sin adivinar.
          { errorName: error instanceof Error ? error.name : typeof error };

    await auditFailure(user, 'exchange_failed', detail);

    // ⚠️ Se loguea nombre y mensaje, NUNCA el stack ni el payload: todos los
    // errores que pueden llegar aca los produce codigo propio y sus mensajes no
    // contienen credenciales. Sin esto, un fallo nuestro es indistinguible de
    // un rechazo de Mercado Pago y hay que deducirlo leyendo el codigo.
    if (!(error instanceof MercadoPagoOAuthError)) {
      console.error(
        '[mercadopago] fallo no esperado al intercambiar el code:',
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      );
    }

    throw errors.mercadoPagoExchangeFailed();
  }

  const previous = await mpRepo.findBySellerId(seller.id);
  const owner = await mpRepo.findSellerIdByMpUserId(credentials.mpUserId);

  // Caso D (spec §9): la cuenta ya pertenece a OTRO vendedor. Se detecta antes
  // de escribir para devolver un error limpio en vez de una violacion de
  // `UNIQUE(mp_user_id)`.
  if (owner !== undefined && owner !== seller.id) {
    await audit.record({
      actorType: 'user',
      actorId: user.id,
      action: 'MP_ACCOUNT_CONFLICT',
      entityType: ENTITY_TYPE,
      entityId: seller.id,
      metadata: { mpUserId: credentials.mpUserId, reason: 'account_belongs_to_another_seller' },
    });

    throw errors.mercadoPagoAccountConflict();
  }

  // Caso C (spec §9): el mismo vendedor cambia de cuenta de Mercado Pago. Se
  // PERMITE, pero se audita: `UNIQUE(seller_id)` implica que la cuenta anterior
  // se sobrescribe y el ERD no modela historial. `audit_log` es el unico rastro
  // que queda de que hubo un cambio de cuenta.
  if (previous !== undefined && previous.mpUserId !== credentials.mpUserId) {
    await audit.record({
      actorType: 'user',
      actorId: user.id,
      action: 'MP_ACCOUNT_CONFLICT',
      entityType: ENTITY_TYPE,
      entityId: seller.id,
      metadata: {
        reason: 'seller_replaced_account',
        previousMpUserId: previous.mpUserId,
        mpUserId: credentials.mpUserId,
      },
    });
  }

  // La persistencia de credenciales y su auditoria van en la MISMA transaccion:
  // una credencial de un tercero guardada sin rastro es exactamente lo que el
  // ERD §19.1 obliga a evitar.
  const row = await getDatabase().transaction(async (tx) => {
    const saved = await mpRepo.upsertConnectedAccount(
      seller.id,
      {
        mpUserId: credentials.mpUserId,
        encryptedAccessToken: credentials.encryptedAccessToken,
        encryptedRefreshToken: credentials.encryptedRefreshToken,
        expiresAt: credentials.expiresAt,
        scopes: credentials.scopes,
        publicKey: credentials.publicKey,
      },
      tx,
    );

    await audit.record(
      {
        actorType: 'user',
        actorId: user.id,
        action: 'MP_CONNECTION_SUCCEEDED',
        entityType: ENTITY_TYPE,
        entityId: seller.id,
        // Metadata SIN secretos: identificadores y metadatos, jamas tokens.
        metadata: {
          mpUserId: credentials.mpUserId,
          scopes: credentials.scopes,
          expiresAt: credentials.expiresAt.toISOString(),
          liveMode: credentials.liveMode,
        },
      },
      tx,
    );

    return saved;
  });

  return toPublicConnection(seller, row);
}

/**
 * Estado de la conexion (spec §13).
 *
 * ⚠️ NUNCA devuelve tokens. `public_key` tampoco se expone aca: no hace falta
 * para saber si la conexion esta viva.
 */
export async function getConnectionStatus(user: PublicUser): Promise<PublicMercadoPagoConnection> {
  const seller = await requireOwnSellerProfile(user);
  return toPublicConnection(seller, await mpRepo.findBySellerId(seller.id));
}

/**
 * Desvinculacion manual (spec §12).
 *
 * Semantica: "Offside dejo de usar esta conexion". NO revoca del lado de
 * Mercado Pago — 🔵 no hay documentado ningun endpoint de revocacion invocable
 * por la aplicacion, y no se inventa uno. Si el vendedor quiere revocar la
 * autorizacion, debe hacerlo en su cuenta de Mercado Pago.
 *
 * ⚠️ NO TOCA `seller_profiles.status`: son dos maquinas de estado
 * independientes (spec §3).
 */
export async function disconnect(user: PublicUser): Promise<PublicMercadoPagoConnection> {
  const seller = await requireOwnSellerProfile(user);
  const existing = await mpRepo.findBySellerId(seller.id);

  // Sin fila no hay nada que desvincular. La spec §12 no contempla este caso;
  // se elige fallar explicitamente en vez de responder "disconnected" sobre
  // una conexion que nunca existio, que seria mentir sobre el estado.
  if (existing === undefined) throw errors.mercadoPagoNotConnected();

  const row = await getDatabase().transaction(async (tx) => {
    const updated = await mpRepo.updateStatus(seller.id, 'disconnected', tx);

    await audit.record(
      {
        actorType: 'user',
        actorId: user.id,
        action: 'MP_DISCONNECTED',
        entityType: ENTITY_TYPE,
        entityId: seller.id,
        before: { status: existing.status },
        after: { status: 'disconnected' },
        metadata: { reason: 'seller_request' },
      },
      tx,
    );

    return updated;
  });

  return toPublicConnection(seller, row);
}

/* -------------------------------------------------------------------------- */
/* Consumo de la conexion por OTROS modulos                                    */
/* -------------------------------------------------------------------------- */

export type { AuthorizedRequest, AuthorizedResponse };

/**
 * Ejecuta una llamada a Mercado Pago **con las credenciales del vendedor**.
 *
 * Es el unico punto por el que `payments` —o cualquier otro modulo— puede
 * operar sobre la cuenta conectada. Recibe QUE pedir y devuelve la respuesta
 * cruda; **nunca entrega el token** (mercadopago-payments-spec.md §4.1,
 * MP-PAY-001).
 *
 * Falla ANTES de salir a la red si la conexion no esta `connected`: no tiene
 * sentido gastar una llamada, y el error de dominio es mas claro que un 401 de
 * Mercado Pago.
 *
 * ⚠️ NO recibe un `PublicUser` a proposito: quien llama ya resolvio y autorizo
 * al vendedor. Este servicio no re-autoriza compradores ni ordenes.
 */
export async function requestAsSeller(
  sellerId: string,
  request: AuthorizedRequest,
): Promise<AuthorizedResponse> {
  const account = await mpRepo.findBySellerId(sellerId);

  if (account?.status !== 'connected') {
    throw errors.mercadoPagoNotConnected();
  }

  if (account.accessTokenEncrypted === null) {
    // Fila `connected` sin credenciales: estado imposible por el flujo normal,
    // pero si ocurre no se puede operar y hay que verlo.
    console.error(`[mercadopago] conexion sin access token para el vendedor ${sellerId}`);
    throw errors.mercadoPagoNotConnected();
  }

  return requestWithEncryptedToken(account.accessTokenEncrypted, request);
}

/**
 * Resuelve a que vendedor pertenece una cuenta de Mercado Pago.
 *
 * Lo necesita `payments` para saber con que credenciales consultar un pago
 * cuando llega un webhook: la notificacion trae el `user_id` de la cuenta de MP,
 * no el `seller_id` de Offside.
 *
 * Devuelve solo el id: quien pregunta no tiene por que recibir la fila con las
 * credenciales.
 */
export async function resolveSellerIdByMpUserId(mpUserId: string): Promise<string | null> {
  return (await mpRepo.findSellerIdByMpUserId(mpUserId)) ?? null;
}

/**
 * Si un vendedor puede vender AHORA: `can_sell` resuelto por `sellerId`.
 *
 * Lo necesita `orders` antes de crear una orden — no tiene sentido armar una
 * compra que despues no se va a poder cobrar. Reutiliza el mismo predicado que
 * expone el endpoint de estado; no hay una segunda definicion de `can_sell`.
 */
export async function canSellerOperate(sellerId: string): Promise<boolean> {
  const [seller] = await getDatabase()
    .select()
    .from(schema.sellerProfiles)
    .where(eq(schema.sellerProfiles.id, sellerId))
    .limit(1);

  if (seller === undefined) return false;

  const account = await mpRepo.findBySellerId(sellerId);

  return canSell(seller.status, account?.status ?? null);
}
