# Validación post-migration

Evidencia de que PostgreSQL real quedó alineado con el ERD y con Drizzle.

|                        |                                                           |
| ---------------------- | --------------------------------------------------------- |
| **Fecha**              | 2026-08-21                                                |
| **Versión del ERD**    | **v1.1** (`docs/04-technical/database-design.md`)         |
| **Migration aplicada** | `0000_erd_v1_1_initial.sql`                               |
| **Mecanismo**          | `npm run db:migrate` → `drizzle-orm/postgres-js/migrator` |
| **Entorno**            | local, Docker Desktop 4.87.0 (engine 29.7.2) sobre WSL2   |
| **PostgreSQL**         | **17.11** (`postgres:17-alpine`, x86_64-pc-linux-musl)    |
| **Redis**              | `redis:8-alpine` — healthy, responde `PONG`               |
| **Base**               | `offside_dev` · usuario `offside` · puerto 5432           |

> No se usó `drizzle-kit push` ni SQL manual. La única fuente del schema fue la
> migration versionada.

## Precheck

La base estaba **verificada vacía** antes de aplicar (no asumida):

```
tablas_public=0   enums=0   extensiones_app=0
schema_drizzle=0  tabla___drizzle_migrations=0
```

Contenedores `offside-postgres` y `offside-redis`: ambos `running (healthy)`,
puertos `5432` y `6379` publicados.

## Extensiones instaladas

| Extensión  | Versión | Para qué                             |
| ---------- | ------- | ------------------------------------ |
| `citext`   | 1.6     | `users.email` case-insensitive       |
| `unaccent` | 1.1     | búsqueda en español sin acentos      |
| `pg_trgm`  | 1.6     | índices trigram (tolerancia a typos) |
| `plpgsql`  | 1.0     | (built-in de PostgreSQL)             |

Las tres se crearon desde la cabecera `CREATE EXTENSION IF NOT EXISTS` de la
propia migration, que es la **única** excepción idempotente del archivo.

## Conteos: ERD = Drizzle = Migration = PostgreSQL

| Objeto                | ERD v1.1 | Drizzle | Migration SQL | PostgreSQL real |
| --------------------- | -------- | ------- | ------------- | --------------- |
| Tablas                | 50       | 50      | 50            | **50**          |
| Enums                 | 35       | 35      | 35            | **35**          |
| Columnas              | —        | 504     | 504           | **504**         |
| Foreign keys          | 73       | 73      | 73            | **73**          |
| Índices explícitos    | 127      | 127     | 127           | **127**         |
| — de ellos UNIQUE     | 34       | 34      | 34            | **34**          |
| — parciales (`WHERE`) | 5        | 5       | 5             | **5**           |
| — GIN                 | 5        | 5       | 5             | **5**           |
| CHECK constraints     | 6        | 6       | 6             | **6**           |
| Primary keys          | 50       | 50      | 50            | **50**          |

> `pg_indexes` reporta **177**: son los 127 explícitos + los 50 índices que
> PostgreSQL crea automáticamente para las PRIMARY KEY. No es una diferencia.

## Introspección (`drizzle-kit introspect` contra la base real)

```
[✓] 50  tables fetched
[✓] 504 columns fetched
[✓] 35  enums fetched
[✓] 127 indexes fetched
[✓] 73  foreign keys fetched
[✓] 6   check constraints fetched
[✓] 0   views fetched
```

Se ejecutó con `--out` a un directorio temporal para no contaminar el repo.

### Diff a nivel de columna (no sólo conteos)

Comparación programática de las **504 columnas**, campo por campo, entre
`getTableConfig()` de Drizzle y `pg_attribute` / `pg_attrdef` de PostgreSQL:

```
columnas comparadas = 504
RESULTADO: CERO DIFERENCIAS en tipo, nullability y default
ENUMS:     los 35 coinciden valor a valor y en orden
```

## Reglas críticas verificadas contra la base real

| Regla                                     | Resultado                                                                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users.email` usa `citext`                | ✅ `USER-DEFINED / citext`                                                                                                                                                                                                                        |
| `listings.search_vector` es `tsvector`    | ✅                                                                                                                                                                                                                                                |
| Índices GIN                               | ✅ 5 (search_vector, extra_attributes, 3 trigram)                                                                                                                                                                                                 |
| Índices trigram                           | ✅ 3 (`title`, `player_name`, `model`)                                                                                                                                                                                                            |
| Sin `float` / `double precision` / `real` | ✅ **0 columnas**                                                                                                                                                                                                                                 |
| Dinero en `bigint`                        | ✅ 26 columnas                                                                                                                                                                                                                                    |
| `currency` en `char(3)`                   | ✅ 13 columnas                                                                                                                                                                                                                                    |
| `deleted_at` sólo donde corresponde       | ✅ únicamente `listings` y `users`                                                                                                                                                                                                                |
| Políticas `ON DELETE` del ERD             | ✅ **56 RESTRICT + 17 CASCADE, 0 NO ACTION**                                                                                                                                                                                                      |
| CASCADE sólo en hijos dependientes        | ✅ sessions, tokens, oauth_accounts, user_addresses, listing_images, listing_price_history, cart_items, favorites, order_items, order_status_history, payment_splits, shipment_tracking_events, dispute_evidences, dispute_actions, notifications |
| Polimórficas SIN FK física                | ✅ las 5: `app_settings.scope_id`, `audit_log.entity_id`, `user_history_events.ref_entity_id`, `risk_events.reference_id`, `catalog_change_requests.created_entity_id`                                                                            |

### Los 6 CHECK, tal como PostgreSQL los almacena

```sql
listings_price_amount_check              CHECK (price_amount > 0)
listings_stock_check                     CHECK (stock >= 0)
orders_amounts_non_negative_check        CHECK (product_amount >= 0 AND discount_amount >= 0
                                               AND shipping_amount >= 0 AND total_amount >= 0)
orders_total_amount_check                CHECK (total_amount = product_amount - discount_amount
                                               + shipping_amount)
reviews_rating_check                     CHECK (rating >= 1 AND rating <= 5)
seller_liabilities_settled_amount_check  CHECK (settled_amount >= 0 AND settled_amount <= amount)
```

## Pruebas ejecutadas

Todas dentro de transacciones con **rollback**. **No quedó ningún dato de
negocio persistido**: verificado al final (`users = 0`).

### Persistencia

| Prueba                                   | Resultado                                                   |
| ---------------------------------------- | ----------------------------------------------------------- |
| Conexión desde Drizzle                   | ✅                                                          |
| INSERT con defaults                      | ✅ `status=active`, `user_level=NUEVO`, `risk_level=NORMAL` |
| SELECT (case-insensitive vía `citext`)   | ✅ encontró con otro case                                   |
| UPDATE                                   | ✅                                                          |
| Dinero `bigint` sin pérdida de precisión | ✅ `12345678901234n`, `typeof === 'bigint'`                 |
| Defaults de listing                      | ✅ `currency='ARS'`, `stock=1`                              |
| DELETE                                   | ✅                                                          |
| Transacción + rollback                   | ✅ base intacta después                                     |

### Restricciones

| Prueba                             | Resultado                                           |
| ---------------------------------- | --------------------------------------------------- |
| FK válida                          | ✅ aceptada                                         |
| FK inválida                        | ✅ `23503` — `seller_profiles_user_id_users_id_fk`  |
| CHECK `rating=9`                   | ✅ `23514` — `reviews_rating_check`                 |
| CHECK total de orden inconsistente | ✅ `23514` — `orders_total_amount_check`            |
| CHECK `price_amount = 0`           | ✅ `23514` — `listings_price_amount_check`          |
| UNIQUE duplicado (distinto case)   | ✅ `23505` — `users_email_key`, `citext` lo detectó |
| `ON DELETE RESTRICT`               | ✅ bloqueó borrar el padre con hijo                 |
| `ON DELETE CASCADE` autorizado     | ✅ borró la sesión al borrar el usuario             |

### Estado de las migrations

```
drizzle.__drizzle_migrations: 1 fila (hash e86cabac2d2da9a3…)
re-ejecutar `npm run db:migrate` → no recrea nada, sigue en 1 fila y 50 tablas
`drizzle-kit check` → "Everything's fine"
```

### Health check end-to-end

```
postgres = UP (69ms)   redis = UP (23ms)
```

## Verificación del proyecto

```
npm run verify → format ✅  lint ✅  typecheck 6/6 ✅  tests 17/17 ✅
npm run build  → ✅
```

## Problemas encontrados

### 1. Docker Desktop no arrancaba — sockets huérfanos (resuelto)

El engine no levantaba. Causa raíz en los logs:

```
backend crashed: starting services: initializing Ingest server:
listening on unix://…/Docker/run/sailor-ingest.sock:
remove …/sailor-ingest.sock: The file cannot be accessed by the system.
```

Sockets AF_UNIX huérfanos de una ejecución previa que Windows no permite borrar
—ni Docker, ni PowerShell, ni `cmd`—. Afectaba dos directorios:

- `%LOCALAPPDATA%\Docker\run`
- `%LOCALAPPDATA%\docker-secrets-engine`

**Solución aplicada:** renombrar (no borrar) ambos directorios; Docker los
recrea limpios al arrancar. Se conservan como `*-stale-<timestamp>` por si hace
falta inspeccionarlos.

⚠️ **Es recurrente:** ya había pasado antes. Cada crash de Docker Desktop puede
dejar nuevos huérfanos. Si vuelve, aplicar el mismo rename, o reiniciar Windows.
No es un problema del proyecto ni del schema.

### 2. Nada más

No apareció **ninguna** contradicción entre ERD, Drizzle, migration y
PostgreSQL.

## Problemas pendientes

Ninguno nuevo de esta fase. Siguen abiertos los ya conocidos:

- 🟡 **Quién aprueba** una solicitud de catálogo — permisos granulares de
  DEC-023 / OQ-F2.
- 🟦 Los pendientes de ERD §22 (umbrales de nivel/riesgo, valores de
  `seller_tiers` y `app_settings`, reglas de refund y disputa).
- `listings.search_vector` queda **vacío**: por DEC-042 lo puebla el Service de
  Listings, que aún no existe. La búsqueda full-text no devolverá resultados
  hasta implementarlo. Es lo esperado.
- `seller_tiers` y `app_settings` están **vacías**: sin seed hasta que se
  definan valores (DEC-037 / DEC-038).
- ⚠️ **Coolify:** verificar que el rol de la aplicación pueda ejecutar
  `CREATE EXTENSION` antes del primer deploy. En local funciona porque `offside`
  es owner de la base.

## Conclusión

**Se cumple el criterio de éxito, con evidencia verificable:**

```
ERD v1.1  =  Drizzle  =  Migration  =  PostgreSQL REAL
```

50 tablas, 35 enums, 504 columnas, 73 FKs, 127 índices y 6 CHECK constraints
coinciden en las cuatro capas. El diff a nivel de columna (tipo, nullability,
default) y la comparación de valores de enums dieron **cero diferencias**. Las
restricciones se comportan en runtime exactamente como las define el ERD.
