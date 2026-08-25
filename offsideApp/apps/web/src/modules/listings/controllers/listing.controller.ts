import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireUser, requireVerifiedUser } from '@/lib/auth-guard';
import { handleError, ok, readJson } from '@/lib/http';
import { consumeIpLimit } from '@/lib/rate-limit';
import { rateLimited } from '@/modules/auth/auth.errors';

import * as listingService from '../services/listing.service';

/** Controller de publicaciones. Sin reglas de negocio. */

const publishListingSchema = z.object({
  categoryId: z.string().uuid(),
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().max(5_000).optional(),
  /**
   * Centavos como string: el dinero es `bigint` en el ERD (§1) y un `number` de
   * JSON no lo representa sin riesgo. Mismo criterio que el importe del refund.
   */
  priceAmount: z.string().regex(/^\d+$/, 'El precio debe ser un entero de centavos'),
  stock: z.number().int().positive().max(1_000),
  sizeValue: z.string().trim().min(1).max(20),
  condition: z.enum(['NUEVO', 'COMO_NUEVO', 'EXCELENTE', 'MUY_BUENO', 'BUENO', 'ACEPTABLE']),
  // Obligatorios para camiseta; lo valida el Service, que es quien conoce la
  // categoria (ERD §9.1).
  kitType: z.enum(['home', 'away', 'third', 'goalkeeper', 'special']).optional(),
  sleeve: z.enum(['short', 'long']).optional(),
});

/**
 * `POST /api/sellers/listings` — publica una prenda.
 *
 * Email verificado (BR-001): publicar es "operar".
 */
export async function publishListing(request: Request): Promise<NextResponse> {
  try {
    const decision = await consumeIpLimit(request, 'listing-create');
    if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);

    const user = await requireVerifiedUser(request);
    const input = publishListingSchema.parse(await readJson(request));

    const listing = await listingService.publishListing(user, {
      categoryId: input.categoryId,
      title: input.title,
      description: input.description ?? null,
      priceAmount: BigInt(input.priceAmount),
      stock: input.stock,
      sizeValue: input.sizeValue,
      condition: input.condition,
      kitType: input.kitType ?? null,
      sleeve: input.sleeve ?? null,
    });

    return ok({ listing }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** `GET /api/sellers/listings` — publicaciones propias. */
export async function listMyListings(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(request);
    return ok({ listings: await listingService.listMyListings(user) });
  } catch (error) {
    return handleError(error);
  }
}
