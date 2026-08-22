import { loadRootEnv } from '@offside/config';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit corre como CLI desde `packages/database`; el `.env` esta en la
// raiz del monorepo.
loadRootEnv(import.meta.dirname);

/**
 * Configuracion de Drizzle Kit.
 *
 * Lee DATABASE_URL directamente de process.env (no de @offside/config) porque
 * drizzle-kit corre como CLI fuera del runtime de la app.
 *
 * Regla no negociable (tech-stack.md §3.1): la base se modifica EXCLUSIVAMENTE
 * por migraciones. Nada de `drizzle-kit push` contra un entorno persistente ni
 * de cambios manuales en PostgreSQL.
 */
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL no esta definida. Copia .env.example a .env y completala ' +
      'antes de correr drizzle-kit.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: databaseUrl },
  // Nombres de constraints e indices estables entre entornos.
  breakpoints: true,
  strict: true,
  verbose: true,
});
