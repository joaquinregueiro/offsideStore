import { getDatabase, schema, type Database } from '@offside/database';
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';

/**
 * Acceso a `app_settings` (ERD §17.1). Sin reglas de negocio.
 *
 * ⚠️ LA TABLA ES VERSIONADA: `UNIQUE(scope, scope_id, key, version)`. Cambiar un
 * valor **inserta una version nueva**, no actualiza la anterior. El historial de
 * configuracion se conserva porque `orders` snapshotea la tasa aplicada
 * (DEC-030) y hay que poder auditar contra que configuracion se cobro.
 *
 * "Vigente" = la version mas alta de esa clave DENTRO DE SU SCOPE. Una clave
 * puede tener una version 3 global y una version 1 para un tier: son dos
 * series distintas, cada una con su propio contador.
 */

export type AppSettingRow = typeof schema.appSettings.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

/** Los tres scopes del enum `config_scope` (ERD §17.1). */
export type SettingScope = (typeof schema.appSettings.$inferSelect)['scope'];

/**
 * A QUE ambito pertenece una fila.
 *
 * Es una union discriminada a proposito: `global` NO lleva `scopeId` y los
 * otros dos lo EXIGEN. Con `{ scope, scopeId? }` sueltos seria posible
 * escribir una fila `seller_tier` sin tier —que no es de nadie y nadie leeria—
 * o una global con id —que la busqueda por `IS NULL` no encontraria nunca—.
 * El tipo hace imposible las dos.
 */
export type SettingScopeRef =
  | { scope: 'global' }
  | { scope: 'seller_tier'; scopeId: string }
  | { scope: 'category'; scopeId: string };

export const GLOBAL_SCOPE: SettingScopeRef = { scope: 'global' };

/**
 * El WHERE del scope. `scope_id IS NULL` para global: `= NULL` nunca es
 * verdadero en SQL y la fila global no apareceria.
 */
function whereScope(ref: SettingScopeRef) {
  return ref.scope === 'global'
    ? and(eq(schema.appSettings.scope, 'global'), isNull(schema.appSettings.scopeId))
    : and(eq(schema.appSettings.scope, ref.scope), eq(schema.appSettings.scopeId, ref.scopeId));
}

/**
 * Version vigente de una clave, o `undefined` si nunca se cargo en ese scope.
 *
 * Sin `ref` lee la global: es lo que hacian todos los lectores hasta hoy y
 * sigue siendo lo que hacen. Los overrides por tier o categoria se leen
 * pasando el scope explicito, o —mejor— con `resolveSetting()` del service,
 * que aplica la precedencia.
 */
export async function findCurrent(
  key: string,
  db?: Database,
  ref: SettingScopeRef = GLOBAL_SCOPE,
): Promise<AppSettingRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.appSettings)
    .where(and(whereScope(ref), eq(schema.appSettings.key, key)))
    .orderBy(desc(schema.appSettings.version))
    .limit(1);

  return row;
}

/**
 * Todas las versiones de una clave, de la mas nueva a la mas vieja.
 *
 * ⚠️ LA TABLA YA GUARDABA EL HISTORIAL Y NADIE LO LEIA. Cada cambio inserta una
 * fila nueva con su `version`, su `updated_by` y su `created_at`: el registro de
 * quien cambio la comision y cuando estaba completo desde el primer dia, y la
 * pantalla mostraba solo la version vigente. Sin esto, "¿desde cuando cobramos
 * 6%?" se contesta con una consulta SQL a mano.
 */
export async function findHistory(
  key: string,
  limite = 10,
  db?: Database,
  ref: SettingScopeRef = GLOBAL_SCOPE,
): Promise<AppSettingRow[]> {
  return conn(db)
    .select()
    .from(schema.appSettings)
    .where(and(whereScope(ref), eq(schema.appSettings.key, key)))
    .orderBy(desc(schema.appSettings.version))
    .limit(limite);
}

/**
 * Version vigente de UNA clave en VARIOS scopes, de una sola consulta.
 *
 * Existe para la precedencia: resolver una clave para un vendedor con tier
 * necesita la fila del tier y la global, y hacer dos viajes a la base por
 * cada lectura de configuracion en una orden es pagar dos veces lo mismo.
 * Devuelve un mapa scope -> fila vigente; los scopes sin fila no aparecen.
 */
export async function findCurrentInScopes(
  key: string,
  refs: readonly SettingScopeRef[],
  db?: Database,
): Promise<Map<SettingScope, AppSettingRow>> {
  const vigentes = new Map<SettingScope, AppSettingRow>();
  if (refs.length === 0) return vigentes;

  // Una condicion por scope, unidas con OR. Traer todas las versiones y
  // quedarse con la mas alta de cada scope es una fila de mas por cambio
  // historico; con `version` indexada y cinco o seis versiones por clave sale
  // mas barato que N consultas con LIMIT 1.
  const filas = await conn(db)
    .select()
    .from(schema.appSettings)
    .where(and(eq(schema.appSettings.key, key), or(...refs.map(whereScope))))
    .orderBy(desc(schema.appSettings.version));

  for (const fila of filas) {
    // Vienen ordenadas de la version mas alta a la mas baja: la primera que
    // aparece de cada scope es la vigente.
    if (!vigentes.has(fila.scope)) vigentes.set(fila.scope, fila);
  }

  return vigentes;
}

/**
 * La version vigente de CADA (scope, scope_id, key) que exista en la tabla,
 * en una sola consulta. Para `listSettings()` del back-office: la pantalla
 * muestra el valor global de cada clave del registro y sus overrides.
 *
 * `DISTINCT ON` con `ORDER BY ... version DESC` es exactamente "la fila mas
 * alta de cada serie", y lo resuelve PostgreSQL en vez de traer todo el
 * historial para descartarlo aca. Claves que no esten en el registro tambien
 * vienen: filtrar es del Service.
 */
export async function findAllCurrent(db?: Database): Promise<AppSettingRow[]> {
  return conn(db)
    .selectDistinctOn([
      schema.appSettings.scope,
      schema.appSettings.scopeId,
      schema.appSettings.key,
    ])
    .from(schema.appSettings)
    .orderBy(
      asc(schema.appSettings.scope),
      asc(schema.appSettings.scopeId),
      asc(schema.appSettings.key),
      desc(schema.appSettings.version),
    );
}

export interface InsertSettingValues {
  key: string;
  value: unknown;
  valueType: string;
  /** Usuario que hizo el cambio. `null` cuando lo carga una migracion. */
  updatedBy?: string | null;
  /** Ambito de la fila. Global si se omite: es lo que hacian todas las escrituras hasta hoy. */
  scope?: SettingScopeRef;
}

/**
 * Inserta la version siguiente de una clave EN SU SCOPE.
 *
 * ⚠️ La lectura de la version vigente y la insercion NO son atomicas entre si.
 * El `UNIQUE(scope, scope_id, key, version)` es el que decide: si dos cambios
 * simultaneos calculan la misma version, el segundo choca y falla en vez de
 * pisar al primero. Es el comportamiento que se quiere para configuracion.
 *
 * ⚠️ NO VALIDA el valor ni si la clave admite ese scope: eso es del Service
 * (`setting-store.service.ts`). Escribir por aca directo es saltearse la
 * validacion, igual que un INSERT a mano.
 */
export async function insertNextVersion(
  values: InsertSettingValues,
  db?: Database,
): Promise<AppSettingRow> {
  const ref = values.scope ?? GLOBAL_SCOPE;
  const actual = await findCurrent(values.key, db, ref);

  const [row] = await conn(db)
    .insert(schema.appSettings)
    .values({
      scope: ref.scope,
      scopeId: ref.scope === 'global' ? null : ref.scopeId,
      key: values.key,
      value: values.value,
      valueType: values.valueType,
      version: (actual?.version ?? 0) + 1,
      updatedBy: values.updatedBy ?? null,
    })
    .returning();

  return row!;
}
