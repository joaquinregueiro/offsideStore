import * as controller from '@/modules/payments/controllers/payment.controller';

/**
 * POST /api/checkout/{orderId} — inicia el pago de una orden.
 *
 * Devuelve `initPoint`; el frontend navega. No redirige (MP-PAY-014 del OAuth,
 * mismo criterio).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  const { orderId } = await params;
  return controller.startCheckout(request, orderId);
}
