import { getDatabase, schema, type Database } from '@offside/database';
import { eq } from 'drizzle-orm';

/**
 * Acceso a los datos de PERFIL de `users` (ERD §2). Sin reglas de negocio.
 *
 * ⚠️ NO PISA A `auth/repositories/user.repository.ts`, LO COMPLEMENTA, y el
 * corte no es arbitrario: `auth` escribe lo que hace a la CREDENCIAL —el hash
 * de la contraseña, la marca de email verificado—, y este escribe lo que la
 * persona elige mostrar. Son dos responsabilidades distintas sobre la misma
 * tabla, y el ERD no modela una tabla `profiles` aparte donde separarlas.
 *
 * ⚠️ NO TOCA `email`, Y ESO ES DELIBERADO. Cambiar el email es cambiar la
 * credencial con la que se entra y la direccion a la que llegan los tokens: eso
 * es `auth`, necesita reverificacion, y no se resuelve con un UPDATE.
 */

const conn = (db?: Database): Database => db ?? getDatabase();

/**
 * Cambia el nombre visible.
 *
 * ⚠️ `updatedAt` LO ESCRIBE LA APP, no la base: el ERD deja `updated_at` a
 * cargo de la aplicacion (CLAUDE.md §6) y no hay trigger que lo mantenga.
 */
export async function updateDisplayName(
  userId: string,
  displayName: string | null,
  db?: Database,
): Promise<void> {
  await conn(db)
    .update(schema.users)
    .set({ displayName, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}
