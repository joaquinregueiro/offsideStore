/**
 * Utilidades transversales sin logica de negocio.
 *
 * Regla: si una funcion necesita conocer una regla de Offside (comision,
 * estados, plazos), NO va aca. Va en el Service de su modulo.
 */

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
