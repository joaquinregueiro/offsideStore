/**
 * Runner de migraciones.
 *
 * Aplica las migraciones generadas por `drizzle-kit generate` en `./migrations`.
 * Es la UNICA via autorizada para modificar el esquema de PostgreSQL
 * (tech-stack.md §3.1 / CLAUDE.md §6).
 *
 *   npm run db:migrate
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { getEnv, loadRootEnv } from '@offside/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

async function main(): Promise<void> {
  loadRootEnv(import.meta.dirname);
  const env = getEnv();

  // max: 1 — las migraciones deben correr en una sola conexion, en orden.
  const connection = postgres(env.DATABASE_URL, { max: 1 });

  try {
    console.warn(`[migrate] aplicando migraciones desde ${migrationsFolder}`);
    await migrate(drizzle(connection), { migrationsFolder });
    console.warn('[migrate] listo');
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error('[migrate] fallo la migracion:', error);
  process.exit(1);
});
