// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';

/**
 * Configuracion ESLint raiz del monorepo (flat config).
 *
 * Cubre `apps/*` y `packages/*`. Reglas especificas de Next.js se aplican solo
 * a `apps/web`. Las reglas apuntan a lo que CLAUDE.md §9 exige: nada de errores
 * silenciosos, nada de `any` implicito, imports de tipo explicitos.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/migrations/**',
      // `docs/` y `design/` viven fuera de offsideApp/, no hace falta ignorarlas.
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- Errores explicitos (CLAUDE.md §9) ---------------------------------
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',

      // --- Tipado -----------------------------------------------------------
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // --- Higiene ----------------------------------------------------------
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // --- Next.js: solo la app web ---------------------------------------------
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // Regla del Pages Router; Offside usa App Router.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  // --- Tests ----------------------------------------------------------------
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  // --- Archivos de configuracion y scripts de la raiz ------------------------
  // No pertenecen a ningun tsconfig de workspace, asi que no hay informacion de
  // tipos disponible: se lintean sin las reglas que la requieren.
  //
  // `scripts/*.mjs` son herramientas de mantenimiento que corren con `node` a
  // secas (hoy, el chequeo de invariantes del CSS). Sin esta entrada, el
  // servicio de proyectos de typescript-eslint los rechaza con un error de
  // parseo que no dice nada de lo que esta mal.
  {
    files: ['*.config.{mjs,mts,ts,js}', 'eslint.config.mjs', 'scripts/**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: false,
      },
      /*
       * Sin informacion de tipos, `no-undef` vuelve a estar activa y no conoce
       * el entorno de Node: `console` y `process` le parecen variables
       * inventadas. Se declaran a mano en vez de traer el paquete `globals`
       * solo para esto.
       */
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
