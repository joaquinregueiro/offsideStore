import type { Database } from '@offside/database';

import {
  appendEntry,
  type AppendAuditEntry,
  type AuditActorType,
} from '../repositories/audit-log.repository';

/**
 * Registro de auditoria (ERD §19.1).
 *
 * POR QUE ES UN MODULO PROPIO Y NO PARTE DE `sellers`: `audit_log` es
 * transversal por diseno —el ERD lo modela con una referencia polimorfica sin
 * FK justamente para eso— y es OBLIGATORIO ante movimientos de dinero,
 * sanciones, disputas, credenciales de Mercado Pago y cambios de configuracion.
 * Todos esos son modulos distintos. Ponerlo dentro de `sellers` obligaria a
 * duplicarlo en cada uno.
 *
 * Otros modulos hablan con este SERVICE, nunca con su repository
 * (`modules/README.md`).
 *
 * ⚠️ ESTE SERVICE NUNCA RECIBE SECRETOS. La spec de Mercado Pago §16 prohibe
 * expresamente que lleguen aca `access_token`, `refresh_token`,
 * `authorization_code`, `code_verifier`, `client_secret` y `state`, ni siquiera
 * truncados. `assertSinSecretos()` lo hace cumplir en tiempo de ejecucion.
 */

export type { AuditActorType };

/**
 * Nombres de campo prohibidos en `metadata`, `before` y `after`.
 *
 * Es una RED DE SEGURIDAD, no la defensa principal: la defensa es que los
 * llamadores no tengan el secreto en la mano (en Mercado Pago, los tokens se
 * cifran dentro de `infrastructure/` y el Service jamas ve uno en claro). Esta
 * comprobacion existe porque una fuga de credenciales al log de auditoria seria
 * silenciosa y permanente: `audit_log` es append-only.
 */
const CAMPOS_PROHIBIDOS = new Set([
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'authorization_code',
  'authorizationcode',
  'code',
  'code_verifier',
  'codeverifier',
  'code_challenge',
  'codechallenge',
  'client_secret',
  'clientsecret',
  'state',
  'token',
  'password',
  'secret',
]);

/** Profundidad maxima de inspeccion. Evita recursion infinita ante ciclos. */
const PROFUNDIDAD_MAXIMA = 6;

function assertSinSecretos(valor: unknown, ruta = 'metadata', profundidad = 0): void {
  if (profundidad > PROFUNDIDAD_MAXIMA) return;
  if (valor === null || typeof valor !== 'object') return;

  if (Array.isArray(valor)) {
    valor.forEach((item, i) => {
      assertSinSecretos(item, `${ruta}[${i}]`, profundidad + 1);
    });
    return;
  }

  for (const [clave, contenido] of Object.entries(valor)) {
    if (CAMPOS_PROHIBIDOS.has(clave.toLowerCase())) {
      // ⚠️ El error nombra la CLAVE, nunca el valor: incluirlo seria filtrar
      // exactamente el secreto que esta comprobacion protege.
      throw new Error(
        `audit_log no puede recibir el campo "${clave}" (en ${ruta}): es una credencial`,
      );
    }

    assertSinSecretos(contenido, `${ruta}.${clave}`, profundidad + 1);
  }
}

/**
 * Registra un hecho auditable.
 *
 * ⚠️ NO atrapa errores: si la auditoria falla, la operacion que la origino debe
 * fallar tambien. Un movimiento sensible sin rastro es peor que un movimiento
 * rechazado. Por eso quien audita algo que debe ser atomico con una escritura
 * pasa la MISMA transaccion en `db`.
 */
export async function record(entry: AppendAuditEntry, db?: Database): Promise<void> {
  assertSinSecretos(entry.metadata, 'metadata');
  assertSinSecretos(entry.before, 'before');
  assertSinSecretos(entry.after, 'after');

  await appendEntry(entry, db);
}
