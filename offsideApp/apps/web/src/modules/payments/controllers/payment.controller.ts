import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminRole, requireVerifiedUser } from '@/lib/auth-guard';
import { handleError, ok, readJson } from '@/lib/http';
import { isValidWebhookSignature, readSignatureHeaders } from '@/lib/mercadopago-webhook-signature';
import { consumeIpLimit } from '@/lib/rate-limit';
import { rateLimited } from '@/modules/auth/auth.errors';

import * as paymentService from '../services/payment.service';
import * as refundService from '../services/refund.service';
import * as webhookService from '../services/payment-webhook.service';

/**
 * Controller de pagos. Sin reglas de negocio: valida entrada, aplica rate limit
 * y traduce a HTTP.
 *
 * ⚠️ NINGUN handler de este archivo llama a Mercado Pago. Eso vive en
 * `infrastructure/` (spec §4.2).
 */

/** Consume una unidad del limite por IP o lanza `RATE_LIMITED`. */
async function enforceIpLimit(request: Request, scope: 'checkout' | 'refund'): Promise<void> {
  const decision = await consumeIpLimit(request, scope);
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
}

/**
 * `POST /api/checkout/{orderId}`
 *
 * Devuelve `init_point`; **no redirige**. El frontend navega (mismo criterio
 * que `connect` en OAuth).
 */
export async function startCheckout(request: Request, orderId: string): Promise<NextResponse> {
  try {
    await enforceIpLimit(request, 'checkout');

    // Email verificado (BR-001): pagar es "operar".
    const user = await requireVerifiedUser(request);

    return ok(await paymentService.startCheckout(user, orderId));
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Cuerpo del reembolso.
 *
 * `amount` viaja como string en centavos: un `number` de JSON no puede
 * representar `bigint` sin riesgo de perder precision en importes grandes.
 */
const refundSchema = z.object({
  amount: z.string().regex(/^\d+$/, 'El importe debe ser un entero de centavos').optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

/**
 * `POST /api/payments/{paymentId}/refunds`
 *
 * ⚠️ SOLO ADMIN. La politica de reembolsos (quien puede pedirlo, con qué
 * plazos, si Offside adelanta el dinero) sigue 🟡 sin decidir: exponerlo al
 * comprador o al vendedor seria inventarla. Ver `refund.service.ts`.
 */
export async function refund(request: Request, paymentId: string): Promise<NextResponse> {
  try {
    await enforceIpLimit(request, 'refund');

    const admin = await requireAdminRole(request, ['SUPER_ADMIN', 'ADMIN', 'FINANCE']);
    const input = refundSchema.parse(await readJson(request));

    return ok(
      await refundService.refundPayment(admin, {
        paymentId,
        amountCents: input.amount === undefined ? null : BigInt(input.amount),
        reason: input.reason ?? null,
      }),
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}

/** Lee los campos que Offside usa de la notificacion de Mercado Pago. */
function parseNotification(payload: unknown): webhookService.WebhookNotification {
  const cuerpo = (payload ?? {}) as Record<string, unknown>;
  const data = (cuerpo.data ?? {}) as Record<string, unknown>;

  const texto = (valor: unknown): string | null => {
    if (typeof valor === 'string' && valor.trim() !== '') return valor.trim();
    if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
    return null;
  };

  return {
    // Algunas variantes usan `type`, otras `topic`. Ambas son de Mercado Pago.
    type: texto(cuerpo.type) ?? texto(cuerpo.topic),
    action: texto(cuerpo.action),
    dataId: texto(data.id) ?? texto(cuerpo.id),
    notificationId: texto(cuerpo.id),
    mpUserId: texto(cuerpo.user_id),
  };
}

/**
 * `POST /api/webhooks/mercadopago/payments`
 *
 * ⚠️ Autenticado por FIRMA, no por sesion. Falla cerrado: sin firma valida
 * responde 401 y **no procesa nada**.
 *
 * ⚠️ Responde rapido (🔴 MP corta a los 22 s) y devuelve 200 incluso cuando el
 * procesamiento no tuvo efecto: un 500 haria que MP reintente para siempre un
 * evento que nunca va a poder aplicarse.
 */
export async function webhook(request: Request): Promise<NextResponse> {
  try {
    const payload = await readJson(request);
    const notification = parseNotification(payload);

    // ⚠️ El `data.id` que se firma es el del QUERY STRING, no el del cuerpo:
    // Mercado Pago documenta `data.id` como query parameter y su SDK lo lee de
    // ahi. Se cae al del cuerpo solo si no vino en la URL.
    const dataIdFirmado = new URL(request.url).searchParams.get('data.id') ?? notification.dataId;

    if (!isValidWebhookSignature(readSignatureHeaders(request, dataIdFirmado))) {
      // ⚠️ No se registra como evento valido ni se procesa. Se cuenta: un pico
      // de firmas invalidas es senal de ataque.
      console.warn('[payments] webhook de Mercado Pago con firma invalida');
      return ok({ error: 'firma invalida' }, 401);
    }

    const outcome = await webhookService.handleNotification(notification, payload);
    return ok({ outcome });
  } catch (error) {
    // Un fallo inesperado se registra completo del lado del servidor. Se
    // responde 500 a proposito: MP reintenta y el evento se recupera.
    console.error('[payments] error no controlado en el webhook:', error);
    return handleError(error);
  }
}
