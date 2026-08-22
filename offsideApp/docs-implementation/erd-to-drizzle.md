# ERD v1.1 → Drizzle

Traducción del **ERD v1.1** (`docs/04-technical/database-design.md`) a schema de
Drizzle. **Fecha: 2026-08-21** (actualizado tras cerrar DEC-041 y DEC-042).

> El ERD es la fuente de verdad. Drizzle lo **implementa**; no lo redefine
> (CLAUDE.md §6). Este documento describe la traducción, no decide nada.

## Estado

**Schema completo. Sin migrations, sin tocar PostgreSQL.**

## Ubicación y división

`offsideApp/packages/database/src/schema/` — un archivo por módulo del ERD §2.

| Archivo            | Tablas | ERD                         |
| ------------------ | ------ | --------------------------- |
| `_custom-types.ts` | —      | tipos `citext` y `tsvector` |
| `_enums.ts`        | —      | los 35 enums (§3)           |
| `auth.ts`          | 5      | §5                          |
| `users.ts`         | 5      | §6                          |
| `sellers.ts`       | 4      | §7                          |
| `catalog.ts`       | 9      | §8                          |
| `listings.ts`      | 3      | §9                          |
| `cart.ts`          | 3      | §10                         |
| `orders.ts`        | 3      | §11                         |
| `payments.ts`      | 7      | §12                         |
| `shipments.ts`     | 2      | §13                         |
| `disputes.ts`      | 3      | §14                         |
| `reviews.ts`       | 1      | §15                         |
| `trust.ts`         | 2      | §16                         |
| `config.ts`        | 1      | §17                         |
| `notifications.ts` | 1      | §18                         |
| `audit.ts`         | 1      | §19                         |
| `relations.ts`     | —      | relaciones del diagrama §4  |
| `index.ts`         | —      | reexporta todo              |

Los prefijos `_` marcan lo compartido, para que no se confunda con un módulo del
ERD.

## Auditoría ERD vs Drizzle

|        | ERD v1.1 | Drizzle | Diferencias |
| ------ | -------- | ------- | ----------- |
| Tablas | 50       | 50      | **0**       |
| Enums  | 35       | 35      | **0**       |

Verificado por introspección de `getTableConfig()` contra las listas textuales
del ERD §24, no a ojo.

Totales generados: **504 columnas · 73 foreign keys · 127 índices** (93 normales
y 34 UNIQUE, de los cuales 5 son parciales) · **6 CHECK constraints** ·
50 primary keys.

Conteo de columnas verificado contra el ERD tabla por tabla en las que el ERD
define columnas explícitamente: `users` 15, `orders` 25, `listings` 36,
`payments` 16, `refunds` 16, `disputes` 14, `shipments` 15,
`seller_liabilities` 13, `risk_events` 11, `app_settings` 10,
`seller_reputations` 11, `mercadopago_accounts` 13, `user_addresses` 14.
Todas coinciden.

### Reglas transversales verificadas

- **Dinero (§20.1):** 26 columnas `bigint`, 13 `char(3)` de `currency`,
  **0 columnas `float`/`double precision`/`real`**. Toda tabla con importes
  tiene su `currency`. Verificado automáticamente.
- **Soft delete (§21.9):** `deleted_at` existe **únicamente** en `users` y
  `listings`. No se agregó "por las dudas" a ninguna otra tabla.
- **PK y timestamps (§1):** 49 `gen_random_uuid()` (las 50 tablas menos
  `seller_reputations`, cuya PK es `seller_id`), 104 columnas `timestamptz`.
- **Snapshots (§20.2):** `orders` guarda el snapshot financiero
  (`commission_rate_at_transaction`, `commission_amount`, `mp_fee_amount`,
  `seller_amount`, `offside_amount`, `seller_tier_code_at_transaction`) y la
  dirección como `jsonb`, **no** como FK a `user_addresses`.
- **Config (DEC-038):** ningún valor de negocio hardcodeado. `seller_tiers` y
  `app_settings` se crean **vacías**; `commission_rate` es nullable y sin default.

### CHECK constraints implementados (6)

| Constraint                                | Regla                                   |
| ----------------------------------------- | --------------------------------------- |
| `listings_stock_check`                    | `stock >= 0`                            |
| `listings_price_amount_check`             | `price_amount > 0`                      |
| `orders_total_amount_check`               | `total = product - discount + shipping` |
| `orders_amounts_non_negative_check`       | los cuatro importes `>= 0`              |
| `reviews_rating_check`                    | `rating` entre 1 y 5                    |
| `seller_liabilities_settled_amount_check` | `0 <= settled_amount <= amount`         |

Son exactamente los que enumera el ERD §21.6. El ERD marcaba
`orders_total_amount_check` como "CHECK opcional, validado en app": se
implementó como CHECK porque §20.1 lo lista entre las reglas de integridad.

## Adaptaciones técnicas necesarias

Ninguna cambia el ERD. Todas son limitaciones de la herramienta.

### 1. Tres extensiones hay que crearlas a mano

ERD §1.b exige `citext`, `unaccent` y `pg_trgm`. **Drizzle Kit no genera
`CREATE EXTENSION`** para ninguna — verificado en el DDL exportado.

La primera migración **debe** empezar con:

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

| Extensión  | Usada por                           | Si falta                      |
| ---------- | ----------------------------------- | ----------------------------- |
| `citext`   | `users.email`                       | falla `CREATE TABLE users`    |
| `pg_trgm`  | 3 índices GIN trigram en `listings` | fallan esos `CREATE INDEX`    |
| `unaccent` | búsqueda en español (runtime)       | la búsqueda distingue acentos |

Las tres están disponibles en `postgres:17-alpine` (verificado: citext 1.6,
unaccent 1.1, pg_trgm 1.6). Es el punto más frágil del paso a migrations.

⚠️ `CREATE EXTENSION` requiere privilegios elevados: **verificar en Coolify**
antes del primer deploy.

### 2. `tsvector` declarado; lo puebla el Service (DEC-042)

`listings.search_vector` es `tsvector` con índice `GIN` (§9.1, §19.2). Se declaró
el tipo y el índice.

**DEC-042 cerró quién lo puebla: el Service de Listings**, no una columna
generada ni un trigger. El schema no puede expresar eso — es una regla de la capa
de aplicación. Al implementar búsqueda hay que respetar el contrato del ERD
§19.2: punto único de escritura, `setweight`, pesos desde `app_settings`, y job
de BullMQ para reindexar cuando cambian aliases de catálogo.

### 3. Defaults `bigint` como literal SQL

Drizzle Kit **crashea** con `TypeError: Do not know how to serialize a BigInt`
si un default de columna `bigint` se escribe como literal de JS (`0n`), porque
serializa su snapshot a JSON.

La solución es expresar el default como literal SQL:

```ts
bigint('discount_amount', { mode: 'bigint' })
  .notNull()
  .default(sql`0`);
```

Aplicado en `orders.discount_amount`, `orders.shipping_amount` y
`seller_liabilities.settled_amount`. El default en la base sigue siendo `0`,
como pide el ERD.

### 4. `app_settings.scope_id` sin foreign key

El ERD (§17.1) la define como **FK lógica**: apunta a `seller_tiers.id` o a
`categories.id` según el valor de `scope`. PostgreSQL no admite FK polimórficas,
así que la columna queda sin constraint y la integridad se valida en la
aplicación. **Es lo que el ERD especifica**, no una omisión.

Lo mismo aplica a `audit_log.entity_id`, `user_history_events.ref_entity_id` y
`risk_events.reference_id`: referencias polimórficas deliberadas.

### 5. `relations()` no crea foreign keys

Las FK reales están en `.references()` de cada tabla. `relations.ts` es sólo la
capa de consulta de Drizzle (`db.query.x.findMany({ with: ... })`). Las dos cosas
conviven y describen lo mismo.

## Decisiones de modelado respetadas

- **DEC-040 — hechos vs señales.** `user_history_events` (hechos, append-only,
  FK `RESTRICT` para que el historial sobreviva) y `risk_events`
  (interpretación) son tablas separadas.
  `risk_events.source_history_event_id` es **nullable**, como exige el ERD: una
  señal puede venir de un hecho, de muchos, o de un patrón.
- **DEC-036 — `seller_reputations` es cache derivado**, no fuente de verdad;
  `score` es nullable y recomputable.
- **DEC-034 — ciclos separados.** Order, Payment, Refund y Dispute se relacionan
  por FK, nunca por estado compartido.
- **DEC-030 — snapshot inmutable.** El schema no tiene ningún camino para
  recalcular importes históricos desde `app_settings`.
- **DEC-037 — `seller_tier` es tabla, no enum**, para poder cambiar tiers sin
  migración.
- **DEC-035 — estado crudo de MP conservado.** `payments.mp_status` y
  `chargebacks.status` son `text`, no enums: son estados de un tercero.

## Diferencias y pendientes

### 1. `catalog_change_requests` — ✅ CERRADO (DEC-041)

Era la única tabla del ERD sin definición de columnas. **Resuelto en ERD v1.1
§8.1** e implementado: 11 columnas, 2 FK (`requested_by` y `reviewed_by` → `users`),
3 índices, y dos enums propios (`catalog_request_status`, `catalog_target_type`).

`created_entity_id` queda **sin FK** por ser polimórfica, y la autorización vive
en la capa de permisos: la tabla **no se acopla a `seller_profiles`**.

Sigue 🟡 **quién aprueba** (permisos granulares de DEC-023 / OQ-F2). No bloquea
la migración: es política, no estructura.

### 2. Tablas con estructura 🟦 pendiente

`size_charts` (OQ-F3) e `identity_verifications.method` (TS-001) tienen su
semántica PENDING en el ERD. Se creó la estructura declarada, sin inventar el
resto.

### 3. Validaciones que quedan en la aplicación

El ERD las asigna explícitamente a la app, no a la base:

- `kit_type` y `sleeve` obligatorios cuando la categoría es camiseta (§9.1).
- Comprable sólo si `status='active'` **y** `moderation_status='APPROVED'` **y**
  `stock >= 1` (§9.1).
- Review sólo sobre órdenes `COMPLETED`/`DELIVERED` (§15).
- Tipado de `app_settings.value` según `value_type` (§17.1).
- Precedencia de configuración (§17.1) — su orden fino es 🟦.

No se convirtieron en CHECK: hacerlo sería endurecer reglas que el ERD dejó
deliberadamente flexibles.

## Validación ejecutada

```bash
npx drizzle-kit export --sql
```

`export` genera el DDL a stdout **sin crear migrations ni tocar la base**. Es la
única validación de Drizzle Kit que no muta nada.

Resultado: **exit 0, sin errores**, 883 líneas de DDL con 50 `CREATE TABLE`,
33 `CREATE TYPE`, 71 `FOREIGN KEY`, 123 índices y 6 CHECK.

`npm run verify`: format ✅ · lint ✅ · typecheck 6/6 ✅ · tests 17/17 ✅.

## Próximo paso (NO ejecutado)

Generar la primera migración, **agregándole a mano `CREATE EXTENSION IF NOT
EXISTS citext;` al principio** antes de aplicarla.
