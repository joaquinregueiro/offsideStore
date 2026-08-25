import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * `@/` apunta a `apps/web/src`, igual que en `tsconfig` y en Next. Sin esto,
 * cualquier test que cargue un controller falla al resolver el import.
 */
const aliasWeb = {
  '@/': `${fileURLToPath(new URL('./apps/web/src', import.meta.url))}/`,
};

/**
 * Configuracion de tests del monorepo.
 *
 * Dos proyectos separados por el tipo de test:
 *
 *   unit         puros, sin IO. Corren siempre, tambien en CI sin servicios.
 *   integration  necesitan PostgreSQL y Redis (docker compose up -d).
 *                Se excluyen por defecto; se corren con:
 *                  npm test -- --project=integration
 *
 * Todavia no hay tests de negocio: los existentes validan la foundation.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: aliasWeb },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['{apps,packages}/*/src/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
        },
      },
      {
        resolve: { alias: aliasWeb },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['{apps,packages}/*/src/**/*.integration.test.ts'],
          exclude: ['**/node_modules/**'],
          // Las pruebas contra la base comparten estado: sin paralelismo.
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/*.config.*',
        '**/*.test.ts',
        '**/migrations/**',
        'apps/web/.next/**',
      ],
    },
  },
});
