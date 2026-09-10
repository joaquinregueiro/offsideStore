import { hash, verify } from '@node-rs/argon2';

/**
 * Hashing de contrasenas.
 *
 * `security-observability-analytics.md` §1 exige "hash de passwords
 * (argon2/bcrypt)" y el ERD §5.1 repite "argon2/bcrypt". Se elige **argon2id**,
 * que es la variante recomendada por OWASP: resiste tanto ataques por GPU como
 * side-channel.
 *
 * Se usa `@node-rs/argon2` (binarios precompilados) para no depender de un
 * toolchain de compilacion en Windows.
 *
 * Parametros: los valores por defecto de la libreria siguen la recomendacion
 * RFC 9106 / OWASP. No se bajan.
 */

/**
 * `2` es `Algorithm.Argon2id`.
 *
 * Se usa el literal en vez del enum porque `@node-rs/argon2` lo declara como
 * `const enum` ambiente, incompatible con `verbatimModuleSyntax` del proyecto.
 * Se deja EXPLICITO —aunque hoy sea el default de la libreria— para que un
 * cambio de default aguas arriba no altere en silencio el algoritmo con el que
 * se hashean las contrasenas.
 */
const OPTIONS = { algorithm: 2 } as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/**
 * Verifica una contrasena contra su hash.
 *
 * Nunca lanza por un hash malformado: devuelve `false`. Un registro corrupto en
 * la base no debe poder tumbar el login de todos.
 */
export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain, OPTIONS);
  } catch (error) {
    console.error('[auth] fallo al verificar la contrasena:', error);
    return false;
  }
}
