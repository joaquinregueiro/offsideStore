/**
 * Utilidades transversales sin logica de negocio.
 *
 * Regla: si una funcion necesita conocer una regla de Offside (comision,
 * estados, plazos), NO va aca. Va en el Service de su modulo.
 */

export {
  DecryptionError,
  ENCRYPTION_KEY_BYTES,
  decodeEncryptionKey,
  decryptSecret,
  encryptSecret,
} from './crypto';

/**
 * Garantiza en tiempo de compilacion que un `switch` cubre todos los casos de
 * una union. Util para los enums de estado del ERD, donde olvidar un caso es un
 * bug silencioso.
 */
export function assertNever(value: never, message = 'Caso no contemplado'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

/** Type guard: descarta `null` y `undefined` preservando el tipo. */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Forma de un UUID, en cualquier version.
 *
 * No se valida la version ni la variante a proposito: el objetivo es que la
 * comparacion contra una columna `uuid` no explote, no auditar que UUID es.
 */
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Si una cadena tiene forma de UUID.
 *
 * ⚠️ ES UNA GUARDA DE FORMA, NO DE EXISTENCIA, Y EVITA UN ERROR DE BASE. Las PK
 * del ERD son `uuid` (CLAUDE.md §6) y PostgreSQL no compara un `uuid` contra
 * texto mal formado: RECHAZA la consulta con `invalid input syntax for type
 * uuid`. O sea que un id con basura no devuelve "no encontrado", tira una
 * excepcion. Quien reciba un id desde afuera —una URL, un formulario— filtra
 * por aca antes de ir a la base.
 */
export function esUuid(value: string): boolean {
  return FORMA_UUID.test(value);
}

/** Espera `ms` milisegundos. Pensado para backoff de reintentos. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Error lanzado por `withTimeout` cuando se agota el plazo. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Acota una promesa en el tiempo. Si no resuelve en `ms`, rechaza con
 * `TimeoutError`.
 *
 * Necesario en todo lo que hable con un servicio externo: varios clientes
 * (ioredis entre ellos) encolan comandos indefinidamente cuando el servicio no
 * responde, en lugar de fallar. Sin esto, un health check puede colgarse para
 * siempre.
 *
 * OJO: no cancela la operacion subyacente, solo deja de esperarla.
 */
export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  message = `La operacion supero el limite de ${ms}ms`,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(message));
    }, ms);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Backoff exponencial con jitter, en milisegundos.
 *
 * Base para los reintentos ante errores de terceros (architecture.md §8).
 * No decide CUANTOS reintentos hacer: eso es politica de cada modulo.
 */
export function exponentialBackoff(
  attempt: number,
  { baseMs = 500, maxMs = 30_000 }: { baseMs?: number; maxMs?: number } = {},
): number {
  const exponential = Math.min(baseMs * 2 ** Math.max(0, attempt), maxMs);
  const jitter = Math.random() * exponential * 0.25;

  return Math.round(exponential - jitter);
}
