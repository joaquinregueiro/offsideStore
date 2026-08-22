# DECISIONS — OFFSIDE STORE

Registro de **decisiones** del proyecto y su estado. Es la contraparte de
`OPEN-QUESTIONS.md`, `04-technical/open-decisions-impact.md` (impacto de lo
pendiente) y `RISKS.md`.

> **Actualización de taxonomía (2026-08-19).** A pedido del owner se adopta una
> clasificación de **5 estados** que reemplaza la anterior (✅/🟡/🔴 "pendiente").
> Convivencia: donde documentos viejos usen 🔴 con el sentido anterior de
> "DECISION REQUIRED", debe reinterpretarse según esta tabla. El tag 🌐
> **DEPENDENCIA EXTERNA** (MP / Correo Argentino — *no inventar*) se mantiene como
> marca **ortogonal** al estado (muchos ítems 🌐 son además 🔵).

## Leyenda de estado (canónica)

| Marca | Significado |
|-------|-------------|
| ✅ **DECIDIDO** | Decisión firme y estable; se puede construir sobre ella. |
| ⚙️ **CONFIGURABLE** | Decidido que el comportamiento se gobierna desde el panel de Admin; el **valor** concreto no se fija en código. Ver `04-technical/configuration-registry.md`. |
| 🟡 **PENDIENTE** | Falta definir; decisión interna del equipo. |
| 🔵 **REQUIERE INVESTIGACIÓN** | Depende de investigar un tercero/tecnología (típicamente Mercado Pago o Correo Argentino) antes de decidir. |
| 🔴 **REQUIERE ASESORAMIENTO PROFESIONAL** | Necesita contador/abogado antes del lanzamiento comercial (fiscal, legal). |
| 🌐 *(tag)* | Dependencia externa (MP/Correo). No se inventan sus comportamientos. |

## 1. Tabla maestra de decisiones

| ID | Decisión | Estado |
|--------|----------|--------|
| DEC-001 | Nombre: Offside Store | ✅ |
| DEC-002 | Modelo marketplace (intermediario, no dueño del stock) | ✅ |
| DEC-003 | Monetización por comisión | ✅ |
| DEC-004 | Mercado Pago Split Payments | ✅ |
| DEC-005 | OAuth vendedores | ✅ |
| DEC-006 | Correo Argentino (integración inicial) | ✅ dirección / 🔵 detalles |
| DEC-007 | Comisión exacta (%) | ⚙️ / 🟡 |
| DEC-008 | Política de refunds | ⚙️ principio / 🟡 valores |
| DEC-009 | Sistema de disputas | 🟡 |
| DEC-010 | Política de autenticidad | 🟡 |
| DEC-011 | Modelo fiscal e impuestos | 🔴 |
| DEC-012 | Stack definitivo | ✅ |
| DEC-013 | Configurabilidad operativa desde Admin (principio) | ✅ |
| DEC-014 | Reglas de cálculo de comisión (base, IVA, min/máx, categoría) | ✅ |
| DEC-015 | Tipos de vendedor con comisión (renombrado **SELLER_TIER**, ver DEC-037) | ✅ estructura / 🟡 valores |
| DEC-016 | Costo de cuotas (quién lo absorbe) | ✅ principio / 🔵 MP |
| DEC-017 | Costo de descuentos (quién lo absorbe) | ✅ |
| DEC-018 | Comisión sobre refund parcial la absorbe Offside | ⚙️ (✅ default) |
| DEC-019 | Liberación de fondos del vendedor sujeta a conformidad | ✅ principio / 🔵 MP (crítico) |
| DEC-020 | Niveles de usuario (NUEVO→…→TIENDA) | ✅ estructura / 🟡 umbrales |
| DEC-021 | Estados de riesgo (NORMAL→RIESGO→RESTRINGIDO→SUSPENDIDO) | ✅ estructura / 🟡 umbrales |
| DEC-022 | Historial, nivel de usuario y riesgo son conceptos distintos | ✅ |
| DEC-023 | Roles de administración (SUPER_ADMIN…FINANCE) | ✅ set / 🟡 permisos |
| DEC-024 | Alcance del MVP y fuera de alcance | ✅ |
| DEC-025 | Conjuntos de estado de producto y de autenticidad | 🟡 (conjuntos propuestos) |
| DEC-026 | 1 orden = 1 vendedor; carrito multi-vendedor se divide en órdenes | ✅ |
| DEC-027 | Checkout Pro como checkout inicial | ✅ |
| DEC-028 | Estados iniciales de Payment (PENDING/IN_PROCESS…CHARGED_BACK) | ✅ (enmendada por DEC-035) |
| DEC-029 | Estados técnicos iniciales de Order (PENDING_PAYMENT…CANCELLED) | ✅ |
| DEC-030 | Snapshot financiero por transacción; tasa MP no hardcodeada; sin recálculo histórico | ✅ |
| DEC-031 | Estados iniciales de Refund | ✅ estructura / 🟡 resto |
| DEC-032 | Principio "Simple por defecto, configurable cuando sea necesario" | ✅ |
| DEC-033 | Pago rechazado no cancela la Order (I-1) | ✅ |
| DEC-034 | Ciclos de vida separados Order/Payment/Refund/Dispute (I-2) | ✅ |
| DEC-035 | `IN_PROCESS` en Payment + mapeo estado MP↔Offside (I-3) | ✅ |
| DEC-036 | Historial es la fuente de verdad de confianza; score sólo derivado (I-4) | ✅ |
| DEC-037 | `SELLER_TIER` separado de USER LEVEL (I-5) | ✅ estructura / 🟡 valores |
| DEC-038 | Configuration Store administrativo (simple) + snapshot económico | ✅ concepto / ✅ modelo (DEC-039) / 🟦 valores |
| DEC-039 | ERD v1.0 cerrado + 6 decisiones de modelado (Fase 2) | ✅ |
| DEC-040 | Riesgo: hechos (`user_history_events`) vs señales (`risk_events`) | ✅ |
| DEC-041 | Estructura de `catalog_change_requests` (gobierno de catálogos) | ✅ estructura / 🟡 permisos (DEC-023) |
| DEC-042 | Técnica de búsqueda: `spanish` + `unaccent` + `pg_trgm`; `search_vector` desde el Service | ✅ |

## 2. Detalle de cada decisión

### DEC-001 — Nombre: Offside Store — ✅
El nombre del producto/empresa es **OFFSIDE STORE**. Estable.

### DEC-002 — Modelo marketplace — ✅
Marketplace **intermediario** que conecta compradores y vendedores; **no** es
dueño ni revendedor del stock de terceros. Ref: `01-business/business-model.md`.

### DEC-003 — Monetización por comisión — ✅
Ingreso principal: **comisión sobre cada venta**, a cargo del vendedor. Reglas de
cálculo en DEC-014; valor en DEC-007. Ref: `business-model.md`,
`payments-and-commissions.md`.

### DEC-004 — Mercado Pago Split Payments — ✅
Los fondos se distribuyen entre vendedor y Offside mediante **Mercado Pago Split
Payments**. La mecánica técnica fina (checkout, momento de PAID, tokens,
conciliación, etc.) es 🔵 y 🌐: **no se asumen detalles no investigados**. Ref:
`payments-and-commissions.md`.

### DEC-005 — OAuth vendedores — ✅
El vendedor conecta su cuenta MP por **OAuth**. **Conectar MP no otorga confianza
ni verificación de identidad automática** (DEC-022, `trust-and-safety.md`).

### DEC-006 — Correo Argentino (integración inicial) — ✅ dirección / 🔵 detalles
Se mantiene Correo Argentino como **integración inicial de envíos**. API,
credenciales, creación de envío, etiqueta, tracking, estados, webhooks/polling y
manejo de errores/pérdidas/demoras quedan 🔵 (a investigar) y 🌐. Ref: `shipping.md`.

### DEC-007 — Comisión exacta (%) — ⚙️ / 🟡
El **porcentaje** de comisión **todavía no está definido** y **no es bloqueante**
en esta etapa. Debe ser **configurable** desde Admin (⚙️), sin necesidad de tocar
código. Las **reglas** de cómo se calcula sí están decididas (DEC-014). Ref:
`business-model.md`, `payments-and-commissions.md`, `configuration-registry.md`.

### DEC-008 — Política de refunds — ⚙️ principio / 🟡 valores
**Decidido:** todas las reglas de refunds deben ser **configurables desde Admin**
(⚙️): total/parcial, antes/después de envío/entrega, quién inicia, plazos, quién
decide, tratamiento de comisión/costos MP/envío, quién paga la devolución, registro.
Los **valores concretos** siguen 🟡. Ref: `orders-and-refunds.md`,
`configuration-registry.md`.

### DEC-009 — Sistema de disputas — 🟡
Se mantiene el **flujo conceptual** `OPEN → WAITING_SELLER → UNDER_REVIEW →
RESOLVED`. Motivos, plazos, evidencias (fotos/videos/mensajes/tracking/
comprobantes), quién analiza, facultades del admin y resoluciones quedan 🟡.
> **Contradicción señalada:** el ERD/`trust-and-safety.md` previos nombraban el 2º
> estado `SELLER_RESPONSE`. **Se prioriza el nuevo nombre `WAITING_SELLER`.** Ver
> impacto en `open-decisions-impact.md` (enum `dispute_status`).

### DEC-010 — Política de autenticidad — 🟡
Se amplía el conjunto de categorías de autenticidad (ver DEC-025). Qué **evidencia**
requiere cada categoría queda 🟡. Sin verificación física en el MVP. Ref:
`product-specification.md`, `trust-and-safety.md`.

### DEC-011 — Modelo fiscal e impuestos — 🔴
**Reclasificado a 🔴 REQUIERE ASESORAMIENTO PROFESIONAL.** Offside aún **no tiene
definida** estructura jurídica, inscripción fiscal ni régimen impositivo. Todo el
bloque (IVA, IIBB, Ganancias, régimen de percepción de plataformas, facturación de
la comisión y del vendedor, quién emite comprobante, monotributo/RI, percepciones,
retenciones, reportes) queda **pendiente de contador/asesor fiscal antes del
lanzamiento comercial real**. **No se modela nada fiscal por ahora.** Ref:
`business-model.md`, `01-business/legal.md`, `open-decisions-impact.md`.

### DEC-012 — Stack definitivo — ✅
Confirmado (ver `04-technical/tech-stack.md`). Next.js + TS, PostgreSQL, Drizzle,
Redis, BullMQ, S3, búsqueda en Postgres, auth propia + OAuth externos, MP Split,
Correo Argentino, Docker + Coolify; monolito modular en monorepo Turborepo.

### DEC-013 — Configurabilidad operativa desde Admin (principio) — ✅
**Principio arquitectónico:** todas las reglas **operativas razonables** deben poder
**modificarse desde administración** sin cambiar código. Aplica a comisiones,
refunds, reputación, publicaciones, envíos, etc. Se distingue entre **configuración
administrativa** (global/por tipo de vendedor/por categoría) y **datos propios de
cada publicación** (no son configuración global). Catálogo en
`04-technical/configuration-registry.md`.

### DEC-014 — Reglas de cálculo de comisión — ✅
- **Base de cálculo:** la comisión se calcula sobre el **TOTAL cobrado al comprador**.
- **Precio final:** se calcula sobre el **precio final efectivamente cobrado**
  (con descuentos aplicados).
- **IVA:** la comisión de Offside se considera **IVA incluido**.
- **Sin mínimo ni máximo** de comisión.
- **Sin diferenciación por categoría de producto.**
- **Costo de Mercado Pago:** lo **absorbe Offside**, contemplado **dentro** de su
  comisión.
> Esto **cierra parte de DEC-007** (antes la base era pregunta abierta). Se prioriza
> esta decisión sobre lo que decían `business-model.md`/`payments` previos
> (que dejaban la base y el absorbedor de MP como 🔴). Ref: `business-model.md`,
> `payments-and-commissions.md`.

### DEC-015 — Tipos de vendedor con comisión asociada — ✅ estructura / 🟡 categorías
El sistema **debe permitir** distintos **tipos/categorías de vendedor** con
**diferentes porcentajes de comisión**, configurables a futuro sin tocar código.
Ejemplos **conceptuales** (no definitivos): `SELLER_STANDARD`, `SELLER_VERIFIED`,
`SELLER_FEATURED`, `SELLER_STORE`. **No se fijan** categorías definitivas todavía.
No hay comisión promocional para vendedores nuevos. Impacto ERD potencial:
`seller_profiles` + tabla de tipos/comisión (ver `open-decisions-impact.md`).

### DEC-016 — Costo de cuotas — ✅ principio / 🔵 MP
Si el vendedor **ofrece cuotas**, el **costo de las cuotas lo absorbe el vendedor**.
Si **no** ofrece cuotas, el costo correspondiente lo absorbe el **comprador** según
la modalidad. La **mecánica exacta en Mercado Pago** queda 🔵 (a investigar). Ref:
`payments-and-commissions.md`.

### DEC-017 — Costo de descuentos — ✅
Descuento ofrecido por el **vendedor**: el costo lo **absorbe el vendedor**.
Beneficios/descuentos **propios de Offside**: el costo lo **absorbe Offside** según
la campaña. (La comisión se calcula sobre el precio final cobrado — DEC-014.)

### DEC-018 — Comisión sobre refund parcial — ⚙️ (✅ default)
Ante un **refund parcial**, el costo de la **comisión asociada al importe
reembolsado lo absorbe Offside**. Esta política debe quedar **CONFIGURABLE desde
Admin** (⚙️). Ref: `orders-and-refunds.md`, `configuration-registry.md`.

### DEC-019 — Liberación de fondos del vendedor — ✅ principio / 🔵 MP (crítico)
El dinero del vendedor **no se considera definitivamente liberado** hasta que el
comprador **confirme conformidad** o se cumpla la **condición automática de
liberación** (a definir). **Investigación técnica crítica** 🔵🌐: verificar cómo se
implementa esto realmente con Mercado Pago Split Payments (fondos, reservas,
liberación). **No se asume** que MP permite este flujo sin verificar la doc. oficial.
Ref: `orders-and-refunds.md`, `payments-and-commissions.md`,
`open-decisions-impact.md`.

### DEC-020 — Niveles de usuario — ✅ estructura / 🟡 umbrales
Progresión propuesta: **NUEVO → CONFIABLE → DESTACADO → COLECCIONISTA → TIENDA**.
Umbrales preliminares: CONFIABLE (+5 compras y ventas), DESTACADO (+10),
COLECCIONISTA (+20), TIENDA (categoría especial otorgada por Offside). La
**definición exacta de "compras y ventas"** queda 🟡. **No** modificar la fórmula de
reputación automáticamente. Ref: `trust-and-safety.md`.

### DEC-021 — Estados de riesgo — ✅ estructura / 🟡 umbrales
Estados: **NORMAL → RIESGO → RESTRINGIDO → SUSPENDIDO** (Fase 1 agrega **NORMAL**
como estado base). Definiciones preliminares: NORMAL (sin problemas), RIESGO
(operaciones problemáticas, opera con advertencias), RESTRINGIDO (responsable de
una infracción), SUSPENDIDO (más de una infracción/problema o situación grave).
El riesgo es **independiente del nivel de usuario**: un usuario puede ser
`COLECCIONISTA + RIESGO` a la vez. Umbrales exactos 🟡.
> **Contradicción señalada:** reemplaza los niveles previos
> `BAJO/MEDIO/ALTO/CRÍTICO` del ERD/`trust-and-safety.md`. **Se prioriza el nuevo
> esquema.** Impacto en enum `risk_level`/`seller_profiles` — ver
> `open-decisions-impact.md`.

### DEC-022 — Historial ≠ nivel de usuario ≠ riesgo — ✅
Son **tres conceptos distintos** y **no deben mezclarse** (Fase 1 los renombra):
(1) **HISTORIAL** — registro de compras, ventas, cancelaciones, reclamos,
devoluciones, disputas e infracciones; (2) **NIVEL DE USUARIO** (DEC-020,
progresión/trayectoria); (3) **NIVEL DE RIESGO** (DEC-021, advertencias/
infracciones/problemas). El "score de reputación" (si se mantiene) se **deriva del
historial** y no es autoridad — cerrado en **DEC-036 (I-4)**. Ref:
`trust-and-safety.md`.

### DEC-023 — Roles de administración — ✅ set / 🟡 permisos
Roles: **SUPER_ADMIN, ADMIN, MODERATOR, SUPPORT, FINANCE**. Los **permisos
granulares por rol** quedan 🟡. Ref: `04-technical/architecture.md`.

### DEC-024 — Alcance del MVP y fuera de alcance — ✅
Se fija explícitamente qué queda **fuera del MVP** (app móvil, IA, chat avanzado,
motor de búsqueda externo, multi-vendedor complejo, suscripciones, publicidad,
autenticación física avanzada, i18n, multi-moneda, gamificación) y qué es
**escalabilidad futura**. Ref: `01-business/mvp-scope.md`.

### DEC-025 — Estados de producto y categorías de autenticidad — 🟡
Conjuntos **propuestos** (no cerrados en su descripción):
- **Estado del producto:** NUEVO, COMO NUEVO, EXCELENTE, MUY BUENO, BUENO,
  ACEPTABLE. (Descripción exacta de cada uno: 🟡.)
- **Autenticidad:** No especificada, Original declarada, Réplica oficial,
  Verificada, Sospechosa, Falsificación. (Evidencia por categoría: 🟡.)
> **Contradicción señalada:** difiere de los enums `item_condition` y `authenticity`
> del ERD. **No se modifica el ERD todavía** (descripciones pendientes); impacto
> documentado en `open-decisions-impact.md`.

### DEC-026 — 1 orden = 1 vendedor — ✅
Se reafirma: en el MVP **una orden corresponde a un solo vendedor**; un **carrito
multi-vendedor** se **divide en múltiples órdenes** al hacer checkout. Ref:
`marketplace-flow.md`.

## 2.b Decisiones de cierre de Fase 1 (2026-08-19)

### DEC-027 — Checkout Pro inicial — ✅
El método de checkout inicial es **Mercado Pago Checkout Pro** (sobre Split
Payments 1:1, DEC-004). Cierra la pregunta previa "Pro vs API" (OQ-B8). Los
vendedores **conectan/autorizan** su cuenta MP por **OAuth**; los tokens se guardan
**cifrados**. Ref: `payments-and-commissions.md`.

### DEC-028 — Estados iniciales de Payment — ✅
Conjunto definitivo inicial: **`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`,
`REFUNDED`, `PARTIALLY_REFUNDED`, `CHARGED_BACK`**. **Mercado Pago es la fuente de
verdad** del estado del pago; los **webhooks son obligatorios** y se procesan de
forma **idempotente**; **nunca** se determina un pago sólo por información del
frontend. Una **Order pasa a `PAID` sólo cuando el backend recibió y validó** la
información de MP. (La mecánica fina de MP sigue 🔵; ver `open-decisions-impact.md`.)
> **Enmienda (DEC-035, I-3):** se **agrega `IN_PROCESS`**. Set definitivo:
> **`PENDING`, `IN_PROCESS`, `APPROVED`, `REJECTED`, `CANCELLED`, `REFUNDED`,
> `PARTIALLY_REFUNDED`, `CHARGED_BACK`**. Se conserva además el **estado original de
> MP** para auditoría y un **mapeo explícito** MP↔Offside.

### DEC-029 — Estados técnicos iniciales de Order — ✅
Conjunto definitivo inicial: **`PENDING_PAYMENT`, `PAID`, `PROCESSING`, `SHIPPED`,
`DELIVERED`, `COMPLETED`, `CANCELLED`**. Las **reglas de transición** se diseñan
para poder **configurarse a futuro** desde Admin (plazos de pago/cancelación/
despacho/confirmación, acciones automáticas, notificaciones), pero **no** se
construye ahora un motor complejo (DEC-032).
> **Contradicción señalada:** difiere del enum `order_status` del ERD (que tenía
> `created/payment_failed/awaiting_shipment/in_dispute/resolved/refunded/
> partially_refunded/…`). **Se prioriza el nuevo set.** Cómo se reflejan a nivel de
> orden un pago fallido, una disputa o un refund quedó **resuelto** en DEC-033 (I-1)
> y DEC-034 (I-2): la Order **no** encoda pago/refund/disputa. ERD **no** modificado.

### DEC-030 — Snapshot financiero por transacción — ✅
Cada transacción **conserva un snapshot financiero**. Campos mínimos a poder
representar: `order_total`, `commission_rate`, `commission_amount`, `mp_fee`,
`seller_amount`, `offside_amount`, `discount_amount`, `shipping_amount`.
Reglas: la **tasa de Mercado Pago NO se hardcodea**; el modelo permite que el costo
real de MP **cambie sin afectar operaciones históricas**; la **comisión histórica
nunca se recalcula** con configuración futura; la comisión se calcula sobre el
**precio final después de descuentos** (DEC-014/017). El **tratamiento fiscal**
definitivo queda **🔴 PENDIENTE** (DEC-011). Ref: `business-model.md`,
`payments-and-commissions.md`.

### DEC-031 — Estados iniciales de Refund — ✅ estructura / 🟡 resto
Flujo inicial: **`REQUESTED → UNDER_REVIEW → APPROVED → PROCESSING → COMPLETED`**,
con rama **`REQUESTED → REJECTED`**. Disputa (DEC-009): `OPEN → WAITING_SELLER →
UNDER_REVIEW → RESOLVED`. **Explícitamente PENDIENTE (no resolver ahora):** política
completa de devoluciones, motivos de refund, evidencia requerida, plazos,
responsabilidad económica, costos de devolución, `seller_liabilities`, chargebacks,
penalizaciones, reincidencia y reglas avanzadas de resolución. Ref:
`orders-and-refunds.md`.

### DEC-032 — Principio "Simple por defecto, configurable cuando sea necesario" — ✅
Filosofía de construcción: **no hardcodear** reglas de negocio que van a cambiar,
pero **tampoco** construir un sistema genérico de configuración excesivamente
complejo para el MVP. Las reglas iniciales deben ser **razonables y simples**, con
una arquitectura que permita modificarlas después. Aplica a publicaciones, órdenes,
comisiones, refunds y reputación. Ref: `configuration-registry.md`,
`04-technical/architecture.md`.

## 2.c Resolución de inconsistencias de Fase 1 (2026-08-19)

### DEC-033 — Pago rechazado no cancela la Order (cierra I-1) — ✅
Un `Payment REJECTED` **no** cancela automáticamente la Order. Si la Order está en
`PENDING_PAYMENT` y un intento de pago resulta `REJECTED`, la Order **permanece en
`PENDING_PAYMENT`**. El comprador **puede reintentar** el pago mientras la Order
siga dentro de su **ventana de pago**. La Order pasa a `CANCELLED` **sólo** cuando:
(a) vence la ventana de pago, (b) el comprador cancela, (c) un administrador la
cancela, o (d) una regla de negocio posterior determina su cancelación. La
**ventana de pago** es un parámetro **⚙️ configurable** (valor 🟡). Ref:
`marketplace-flow.md`, `payments-and-commissions.md`.

### DEC-034 — Ciclos de vida separados (cierra I-2) — ✅
**No** se agregan estados de refund ni de disputa al enum principal de `Order`.
Cada entidad tiene su propio ciclo de vida y **no se mezclan**:
- **Order** (ciclo de la orden): `PENDING_PAYMENT, PAID, PROCESSING, SHIPPED,
  DELIVERED, COMPLETED, CANCELLED`.
- **Payment** (ciclo financiero): `PENDING, IN_PROCESS, APPROVED, REJECTED,
  CANCELLED, REFUNDED, PARTIALLY_REFUNDED, CHARGED_BACK`.
- **Refund** y **Dispute**: entidades propias con sus estados (DEC-031, DEC-009).
Una Order puede estar `COMPLETED` mientras su Payment está `PARTIALLY_REFUNDED` y
existe una Dispute relacionada. La relación entre entidades es por **referencia**,
no por estado compartido. Ref: `marketplace-flow.md`, `orders-and-refunds.md`.

### DEC-035 — `IN_PROCESS` + mapeo de estados MP↔Offside (cierra I-3) — ✅
Se **agrega `IN_PROCESS`** como estado de Payment. El sistema **distingue**:
(a) el **estado normalizado de Offside** (el enum de DEC-028 enmendado) y (b) el
**estado original provisto por Mercado Pago**, que se **conserva** (auditoría/
investigación, p. ej. `payments.mp_status`/`raw`). Debe existir un **mecanismo
explícito de mapeo** MP→Offside en el backend. Ref: `payments-and-commissions.md`.

### DEC-036 — Historial como fuente de verdad de confianza (cierra I-4) — ✅
Se **elimina el score de reputación como fuente principal de verdad** del modelo de
confianza. Los tres conceptos (DEC-022) son: **1) HISTORIAL** (eventos reales:
compras, ventas, cancelaciones, reclamos, devoluciones, disputas, infracciones —
fuente de verdad), **2) NIVEL DE USUARIO** (trayectoria/confianza: NUEVO,
CONFIABLE, DESTACADO, COLECCIONISTA, TIENDA), **3) NIVEL DE RIESGO** (NORMAL,
RIESGO, RESTRINGIDO, SUSPENDIDO). Un usuario puede tener simultáneamente un nivel
alto y un nivel de riesgo. **No** se usa un score numérico como autoridad principal
de confianza. Si más adelante se necesita un score para **ranking interno/análisis**,
será **derivado del historial** y **nunca reemplaza** al historial. Ref:
`trust-and-safety.md`.

### DEC-037 — `SELLER_TIER` separado de USER LEVEL (cierra I-5) — ✅ estructura / 🟡 valores
Se separan definitivamente:
- **USER LEVEL** (NUEVO, CONFIABLE, DESTACADO, COLECCIONISTA, TIENDA): representa
  **trayectoria/confianza** del usuario.
- **SELLER_TIER**: representa la **categoría comercial/operativa** del vendedor y
  podrá determinar **comisión, límites, beneficios, condiciones comerciales y reglas
  especiales**.
Se usa el nombre **`SELLER_TIER`** para evitar confusión con USER LEVEL. Estructura
inicial **simple y configurable**; **no** se asumen valores definitivos de
SELLER_TIER (🟡). Reemplaza el naming de DEC-015. Ref: `seller-system.md`,
`payments-and-commissions.md`, `configuration-registry.md`.

### DEC-038 — Configuration Store administrativo — ✅ concepto / ✅ modelo (DEC-039) / 🟦 valores
Existirá un **sistema de configuración administrativa** que permita modificar
parámetros de negocio **sin cambiar código** (ej.: comisión default, comisión por
`SELLER_TIER`, ventana de cancelación, ventana de refund, máximo de imágenes,
límites de vendedores/publicaciones, etc.). **No** es un sistema genérico
excesivamente complejo: para el MVP es **simple y controlado** (DEC-032). **Toda
configuración que afecte una transacción económica se conserva como snapshot dentro
de la transacción** (p. ej. `commission_rate_at_transaction`, `commission_amount`);
**nunca** se recalculan operaciones históricas con la configuración actual (refuerza
DEC-030).

> **Actualizado 2026-08-20.** El texto original cerraba con "el **modelo de datos**
> del store queda 🟡 (a diseñar; no se toca el ERD ahora)". Eso fue **superado por
> DEC-039** (§2.d), que adopta la **Alternativa C** y cierra el ERD v1.0 con
> `app_settings` (§17.1) + `seller_tiers` (§7.1). Sólo siguen 🟦 los **valores**
> concretos y el **orden fino de precedencia**. No es una decisión nueva.

Ref: `database-design.md` §17.1 y §7.1, `configuration-registry.md`,
`open-decisions-impact.md` (E1), DEC-039.

## 2.d Cierre del ERD (Fase 2, 2026-08-19)

### DEC-039 — ERD v1.0 cerrado + decisiones de modelado — ✅
Tras la auditoría (`erd-audit-fase2.md`) se aprueban **6 decisiones de modelado** y
se cierra `database-design.md` como **v1.0**:
1. **Historial (Alternativa B):** `user_history_events` append-only como **fuente de
   verdad** (DEC-036); `seller_reputations` pasa a **cache derivado**.
2. **Config Store (Alternativa C):** `seller_tiers` (tabla de dominio) +
   `app_settings` (key-value acotado) + **snapshots** económicos en la transacción.
3. **`user_level` y `risk_level` viven en `users`** (aplican al usuario, no sólo al
   vendedor); `seller_tier` vive en `seller_profiles` y es independiente.
4. **`seller_liability_status`:** `OPEN | PARTIALLY_SETTLED | SETTLED | WRITTEN_OFF`
   (+`settled_amount`); reglas de recuperación siguen PENDING (DEC-019).
5. **`admin_role` enum:** `SUPER_ADMIN | ADMIN | MODERATOR | SUPPORT | FINANCE`
   (reemplaza `is_admin`); permisos granulares no en el MVP.
6. **`listings`:** +`sku`, +`moderation_status` (`PENDING/APPROVED/REJECTED/
   SUSPENDED`, **independiente** de `listing.status`).
Además se aplicaron todos los enums de Fase 1 y los renombres del snapshot
financiero. Semántica/valores PENDING quedan marcados 🟦 en el ERD (§22) y **no** se
inventaron. Ref: `04-technical/database-design.md`, `erd-audit-fase2.md`.

### DEC-040 — Riesgo: hechos vs señales — ✅ **CLOSED**
Se **separan hechos de interpretaciones de riesgo** (ambas tablas se conservan; el
historial es la fuente de verdad y nunca se modifica):
- **`user_history_events` = hechos** ("¿qué pasó?"): USER_REGISTERED,
  PURCHASE_COMPLETED, SALE_COMPLETED, ORDER_CANCELLED, DISPUTE_OPENED,
  DISPUTE_RESOLVED, REFUND_CREATED, REFUND_COMPLETED, REVIEW_RECEIVED,
  POLICY_VIOLATION_CONFIRMED, ACCOUNT_SUSPENDED. **No** contiene HIGH_RISK/FRAUD.
- **`risk_events` = señales de riesgo** ("¿qué detectamos?"): HIGH_CANCELLATION_RATE,
  EXCESSIVE_DISPUTES, CONFIRMED_COUNTERFEIT, UNUSUAL_ACTIVITY, MULTIPLE_ACCOUNTS,
  CHARGEBACK_PATTERN. Campos: `user_id, risk_type, severity, source, reference_type,
  reference_id, source_history_event_id (nullable), metadata, created_at,
  resolved_at`.
- **`users.risk_level` = estado actual** derivado por el Risk Engine.
`source_history_event_id` es **nullable**: una señal puede originarse en un hecho,
en muchos/un patrón, en **reglas configuradas** o en **eventos externos**. Ventaja:
cambiar la lógica de riesgo **no** modifica el historial (los hechos persisten).
`seller_reputations` sigue siendo **dato derivado/cache** (no fuente de verdad).
**MVP:** las señales iniciales se generan con **reglas simples y configurables**;
**no** se implementa un Risk Engine complejo todavía. El Risk Engine completo y sus
umbrales quedan 🟦 PENDING (DEC-020/021). Aplicado al ERD v1.0 (§6.3/§16.1). Ref:
`database-design.md`, `trust-and-safety.md`, `open-decisions-impact.md`.

## 2.e Cierre de gaps pre-migración (2026-08-21, ERD v1.1)

### DEC-041 — Estructura de `catalog_change_requests` — ✅ estructura / 🟡 permisos
`catalog_change_requests` era la **única tabla del ERD v1.0 sin definición de
columnas**: sólo estaba descrita como "alta propuesta→aprobada por admin". Se
define su estructura (ERD §8.1):

- **Enum propio `catalog_request_status`:** `PENDING | APPROVED | REJECTED`.
  **No** se reutiliza `moderation_status`: moderar una publicación y gobernar el
  catálogo son conceptos distintos, y `SUSPENDED` no aplica a una solicitud.
- **Enum propio `catalog_target_type`:** `club | national_team | brand |
  competition | country | season | size_chart` — exactamente los catálogos
  controlados que lista `product-specification.md` §4.3. **No** incluye
  `categories` (conjunto fijo vía `garment_category`).
- **`requested_by` → `users`**, no a `seller_profiles`: la tabla **no se acopla
  al rol**. Quién puede crear y quién puede aprobar se resuelve en la **capa de
  permisos** (roles de DEC-023), no en el modelo de datos. **No se inventaron
  permisos nuevos.**
- `payload jsonb` conserva la propuesta original como **snapshot inmutable**;
  `reviewed_by`/`reviewed_at`/`review_note` conservan la resolución;
  `created_entity_id` guarda la entidad creada al aprobar (referencia
  polimórfica, sin FK).
- **Regla dura:** la solicitud **no** modifica el catálogo; sólo la aprobación
  crea la entidad.

Sigue 🟡: **quién aprueba**, que depende de los permisos granulares de DEC-023.
Cierra parcialmente **OQ-F2**. Ref: `database-design.md` §8.1,
`product-specification.md` §4.3.

### DEC-042 — Técnica de búsqueda full-text — ✅
Cierra lo que `product-specification.md` §5.3 dejaba 🔵 ("técnica fina a validar"):

- Configuración de text search: **`spanish`**; **`unaccent`** habilitado.
- **`pg_trgm`** habilitado + índices GIN trigram en `listings.title`,
  `player_name` y `model` (ERD §9.1) para la tolerancia a typos de **PS-020.b**.
- `listings.search_vector` se mantiene y lo **puebla el Service de Listings**,
  **no** una columna generada ni un trigger. Motivo: una columna generada no
  puede leer los `aliases` de las tablas de catálogo (PS-024), y un trigger
  metería los pesos del ranking —⚙️ configurables por **PS-021**— dentro de
  PL/pgSQL.
- Cuando cambian aliases/datos relevantes de catálogo, se encola un **job de
  BullMQ** que reindexa los listings afectados.
- Los **pesos de ranking permanecen configurables** desde la aplicación
  (`app_settings`), nunca hardcodeados.

Ref: `database-design.md` §19.2, `product-specification.md` §5.

## 3. Cómo evoluciona este archivo

Cuando una decisión cambie de estado, se actualiza su fila y su detalle, con fecha.
Reglas: **no** mover a ✅ nada que dependa de verificar comportamiento de MP/Correo
sin verificarlo contra la doc. oficial (esos ítems son 🔵); **no** convertir en ✅
las decisiones fiscales/legales sin asesoramiento profesional (🔴); **no** fijar en
código lo que se decidió como ⚙️ configurable.
