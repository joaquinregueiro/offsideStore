import { NextResponse } from 'next/server';

import { getCurrentUser, requireUser, requireVerifiedUser } from '@/lib/auth-guard';
import { mercadoPagoCallbackUrl } from '@/lib/frontend-routes';
import { handleError, ok } from '@/lib/http';
import { consumeIpLimit } from '@/lib/rate-limit';
import { AuthError, rateLimited } from '@/modules/auth/auth.errors';

import * as connectionService from '../services/mercadopago-connection.service';

/**
 * Controller de la conexion con Mercado Pago
 * (`docs-implementation/mercadopago-oauth-spec.md` §13).
 *
 * Sin reglas de negocio: valida entrada, aplica rate limit y traduce a HTTP.
 *
 * ⚠️ NUNCA loguea el `code`, el `state` ni el `error_description` que devuelve
 * Mercado Pago. El `code` es una credencial de un solo uso (spec §7 y §8).
 */

/** Consume una unidad del limite por IP o lanza `RATE_LIMITED`. */
async function enforceIpLimit(
  request: Request,
  scope: 'mp-connect' | 'mp-callback',
): Promise<void> {
  const decision = await consumeIpLimit(request, scope);
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
}

/**
 * `POST /api/sellers/mercadopago/connect`
 *
 * ⚠️ Devuelve la URL; NO redirige (MP-OAUTH-014). El frontend tiene que navegar
 * de verdad: un `fetch()` no puede seguir un redirect cross-origin hacia la
 * pantalla de login de Mercado Pago.
 */
export async function connect(request: Request): Promise<NextResponse> {
  try {
    await enforceIpLimit(request, 'mp-connect');

    // Email verificado (BR-001): conectar Mercado Pago es "operar".
    const user = await requireVerifiedUser(request);

    return ok(await connectionService.startConnection(user));
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Motivo generico que ve el frontend para cada error de dominio.
 *
 * ⚠️ El detalle tecnico queda SOLO en `audit_log` (spec §14). En particular, un
 * conflicto de cuenta jamas se comunica como "esa cuenta pertenece a otro
 * vendedor": eso permitiria descubrir que cuentas de Mercado Pago estan
 * registradas en Offside.
 */
function callbackReason(error: unknown): string {
  if (!(error instanceof AuthError)) return 'unexpected';

  switch (error.code) {
    case 'MP_INVALID_STATE':
    case 'NOT_AUTHENTICATED':
    case 'SESSION_INVALID':
      return 'invalid_state';
    case 'MP_ACCOUNT_CONFLICT':
      return 'account_conflict';
    case 'MP_EXCHANGE_FAILED':
      return 'exchange_failed';
    default:
      // Incluye MP_SELLER_NOT_APPROVED, FORBIDDEN y RATE_LIMITED: el vendedor
      // no puede completar la conexion, y el porque se ve en la pantalla de
      // Mercado Pago del panel, no en la URL.
      return 'unavailable';
  }
}

/**
 * `GET /api/sellers/mercadopago/callback`
 *
 * SI redirige (302): es una navegacion iniciada por el browser, no un `fetch`.
 * **Siempre** termina en un redirect al frontend, incluso ante error: devolver
 * un JSON dejaria al vendedor mirando una respuesta cruda de la API.
 */
export async function callback(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const code = params.get('code');
  const state = params.get('state');
  const oauthError = params.get('error');

  try {
    await enforceIpLimit(request, 'mp-callback');

    // El vendedor cancelo en la pantalla de Mercado Pago. No es un fallo del
    // sistema y no se audita: la spec §16 no contempla la cancelacion como
    // evento auditable, y no se inventa uno.
    if (oauthError === 'access_denied') {
      if (state !== null) await connectionService.discardPendingState(state);
      return NextResponse.redirect(mercadoPagoCallbackUrl('cancelled'), 302);
    }

    // Cualquier otro error devuelto por Mercado Pago: el intercambio nunca
    // llego a ocurrir. ⚠️ `error_description` NO se lee ni se registra.
    if (oauthError !== null) {
      if (state !== null) await connectionService.discardPendingState(state);
      return NextResponse.redirect(mercadoPagoCallbackUrl('error', 'exchange_failed'), 302);
    }

    if (code === null || state === null) {
      return NextResponse.redirect(mercadoPagoCallbackUrl('error', 'invalid_state'), 302);
    }

    // Sesion obligatoria: el `state` se valida contra el usuario autenticado
    // (spec §4 paso 18). Sin sesion no hay contra que validarlo.
    const user = await getCurrentUser(request);
    if (user === null) {
      return NextResponse.redirect(mercadoPagoCallbackUrl('error', 'invalid_state'), 302);
    }

    await connectionService.completeConnection(user, { code, state });

    return NextResponse.redirect(mercadoPagoCallbackUrl('connected'), 302);
  } catch (error) {
    if (!(error instanceof AuthError)) {
      // Un error inesperado se registra completo del lado del servidor, nunca
      // en la URL de retorno.
      console.error('[mercadopago] error no controlado en el callback:', error);
    }

    return NextResponse.redirect(mercadoPagoCallbackUrl('error', callbackReason(error)), 302);
  }
}

/**
 * `GET /api/sellers/mercadopago/status`
 *
 * ⚠️ NUNCA devuelve tokens (spec §13).
 */
export async function status(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(request);
    return ok(await connectionService.getConnectionStatus(user));
  } catch (error) {
    return handleError(error);
  }
}

/**
 * `POST /api/sellers/mercadopago/disconnect`
 *
 * Marca el estado local. NO revoca del lado de Mercado Pago (spec §12).
 */
export async function disconnect(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(request);
    return ok(await connectionService.disconnect(user));
  } catch (error) {
    return handleError(error);
  }
}
