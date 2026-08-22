import type { NextResponse } from 'next/server';

import { requireUser, requireVerifiedUser } from '@/lib/auth-guard';
import { handleError, ok, readJson } from '@/lib/http';
import { createSellerProfileSchema, submitTaxIdentitySchema } from '@/modules/auth/auth.schemas';

import * as sellerService from '../services/seller.service';
import * as taxProfileService from '../services/seller-tax-profile.service';

/** Controller de vendedores. Sin reglas de negocio. */

/**
 * SS-001/SS-002 — habilitar el rol vendedor.
 * Exige email verificado (BR-001): habilitarse como vendedor es "operar".
 */
export async function createSellerProfile(request: Request): Promise<NextResponse> {
  try {
    const user = await requireVerifiedUser(request);
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
