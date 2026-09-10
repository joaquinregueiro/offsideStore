import * as controller from '@/modules/sellers/controllers/mercadopago.controller';

/**
 * POST /api/sellers/mercadopago/connect
 *
 * Devuelve la URL de autorizacion. NO redirige (MP-OAUTH-014).
 */
export const POST = controller.connect;
