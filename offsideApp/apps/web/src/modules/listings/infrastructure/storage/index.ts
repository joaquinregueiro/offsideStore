import { getEnv } from '@offside/config';

import { createLocalStorage } from './local-storage.adapter';
import { createS3Storage } from './s3-storage.adapter';
import type { StoragePort } from './storage.port';

/**
 * Elige el adaptador de storage segun la configuracion presente.
 *
 * REGLA, y es de seguridad, no de comodidad — la misma que usa el email:
 *
 *   - Con las cinco variables de S3 cargadas -> S3/R2, en cualquier entorno.
 *   - Sin ellas y FUERA de produccion        -> disco local.
 *   - Sin ellas y EN produccion              -> se rompe a proposito.
 *
 * El ultimo caso es el importante. Caer al adaptador local en produccion
 * escribiria las fotos DENTRO del contenedor: desaparecerian en el proximo
 * deploy y dos instancias verian catalogos distintos. Peor todavia, el sistema
 * informaria exito mientras construye publicaciones que quedan rotas. Es
 * preferible que la subida falle ruidosamente.
 */
export function createStorage(): StoragePort {
  const env = getEnv();

  const configurado =
    env.S3_ENDPOINT !== undefined &&
    env.S3_BUCKET !== undefined &&
    env.S3_ACCESS_KEY !== undefined &&
    env.S3_SECRET_KEY !== undefined &&
    env.S3_PUBLIC_URL !== undefined;

  if (configurado) return createS3Storage();

  if (env.APP_ENV === 'production') {
    throw new Error(
      'Storage sin configurar en produccion: faltan S3_ENDPOINT, S3_BUCKET, ' +
        'S3_ACCESS_KEY, S3_SECRET_KEY o S3_PUBLIC_URL. No se cae al adaptador ' +
        'local porque las fotos se perderian en el proximo deploy.',
    );
  }

  return createLocalStorage();
}

export type { ImageMimeType, PutObjectInput, StoragePort, StoredObject } from './storage.port';
export { StorageError } from './storage.port';
