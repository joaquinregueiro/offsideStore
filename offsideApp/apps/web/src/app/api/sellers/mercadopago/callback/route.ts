import * as controller from '@/modules/sellers/controllers/mercadopago.controller';

/**
 * GET /api/sellers/mercadopago/callback — retorno de Mercado Pago.
 *
 * ⚠️ Esta ruta es la que se registra como `redirect_uri` en la aplicacion de
 * Mercado Pago y debe coincidir EXACTAMENTE con `MERCADOPAGO_REDIRECT_URI`.
 */
export const GET = controller.callback;
