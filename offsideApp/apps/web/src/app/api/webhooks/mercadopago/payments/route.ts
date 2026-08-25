import * as controller from '@/modules/payments/controllers/payment.controller';

/**
 * POST /api/webhooks/mercadopago/payments — notificaciones del topic `payment`.
 *
 * ⚠️ Esta URL es la que se registra como `notification_url` en la preferencia y
 * en el panel de Mercado Pago. Se autentica por FIRMA, no por sesion.
 */
export const POST = controller.webhook;
