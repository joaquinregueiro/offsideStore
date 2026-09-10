import * as controller from '@/modules/sellers/controllers/mercadopago.controller';

/**
 * POST /api/sellers/mercadopago/disconnect — desvinculacion local.
 *
 * No revoca del lado de Mercado Pago (spec §12).
 */
export const POST = controller.disconnect;
