import { createHash, randomBytes } from 'node:crypto';

/**
 * PKCE (RFC 7636) y generacion del `state` para el flujo OAuth (spec §5 y §6).
 *
 * Funciones PURAS: no tocan Redis, ni la base, ni el entorno. Estan en
 * `services/` y no en `infrastructure/` porque no son especificas de Mercado
 * Pago: PKCE es un estandar y su implementacion no cambia si cambia el
 * proveedor.
 *
 * ⚠️ PKCE ES OBLIGATORIO PARA OFFSIDE (MP-OAUTH-002), aunque Mercado Pago lo
 * documente como opcional. Debe estar habilitado ademas en la configuracion de
 * la aplicacion de Mercado Pago: no alcanza con enviar los parametros.
 */

/**
 * 64 bytes → 86 caracteres en base64url, dentro del rango 43–128 que admite
 * Mercado Pago, con 512 bits de entropia (spec §5).
 */
const CODE_VERIFIER_BYTES = 64;

/** 256 bits: inadivinable por fuerza bruta (spec §6). */
const STATE_BYTES = 32;

/**
 * Genera el `code_verifier`.
 *
 * ⚠️ Es una credencial: vive solo en Redis y nunca sale hacia el frontend, los
 * logs o `audit_log`.
 */
export function generateCodeVerifier(): string {
  return randomBytes(CODE_VERIFIER_BYTES).toString('base64url');
}

/**
 * Deriva el `code_challenge` con el metodo S256.
 *
 * Es lo unico que viaja en la URL de autorizacion. Como es un hash, quien lo
 * intercepte no puede reconstruir el `code_verifier`, y por lo tanto no puede
 * canjear un `authorization_code` robado.
 */
export function deriveCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

/**
 * Genera el `state`.
 *
 * OPACO: no lleva informacion del usuario. La asociacion con `userId` y
 * `sellerId` vive del lado del servidor, en Redis. Meter datos adentro lo
 * volveria legible por terceros y obligaria a firmarlo (spec §6).
 */
export function generateState(): string {
  return randomBytes(STATE_BYTES).toString('base64url');
}
