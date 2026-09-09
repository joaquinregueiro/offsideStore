import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireUser, requireVerifiedUser } from '@/lib/auth-guard';
import { handleError, ok, readJson } from '@/lib/http';
import { consumeIpLimit, consumeUserLimit, type RateLimitScope } from '@/lib/rate-limit';
import { rateLimited } from '@/modules/auth/auth.errors';

import * as orderService from '../services/order.service';

/** Controller de ordenes. Sin reglas de negocio. */

/**
 * Consume una unidad del limite POR USUARIO o lanza `RATE_LIMITED`.
 *
 * ⚠️ ES EL MISMO CONTADOR QUE CONSUME LA SERVER ACTION equivalente. Si contaran
 * aparte, bloquear un camino no serviria de nada: el otro seguiria abierto. Es
 * exactamente el agujero que tenia el login antes de `rate-limit-actions.ts`.
 *
 * Va DESPUES de resolver al usuario —no se puede contar por usuario sin saber
 * quien es— y ANTES de parsear el cuerpo y de tocar la base.
 */
async function enforceUserLimit(scope: RateLimitScope, userId: string): Promise<void> {
  const decision = await consumeUserLimit(scope, userId);
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
}

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
    await enforceUserLimit('order-create', user.id);

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
