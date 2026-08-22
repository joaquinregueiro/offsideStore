import type { Database } from '@offside/database';

import { appendEvent } from '../repositories/user-history.repository';

/**
 * Historial de HECHOS del usuario (ERD §6.3, DEC-036/DEC-040).
 *
 * Regla dura: aca van SOLO hechos objetivos ("¿que paso?"). Nada de
 * interpretaciones de riesgo — esas viven en `risk_events` y las produce otro
 * modulo. No mezclar (DEC-040).
 *
 * Otros modulos hablan con este SERVICE, nunca con su repository
 * (`modules/README.md`).
 */

/**
 * Registra el alta de un usuario.
 *
 * ⚠️ La aceptacion de terminos (BS-002) se guarda en `data` porque **el ERD no
 * tiene columna para ella**. Es un hecho ocurrido en el alta, y `data` es
 * justamente "payload del hecho". Ver la nota en
 * `docs-implementation/auth-module.md`: si se decide que la aceptacion necesita
 * una columna propia, hay que actualizar el ERD.
 */
export async function recordUserRegistered(
  params: { userId: string; acceptedTermsAt: Date },
  db?: Database,
): Promise<void> {
  await appendEvent(
    {
      userId: params.userId,
      eventType: 'USER_REGISTERED',
      data: { acceptedTermsAt: params.acceptedTermsAt.toISOString() },
    },
    db,
  );
}
