import * as controller from '@/modules/payments/controllers/payment.controller';

/**
 * POST /api/payments/{paymentId}/refunds — reembolso total o parcial.
 *
 * ⚠️ SOLO ADMIN: la politica de reembolsos sigue pendiente de decision.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  const { paymentId } = await params;
  return controller.refund(request, paymentId);
}
