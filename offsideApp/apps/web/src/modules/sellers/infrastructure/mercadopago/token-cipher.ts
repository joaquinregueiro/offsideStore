import { getEnv, requireEnv } from '@offside/config';
import { decodeEncryptionKey, decryptSecret, encryptSecret } from '@offside/utils';

/**
 * Cifrado de las credenciales de Mercado Pago en reposo.
 *
 * ⚠️ ESTE ES EL UNICO LUGAR DEL SISTEMA QUE RESUELVE `TOKEN_ENCRYPTION_KEY` Y
 * QUE VE UN TOKEN DE MERCADO PAGO EN CLARO (spec §8 y MP-OAUTH-015).
 *
 * Reparto de responsabilidades:
 *
 *   @offside/utils   primitiva AES-256-GCM pura, sin entorno ni dominio.
 *   este archivo     resuelve la clave y encapsula cifrar/descifrar.
 *   Service          maneja identificadores y estados. Nunca un token.
 *
 * `public_key` NO pasa por aca: es publica por diseno y se guarda tal cual.
 */

let cachedKey: Buffer | undefined;

/**
 * Resuelve la clave la PRIMERA vez que se usa, no al importar el modulo.
 *
 * Mismo criterio que `getEnv()`: importar este archivo no puede reventar en un
 * proceso que no vaya a cifrar nada (tests, lint, drizzle-kit). La ausencia de
 * la clave se detecta cuando de verdad hace falta.
 */
function key(): Buffer {
  cachedKey ??= decodeEncryptionKey(requireEnv(getEnv(), 'TOKEN_ENCRYPTION_KEY'));
  return cachedKey;
}

/** Solo para tests: fuerza a releer `TOKEN_ENCRYPTION_KEY`. */
export function resetTokenCipherCache(): void {
  cachedKey = undefined;
}

/** Cifra un token de Mercado Pago para persistirlo. */
export function encryptToken(plaintext: string): string {
  return encryptSecret(plaintext, key());
}

/**
 * Descifra un token de Mercado Pago.
 *
 * ⚠️ El valor devuelto NO puede salir de `infrastructure/mercadopago/`: se usa
 * para construir la llamada a Mercado Pago y se descarta. No se devuelve al
 * Service, no se loguea, no se audita, no viaja en una respuesta HTTP.
 *
 * Hoy no lo usa nadie: el refresh de tokens y las llamadas autenticadas
 * pertenecen a fases posteriores (spec §10 y §17). Existe para que la frontera
 * quede establecida desde el principio y ningun otro modulo tenga excusa para
 * descifrar por su cuenta.
 */
export function decryptToken(payload: string): string {
  return decryptSecret(payload, key());
}
