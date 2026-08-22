import { loadRootEnv } from '@offside/config';
import type { NextConfig } from 'next';

// Next solo lee `.env` desde `apps/web/`, pero el archivo vive en la raiz del
// monorepo. Se carga aca, antes de que arranque cualquier Route Handler.
loadRootEnv(import.meta.dirname);

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Los packages del monorepo se publican como TypeScript sin compilar
   * (`main: ./src/index.ts`), asi que Next tiene que transpilarlos.
   */
  transpilePackages: [
    '@offside/config',
    '@offside/database',
    '@offside/jobs',
    '@offside/types',
    '@offside/utils',
  ],

  typescript: {
    // El typecheck corre como paso propio (`npm run typecheck`) y en CI.
    // Nunca poner `ignoreBuildErrors: true`.
    ignoreBuildErrors: false,
  },

  // Nota: Next 16 elimino la integracion de ESLint en next.config (`next lint`
  // ya no existe). El lint corre a nivel monorepo con la config raiz.
};

export default nextConfig;
