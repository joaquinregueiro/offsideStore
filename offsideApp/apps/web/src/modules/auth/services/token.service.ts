import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { getEnv, requireEnv } from '@offside/config';

/**
 * Generacion y hashing de tokens opacos (sesiones, verificacion de email,
 * reset de password).
 *
 * DISENO, derivado del ERD §5.2 / §5.4 / §5.5:
 *
 *  - El ERD guarda `token_hash`, no el token. Por lo tanto el token es un valor
 *    OPACO y ALEATORIO, no un JWT: un JWT no necesitaria fila en `sessions`, y
 *    el ERD la exige.
 *  - Ventaja concreta: la sesion se puede REVOCAR borrando la fila. Un JWT no
 *    se puede revocar sin una lista negra, que el ERD no modela.
 *  - No hay refresh tokens: el ERD no los modela para la auth propia. Los
 *    `refresh_token_encrypted` que existen son de Mercado Pago, otra cosa.
 *
 * El hash es HMAC-SHA256 con `AUTH_SESSION_SECRET` como pepper. Frente a un
 * SHA-256 pelado, el pepper impide que alguien que consiga escribir en la base
 * fabrique un `token_hash` valido sin conocer el secreto.
 */

/** 256 bits de entropia: inadivinable por fuerza bruta. */
const TOKEN_BYTES = 32;

/** Token en claro: solo se entrega una vez, nunca se persiste. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Deriva el hash que SI se persiste. */
export function hashToken(token: string): string {
  const pepper = requireEnv(getEnv(), 'AUTH_SESSION_SECRET');
  return createHmac('sha256', pepper).update(token).digest('hex');
}

/**
 * Compara dos hashes en tiempo constante.
 *
 * Aunque el lookup se hace por indice en la base, esta funcion existe para las
 * comparaciones en memoria: una comparacion con `===` filtra informacion por
 * temporizacion.
 */
export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Instante de expiracion a partir de una cantidad de horas. */
export function expiresInHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}
