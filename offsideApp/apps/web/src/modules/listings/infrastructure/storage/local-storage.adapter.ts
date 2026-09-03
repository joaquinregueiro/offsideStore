import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { getEnv } from '@offside/config';

import {
  StorageError,
  type PutObjectInput,
  type StoragePort,
  type StoredObject,
} from './storage.port';

/**
 * Adaptador de storage para DESARROLLO. Escribe en el disco local.
 *
 * Existe por lo mismo que el adaptador de log del email: que no haga falta una
 * cuenta de un tercero para levantar el proyecto y correr los tests. En
 * desarrollo, `public/uploads/` ES el bucket.
 *
 * ⚠️ NUNCA EN PRODUCCION. Lo impide `createStorage()`, no este archivo. Escribir
 * dentro del contenedor haria que las fotos desaparezcan en cada deploy —el
 * sistema de archivos es efimero— y que dos instancias vean cosas distintas.
 *
 * ⚠️ `public/` la sirve Next como estatica, asi que lo que se escribe aca queda
 * accesible en `/uploads/...` sin configurar nada. Es exactamente lo que se
 * quiere en desarrollo y exactamente lo que NO se quiere en produccion.
 */

/**
 * Carpeta raiz de las subidas locales.
 *
 * ⚠️ Es relativa a `process.cwd()`, que NO es el mismo directorio siempre:
 * con `next dev` es `apps/web/` —y entonces cae en el `public/` que Next sirve,
 * que es lo que se quiere—; corriendo los tests es la raiz del monorepo. Las
 * dos rutas estan en `.gitignore`.
 */
const RAIZ = resolve(process.cwd(), 'public', 'uploads');

/**
 * Resuelve la ruta en disco de una clave, rechazando cualquier escape.
 *
 * ⚠️ ESTO ES SEGURIDAD, NO PROLIJIDAD. Una clave con `../` escribiria fuera de
 * la carpeta de subidas: con la ruta justa, sobre el codigo de la aplicacion.
 * Las claves las genera el Service y no vienen del cliente, pero un adaptador
 * de storage no puede DEPENDER de eso —el dia que alguien construya una clave
 * con datos del usuario, esta linea es la que evita el desastre—.
 */
function rutaSegura(key: string): string {
  const destino = resolve(RAIZ, key);

  if (destino !== RAIZ && !destino.startsWith(RAIZ + sep)) {
    throw new StorageError('rejected', 'Clave de storage invalida');
  }

  return destino;
}

export function createLocalStorage(): StoragePort {
  return {
    name: 'local',

    async put(input: PutObjectInput): Promise<StoredObject> {
      const destino = rutaSegura(input.key);

      await mkdir(dirname(destino), { recursive: true });
      await writeFile(destino, input.body);

      return {
        key: input.key,
        url: `${getEnv().APP_URL.replace(/\/$/, '')}${join('/uploads', input.key).replaceAll(sep, '/')}`,
        sizeBytes: input.body.byteLength,
      };
    },

    async delete(key: string): Promise<void> {
      try {
        await unlink(rutaSegura(key));
      } catch (error) {
        // Borrar algo que no existe no es un error: el puerto pide que sea
        // idempotente. Cualquier otro fallo si se propaga.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
  };
}
