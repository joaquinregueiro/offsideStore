import { getDatabase, schema, type Database } from '@offside/database';
import { eq } from 'drizzle-orm';

/**
 * Existe SOLO para validar `app_settings.scope_id` cuando `scope = 'category'`.
 *
 * `scope_id` es FK logica (ERD §17.1): PostgreSQL no puede exigir que apunte a
 * una categoria porque la tabla destino depende de `scope`. El Service la
 * valida antes de escribir, y esta es la unica pregunta que necesita hacerle
 * al catalogo. El catalogo en si es del modulo `listings`.
 */
export async function categoryExists(id: string, db?: Database): Promise<boolean> {
  const [fila] = await (db ?? getDatabase())
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(eq(schema.categories.id, id))
    .limit(1);

  return fila !== undefined;
}
