export { appEnvSchema, envSchema, parseEnv, requireEnv, type AppEnv, type Env } from './env';

export { loadRootEnv, resetRootEnvCache } from './load-env';

import { parseEnv, type Env } from './env';

let cached: Env | undefined;

/**
 * Configuracion de entorno del proceso actual, validada y cacheada.
 *
 * Se resuelve de forma perezosa para que importar este paquete no reviente en
 * contextos donde el entorno todavia no esta cargado (por ejemplo, tests que
 * inyectan sus propias variables).
 */
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

/** Solo para tests: descarta la configuracion cacheada. */
export function resetEnvCache(): void {
  cached = undefined;
}
