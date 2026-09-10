import { getEnv } from '@offside/config';

import * as audit from '../../audit/services/audit.service';
import { createMercadoPagoOAuthClient } from '../infrastructure/mercadopago/mercadopago-oauth.client';
import {
  MercadoPagoOAuthError,
  type MercadoPagoOAuthPort,
} from '../infrastructure/mercadopago/mercadopago-oauth.port';
import * as lock from '../infrastructure/mercadopago/refresh-lock.store';
import * as mpRepo from '../repositories/mercadopago-account.repository';

/**
 * Renovacion de los tokens de Mercado Pago (`mercadopago-oauth-spec.md` §10).
 *
 * El `access_token` dura **180 dias** 🔴 y renovarlo exige que la autorizacion
 * se haya pedido con `scope=offline_access` 🔴 — Offside ya lo pide.
 *
 * ⚠️ MERCADO PAGO ROTA EL `refresh_token`: cada renovacion devuelve uno nuevo y
 * el anterior deja de servir. Todo el diseno de este archivo —el lock, la
 * revalidacion, el orden de escritura— existe por esa rotacion.
 *
 * ⚠️ FRONTERA DE SECRETOS: este archivo nunca ve un token en claro. Le pasa al
 * puerto el `refresh_token` CIFRADO y recibe credenciales CIFRADAS.
 *
 * ⚠️ POR QUE UN JOB Y NO UNA RENOVACION PEREZOSA (decision del owner,
 * 2026-08-27): un vendedor puede pasar meses sin vender, y con la renovacion
 * perezosa se enteraria del vencimiento en medio de un checkout, que es el peor
 * momento posible. El barrido programado cubre al vendedor dormido.
 */

const ENTITY_TYPE = 'mercadopago_account';

/** Resultado de intentar renovar un vendedor. */
export type RefreshOutcome =
  /** Renovado y persistido. */
  | 'refreshed'
  /** Otro proceso lo tenia tomado. No es un error: se reintenta en el proximo barrido. */
  | 'locked'
  /** Dejo de corresponder mientras se renovaba (se desconecto, o ya no vencia). */
  | 'skipped'
  /** Mercado Pago rechazo la renovacion: la conexion queda `expired`. */
  | 'rejected'
  /** No se pudo contactar a Mercado Pago. Se reintenta. */
  | 'unreachable';

export interface RefreshSummary {
  evaluadas: number;
  renovadas: number;
  rechazadas: number;
  fallidas: number;
}

const defaultClient = (): MercadoPagoOAuthPort => createMercadoPagoOAuthClient();

/** Fecha limite del barrido: ahora + la ventana configurada. */
export function refreshDeadline(now: Date = new Date()): Date {
  const dias = getEnv().MERCADOPAGO_TOKEN_REFRESH_WINDOW_DAYS;

  return new Date(now.getTime() + dias * 24 * 60 * 60 * 1000);
}

/**
 * Renueva UN vendedor, tomando el lock.
 *
 * Orden de las operaciones, y cada paso esta donde esta por una razon:
 *
 *   1. tomar el lock          — sin el, dos refresh se pisan el token rotado
 *   2. RELEER la conexion     — pudo cambiar entre que se la eligio y ahora
 *   3. revalidar que aplique  — sigue `connected`, sigue por vencer
 *   4. pedir el token a MP
 *   5. persistir              — condicionado otra vez a `connected` en el WHERE
 *   6. soltar el lock         — en `finally`, pase lo que pase
 */
export async function refreshSeller(
  sellerId: string,
  client: MercadoPagoOAuthPort = defaultClient(),
  now: Date = new Date(),
): Promise<RefreshOutcome> {
  if (!(await lock.acquire(sellerId))) return 'locked';

  try {
    // Se RELEE dentro del lock. La fila que eligio el barrido pudo haber sido
    // renovada, desconectada o reemplazada por una reconexion en el medio.
    const account = await mpRepo.findBySellerId(sellerId);

    if (
      account?.status !== 'connected' ||
      account.refreshTokenEncrypted === null ||
      account.tokenExpiresAt === null
    ) {
      return 'skipped';
    }

    // Si otro proceso ya la renovo, su vencimiento quedo lejos y no hay nada
    // que hacer. Evita renovar dos veces por un barrido superpuesto.
    if (account.tokenExpiresAt > refreshDeadline(now)) return 'skipped';

    let credenciales;
    try {
      credenciales = await client.refreshAccessToken({
        encryptedRefreshToken: account.refreshTokenEncrypted,
      });
    } catch (error) {
      return manejarFallo(sellerId, error);
    }

    // ⚠️ El WHERE exige `connected` otra vez: si el vendedor se desconecto
    // mientras Mercado Pago respondia, la renovacion NO puede reactivarlo
    // (spec §10). Devuelve `undefined` y no se escribe nada.
    const actualizada = await mpRepo.updateRefreshedCredentials(sellerId, {
      encryptedAccessToken: credenciales.encryptedAccessToken,
      encryptedRefreshToken: credenciales.encryptedRefreshToken,
      expiresAt: credenciales.expiresAt,
      scopes: credenciales.scopes,
    });

    if (actualizada === undefined) return 'skipped';

    await audit.record({
      actorType: 'system',
      action: 'MP_TOKEN_REFRESHED',
      entityType: ENTITY_TYPE,
      entityId: sellerId,
      // Metadata SIN secretos: solo el nuevo vencimiento y si rotó el refresh.
      metadata: {
        sellerId,
        expiresAt: credenciales.expiresAt.toISOString(),
        refreshTokenRotated: credenciales.encryptedRefreshToken !== null,
      },
    });

    return 'refreshed';
  } finally {
    // SIEMPRE. Si no se libera, ese vendedor queda trabado hasta que expire el
    // TTL del lock.
    await lock.release(sellerId);
  }
}

/**
 * Traduce un fallo del proveedor a un estado de la conexion.
 *
 * ⚠️ RECHAZO Y CAIDA DE RED NO SON LO MISMO. Si Mercado Pago rechaza, el
 * `refresh_token` ya no sirve y la conexion pasa a `expired`: el vendedor tiene
 * que reconectar. Si no hubo respuesta, el token probablemente siga bien y
 * marcarla seria romper una conexion sana por un problema de red.
 */
async function manejarFallo(sellerId: string, error: unknown): Promise<RefreshOutcome> {
  const esRechazo = error instanceof MercadoPagoOAuthError && error.failure === 'refresh_rejected';

  const detalle =
    error instanceof MercadoPagoOAuthError
      ? {
          failure: error.failure,
          ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
        }
      : { errorName: error instanceof Error ? error.name : typeof error };

  if (esRechazo) await mpRepo.updateStatus(sellerId, 'expired');

  await audit.record({
    actorType: 'system',
    action: 'MP_TOKEN_REFRESH_FAILED',
    entityType: ENTITY_TYPE,
    entityId: sellerId,
    metadata: { sellerId, expired: esRechazo, ...detalle },
  });

  return esRechazo ? 'rejected' : 'unreachable';
}

/**
 * Barrido: renueva todas las conexiones que vencen dentro de la ventana.
 *
 * ⚠️ NO SE DETIENE ANTE UN FALLO. Un vendedor cuyo `refresh_token` fue revocado
 * no puede impedir que se renueven los demas; por eso cada uno se maneja por
 * separado y el resumen cuenta los resultados en vez de propagar el primer
 * error.
 *
 * Secuencial a proposito: son pocas conexiones por barrido y golpear a Mercado
 * Pago en paralelo sin necesidad solo agrega riesgo de rate limiting.
 */
export async function refreshExpiring(
  client: MercadoPagoOAuthPort = defaultClient(),
  now: Date = new Date(),
): Promise<RefreshSummary> {
  const pendientes = await mpRepo.findExpiringConnections(refreshDeadline(now));

  const resumen: RefreshSummary = {
    evaluadas: pendientes.length,
    renovadas: 0,
    rechazadas: 0,
    fallidas: 0,
  };

  for (const cuenta of pendientes) {
    const resultado = await refreshSeller(cuenta.sellerId, client, now);

    if (resultado === 'refreshed') resumen.renovadas += 1;
    if (resultado === 'rejected') resumen.rechazadas += 1;
    if (resultado === 'unreachable') resumen.fallidas += 1;
  }

  if (resumen.evaluadas > 0) {
    console.warn(
      `[mercadopago] refresh: ${resumen.evaluadas} evaluadas, ${resumen.renovadas} renovadas, ` +
        `${resumen.rechazadas} rechazadas, ${resumen.fallidas} sin contactar`,
    );
  }

  return resumen;
}
