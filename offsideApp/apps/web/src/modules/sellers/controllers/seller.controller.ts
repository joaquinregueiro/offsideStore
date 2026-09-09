import type { NextResponse } from 'next/server';

import { requireUser, requireVerifiedUser } from '@/lib/auth-guard';
import { handleError, ok, readJson } from '@/lib/http';
import { consumeUserLimit, type RateLimitScope } from '@/lib/rate-limit';
import { rateLimited } from '@/modules/auth/auth.errors';
import { createSellerProfileSchema, submitTaxIdentitySchema } from '@/modules/auth/auth.schemas';

import * as sellerService from '../services/seller.service';
import * as taxProfileService from '../services/seller-tax-profile.service';

/** Controller de vendedores. Sin reglas de negocio. */

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

/**
 * SS-001/SS-002 — habilitar el rol vendedor.
 * Exige email verificado (BR-001): habilitarse como vendedor es "operar".
 */
export async function createSellerProfile(request: Request): Promise<NextResponse> {
  try {
    const user = await requireVerifiedUser(request);
    await enforceUserLimit('seller-create', user.id);

    const input = createSellerProfileSchema.parse(await readJson(request));

    return ok({ sellerProfile: await sellerService.createSellerProfile(user, input) }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** Perfil de vendedor propio. `null` si el usuario no lo solicito todavia. */
export async function getMySellerProfile(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(request);
    return ok({ sellerProfile: await sellerService.getMySellerProfile(user.id) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Declara la identidad fiscal del vendedor.
 *
 * ⚠️ NO aprueba al vendedor: cargar datos fiscales validos es un paso del
 * onboarding, no la aprobacion.
 */
export async function submitTaxIdentity(request: Request): Promise<NextResponse> {
  try {
    const user = await requireVerifiedUser(request);
    await enforceUserLimit('tax-identity', user.id);

    const input = submitTaxIdentitySchema.parse(await readJson(request));

    return ok({ taxProfile: await taxProfileService.submitTaxIdentity(user, input) }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** Identidad fiscal vigente. `null` si todavia no se cargo. */
export async function getMyTaxProfile(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(request);
    return ok({ taxProfile: await taxProfileService.getMyTaxProfile(user) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Dispara la verificacion contra la fuente fiscal oficial.
 *
 * ⚠️ Hoy responde 503: no hay integracion con ARCA. El endpoint existe para
 * que el contrato este definido, no para simular una verificacion.
 */
export async function verifyTaxIdentity(request: Request): Promise<NextResponse> {
  try {
    const user = await requireVerifiedUser(request);
    return ok({ taxProfile: await taxProfileService.verifyTaxIdentity(user) });
  } catch (error) {
    return handleError(error);
  }
}
