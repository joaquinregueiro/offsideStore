import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireUser, requireVerifiedUser } from '@/lib/auth-guard';
import { handleError, ok, readJson } from '@/lib/http';
import { consumeIpLimit } from '@/lib/rate-limit';
import { rateLimited } from '@/modules/auth/auth.errors';

import * as orderService from '../services/order.service';

/** Controller de ordenes. Sin reglas de negocio. */

const createOrderSchema = z.object({
  listingId: z.string().uuid(),
  quantity: z.number().int().positive().max(100),
  /**
   * Snapshot de la direccion. Se acepta un objeto libre: la forma canonica de
   * una direccion la define el modulo `users` (libreta de direcciones), que
   * todavia no existe. Validar una forma inventada seria peor que no validarla.
   */
  shippingAddress: z.record(z.string(), z.unknown()).refine((v) => Object.keys(v).length > 0, {
    message: 'La direccion de envio no puede estar vacia',
  }),
});

/**
 * `POST /api/orders` — compra directa de una publicacion.
 *
 * Email verificado (BR-001): comprar es "operar".
 */
export async function createOrder(request: Request): Promise<NextResponse> {
  try {
    const decision = await consumeIpLimit(request, 'order-create');
    if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);

    const user = await requireVerifiedUser(request);
    const input = createOrderSchema.parse(await readJson(request));

    return ok({ order: await orderService.createOrder(user, input) }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** `GET /api/orders` — ordenes del comprador autenticado. */
export async function listMyOrders(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(request);
    return ok({ orders: await orderService.listMyOrders(user) });
  } catch (error) {
    return handleError(error);
  }
}
