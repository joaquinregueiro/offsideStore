import { getDatabase, schema, type Database } from '@offside/database';
import { and, desc, eq, isNull } from 'drizzle-orm';

/**
 * Lectura de `app_settings` (ERD §17.1) para las claves de reputacion y
 * niveles. Sin reglas de negocio.
 *
 * ⚠️ POR QUE NO SE IMPORTA EL REPOSITORY DE `config`: `modules/README.md`
 * prohibe que un modulo importe el Repository de otro, y el Service de
 * `config` hoy solo expone la comision y las imagenes. Es la misma consulta
 * —"version vigente de una clave global"— escrita una vez mas; cuando `config`
 * exponga un `getSettingValue(key)` generico, este archivo desaparece.
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
