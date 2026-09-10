import * as controller from '@/modules/sellers/controllers/mercadopago.controller';

/** GET /api/sellers/mercadopago/status — estado de la conexion. Sin tokens. */
export const GET = controller.status;
