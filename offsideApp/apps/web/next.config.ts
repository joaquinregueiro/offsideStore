import { loadRootEnv } from '@offside/config';
import type { NextConfig } from 'next';

import { securityHeaders } from './src/lib/security-headers';

// Next solo lee `.env` desde `apps/web/`, pero el archivo vive en la raiz del
// monorepo. Se carga aca, antes de que arranque cualquier Route Handler.
loadRootEnv(import.meta.dirname);

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /** `X-Powered-By: Next.js` solo le sirve a quien busca que version atacar. */
  poweredByHeader: false,

  /**
   * Cabeceras de seguridad en TODAS las respuestas, incluidas `/public` y
   * `/_next/*`. El detalle y lo que deliberadamente NO incluyen esta en
   * `src/lib/security-headers.ts`.
   */
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders() }]);
  },

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

  experimental: {
    serverActions: {
      /**
       * ⚠️ SIN ESTO, SUBIR UNA FOTO FALLA. El limite por defecto del cuerpo de
       * una Server Action es 1 MB, y el Config Store permite imagenes de 5 MB:
       * el formulario de publicar manda varias de una, asi que el cuerpo real
       * puede ser bastante mas grande.
       *
       * ⚠️ ESTE LIMITE NO REEMPLAZA AL DEL CONFIG STORE. Son dos cosas
       * distintas y las dos hacen falta: este es un techo de transporte de
       * Next para TODO el cuerpo; el del Config Store es la regla de negocio
       * POR IMAGEN, y es el que el Service valida y el que se puede cambiar
       * desde Admin. Este tiene que ser holgadamente mayor.
       */
      bodySizeLimit: '48mb',
    },
  },

  typescript: {
    // El typecheck corre como paso propio (`npm run typecheck`) y en CI.
    // Nunca poner `ignoreBuildErrors: true`.
    ignoreBuildErrors: false,
  },

  // Nota: Next 16 elimino la integracion de ESLint en next.config (`next lint`
  // ya no existe). El lint corre a nivel monorepo con la config raiz.
};

export default nextConfig;
