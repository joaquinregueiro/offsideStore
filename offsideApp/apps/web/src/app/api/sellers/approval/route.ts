import * as controller from '@/modules/sellers/controllers/seller-approval.controller';

/**
 * GET  /api/sellers/approval — estado de la habilitacion y que falta.
 * POST /api/sellers/approval — reevalua y aprueba si corresponde (TS-010).
 *
 * El POST existe porque la evaluacion automatica corre al conectar Mercado Pago
 * y al declarar el CUIT; si alguna de las dos falla, el vendedor necesita poder
 * reintentar sin rehacer el onboarding.
 */
export const GET = controller.getApprovalStatus;
export const POST = controller.evaluateApproval;
