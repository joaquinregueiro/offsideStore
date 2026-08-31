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
          /**
           * Entorno FIJO para los tests unitarios.
           *
           * ⚠️ NO ES COMODIDAD, ES AISLAMIENTO. `loadRootEnv()` usa
           * `process.loadEnvFile()`, que PISA `process.env` con el contenido
           * del `.env` y recien despues restaura lo que ya estaba. Los tests de
           * integracion lo llaman, y `process.env` es del proceso: si un test
           * unitario fijaba su secreto DESPUES de esa carga, terminaba firmando
           * con un valor y validando con el del `.env`.
           *
           * Definirlas aca las deja presentes ANTES de que cargue cualquier
           * archivo de test, asi que la restauracion de `loadRootEnv` las
           * conserva. Era la causa de una falla intermitente en el webhook.
           *
           * Los valores son inventados y locales. Ninguno es una credencial.
           */
          env: {
            DATABASE_URL: 'postgresql://unit:unit@localhost:5432/unit',
            REDIS_URL: 'redis://localhost:6379',
            AUTH_SESSION_SECRET: 'pepper-solo-para-tests',
            MERCADOPAGO_WEBHOOK_SECRET: 'secreto-de-webhook-solo-para-tests',
          },
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
          // Los `beforeAll` importan modulos de forma diferida y arrastran un
          // grafo grande (guards -> sellers -> payments). El default de 10 s se
          // queda corto en la primera carga; se iguala al de los tests.
          hookTimeout: 30_000,
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
