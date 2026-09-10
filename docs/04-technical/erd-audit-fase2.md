# ERD Audit — Fase 2 — OFFSIDE STORE

> **Informe de auditoría del modelo de datos.** NO modifica el ERD. Su objetivo es
> recomendar los cambios necesarios para llegar al ERD definitivo, contrastando
> `database-design.md` (v0.1) contra las **decisiones CLOSED** (DECISIONS.md,
> DEC-001…DEC-038) y el resto de las fuentes de verdad.
> **Nada aquí se aplica hasta que ustedes aprueben.** Las decisiones **PENDING** no
> se inventan: se listan como bloqueantes.
> Fecha: 2026-08-19.

Convención de este informe: 🟥 cambio **requerido** por una decisión CLOSED · 🟨
mejora **recomendada** · 🟦 depende de una decisión **PENDING** (no se aplica) ·
✅ correcto.

---

## 1. RESUMEN EJECUTIVO

El ERD v0.1 es **estructuralmente sólido y bien pensado** (UUID, dinero en centavos,
snapshots, webhooks idempotentes, S3 para imágenes, catálogos controlados,
`audit_log` append-only). **No requiere un rediseño**, sino una **actualización de
alineación** con las decisiones de Fase 1 y el cierre de inconsistencias I-1…I-5.

Los cambios se concentran en cuatro frentes:

1. **Enums desactualizados** (order/payment/refund/risk/condition/authenticity/
   dispute). Es el grupo más grande y **100% requerido** (CLOSED). El propio ERD ya
   lo advierte en su banner.
2. **Snapshot financiero** (DEC-030/038): faltan campos (`commission_rate_at_
   transaction`, `discount_amount`, `offside_amount`) y hay **duplicación** entre
   `orders` y `payment_splits` que conviene resolver con una regla de "quién es la
   fuente".
3. **Conceptos nuevos sin tabla:** `SELLER_TIER` (DEC-037), `USER LEVEL` (DEC-020),
   **historial** como fuente de verdad (DEC-036), **Config Store** (DEC-038),
   **ventana de pago** (DEC-033). Algunos se pueden cerrar ahora (SELLER_TIER, user
   level, ventana de pago); otros requieren que ustedes elijan una alternativa
   (historial, config store).
4. **Coherencia menor pero importante:** faltan `currency` en varias tablas de
   dinero, `is_admin` es demasiado grueso frente a los roles de DEC-023, y hay
   ambigüedad sobre si el **riesgo** aplica al usuario o sólo al vendedor (necesario
   para el CASO 7).

**Los 8 casos** son representables **después** de aplicar los cambios requeridos.
Ninguno exige un rediseño; sí exigen los enums nuevos y ~6 columnas.

**Bloqueantes para cerrar el ERD:** dos decisiones de modelado que les pido decidir
(historial A/B y config store A/B/C) más el **alcance del riesgo** (usuario vs
vendedor) y el **naming del estado de seller_liability** (OPEN vs pending). El resto
puede cerrarse con lo ya decidido.

---

## 2. TABLAS ACTUALES

### 2.1 Correctas (se mantienen, con ajustes menores o nulos) — ✅

`users`✅, `sessions`✅, `oauth_accounts`✅, `email_verification_tokens`✅,
`password_reset_tokens`✅, `user_addresses`✅, `identity_verifications`✅ (pendiente
su método, 🟦), `mercadopago_accounts`✅, `seller_risk_history`✅ (enum cambia),
`categories`✅, `clubs`✅, `national_teams`✅, `brands`✅, `competitions`✅,
`countries`✅, `seasons`✅, `size_charts`✅, `catalog_change_requests`✅,
`listing_images`✅, `listing_price_history`✅, `carts`✅, `cart_items`✅,
`favorites`✅, `order_items`✅, `order_status_history`✅ (enum cambia),
`payment_splits`🟨 (falta `currency`), `payment_webhook_events`✅,
`chargebacks`✅ (falta `currency`), `reconciliation_records`✅, `shipments`🟨
(falta `currency`), `shipment_tracking_events`✅, `dispute_evidences`✅,
`dispute_actions`✅, `reviews`✅, `risk_events`✅, `sanctions`✅, `notifications`✅,
`audit_log`✅.

### 2.2 Necesitan cambios — 🟥/🟨

| Tabla | Motivo |
|-------|--------|
| `listings` | 🟥 enums `item_condition`/`authenticity` cambian; 🟨 falta `moderation_status` y (opcional) `sku`. |
| `orders` | 🟥 enum `order_status` + default; 🟨 snapshot financiero incompleto (ver §6); 🟥 `payment_deadline`/ventana de pago (DEC-033); 🟨 snapshot de `SELLER_TIER`. |
| `payments` | 🟥 enum `payment_status` (add `IN_PROCESS`, `PARTIALLY_REFUNDED`, casing); 🟨 idempotencia de creación (además de webhooks). |
| `refunds` | 🟥 enum `refund_status` nuevo; 🟨 falta `currency`. |
| `disputes` | 🟥 enum `dispute_status` (`seller_response`→`waiting_seller`). |
| `seller_profiles` | 🟥 enum `risk_level` nuevo; 🟥 agregar `seller_tier_id` (DEC-037); 🟦 definir si `risk_level` vive acá o en `users`. |
| `seller_reputations` | 🟥 `score` deja de ser autoridad (DEC-036); pasa a **cache derivado**. |
| `users` | 🟥 `is_admin` → roles (DEC-023); 🟥 agregar `user_level` (DEC-020); 🟨 `phone_verified_at`, `deleted_at`. |

### 2.3 Innecesarias

**Ninguna tabla sobra.** Todas tienen razón de negocio clara. La única "candidata"
sería `seller_reputations`, pero **no se elimina**: se **reinterpreta** como
proyección/cache derivada del historial (DEC-036), no como fuente de verdad.

---

## 3. TABLAS FALTANTES

| Tabla propuesta | Razón (decisión) | Estado |
|-----------------|------------------|--------|
| `seller_tiers` | Categoría comercial del vendedor: comisión/límites/beneficios (DEC-037). | 🟥 requerida (estructura); valores 🟦 |
| `app_settings` (Config Store) | Parámetros de negocio configurables sin código (DEC-038). | 🟦 requiere elegir alternativa (§11) |
| `user_history_events` | Historial como **fuente de verdad** de confianza (DEC-036). | 🟦 requiere elegir A/B (§10) |
| `user_level_history` | Auditar cambios de nivel de usuario (paralelo a `seller_risk_history`). | 🟨 recomendada |
| `admin_roles` / `admin_users` | Roles SUPER_ADMIN…FINANCE (DEC-023) si se modela como tabla en vez de enum. | 🟨 recomendada |
| `saved_searches`, `follows` | Engagement (búsquedas guardadas, seguir club/jugador/vendedor). | 🟦 POST-MVP (DEC-024) — **no** crear ahora |
| `payment_status_history` | Trazabilidad de transiciones de Payment (además de webhook_events). | 🟨 opcional (ver §9) |
| `invoices`/comprobantes fiscales | Facturación. | 🔴 PENDIENTE fiscal (DEC-011) — **no** modelar |

---

## 4. RELACIONES INCORRECTAS O A REVISAR

1. **`orders` ↔ `disputes` (1:1).** Correcto para el MVP (1 disputa por orden,
   DEC-034 mantiene entidades separadas). ✅ Se recomienda documentar que la
   relación es por **referencia**, no por estado.
2. **`orders` financiero vs `payment_splits`.** 🟨 Hoy `orders` guarda
   `offside_commission_amount`, `mp_commission_amount`, `seller_net_amount`,
   `commission_rate` **y** `payment_splits` guarda `seller_amount`,
   `marketplace_fee_amount`, `mp_fee_amount`. Es **duplicación con distinto naming**.
   Debe definirse una **fuente única**: recomendación en §9.
3. **`risk_events`/`seller_risk_history` → sólo vendedor.** 🟦 El CASO 7 habla de un
   **usuario** con `RISK_LEVEL = RIESGO`. Hoy el riesgo vive **sólo** en
   `seller_profiles`. Hay que decidir si el riesgo es del **usuario** (aplica a
   comprador y vendedor) o sólo del vendedor. (Ver §9 y §15.)
4. **`identity_verifications` sin unicidad.** 🟨 conviene `UNIQUE(user_id)` o al
   menos un índice de "última verificación vigente".
5. **`reviews` unidireccional (comprador→vendedor).** ✅ correcto para MVP; si a
   futuro hay review vendedor→comprador, se amplía (no ahora).
6. **`seller_liabilities` → origen.** ✅ ya referencia `order_id`/`refund_id`/
   `chargeback_id` (satisface CASO 5). 🟨 naming de estado (ver §5).

---

## 5. ENUMS A CAMBIAR

Todos **requeridos** por decisiones CLOSED (🟥), salvo donde se indique.

| Enum | Actual | Definitivo (decisión) |
|------|--------|-----------------------|
| `order_status` | created, payment_failed, paid, awaiting_shipment, shipped, delivered, completed, in_dispute, resolved, refunded, partially_refunded, cancelled | **PENDING_PAYMENT, PAID, PROCESSING, SHIPPED, DELIVERED, COMPLETED, CANCELLED** (DEC-029/034) |
| `payment_status` | pending, in_process, approved, rejected, cancelled, refunded, charged_back | **PENDING, IN_PROCESS, APPROVED, REJECTED, CANCELLED, REFUNDED, PARTIALLY_REFUNDED, CHARGED_BACK** (DEC-028/035 — **faltaba `partially_refunded`**) |
| `refund_status` | requested, processing, done, failed | **REQUESTED, UNDER_REVIEW, APPROVED, PROCESSING, COMPLETED, REJECTED** (DEC-031) |
| `dispute_status` | open, seller_response, under_review, resolved | **open, waiting_seller, under_review, resolved** (DEC-009) |
| `risk_level` | low, medium, high, critical | **NORMAL, RIESGO, RESTRINGIDO, SUSPENDIDO** (DEC-021) |
| `item_condition` | new_with_tags…used_fair | **NUEVO, COMO NUEVO, EXCELENTE, MUY BUENO, BUENO, ACEPTABLE** (DEC-025) 🟦 descripciones pendientes |
| `authenticity` | authentic_official, replica, unspecified | **No especificada, Original declarada, Réplica oficial, Verificada, Sospechosa, Falsificación** (DEC-025) 🟦 evidencia pendiente |
| `seller_liability_status` | pending, recovered, written_off | 🟦 **naming a decidir:** CASO 5 usa `OPEN`. Recomendado: `OPEN → RECOVERED / WRITTEN_OFF` para alinear con el caso. |

**Enums nuevos a crear:**

- `user_level` : **NUEVO, CONFIABLE, DESTACADO, COLECCIONISTA, TIENDA** (DEC-020). 🟥
- `admin_role` : **SUPER_ADMIN, ADMIN, MODERATOR, SUPPORT, FINANCE** (DEC-023). 🟥
- `seller_tier` : **no como enum** — recomiendo **tabla** `seller_tiers` (valores 🟦
  no definidos, DEC-037), referenciada por FK. Usar enum obligaría a migración por
  cada tier nuevo (contra DEC-013/032).
- (opcional) `moderation_status` : draft/pending/approved/rejected para `listings`. 🟨

**Nota de convención:** los enums en español con espacios (`item_condition`,
`authenticity`) conviene guardarlos como **códigos** `snake_case`/`SCREAMING_SNAKE`
(p. ej. `MUY_BUENO`, `ORIGINAL_DECLARADA`) y mostrar la etiqueta en la UI, para no
acoplar la DB al texto visible. 🟨

---

## 6. CAMPOS A AGREGAR

**`users`**
- `user_level user_level NOT NULL DEFAULT 'NUEVO'` (DEC-020). 🟥
- `phone_verified_at timestamptz NULL` (señal de identidad, DEC-036/TS). 🟨
- `deleted_at timestamptz NULL` (soft delete real; hoy sólo hay `status='deleted'`).
  Necesario para "eliminación de cuenta / exportación". 🟨
- Rol admin: `admin_role admin_role NULL` (reemplaza `is_admin`, DEC-023). 🟥

**`seller_profiles`**
- `seller_tier_id uuid FK→seller_tiers` (DEC-037). 🟥
- `risk_level` cambia de enum (ver §5). 🟥
- 🟦 (DEC-019, pendiente) posibles `block_sales_on_debt bool`, `exposure_limit_amount
  bigint` — **no** agregar hasta cerrar B4.

**`orders` — snapshot financiero (DEC-030/038)**
- `commission_rate_at_transaction numeric(6,4)` (renombra/oficializa `commission_
  rate`). 🟥
- `commission_amount bigint` (= comisión OFFSIDE). 🟥
- `mp_fee_amount bigint` (costo real MP de la operación, **no** hardcodeado). 🟥
- `seller_amount bigint`, `offside_amount bigint` (neto vendedor / neto OFFSIDE). 🟥
- `discount_amount bigint NOT NULL DEFAULT 0` (DEC-017; hoy no existe). 🟥
- `seller_tier_code_at_transaction text` (snapshot del tier para CASO 8). 🟨
- `payment_deadline timestamptz` (ventana de pago, DEC-033; el valor viene del
  Config Store). 🟥
- `status order_status NOT NULL DEFAULT 'PENDING_PAYMENT'` (cambia default). 🟥

**`payments`**
- `idempotency_key text UNIQUE` (idempotencia al **crear** el pago, no sólo webhooks;
  DEC-028). 🟨 (🌐 confirmar soporte MP)
- (mantiene `mp_status`, `mp_status_detail`, `raw` para el estado original — DEC-035 ✅)

**`refunds`, `payment_splits`, `shipments`, `chargebacks`, `seller_liabilities`**
- `currency char(3) NOT NULL DEFAULT 'ARS'` donde haya `*_amount` y hoy falta. 🟥
  (regla "todo dinero con currency").

**`listings`**
- `moderation_status moderation_status` (moderación, `configuration-registry`/
  Bloque 6). 🟨
- `sku text NULL` + `UNIQUE(seller_id, sku)` si se adopta SKU del vendedor. 🟨

**`disputes`**
- ✅ ya tiene `dispute_status`; sólo cambia el valor del enum.

---

## 7. CAMPOS A ELIMINAR / REEMPLAZAR

| Campo | Acción | Motivo |
|-------|--------|--------|
| `users.is_admin boolean` | **Reemplazar** por `admin_role` | DEC-023 (roles). 🟥 |
| `orders.offside_commission_amount` | **Renombrar** → `commission_amount` | Unificar naming del snapshot (DEC-030). 🟨 |
| `orders.mp_commission_amount` | **Renombrar** → `mp_fee_amount` | Consistencia con `payment_splits.mp_fee_amount`. 🟨 |
| `orders.seller_net_amount` | **Renombrar** → `seller_amount` | Idem. 🟨 |
| `orders.commission_rate` | **Renombrar** → `commission_rate_at_transaction` | DEC-030/038. 🟥 |
| `seller_reputations.score` | **No eliminar; degradar** a cache derivado (nullable, recomputable) | DEC-036 (no es autoridad). 🟥 |

> **No hay campos "basura"** para borrar; el trabajo es sobre todo de
> **renombrado/oficialización** para que el snapshot financiero sea explícito y
> único.

---

## 8. ÍNDICES Y CONSTRAINTS NECESARIOS

**Ya presentes y correctos:** `UNIQUE(email)`, `UNIQUE(token_hash)` (sessions),
`UNIQUE(provider, provider_account_id)`, `UNIQUE(seller_id)` y `UNIQUE(mp_user_id)`
(mercadopago_accounts), `UNIQUE(mp_payment_id)`, `UNIQUE(idempotency_key)`
(webhooks), `UNIQUE(order_number)`, `UNIQUE(order_id)` (shipments/disputes/reviews),
`GIN(search_vector)`, `GIN(extra_attributes)`. ✅

**A agregar / reforzar:**

- `listings`: `UNIQUE(seller_id, sku)` (si SKU) 🟨; índice compuesto
  `(status, category_id, club_id)` y `(status, price_amount)` (ya sugeridos) 🟨.
- `payments`: `UNIQUE(mp_payment_id) WHERE mp_payment_id IS NOT NULL` (partial) 🟨;
  `UNIQUE(idempotency_key)` 🟨.
- `orders`: `INDEX(seller_id, status)` (seller lookup), `INDEX(buyer_id, created_at)`
  (historial comprador), `INDEX(status, payment_deadline)` (expiración de ventana de
  pago, jobs). 🟨
- `seller_profiles`: `INDEX(seller_tier_id)`, `INDEX(risk_level)` (ya), 
  `INDEX(status)` (ya). 🟨
- `user_history_events` (si se adopta): `INDEX(user_id, created_at)`,
  `INDEX(event_type)`. 🟦
- `app_settings` (si se adopta): `UNIQUE(scope, scope_id, key)`. 🟦
- **CHECK de dinero:** `*_amount >= 0` en todas las tablas monetarias; en `orders`
  `total_amount = product_amount + shipping_amount - discount_amount` (validado en
  app; CHECK si se quiere duro). 🟨
- **CHECK `reviews.rating BETWEEN 1 AND 5`** ✅ ya está.
- **`favorites` / `cart_items`**: `UNIQUE` ya presentes. ✅

---

## 9. DECISIONES DE MODELADO IMPORTANTES

1. **Fuente única del snapshot financiero (recomendación 🟨).** `orders` es la
   **fuente comercial** (lo que Offside cobró/calculó: `order_total`,
   `commission_rate_at_transaction`, `commission_amount`, `discount_amount`,
   `seller_amount`, `offside_amount`, `mp_fee_amount`). `payment_splits` es la
   **fuente de conciliación con MP** (lo que MP efectivamente repartió, con su
   `raw`). Se documenta que ante discrepancia manda la conciliación (MP), pero el
   **snapshot inmutable de negocio** vive en `orders`. Esto elimina la duplicación
   ambigua actual.
2. **Alcance del riesgo (🟦 decisión).** `RISK_LEVEL` ¿es del **usuario** o del
   **vendedor**? El CASO 7 lo pone sobre "un usuario". Dos opciones: (a) mover
   `risk_level` a `users` (aplica a cualquier cuenta), (b) mantenerlo en
   `seller_profiles` y aceptar que el riesgo del CASO 7 se refiere a un usuario que
   además es vendedor. **Recomiendo (a)**: el riesgo es del **usuario** (un comprador
   también puede ser riesgoso por chargebacks/fraude). `USER LEVEL` también en
   `users`. Requiere su OK.
3. **`SELLER_TIER` como tabla, no enum (🟥 estructura).** Permite configurar
   comisión/límites/beneficios por tier sin migración (DEC-013/032/037). Los
   **valores** de los tiers quedan 🟦.
4. **`seller_reputations` = read model derivado (🟥).** Deja de ser autoridad; se
   recomputa desde el historial. Mantener sus contadores como cache acelera lectura.
5. **Snapshot de tier/comisión en `orders` (🟨).** Necesario para CASO 6 y CASO 8:
   las operaciones históricas conservan la tasa y (opcional) el tier vigentes al
   momento; nunca se recalculan (DEC-030/038).
6. **Estado original de MP (✅ ya soportado).** `payments.mp_status`/`raw` +
   `payment_webhook_events` cubren "estado original + auditoría + idempotencia".
   Opcional `payment_status_history` si se quiere trazar cada transición
   normalizada (🟨).

---

## 10. HISTORIAL / REPUTACIÓN

Contexto: DEC-036 fija que **el historial es la fuente de verdad** y que **no** hay
score como autoridad.

### Alternativa A — Historial **derivado** de orders/disputes/refunds/reviews/…
No existe tabla de historial; el "historial" se calcula on-demand (o en un job) a
partir de las entidades transaccionales.

- **Performance:** consultas de agregación potencialmente costosas; se mitiga con
  contadores cache (`seller_reputations`/`user_stats`) recomputables.
- **Consistencia:** la verdad está **distribuida**; el "qué cuenta como evento" se
  define en código de agregación → riesgo de drift entre reportes.
- **Auditoría:** débil; reconstruir "qué pasó y cuándo" exige unir muchas tablas.
- **Reputación:** nivel/riesgo se derivan, pero la **definición** de las señales
  vive en queries, no en datos.
- **Reporting:** cada reporte reimplementa la agregación.

### Alternativa B — Tabla explícita `user_history_events` (append-only)
Un log inmutable de eventos de dominio (`sale_completed`, `purchase_completed`,
`cancellation`, `claim_opened`, `refund_issued`, `dispute_resolved`, `infraction`…),
cada uno con `user_id`, `event_type`, `ref_entity`, `ref_id`, `data jsonb`,
`created_at`. Los contadores/nivel/riesgo se **derivan** de acá; `seller_reputations`
pasa a ser cache.

- **Performance:** lecturas de historial y agregados eficientes por `INDEX(user_id,
  created_at)`; escritura = 1 insert por evento.
- **Consistencia:** **una sola** definición de "evento"; fuente de verdad única
  (alineado con DEC-036).
- **Auditoría:** fuerte (append-only, timestamps, referencia al origen).
- **Reputación:** nivel (DEC-020) y riesgo (DEC-021) se calculan de forma
  determinística y explicable desde los eventos.
- **Reporting/analytics:** el mismo stream alimenta métricas (se solapa con Bloque
  18 analytics → sinergia).
- **Costo:** una tabla más y disciplina de "emitir evento" en cada transición
  (idealmente vía el mismo punto que escribe `audit_log`).

### Recomendación — **Alternativa B** ✅
Es la que **honra literalmente DEC-036** ("el historial es la fuente de verdad") y
la que menos deuda genera: audita, unifica la definición de señales, y da soporte
natural a niveles, riesgo y analytics. `seller_reputations` se conserva como
**proyección/cache recomputable** (no autoridad). Un eventual `score` es un campo
derivado de esta tabla, nunca su reemplazo.
> Requiere su aprobación antes de agregar `user_history_events` al ERD.

---

## 11. CONFIGURATION STORE

Contexto: DEC-038 pide un store **simple y controlado**, sin mega-EAV; las configs
económicas usadas en una operación se **snapshotean** en la transacción.

### Alternativa A — Key-Value (`app_settings`)
`key`, `value jsonb`, `scope` (global/seller_tier/category), `scope_id`, `version`,
`updated_by`, timestamps.

- **Pros:** máxima flexibilidad, una sola tabla, agregar parámetros sin migración.
- **Contras:** sin tipado fuerte ni validación en DB; riesgo de "cajón de sastre";
  precedencia (global vs scope) se resuelve en código.

### Alternativa B — Tablas por dominio
`commission_config`, `order_window_config`, `listing_rules_config`, etc., cada una
con columnas tipadas.

- **Pros:** tipado y constraints reales; auto-documentado.
- **Contras:** muchas tablas pequeñas; cada parámetro nuevo = migración (roza el
  "excesivamente complejo" que DEC-038 pide evitar).

### Alternativa C — Híbrido (recomendado)
- **`seller_tiers`** ya es una **tabla por dominio** (comisión/límites/beneficios) —
  ahí viven los parámetros ricos y relacionales.
- Un **`app_settings` key-value tipado y acotado** (con `scope`) para parámetros
  simples y globales/por-tier/por-categoría: comisión default, ventanas de
  cancelación/refund/pago, máximos de imágenes, límites, flags de moderación.
- **Regla dura (DEC-030/038):** todo parámetro económico usado en una operación se
  **copia como snapshot** en la transacción (`orders.commission_rate_at_transaction`,
  etc.). El Config Store nunca se consulta para recalcular lo histórico.

- **Performance:** lecturas triviales (pocos settings, cacheables en Redis).
- **Consistencia:** lo relacional/tipado (tiers) en tablas; lo simple en KV.
- **Auditoría:** `app_settings` versionado + `audit_log` en cada cambio.

### Recomendación — **Alternativa C (híbrido)** ✅
Cumple DEC-032 (simple) y DEC-038 (controlado), evita el mega-EAV y respeta el
snapshot económico. Requiere su OK para el modelo exacto de `app_settings`.

---

## 12. VALIDACIÓN DE LOS 8 CASOS

| Caso | ¿Representable hoy? | ¿Qué falta? |
|------|---------------------|-------------|
| **1** Compra OK: Payment APPROVED, Order PAID→…→COMPLETED | ⚠️ tras enums | `order_status` nuevo (hoy `awaiting_shipment` ≠ `PROCESSING`). Sin otro cambio. |
| **2** Pago rechazado: Payment REJECTED, Order PENDING_PAYMENT, reintento | ⚠️ tras enums + campo | `order_status` nuevo (falta `PENDING_PAYMENT`, default cambia) + `payment_deadline` (ventana, DEC-033). |
| **3** Refund parcial: Order COMPLETED, Payment PARTIALLY_REFUNDED, Refund COMPLETED | ⚠️ tras enums | `payment_status` **carecía de `PARTIALLY_REFUNDED`**; `refund_status` `done`→`COMPLETED`. Ciclos ya separados (DEC-034) ✅. |
| **4** Disputa sobre orden completada | ⚠️ tras enum | `dispute_status` `seller_response`→`waiting_seller`. Order no encoda disputa ✅ (DEC-034). |
| **5** Vendedor con deuda ligada al origen | ✅ (naming) | `seller_liabilities` ya liga `order/refund/chargeback`; sólo decidir `OPEN` vs `pending`. |
| **6** Comisión 10%→12%, históricas intactas | ✅ tras rename | `commission_rate_at_transaction` por orden (existe como `commission_rate`); nunca recalcular (snapshot) ✅. |
| **7** Usuario COLECCIONISTA + RIESGO simultáneos | ⚠️ decisión §9.2 | `user_level` en `users` (falta) + `risk_level` accesible a nivel usuario (hoy sólo en `seller_profiles`). |
| **8** Cambio de SELLER_TIER sin afectar históricas | ⚠️ tras tabla+snapshot | `seller_tiers` + `seller_profiles.seller_tier_id` (mutable) + snapshot de tier/comisión en `orders` (inmutable). |

**Conclusión:** los 8 casos quedan cubiertos con los **enums nuevos** + ~6 columnas
+ 1 tabla (`seller_tiers`) + la decisión de alcance del riesgo (CASO 7). Ninguno
obliga a rediseñar.

---

## 13. RIESGOS DEL ERD

1. **Drift de enums docs↔DB** (alto): hoy el ERD tiene los enums viejos; si se
   empieza Drizzle sin actualizarlos, se migra dos veces. **Mitigación:** cerrar
   enums antes de la primera migración.
2. **Alterar enums en Postgres es caro** (medio): agregar valor es fácil, **quitar/
   renombrar** requiere recrear el tipo. **Mitigación:** dejar los enums definitivos
   ahora; usar `text`+`CHECK` sólo para lo volátil/externo (estados crudos de MP,
   `chargebacks.status`).
3. **Duplicación financiera `orders`↔`payment_splits`** (medio): riesgo de números
   inconsistentes. **Mitigación:** regla de fuente única (§9.1).
4. **Riesgo/nivel/tier mal ubicados** (medio): si `risk_level`/`user_level` quedan
   sólo en `seller_profiles`, el CASO 7 (usuario) no cierra. **Mitigación:** §9.2.
5. **Historial derivado** (medio): si se elige A, la "fuente de verdad" queda en
   queries → drift de reputación/reporting. **Mitigación:** elegir B.
6. **Config como mega-EAV** (medio): si se elige A puro sin disciplina. **Mitigación:**
   híbrido C + snapshots.
7. **`currency` faltante en tablas de dinero** (bajo pero real): multi-moneda es
   post-MVP, pero la regla es "todo dinero con currency". **Mitigación:** agregar
   `currency` con default 'ARS'.
8. **`is_admin` grueso** (bajo): no permite SUPPORT/FINANCE/MODERATOR. **Mitigación:**
   `admin_role`.
9. **Tokens MP** (alto si se filtra, ya mitigado): cifrado en reposo + no
   serializar; ✅ ya contemplado. Reforzar que `mercadopago_accounts` **nunca** entre
   en `SELECT *` expuesto.

---

## 14. IMPACTO SOBRE EL FUTURO DRIZZLE SCHEMA

- **Definir todos los `pgEnum` antes de la primera migración.** Los cambios de §5
  son breaking; hacerlos ahora evita `ALTER TYPE` dolorosos.
- **Snapshots como columnas NOT NULL con default** donde aplique (`discount_amount`
  default 0) y **sin triggers de recálculo** (inmutables).
- **`seller_tiers`, `app_settings`, `user_history_events`** son tablas nuevas: su
  forma depende de las decisiones §10/§11 → **no** codificarlas hasta el OK.
- **`text`+`CHECK`** para estados crudos externos (MP/Correo) y `chargebacks.status`
  (dependen de terceros, 🌐).
- **Money helper:** definir un tipo/patrón común `amount bigint` + `currency char(3)`
  reutilizable en Drizzle para no olvidar `currency`.
- **Índices parciales** (`WHERE mp_payment_id IS NOT NULL`) y **generated column**
  para `search_vector` (o trigger) — confirmar soporte en la versión de Drizzle.
- **Orden de creación** por dependencias: catálogos → users → seller_tiers →
  seller_profiles → mercadopago_accounts → listings → carts → orders → payments →
  refunds/chargebacks/shipments/disputes → history/audit.

---

## 15. DECISIONES PENDIENTES QUE IMPIDEN CERRAR EL ERD

**Bloqueantes de modelado (necesito su decisión):**

1. 🟦 **Historial:** ¿Alternativa **A** (derivado) o **B** (`user_history_events`)?
   → recomiendo **B**.
2. 🟦 **Config Store:** ¿**A** (KV), **B** (tablas por dominio) o **C** (híbrido)?
   → recomiendo **C**.
3. 🟦 **Alcance del riesgo:** ¿`risk_level`/`user_level` en **`users`** (recomendado)
   o `risk_level` sólo en `seller_profiles`?
4. 🟦 **Naming `seller_liability_status`:** ¿`OPEN/RECOVERED/WRITTEN_OFF` (alinea con
   CASO 5) o mantener `pending/…`?
5. 🟦 **Roles admin:** ¿`admin_role` enum en `users` o tabla `admin_users`/
   `admin_roles`?
6. 🟦 **SKU y `moderation_status` en `listings`:** ¿se adoptan en el MVP?

**Bloqueantes por decisiones aún PENDING (no se inventan; el ERD queda con placeholder):**

7. 🟦 **DEC-025** — descripciones de `item_condition` y evidencia de `authenticity`
   (no bloquea la **forma** del enum, sí su semántica).
8. 🟦 **DEC-020/021** — umbrales de nivel y de riesgo (no bloquean el enum ni el
   campo; bloquean la **lógica** de cálculo).
9. 🟦 **SELLER_TIER** — valores concretos (la **tabla** puede crearse ya; se seedea
   después).
10. 🟦 **DEC-019** — liberación de fondos / campos extra de `seller_liabilities`
    (bloqueado por investigación MP 🔵).
11. 🔵 **MP fino** — vida/rotación de tokens, idempotencia de creación de pago
    (afinan `mercadopago_accounts`/`payments`, no bloquean la estructura).
12. 🔴 **Fiscal (DEC-011)** — sin tablas de facturación hasta asesoramiento.

**Lo que SÍ se puede cerrar ya (sin decisiones nuevas):** todos los enums de §5,
los renombres del snapshot financiero (§6/§7), `currency` faltante, `admin_role`,
`user_level`/`seller_tiers` (estructura), `payment_deadline`, y los índices/CHECK de
§8.

---

## Anexo — Checklist de aprobación

Para cerrar el ERD definitivo necesito su ✅ sobre: **(1)** Historial B, **(2)**
Config Store C, **(3)** riesgo/nivel en `users`, **(4)** naming liability,
**(5)** roles admin como enum, **(6)** SKU/moderación en listings. Con eso más los
cambios ya requeridos por decisiones CLOSED, actualizo `database-design.md` y marco
el ERD como **v1.0 cerrado**.
