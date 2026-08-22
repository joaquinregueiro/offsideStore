import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

/**
 * Carga el `.env` compartido del monorepo.
 *
 * POR QUE EXISTE: el `.env` vive en la raiz del monorepo (`offsideApp/.env`),
 * pero cada proceso arranca en su propio directorio:
 *
 *   - `next dev` corre con cwd = `apps/web`, y Next SOLO lee `.env` desde el
 *     directorio de su propia app. Sin esto, la app no ve ninguna variable y
 *     todo parece "caido".
 *   - el worker de BullMQ y drizzle-kit corren con cwd = `packages/*`.
 *
 * Se llama de forma EXPLICITA en cada punto de entrada (next.config.ts,
 * workers/main.ts, drizzle.config.ts, migrate.ts). Nada de magia implicita al
 * importar el paquete.
 *
 * En produccion normalmente no hay archivo `.env` —las variables las inyecta la
 * plataforma (Coolify)— y la funcion no hace nada.
 */

let loadedFrom: string | undefined;

/** Busca el `.env` mas cercano subiendo desde `startDir` hasta la raiz del disco. */
function findEnvFile(startDir: string): string | undefined {
  const { root } = parse(startDir);
  let dir = startDir;

  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;

    if (dir === root) return undefined;

    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Carga el `.env` del monorepo si existe. Idempotente.
 *
 * Las variables ya presentes en el entorno tienen prioridad: lo que inyecta la
 * plataforma nunca lo pisa un archivo local.
 *
 * @returns la ruta del archivo cargado, o `undefined` si no habia ninguno.
 */
export function loadRootEnv(startDir: string = process.cwd()): string | undefined {
  if (loadedFrom !== undefined) return loadedFrom;

  const envFile = findEnvFile(startDir);
  if (!envFile) return undefined;

  const previas = { ...process.env };

  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    // Un `.env` ilegible o malformado no debe tumbar el proceso en silencio:
    // se avisa y se sigue con el entorno que ya haya (CLAUDE.md §9).
    console.warn(
      `[config] no se pudo leer ${envFile}:`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }

  // Restaura lo que ya venia del entorno real, para que el archivo no lo pise.
  for (const [key, value] of Object.entries(previas)) {
    if (value !== undefined) process.env[key] = value;
  }

  loadedFrom = envFile;
  return envFile;
}

/** Solo para tests: olvida que ya se cargo un archivo. */
export function resetRootEnvCache(): void {
  loadedFrom = undefined;
}
