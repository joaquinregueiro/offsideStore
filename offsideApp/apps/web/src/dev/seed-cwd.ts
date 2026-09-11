import { resolve } from 'node:path';

/**
 * Fija el directorio de trabajo en `apps/web` ANTES de que se evalue cualquier
 * modulo de la app.
 *
 * POR QUE ES UN ARCHIVO APARTE: el adaptador de storage local calcula su
 * carpeta a partir de `process.cwd()` en el momento de IMPORTARSE, y las fotos
 * tienen que caer en `apps/web/public/uploads/` para que `next dev` las sirva.
 * El comando documentado corre desde `offsideApp/`, asi que hay que cambiar de
 * directorio antes de que ese modulo se cargue. Los `import` de un archivo se
 * evaluan en orden, y este es el primero de `seed.ts`.
 *
 * ⚠️ NO se resuelve con `import()` dinamico dentro del seed, y no es capricho:
 * bajo `tsx`, los `.ts` de `apps/web` corren como CommonJS y un `import()`
 * dinamico carga una SEGUNDA instancia (ESM) de `@offside/database`, con su
 * propio pool que `closeDatabase()` nunca ve. El proceso termina el trabajo y
 * se queda colgado con una conexion abierta. Con imports estaticos hay una
 * sola instancia y el seed termina solo.
 */
process.chdir(resolve(import.meta.dirname, '..', '..'));
