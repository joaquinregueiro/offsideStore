import { getDatabase, schema, type Database } from '@offside/database';
import { and, desc, eq, isNull } from 'drizzle-orm';

/**
 * Lectura de `app_settings` (ERD §17.1) para las claves de calificaciones.
 * Sin reglas de negocio.
 *
 * ⚠️ MISMA CONSULTA QUE `reputation/repositories/reputation-settings.repository.ts`,
 * y por la misma razon: un modulo no importa el Repository de otro
 * (`modules/README.md`) y `config` no expone todavia un `getSettingValue(key)`
 * generico. Cuando lo exponga, este archivo desaparece.
 */

const conn = (db?: Database): Database => db ?? getDatabase();

/** Valor vigente (version mas alta) de una clave global, o `undefined`. */
export async function findCurrentValue(key: string, db?: Database): Promise<unknown> {
  const [row] = await conn(db)
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(
      and(
        eq(schema.appSettings.scope, 'global'),
        isNull(schema.appSettings.scopeId),
        eq(schema.appSettings.key, key),
      ),
    )
    .orderBy(desc(schema.appSettings.version))
    .limit(1);

  return row?.value;
}
