import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifrado simetrico autenticado (AES-256-GCM).
 *
 * PRIMITIVA PURA: recibe la clave por parametro y NO lee variables de entorno.
 * Quien resuelve la clave es el modulo que la usa —hoy
 * `sellers/infrastructure/mercadopago/token-cipher.ts` con
 * `TOKEN_ENCRYPTION_KEY`—, no este archivo. Asi la primitiva se testea sin
 * entorno y se reutiliza sin arrastrar configuracion.
 *
 * POR QUE GCM Y NO CBC: GCM es cifrado AUTENTICADO. Un texto cifrado alterado
 * en la base falla al descifrar en vez de devolver basura silenciosamente. Sin
 * autenticacion, quien pueda escribir en la base podria manipular un token
 * cifrado sin que nadie lo note (CLAUDE.md §10).
 *
 * ALCANCE: cifra credenciales de terceros en reposo (tokens OAuth de Mercado
 * Pago, tech-stack.md §3.5). NO es para passwords de usuarios: esas se hashean
 * con argon2id y no se descifran nunca.
 */

/** AES-256 exige exactamente 32 bytes de clave. */
export const ENCRYPTION_KEY_BYTES = 32;

/**
 * 96 bits es el tamano de IV recomendado para GCM: es el unico que el modo usa
 * directamente, sin derivarlo por GHASH.
 */
const IV_BYTES = 12;

/** Tag de autenticacion de GCM. */
const AUTH_TAG_BYTES = 16;

const ALGORITHM = 'aes-256-gcm';

/**
 * Version del formato del texto cifrado.
 *
 * Va DENTRO del valor guardado para que una futura rotacion de clave o cambio
 * de algoritmo pueda convivir con los valores viejos en la misma columna: se
 * lee la version y se elige como descifrar. Sin esto, rotar obligaria a migrar
 * toda la tabla de una sola vez.
 */
const FORMAT_VERSION = 'v1';

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

/** Valida el material de clave. Una clave corta rompe la garantia de AES-256. */
function assertKey(key: Buffer): void {
  if (key.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error(
      `La clave de cifrado debe tener ${ENCRYPTION_KEY_BYTES} bytes, tiene ${key.length}`,
    );
  }
}

/**
 * Cifra un secreto. Devuelve `v1.<iv>.<ciphertext>.<tag>` en base64url.
 *
 * El IV es ALEATORIO en cada llamada: reutilizarlo con la misma clave rompe
 * GCM por completo. Por eso cifrar dos veces el mismo token da resultados
 * distintos, y eso es correcto, no un bug.
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  assertKey(key);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    authTag.toString('base64url'),
  ].join('.');
}

/**
 * Descifra un valor producido por `encryptSecret`.
 *
 * ⚠️ El mensaje de error NUNCA incluye el texto cifrado ni parte de el: es una
 * credencial y no debe terminar en un log (CLAUDE.md §10).
 */
export function decryptSecret(payload: string, key: Buffer): string {
  assertKey(key);

  const parts = payload.split('.');
  if (parts.length !== 4) {
    throw new DecryptionError('El valor cifrado no tiene el formato esperado');
  }

  const [version, ivPart, ciphertextPart, tagPart] = parts as [string, string, string, string];

  if (version !== FORMAT_VERSION) {
    throw new DecryptionError(`Version de cifrado no soportada: ${version}`);
  }

  const iv = Buffer.from(ivPart, 'base64url');
  const authTag = Buffer.from(tagPart, 'base64url');

  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new DecryptionError('El valor cifrado esta corrupto');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // El error original de OpenSSL no aporta nada accionable y arriesga filtrar
    // detalles del criptosistema. Se reemplaza por uno propio.
    throw new DecryptionError('No se pudo descifrar el valor: clave incorrecta o dato alterado');
  }
}

/**
 * Decodifica una clave en base64 y verifica su longitud.
 *
 * Es la forma en que `.env.example` documenta generar las claves
 * (`openssl rand -base64 32`).
 */
export function decodeEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  assertKey(key);
  return key;
}
