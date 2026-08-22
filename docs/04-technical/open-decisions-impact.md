# Open Decisions — Impact Analysis — OFFSIDE STORE

> Traduce las **decisiones pendientes** a su **impacto sobre el sistema y el ERD**.
> Objetivo: saber qué NO se puede construir todavía y qué tablas/campos podrían
> cambiar. **No** modifica el ERD; sólo documenta el impacto. Actualizado 2026-08-19.

> ✅ **ERD v1.0 CERRADO (DEC-039).** Los ítems **estructurales** de este documento ya
> están **reflejados en `database-design.md`**: enums (D5), `SELLER_TIER` (A4/C…),
> Config Store (E1 → `app_settings`+`seller_tiers`), historial (`user_history_
> events`), `user_level`/`risk_level` en `users`, `seller_liabilities` estados,
> `admin_role`, `sku`/`moderation_status`. Lo que sigue abierto es **semántica/
> valores/lógica** (umbrales, fórmulas, reglas de refund/disputa, valores de tiers,
> MP fino, fiscal) — ver `database-design.md` §22. Este documento se conserva como
> historial del análisis; ante conflicto, **manda `database-design.md` v1.0 +
> `DECISIONS.md`**.
>
> ✅ **Modelo de riesgo — CLOSED (DEC-040).** Se separan **hechos**
> (`user_history_events`, fuente de verdad, sin interpretaciones) de **señales**
> (`risk_events`, con `source_history_event_id` nullable y `metadata`), y
> `users.risk_level` como estado actual. `seller_reputations` = cache derivado. MVP:
> señales por **reglas simples y configurables**, sin Risk Engine complejo. Ya
> reflejado en el ERD v1.0 (§6.3/§16.1). Lo único 🟦 PENDING es la **fórmula/
> umbrales** (DEC-020/021).

## Cómo leer

Cada ítem tiene: **decisión pendiente**, **por qué importa**, **qué afecta**, **qué
tablas podría afectar**, **qué decisión necesitamos**, y **prioridad**:

- 🔴 **BLOQUEANTE** — hay que resolverlo antes de pasar a Drizzle / construir esa área.
- 🟠 **IMPORTANTE** — no bloquea el arranque, pero debe resolverse pronto.
- 🟡 **POST-MVP** — puede esperar.

---

## A. Pagos y comisiones

### A1. Momento exacto de `PAID` y webhooks de Mercado Pago — 🔴 BLOQUEANTE
- **Por qué importa:** define cuándo se confirma una orden, se ejecuta el split y
  se descuenta stock. Es el corazón transaccional.
- **Qué afecta:** `payments`, `orders`, stock de `listings`, jobs de webhooks.
- **Tablas:** `payments`, `payment_webhook_events`, `orders`, `listings.stock`.
- **Qué decidir:** el **enfoque** ya está decidido (DEC-028: webhooks obligatorios,
  idempotencia, MP = fuente de verdad, Order→`PAID` sólo tras validación en
  backend). Resta 🔵 el **detalle** MP (nombres/estados crudos, firma de webhook,
  mapeo de estados, in_process).
- **Estado:** DEC-004 ✅ (Split), DEC-028 ✅ (enfoque + estados Payment), detalle 🔵.

### A2. Checkout — ✅ CERRADA (DEC-027)
- **Resuelto:** **Checkout Pro** como checkout inicial. Checkout API queda fuera del
  MVP.
- **Qué afecta:** `payments.checkout_type = 'pro'`.

### A3. Comisión de MP: valor real — 🟠 IMPORTANTE
- **Por qué importa:** Offside la absorbe (DEC-014); su valor calibra el % de
  comisión para no operar a pérdida.
- **Qué afecta:** unit economics, `payment_splits.mp_fee_amount`.
- **Qué decidir:** 🔵 investigar tarifario MP (por medio de pago/cuotas/plazo).

### A4. `SELLER_TIER` con comisión (DEC-015 → DEC-037) — 🟠 IMPORTANTE
- **Por qué importa:** la comisión (y límites/beneficios/condiciones) varían por
  **`SELLER_TIER`**, configurable; separado de USER LEVEL (I-5/DEC-037).
- **Qué afecta:** motor de comisión, Admin config.
- **Tablas (potencial, NO creadas):** `seller_tiers` (código, nombre, comisión,
  límites, beneficios) + FK desde `seller_profiles`; hoy sólo existe
  `orders.commission_rate` (tasa aplicada, snapshot).
- **Qué decidir:** valores definitivos de `SELLER_TIER` (🟡) + fuente de config
  (Config Store, DEC-038).

### A5. Cuotas (DEC-016) — 🟠 IMPORTANTE
- **Por qué importa:** define quién paga el costo financiero.
- **Qué afecta:** cálculo de importes en checkout, `orders`/`payments`.
- **Qué decidir:** 🔵 mecánica exacta en MP.

## B. Refunds, fondos y riesgo

### B1. Liberación de fondos sujeta a conformidad (DEC-019) — 🔴 BLOQUEANTE
- **Por qué importa:** reduce el riesgo central (refunds no recuperables); cambia
  cuándo el vendedor "tiene" el dinero.
- **Qué afecta:** `payments`/`orders` (estado de fondos), timing de liberación,
  jobs de liberación automática.
- **Tablas (potencial):** campos de "fondos retenidos/liberados" en `orders` o
  `payments`, o entidad `fund_releases`; condición automática configurable.
- **Qué decidir:** 🔵 **investigación técnica crítica** de MP Split (¿permite hold/
  liberación diferida?). **No inventar.**

### B2. Valores por defecto de la política de refunds (DEC-008) — 🟠 IMPORTANTE
- **Por qué importa:** aunque las reglas son configurables (⚙️), hay que fijar
  defaults (envío reembolsable, reversa de comisión, orden en devolución, plazos).
- **Qué afecta:** `refunds`, Admin config, disputas.
- **Tablas:** `refunds`, más una **tabla/almacén de configuración** (ver §E).
- **Qué decidir:** defaults de cada parámetro.

### B3. ¿Offside adelanta el refund al comprador? — 🟠 IMPORTANTE
- **Por qué importa:** define protección al comprador vs exposición financiera.
- **Qué afecta:** `refunds`, `seller_liabilities`, tesorería.
- **Qué decidir:** parámetro configurable + default.

### B4. `seller_liabilities` ampliado (DEC-019) — 🟠 IMPORTANTE
- **Por qué importa:** debe soportar bloqueo de ventas, descuento de ventas
  futuras y límite de exposición.
- **Qué afecta:** `seller_liabilities`, `seller_profiles`.
- **Tablas (potencial):** campos como `block_sales_on_debt`, `exposure_limit` en
  `seller_profiles` o config; lógica de recupero.
- **Qué decidir:** reglas y límites concretos (🟡).

### B5. Chargebacks — 🟡 POST-MVP (pero contemplar)
- **Por qué importa:** pérdidas potenciales; afecta reputación/reincidencia.
- **Qué afecta:** `chargebacks`, riesgo de fondos, reputación.
- **Qué decidir:** quién absorbe, efecto en vendedor/Offside/reputación,
  reincidentes (🟡).

## C. Confianza y reputación

### C1. Estados de riesgo nuevos (DEC-021) vs enum del ERD — 🔴 BLOQUEANTE (si se toca esa área)
- **Por qué importa:** el ERD tiene `risk_level = low|medium|high|critical`; la
  decisión nueva es `RIESGO|RESTRINGIDO|SUSPENDIDO`.
- **Qué afecta:** `seller_profiles.risk_level`, `seller_risk_history`, motor de riesgo.
- **Tablas:** enum `risk_level` (renombrar/redefinir), `seller_profiles`.
- **Qué decidir:** confirmar el nuevo enum + umbrales (🟡). **ERD NO modificado aún.**

### C2. Niveles de usuario (DEC-020) — 🟠 IMPORTANTE
- **Por qué importa:** progresión de estatus separada de riesgo/reputación.
- **Qué afecta:** perfil de usuario/vendedor, UI.
- **Tablas (potencial):** campo `user_level` en `users`/`seller_profiles` +
  definición de "compras y ventas"; hoy **no existe**.
- **Qué decidir:** definición de "compras y ventas" y umbrales (🟡).

### C3. Fórmula de reputación — 🟠 IMPORTANTE
- **Qué afecta:** `seller_reputations.score`, ranking de búsqueda.
- **Qué decidir:** fórmula y pesos (🟡).

### C4. Definición de "identidad verificada" (TS-001) — 🟠 IMPORTANTE
- **Qué afecta:** `identity_verifications`, gating de vendedor.
- **Qué decidir:** qué combinación de señales (email/teléfono/MP/KYC) exige Offside;
  🔵 qué expone el KYC de MP.

## D. Producto y disputas

### D1. Estado de producto y autenticidad ampliados (DEC-025) — 🟠 IMPORTANTE
- **Por qué importa:** difieren de los enums del ERD.
- **Qué afecta:** publicación, búsqueda/facetas, disputas.
- **Tablas:** enums `item_condition` (NUEVO/COMO NUEVO/EXCELENTE/MUY BUENO/BUENO/
  ACEPTABLE) y `authenticity` (No especificada/Original declarada/Réplica oficial/
  Verificada/Sospechosa/Falsificación) en `listings`.
- **Qué decidir:** **descripciones/evidencia de cada valor** (🟡) antes de tocar el
  enum. **ERD NO modificado aún.**

### D2. Renombre `dispute_status` (DEC-009) — 🟠 IMPORTANTE
- **Por qué importa:** el 2º estado pasa de `SELLER_RESPONSE` a `WAITING_SELLER`.
- **Qué afecta:** `disputes.status`.
- **Tablas:** enum `dispute_status`.
- **Qué decidir:** confirmar el renombre (ya decidido) + reglas de disputa (🟡).
  **ERD NO modificado aún.**

### D5. Enums de Payment / Order / Refund (Fase 1) — 🔴 BLOQUEANTE (confirmar antes de Drizzle)
- **Por qué importa:** los sets definitivos difieren de los enums del ERD.
- **Qué afecta:** `payments.status`, `orders.status`, `refunds.status`.
- **Tablas/enums:**
  - `payment_status` → `PENDING/IN_PROCESS/APPROVED/REJECTED/CANCELLED/REFUNDED/
    PARTIALLY_REFUNDED/CHARGED_BACK` (DEC-028 + **DEC-035 agrega `IN_PROCESS`**;
    conservar `mp_status`/`raw`).
  - `order_status` → `PENDING_PAYMENT/PAID/PROCESSING/SHIPPED/DELIVERED/COMPLETED/
    CANCELLED` (DEC-029; refund/disputa **no** son estados de Order — DEC-034).
  - `refund_status` → `REQUESTED/UNDER_REVIEW/APPROVED/PROCESSING/COMPLETED/REJECTED`
    (DEC-031).
- **Qué decidir:** confirmar los enums definitivos (I-1/I-2/I-3 ya resueltos) y
  **reflejarlos en el ERD** antes de migrar. **ERD NO modificado aún.**

### D6. Snapshot financiero (DEC-030) — 🟠 IMPORTANTE
- **Por qué importa:** debe garantizarse inmutabilidad y cobertura de todos los
  campos.
- **Qué afecta:** `orders`, `payment_splits`.
- **Tablas:** revisar que `order_total`, `commission_rate`, `commission_amount`,
  `mp_fee`, `seller_amount`, `offside_amount`, `discount_amount`, `shipping_amount`
  estén representados de forma inmutable; `mp_fee` **no** hardcodeado.
- **Qué decidir:** dónde vive `offside_amount`/`discount_amount` (hoy no explícitos).

### D3. Vintage/Retro (DEC-025) — 🟡 POST-MVP (definición)
- **Qué afecta:** `listings.is_retro`, búsqueda, autenticidad.
- **Qué decidir:** definiciones de vintage/retro/remake/réplica moderna (🟡).

### D4. Matriz "categoría → atributos obligatorios" — 🟠 IMPORTANTE
- **Qué afecta:** validación de publicación.
- **Tablas:** `categories.required_attributes`.
- **Qué decidir:** matriz fina (🟡).

## E. Configuración (transversal a DEC-013)

### E1. Config Store (DEC-038) — ✅ RESUELTO por DEC-039

> **Actualizado 2026-08-20.** Esta sección estaba marcada 🔴 BLOQUEANTE por el
> modelo de datos. **DEC-039 (cierre del ERD v1.0, 2026-08-19) lo resolvió**
> adoptando la Alternativa C. No es una decisión nueva: se alinea el texto con la
> decisión ✅ ya tomada. Lo único que sigue abierto son los **valores** y el
> **orden fino de precedencia** (🟦, no bloqueante para modelar).

- **Concepto CERRADO (DEC-038):** existirá un **Config Store administrativo**,
  **simple y controlado** para el MVP (no un motor genérico complejo), para cambiar
  parámetros de negocio sin código (comisión default, comisión por `SELLER_TIER`,
  ventana de cancelación, ventana de refund, máximo de imágenes, límites, etc.).
  **Regla firme:** toda config que afecte una transacción económica se **snapshotea
  dentro de la transacción** (`commission_rate_at_transaction`, `commission_amount`,
  …); **nunca** se recalcula lo histórico (DEC-030).
- **Modelo de datos — ✅ CERRADO (DEC-039, Alternativa C):** key-value acotado y
  tipado (`app_settings`) para lo simple + tabla de dominio (`seller_tiers`) para
  lo relacional/rico. Alcance resuelto por la columna `scope`
  (global / seller_tier / category). Versionado por columna `version` + registro
  en `audit_log`.
- **Tablas (EN EL ERD v1.0):** `app_settings` (§17.1) y `seller_tiers` (§7.1).
- **Qué queda 🟦:** los **valores** concretos y el **orden fino de precedencia**
  (publicación > categoría > seller_tier > global).
- **Ref:** `database-design.md` §17.1 y §7.1, `configuration-registry.md`,
  DEC-038, DEC-039.

## F. Engagement (nuevas entidades)

### F1. Búsquedas guardadas y follows — 🟡 POST-MVP
- **Qué afecta:** engagement, notificaciones/alertas.
- **Tablas (potencial, NO creadas):** `saved_searches`, `follows`
  (vendedor/club/jugador).
- **Qué decidir:** alcance en MVP (🟡).

## G. Fiscal / legal

### G1. Modelo fiscal (DEC-011) — 🔴 BLOQUEANTE para lanzamiento comercial
- **Por qué importa:** facturación, impuestos, comprobantes.
- **Qué afecta:** potencialmente nuevas tablas de facturación **no** modeladas.
- **Qué decidir:** **contador** (🔴). **No** se modela nada hasta entonces.
- **Ref:** `01-business/legal.md`.

---

## H. Inconsistencias de Fase 1 — ✅ TODAS CERRADAS (2026-08-19)

### I-1 — ✅ CLOSED (DEC-033)
**Resolución:** un pago rechazado **no** cancela la Order; permanece en
`PENDING_PAYMENT` y el comprador puede reintentar dentro de la **ventana de pago**.
`CANCELLED` sólo por: vencimiento de la ventana, cancelación del comprador,
cancelación del admin, o regla de negocio posterior. La ventana de pago es ⚙️
configurable (valor 🟡).
- **Impacto ERD (no aplicado):** ninguna columna nueva obligatoria; conviene un
  `payment_deadline`/`expires_at` en `orders` (⚙️). No se modela ahora.

### I-2 — ✅ CLOSED (DEC-034)
**Resolución:** **no** se agregan estados de refund/disputa al enum de `Order`.
Ciclos separados: Order (logístico) / Payment (financiero) / Refund / Dispute; se
relacionan por **referencia**. Ej.: Order `COMPLETED` + Payment `PARTIALLY_REFUNDED`
+ Dispute relacionada.
- **Impacto ERD (no aplicado):** mantener las relaciones ya existentes
  (`orders`↔`payments`↔`refunds`↔`disputes`); no encodar refund/disputa en
  `order_status`. Un flag derivado tipo `has_open_dispute` es opcional (se puede
  calcular por relación).

### I-3 — ✅ CLOSED (DEC-035)
**Resolución:** se **agrega `IN_PROCESS`** a `payment_status`. Se distingue el
estado **normalizado Offside** del **estado original de MP** (que se conserva para
auditoría), con un **mapeo explícito** MP→Offside en el backend.
- **Impacto ERD (no aplicado):** `payment_status` pasa a incluir `IN_PROCESS`;
  conservar `mp_status`/`raw` (ya existen en el diseño). Ver D5.

### I-4 — ✅ CLOSED (DEC-036)
**Resolución:** el **historial** es la **fuente de verdad**; **no** hay score como
autoridad principal. Un score sólo puede existir **derivado** del historial para
ranking/análisis, sin reemplazarlo.
- **Impacto ERD (no aplicado):** `seller_reputations.score` deja de ser autoridad;
  si se mantiene, es **derivado/cacheado** (recalculable) y debe existir una fuente
  de **eventos de historial** (tabla `user_history`/`reputation_events` — hoy no
  modelada explícitamente; las señales viven dispersas en orders/disputes/etc.).

### I-5 — ✅ CLOSED (DEC-037)
**Resolución:** `SELLER_TIER` (categoría comercial: comisión/límites/beneficios/
condiciones/reglas) queda **separado** de USER LEVEL (trayectoria/confianza). Nombre
`SELLER_TIER`; estructura simple y configurable; valores 🟡.
- **Impacto ERD (no aplicado):** entidad `seller_tiers` (código, nombre, comisión,
  límites, beneficios…) + FK desde `seller_profiles`; el **USER LEVEL** es un campo
  aparte (`user_level`). `TIENDA` (level) ≠ `SELLER_TIER`.

> **Nota:** el naming previo "tipos de vendedor" (DEC-015) se unifica bajo
> **`SELLER_TIER`** (DEC-037).

---

## Resumen de prioridades

| Prioridad | Ítems |
|-----------|-------|
| 🔴 **BLOQUEANTE** | A1 (detalle MP), B1 (liberación de fondos), D5 (enums Payment/Order/Refund — incl. `IN_PROCESS`), E1 (modelo del Config Store, DEC-038), G1 (fiscal, para lanzamiento) |
| 🟠 **IMPORTANTE** | A3, A4 (`SELLER_TIER`), A5, B2, B3, B4, C1, C2, C3, C4, D1, D2, D4, D6 |
| 🟡 **POST-MVP** | B5, D3, F1 |
| ✅ **CERRADAS Fase 1** | A2 (Checkout Pro), estados Payment/Order/Refund (DEC-028/029/031), snapshot financiero (DEC-030), principio simple/configurable (DEC-032), **I-1 (DEC-033), I-2 (DEC-034), I-3 (DEC-035), I-4 (DEC-036), I-5 (DEC-037)**, Config Store como concepto (DEC-038) |

### Antes de pasar a Drizzle (mínimo recomendado)
Resolver: **A1** (detalle MP), **B1** (liberación de fondos), **E1** (modelo del
Config Store), y confirmar los **enums** (**D5**, más C1/D1/D2). Las inconsistencias
I-1…I-5 ya están cerradas; falta sólo **reflejarlas en el ERD** cuando se apruebe.
