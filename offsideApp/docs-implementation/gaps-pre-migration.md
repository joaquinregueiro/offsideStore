# Gaps a cerrar antes de la primera migration

Análisis de los tres gaps detectados al traducir el ERD v1.0 a Drizzle.
**Fecha: 2026-08-21.**

> ## ✅ RESUELTO — este documento es histórico
>
> El owner aprobó las decisiones el 2026-08-21. Quedaron registradas como
> **DEC-041** (`catalog_change_requests`) y **DEC-042** (búsqueda) e incorporadas
> al **ERD v1.1** (§1.b, §3, §8.1, §9.1, §19.2, §28) y al schema de Drizzle.
>
> Este documento se conserva como registro del análisis y de las alternativas
> evaluadas. **Para el estado vigente, ver `erd-to-drizzle.md` y el ERD.**
>
> Diferencia respecto de la propuesta original: `catalog_target_type` quedó con
> **7 valores** (los catálogos controlados de `product-specification.md` §4.3),
> no con los 5 que proponía §1.10.
>
> Sigue abierto: **quién aprueba** una solicitud (permisos de DEC-023 / OQ-F2).

---

# 1. `catalog_change_requests`

## 1.1 Propósito

Permitir que un vendedor **proponga** el alta de un ítem de catálogo controlado
(club, selección, marca, competición, temporada) que todavía no existe, para
poder publicar — **sin darle permiso de escribir directamente** en esas tablas.

La razón es explícita en la documentación:

- `product-specification.md` §4.3: _"Alta de nuevos ítems: propuesta del vendedor
  → aprobación admin (**para no ensuciar el catálogo**)"_.
- `product-specification.md` §11 (riesgos): _"**Datos sucios:** si se permite
  texto libre donde debería haber catálogo, los filtros pierden valor (**mata el
  diferencial**)"_.

Es decir: esta tabla protege el diferencial del producto (búsqueda facetada).
Sin ella, o el catálogo se ensucia, o el vendedor no puede publicar.

## 1.2 Actores

| Actor             | Rol                     | Estado en la doc                              |
| ----------------- | ----------------------- | --------------------------------------------- |
| **Vendedor**      | propone el alta         | ✅ definido (`product-specification.md` §4.3) |
| **Administrador** | aprueba o rechaza       | ⚠️ **quién exactamente NO está decidido**     |
| **Sistema**       | registra en `audit_log` | ✅ ERD §19.1                                  |

⚠️ **DEC-023** define los roles (`SUPER_ADMIN`, `ADMIN`, `MODERATOR`, `SUPPORT`,
`FINANCE`) pero sus **permisos granulares están 🟡 PENDING**. `MODERATOR` es el
candidato natural, pero **no está escrito en ninguna parte**. No se asume.

## 1.3 Ciclo de vida necesario

```
   (vendedor)                    (admin)
   propone  ──►  PENDIENTE  ──►  revisa  ──►  APROBADA  ──► crea el ítem de catálogo
                                          └►  RECHAZADA ──► queda el motivo
```

Requisitos que impone la documentación:

- La propuesta **no** crea el ítem: lo crea la aprobación.
- La decisión debe quedar **auditada** (`audit_log`, ERD §19.1 — "toda acción
  administrativa sensible", AR-001).
- El rechazo debe conservar **por qué** se rechazó (para poder responderle al
  vendedor y para defender la decisión).

## 1.4 Información que obligatoriamente debe persistir

| Qué                             | Por qué                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| **A qué catálogo apunta**       | el mismo formulario sirve para clubs, brands, competitions…        |
| **Contenido propuesto**         | nombre, alias sugeridos, y los campos propios del catálogo destino |
| **Quién propuso**               | trazabilidad y para poder notificarle                              |
| **Estado**                      | dónde está en el flujo                                             |
| **Quién revisó y cuándo**       | auditoría (AR-001)                                                 |
| **Motivo de la decisión**       | especialmente en rechazo                                           |
| **Qué ítem se creó al aprobar** | cierra el círculo propuesta → entidad real                         |
| **Timestamps**                  | `created_at`, `updated_at`                                         |

## 1.5 Relaciones necesarias

| Relación                              | Notas                                                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requested_by` → `users`              | ⚠️ ¿o `seller_profiles`? La doc dice "del vendedor", pero un admin también podría cargar uno. **Requiere decisión.**                                 |
| `reviewed_by` → `users`               | el admin que decidió. Nullable hasta que se revise.                                                                                                  |
| `created_entity_id` → _(polimórfica)_ | apunta a `clubs` / `brands` / … según `target_type`. **Sin FK**, igual que `audit_log.entity_id` (ERD §19.1) — PostgreSQL no admite FK polimórficas. |

## 1.6 Qué debe conservarse como snapshot / histórico

- **El payload propuesto, tal como se envió.** Si luego se aprueba y un admin
  edita el club creado, la propuesta original no debe cambiar. Mismo principio
  que los snapshots del ERD §20.2.
- **El motivo del rechazo**, aunque después se apruebe una propuesta equivalente.
- La tabla es de **decisiones**: no se hard-deletea. Coherente con ERD §20.10
  (las efímeras se borran; ésta no es efímera).

## 1.7 Estados

Mínimo viable: `PENDING → APPROVED | REJECTED`.

Hay **dos caminos** y **ninguno es obvio** — requiere decisión:

| Opción                                                                    | A favor                                                                              | En contra                                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **A. Reusar `moderation_status`** (`PENDING/APPROVED/REJECTED/SUSPENDED`) | no agrega enums; el ERD §26.1 advierte que alterar enums post-migración es un riesgo | `SUSPENDED` no significa nada acá; acopla dos conceptos distintos (moderar publicaciones ≠ gobernar catálogo) |
| **B. Enum nuevo `catalog_request_status`**                                | semántica limpia; permite `UNDER_REVIEW` si se quiere                                | agrega el enum 34 al ERD; **debe decidirse ahora**, porque agregarlo después implica `ALTER TYPE`             |

## 1.8 Campos estrictamente necesarios para el MVP

```
id                 uuid PK
target_type        text        a qué catálogo apunta
payload            jsonb       contenido propuesto
requested_by       uuid FK     quién propuso
status             enum        PENDING / APPROVED / REJECTED
reviewed_by        uuid FK     null hasta revisar
reviewed_at        timestamptz null hasta revisar
review_note        text        motivo (obligatorio en rechazo, por app)
created_entity_id  uuid        null hasta aprobar; sin FK (polimórfica)
created_at         timestamptz
updated_at         timestamptz
```

`payload` es `jsonb` porque **la forma varía según el catálogo destino**: un club
no tiene los mismos campos que una temporada. Es coherente con el uso de `jsonb`
que ya hace el ERD (§1: "JSONB para snapshots, payloads crudos y atributos
extra").

## 1.9 Campos futuros / opcionales (NO en el MVP)

- `duplicate_of_id` — para marcar "ya existe, es un duplicado" en vez de un
  rechazo genérico.
- `evidence` — links o imágenes que justifiquen el alta (escudo oficial, etc.).
- `priority` / `due_at` — SLA de revisión.
- Propuestas de **edición** o **fusión** de ítems existentes: hoy la doc sólo
  habla de **alta** (§4.3). Ampliar el alcance sería inventar.

## 1.10 Propuesta concreta de schema

⚠️ **Requiere aprobación y actualizar el ERD antes de implementarse.**

```ts
export const catalogChangeRequests = pgTable(
  'catalog_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Catálogo destino: 'club' | 'national_team' | 'brand' | 'competition' | 'season'. */
    targetType: text('target_type').notNull(),

    /** Contenido propuesto, tal como se envió. Snapshot inmutable. */
    payload: jsonb('payload').notNull(),

    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),

    status: /* opción A o B de §1.7 */ 'status'.notNull().default('PENDING'),

    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** Motivo. Obligatorio en rechazo (validado en app). */
    reviewNote: text('review_note'),

    /** Ítem creado al aprobar. Polimórfico: sin FK, como audit_log.entity_id. */
    createdEntityId: uuid('created_entity_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    index('catalog_change_requests_status_idx').on(t.status),
    index('catalog_change_requests_requested_by_idx').on(t.requestedBy),
    index('catalog_change_requests_target_type_idx').on(t.targetType),
  ],
);
```

### Estado actual en el código

Hoy la tabla está implementada con la "forma común" de catálogo
(`name`, `slug`, `aliases`, `is_active`) porque es lo único que el ERD §8 le
asigna. **Esa forma es incorrecta para su propósito** y hay que reemplazarla por
la de arriba una vez aprobada.

### Decisiones que necesito antes de implementar

1. **¿Enum nuevo o reusar `moderation_status`?** (§1.7). Si es enum nuevo, hay
   que decidirlo ahora: agregarlo después obliga a un `ALTER TYPE`.
2. **¿`requested_by` apunta a `users` o a `seller_profiles`?**
3. **¿Qué rol aprueba?** Ligado a los permisos 🟡 de DEC-023.
4. **¿`target_type` es `text` o enum?** El ERD usa `text` para referencias
   polimórficas (`audit_log.entity_type`), lo que sugiere `text`.

> **Nota de proceso:** OQ-F2 ("Gobierno de catálogos controlados — alta de
> clubes/marcas/competiciones nuevas; **quién aprueba**") está abierta, y
> `product-specification.md` §10 la marca 🔴. La estructura de arriba no la
> resuelve: sólo la soporta. Los **valores y las políticas** siguen siendo
> decisión de negocio.

---

# 2. `citext` en `users.email`

## 2.1 Verificación

|                                              |                                            |
| -------------------------------------------- | ------------------------------------------ |
| Extensión disponible en `postgres:17-alpine` | ✅ `citext` **1.6**                        |
| Instalada actualmente                        | ❌ no                                      |
| Drizzle Kit genera `CREATE EXTENSION`        | ❌ **no** (verificado en el DDL exportado) |
| Tipo en el DDL generado                      | `"email" "citext" NOT NULL`                |

El modelo **no cambia**: `users.email` sigue siendo `citext`, como manda el ERD
§5.1.

## 2.2 Cómo debe incorporarse

Drizzle Kit genera el `CREATE TABLE "users"` con tipo `citext`, pero **nunca** la
sentencia que crea la extensión. Si se aplica la migración tal cual, falla con
`type "citext" does not exist`.

Procedimiento para la primera migración:

1. Generar la migración con `drizzle-kit generate`.
2. **Editar a mano** el `.sql` resultante y agregar como **primera línea**:

```sql
CREATE EXTENSION IF NOT EXISTS citext;
```

3. Recién entonces aplicarla.

`IF NOT EXISTS` la hace idempotente: no rompe si se re-ejecuta.

## 2.3 Consideraciones

- **Permisos:** `CREATE EXTENSION` requiere superusuario o el rol adecuado. En
  local, `offside` es el owner de la base y funciona. **En Coolify hay que
  verificarlo antes del primer deploy** — si el usuario de la app no puede crear
  extensiones, un DBA debe crearla previamente.
- **Editar migraciones generadas es aceptable acá**: la regla del ERD es que la
  base se modifica _sólo por migraciones_ (§20 / tech-stack §3.1), no que las
  migraciones no puedan tocarse. Queda versionada y auditable.
- **Alternativa descartada:** cambiar `citext` por `text` + índice funcional
  `LOWER(email)`. Sería reinterpretar el ERD. No se hace.

---

# 3. `tsvector` y búsqueda

## 3.1 Qué tablas lo usan

**Una sola:** `listings.search_vector` (ERD §9.1), con índice `GIN`
(`listings_search_vector_idx`). Verificado sobre el schema completo: no hay otra.

## 3.2 Qué campos deberían alimentar el índice

Según ERD §19.2, el vector se arma desde:

| Origen                         | Ubicación                                                                         | Problema           |
| ------------------------------ | --------------------------------------------------------------------------------- | ------------------ |
| `title`                        | misma fila                                                                        | —                  |
| `description`                  | misma fila                                                                        | —                  |
| `player_name`                  | misma fila                                                                        | —                  |
| `model`                        | misma fila                                                                        | —                  |
| **`aliases` de los catálogos** | **otras tablas** (`clubs`, `brands`, `competitions`, `national_teams`, `seasons`) | ⚠️ **cross-table** |

Ese último punto es el que decide la implementación.

PS-024 lo confirma: _"sinónimos/alias en catálogos (River = River Plate = CARP),
resueltos **al construir el índice** y al parsear la query"_.

## 3.3 ¿Alcanza el ERD actual para implementar búsqueda?

**Para lo básico sí; para lo prometido, no del todo.** Lo que falta no es
estructura de datos sino definiciones técnicas:

| Requisito                         | ¿Cubierto por el ERD?                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| Full-text + facetas (PS-020)      | ✅ `search_vector` + columnas indexadas                                                   |
| Conteos por faceta (PS-022)       | ✅ se derivan de los índices existentes                                                   |
| Ranking configurable (PS-021)     | ✅ los pesos van en `app_settings` (🟦 valores)                                           |
| Sinónimos/alias (PS-024)          | ⚠️ los datos existen (`aliases text[]`), **falta el mecanismo** que los mete en el vector |
| **Tolerancia a typos (PS-020.b)** | ❌ **requiere `pg_trgm` + índices GIN trigram que NO están en el ERD**                    |
| Búsquedas guardadas (PS-025)      | ✅ correctamente fuera del MVP (`saved_searches` no existe, ERD §2)                       |

Dos huecos concretos:

1. **`pg_trgm`** — el ejemplo obligatorio `"river 96 adidas"` → _"River Plate 1996
   Adidas"_ necesita trigramas o diccionarios. La extensión está disponible
   (`pg_trgm` 1.6, verificado) pero el ERD **no define índices trigram**. Mismo
   problema de extensión que `citext`. `product-specification.md` §5.3 lo marca
   🔵 "técnica fina a validar".
2. **Configuración de text search** — nadie definió si es `'spanish'`,
   `'simple'`, o `'spanish'` + `unaccent`. La base tiene `spanish` y `unaccent`
   disponibles. **Es una decisión técnica pendiente**, y no es menor: cambiarla
   después obliga a reindexar todo.

## 3.4 Recomendación técnica: generated column, trigger o aplicación

Dato verificado en la base real:

```
to_tsvector(regconfig, text) → IMMUTABLE   ✅ sirve para generated column
to_tsvector(text)            → STABLE      ❌ no sirve
```

Es decir, una columna generada **es posible**, pero sólo con la configuración
explícita (`to_tsvector('spanish', ...)`).

| Opción                  | Ventajas                                                                          | Limitación decisiva                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Generated column**    | imposible que se desincronice; cero código; PostgreSQL la mantiene                | **No puede leer otras tablas.** Los alias de catálogo quedan fuera → incumple PS-024                                                                      |
| **Trigger**             | puede hacer JOIN a los catálogos; se mantiene solo ante INSERT/UPDATE del listing | Si cambian los `aliases` de un club, los listings ya indexados **quedan viejos**: hace falta un segundo trigger sobre los catálogos que actualice en masa |
| **Desde la aplicación** | control total; los pesos (`setweight`) quedan explícitos y testeables             | Cada camino de escritura debe acordarse de actualizar; si uno se olvida, el listing se vuelve invisible en la búsqueda                                    |

**Recomiendo el enfoque híbrido:**

- La **aplicación** compone y escribe `search_vector` en el Service de `listings`
  (un solo punto de escritura, con `setweight` para que el título pese más que la
  descripción), porque es el único que puede incorporar los alias de catálogo con
  control y testearlo.
- Un **job de BullMQ** reindexa los listings afectados cuando cambian los
  `aliases` de un catálogo. La infraestructura de jobs ya existe y esto es
  exactamente el caso de uso: trabajo diferido y masivo, no bloqueante.

**Por qué no generated column:** es la opción más segura pero **no puede cumplir
PS-024**, que es parte del diferencial del producto. Descartarla es una decisión
técnica, no de negocio.

**Por qué no sólo trigger:** resuelve el JOIN pero mueve lógica de negocio
(los pesos del ranking, que son ⚙️ configurables por PS-021) dentro de PL/pgSQL,
donde no se testea ni se configura desde Admin. Contradice el layering de
`tech-stack.md` §2.

### Decisiones que necesito antes de implementar

1. **Configuración de text search:** `'spanish'`, o `'spanish'` + `unaccent`.
2. **¿Se agrega `pg_trgm`** y sus índices trigram al ERD, o la tolerancia a typos
   queda fuera del MVP? Hoy PS-020.b la pide, pero el ERD no la soporta.
3. **Confirmar el enfoque híbrido** (aplicación + job de reindexación).

Ninguna de estas se implementa hasta que estén decididas.
