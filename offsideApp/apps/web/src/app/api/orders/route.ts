import * as controller from '@/modules/orders/controllers/order.controller';

/**
 * POST /api/orders — compra directa de una publicacion.
 * GET  /api/orders — ordenes propias del comprador.
 */
export const POST = controller.createOrder;
export const GET = controller.listMyOrders;
