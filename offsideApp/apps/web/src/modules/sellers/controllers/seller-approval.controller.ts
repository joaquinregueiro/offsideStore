import type { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth-guard';
import { handleError, ok } from '@/lib/http';

import * as approvalService from '../services/seller-approval.service';

/** Controller de la habilitacion del vendedor (TS-010). Sin reglas de negocio. */

/**
 * `GET /api/sellers/approval` — que le falta al vendedor para poder operar.
 *
 * Solo lectura: NO evalua ni aprueba, para que refrescar la pantalla no escriba
 * una verificacion cada vez.
 */
export async function getApprovalStatus(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(request);
    return ok({ approval: await approvalService.getStatus(user) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * `POST /api/sellers/approval` — reevalua y aprueba si corresponde.
 *
 * Idempotente: si ya esta aprobado, devuelve el mismo estado sin cambiar nada.
 */
export async function evaluateApproval(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(request);
    return ok({ approval: await approvalService.evaluate(user) });
  } catch (error) {
    return handleError(error);
  }
}
