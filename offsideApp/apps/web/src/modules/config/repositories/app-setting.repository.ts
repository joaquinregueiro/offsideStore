import { getDatabase, schema, type Database } from '@offside/database';
import { and, desc, eq, isNull } from 'drizzle-orm';

/**
 * Acceso a `app_settings` (ERD §21.1). Sin reglas de negocio.
 *
 * ⚠️ LA TABLA ES VERSIONADA: `UNIQUE(scope, scope_id, key, version)`. Cambiar un
 * valor **inserta una version nueva**, no actualiza la anterior. El historial de
 * configuracion se conserva porque `orders` snapshotea la tasa aplicada
 * (DEC-030) y hay que poder auditar contra que configuracion se cobro.
 *
 * "Vigente" = la version mas alta de esa clave.
 */

export type AppSettingRow = typeof schema.appSettings.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

/** Solo `global` por ahora: los overrides por tier o categoria siguen 🟡. */
export type SettingScope = 'global';

/** Version vigente de una clave, o `undefined` si nunca se cargo. */
export async function findCurrent(key: string, db?: Database): Promise<AppSettingRow | undefined> {
  const [row] = await conn(db)
    .select()
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

  return row;
}

export interface InsertSettingValues {
  key: string;
  value: unknown;
  valueType: string;
  /** Usuario que hizo el cambio. `null` cuando lo carga una migracion. */
  updatedBy?: string | null;
}

/**
 * Inserta la version siguiente de una clave.
 *
 * ⚠️ La lectura de la version vigente y la insercion NO son atomicas entre si.
 * El `UNIQUE(scope, scope_id, key, version)` es el que decide: si dos cambios
 * simultaneos calculan la misma version, el segundo choca y falla en vez de
 * pisar al primero. Es el comportamiento que se quiere para configuracion.
 */
export async function insertNextVersion(
  values: InsertSettingValues,
  db?: Database,
): Promise<AppSettingRow> {
  const actual = await findCurrent(values.key, db);

  const [row] = await conn(db)
    .insert(schema.appSettings)
    .values({
      scope: 'global',
      scopeId: null,
      key: values.key,
      value: values.value,
      valueType: values.valueType,
      version: (actual?.version ?? 0) + 1,
      updatedBy: values.updatedBy ?? null,
    })
    .returning();

  return row!;
}
