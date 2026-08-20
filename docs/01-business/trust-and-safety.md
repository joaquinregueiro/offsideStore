# Trust & Safety — OFFSIDE STORE

## 1. Propósito

Definir el **sistema de confianza** del marketplace: cómo se verifica la
identidad, cómo se aprueba y reputa a un vendedor, cómo se autentica un producto,
cómo se miden y gestionan los **niveles de riesgo**, y cómo se procesan las
**disputas** y **sanciones**. En un marketplace de coleccionismo, la
**falsificación** y el **fraude** son el riesgo central; este documento es, por
lo tanto, uno de los pilares del producto.

## 2. Alcance

Incluye: los cuatro ejes de confianza, el registro de comportamiento del
vendedor, los niveles de riesgo y sus acciones, el sistema de disputas
(estados/resoluciones/evidencias) y las sanciones. La mecánica financiera de los
refunds resultantes está en `03-operations/orders-and-refunds.md`.

## 3. Conceptos principales

### 3.1 Los cuatro ejes de confianza (independientes)

Es fundamental **no confundirlos**. Son dimensiones separadas:

| # | Eje | Pregunta que responde | Se obtiene por |
|---|-----|-----------------------|----------------|
| 1 | **Identidad verificada** | ¿Sabemos quién es esta persona? | Verificación de identidad (documento/datos). |
| 2 | **Vendedor aprobado** | ¿Está habilitado para vender? | Cumplir requisitos de onboarding (identidad + MP conectado + aceptación de términos + criterios de riesgo). |
| 3 | **Reputación del vendedor** | ¿Se comporta bien a lo largo del tiempo? | Historial de ventas, calificaciones, reclamos, cumplimiento. |
| 4 | **Producto autenticado/verificado** | ¿Este artículo puntual es auténtico? | Política de autenticidad (DEC-010, pendiente). |

> ✅ **REGLA (repetida por su importancia):** conectar Mercado Pago **no**
> otorga ninguno de estos ejes automáticamente. Un vendedor con MP conectado
> puede seguir teniendo identidad sin verificar, no estar aprobado, tener mala
> reputación y vender productos no autenticados.

### 3.2 Diferencia clave: vendedor confiable ≠ producto auténtico

Un vendedor de alta reputación **puede** publicar (por error o dolo) un producto
falso, y un vendedor nuevo puede vender un producto genuino. Por eso el eje 4
(producto) es **por publicación/artículo**, no por vendedor.

### 3.3 TRES conceptos distintos que NO deben mezclarse — ✅ (DEC-022) — actualizado Fase 1

> El owner definió (y Fase 1 confirmó/renombró) que **historial**, **nivel de
> usuario** y **nivel de riesgo** son **conceptos separados**. El sistema **no
> debe** derivar uno del otro de forma implícita.

| Concepto | Qué es | Sección | Decisión |
|----------|--------|---------|----------|
| **A. HISTORIAL** | Registro de compras, ventas, cancelaciones, reclamos, devoluciones, disputas e infracciones. | §4.3 | DEC-022 |
| **B. NIVEL DE USUARIO** | Trayectoria/confianza (progresión de estatus). | §4.6 | DEC-020 |
| **C. NIVEL DE RIESGO** | Advertencias, infracciones o problemas (moderación). | §4.5 | DEC-021 |

Un usuario puede tener **simultáneamente** un nivel alto y una clasificación de
riesgo — p. ej. **`COLECCIONISTA + RIESGO`**: el nivel representa trayectoria, el
riesgo representa problemas.

Además, el **`SELLER_TIER`** (categoría comercial del vendedor, DEC-037:
comisión/límites/beneficios) es un concepto adicional, también independiente de
los tres de arriba (`seller-system.md`).

> **Score de reputación — ✅ RESUELTO (DEC-036, cierre I-4).** El **HISTORIAL es la
> fuente de verdad** del modelo de confianza. **No** se usa un **score numérico
> como autoridad principal**. Si más adelante se necesita un score para **ranking
> interno o análisis**, será **derivado del historial** y **nunca lo reemplaza**.
> En consecuencia, `seller_reputations.score` (ERD) deja de ser autoridad: si se
> conserva, es un **valor derivado/recalculable**, no la fuente de verdad.

## 4. Reglas

### 4.1 Eje 1 — Identidad verificada — ACTUALIZADO 2026-08-19

**Señales de identidad relevantes** (mecanismos que suman, no equivalen entre sí):

- **Email verificado.**
- **Teléfono verificado.**
- **Mercado Pago conectado.**
- **KYC realizado por Mercado Pago** cuando corresponda 🌐.

- **TS-001 (🟡):** **qué significa exactamente "identidad verificada" dentro de
  Offside** queda **por definir** (qué combinación de señales se exige). No se
  fija todavía.
- 🌐 **DEPENDENCIA EXTERNA:** Mercado Pago realiza su propio **KYC**. **No afirmar**
  que **conectar Mercado Pago equivale automáticamente a una verificación completa
  de identidad de Offside.** A investigar qué datos expone MP.
- **TS-002:** una noción de identidad (a definir) es **prerrequisito** para
  "vendedor aprobado" (eje 2).

### 4.2 Eje 2 — Vendedor aprobado

- **TS-010:** un vendedor pasa a "aprobado" cuando cumple: identidad (según la
  definición pendiente TS-001) + Mercado Pago conectado por OAuth + términos
  aceptados + no estar en estado de riesgo que lo impida (§4.5).
- **TS-011:** la aprobación puede ser **revocada** si el vendedor entra en estado
  de riesgo (§4.5).
- **TS-012:** un vendedor no aprobado puede navegar y comprar, pero no publicar
  ni vender.

> 🟡 **PENDIENTE (lista del owner, 2026-08-19):** falta definir **cómo se convierte
> un usuario en vendedor**, si la **aprobación es automática o manual**, las
> **restricciones y límites iniciales** para vendedores nuevos, **cuándo se
> considera confiable**, y la **diferencia entre vendedor particular y
> profesional**. No se fija todavía.

### 4.3 Concepto A — HISTORIAL del vendedor (DEC-022)

El **HISTORIAL** es el registro de: **compras, ventas, cancelaciones, reclamos,
devoluciones, disputas e infracciones**. Es la base sobre la que se derivan nivel y
riesgo. El sistema **registra**, por vendedor, al menos:

| Señal | Descripción |
|-------|-------------|
| ventas | Cantidad y monto de ventas completadas. |
| cancelaciones | Ventas canceladas por el vendedor. |
| reclamos | Reclamos recibidos (por motivo). |
| devoluciones | Refunds/returns asociados. |
| tiempos de despacho | Cumplimiento del plazo de despacho. |
| calificaciones | Puntajes y comentarios de compradores. |
| comportamiento | Señales de conducta (respuestas a disputas, tono, evasión). |
| posibles falsificaciones | Marcas/flags de autenticidad dudosa. |
| sanciones | Historial de sanciones aplicadas. |

- **TS-020 (DEC-036):** el **HISTORIAL** (estas señales/eventos reales) es la
  **fuente de verdad**. **No** se usa un score numérico como autoridad de confianza.
- **TS-020.b (DEC-040):** se separan **hechos** de **interpretaciones de riesgo**.
  Los hechos viven en `user_history_events` (inmutables; no incluyen "riesgo/
  fraude"); las **señales de riesgo** viven en `risk_events` (derivadas, con
  `source_history_event_id` nullable) y alimentan `risk_level`. Cambiar la lógica de
  riesgo **no** altera el historial. Detalle en `04-technical/database-design.md`
  §6.3/§16.1.
- **TS-021:** al comprador se le muestran **nivel**, **estado de riesgo** y
  **métricas del historial** de forma comprensible; un eventual **score** es sólo
  **derivado** (ranking/análisis), nunca la autoridad (DEC-036). Diseño 🟡.
- **TS-022:** eventos negativos graves (falsificación confirmada) pesan
  desproporcionadamente en el historial.

### 4.4 Eje 4 — Producto autenticado/verificado

- **TS-030 (DEC-025):** conjunto de categorías de autenticidad **ampliado**: *No
  especificada, Original declarada, Réplica oficial, Verificada, Sospechosa,
  Falsificación*. Declarar autenticidad en falso es la falta más grave (BR-050).
  (Difiere del enum previo `authenticity` del ERD — ver contradicción en
  `product-specification.md` y `open-decisions-impact.md`.)
- **TS-031 (🟡 DEC-010):** falta definir **qué evidencia requiere cada categoría**
  (p. ej. qué se necesita para "Verificada"). En el MVP no hay verificación física
  (el marketplace no recibe la prenda). Debe comunicarse con transparencia.
- **TS-032:** mientras no se defina, las categorías "declaradas" son **declaradas
  por el vendedor, no verificadas por OFFSIDE**, y así debe comunicarse.

### 4.5 Estados de riesgo del vendedor — REDEFINIDO 2026-08-19 (DEC-021)

> **Contradicción señalada y priorización.** El esquema previo de niveles
> `BAJO / MEDIO / ALTO / CRÍTICO` **queda reemplazado** por el nuevo esquema de
> **estados de riesgo** definido por el owner. **Se prioriza el nuevo.** Impacto en
> el enum `risk_level` del ERD documentado en `open-decisions-impact.md` (el ERD
> **no** se modifica todavía).

Estados de **nivel de riesgo** (independiente del historial y del nivel de usuario,
DEC-022; Fase 1 agrega **`NORMAL`** como estado base):

| Estado | Definición preliminar |
|--------|-----------------------|
| **NORMAL** | Sin problemas; estado base por defecto. |
| **RIESGO** | Usuario con operaciones problemáticas; debe **operar con advertencias**. |
| **RESTRINGIDO** | Usuario considerado **responsable de una infracción**. |
| **SUSPENDIDO** | Usuario con **más de una infracción/problema**, o que incurre en una situación suficientemente grave. |

- **TS-040 (revisión automática):** el sistema evalúa señales y puede cambiar el
  estado de riesgo; los **umbrales exactos y reglas** quedan 🟡 **PENDIENTES**.
- **TS-041 (revisión manual):** los estados de riesgo disparan **revisión manual**
  por Admin según corresponda.
- **TS-042 (limitaciones):** se pueden aplicar limitaciones graduales (throttling
  de publicaciones, exigir verificación adicional, advertencias).
- **TS-043 (suspensión):** `SUSPENDIDO` frena la capacidad de vender; las órdenes en
  curso siguen con seguimiento reforzado.
- **TS-045:** todo cambio de estado de riesgo y toda sanción quedan **auditados**
  (motivo, evidencia, responsable si fue manual).

### 4.6 Niveles de usuario — NUEVO 2026-08-19 (DEC-020)

**Concepto distinto** del estado de riesgo y de la reputación (DEC-022). Es una
**progresión de estatus** por actividad:

```
NUEVO → CONFIABLE → DESTACADO → COLECCIONISTA → TIENDA
```

| Nivel | Umbral preliminar |
|-------|-------------------|
| **NUEVO** | Estado inicial. |
| **CONFIABLE** | +5 compras y ventas. |
| **DESTACADO** | +10 compras y ventas. |
| **COLECCIONISTA** | +20 compras y ventas. |
| **TIENDA** | Categoría **especial** otorgada/contactada directamente por Offside. |

- **TS-046 (🟡):** la **definición exacta de "compras y ventas"** (¿sólo ventas?,
  ¿ambas?, ¿completadas?) queda **pendiente**. **No** modificar la fórmula
  automáticamente hasta cerrarla.
- **TS-047:** el nivel de usuario **no** implica por sí solo confianza ni ausencia
  de riesgo; se muestra como estatus, no como garantía.

## 5. Sistema de disputas

> **Actualización 2026-08-19.** Se mantiene el **flujo conceptual** pero **no** se
> cierran todavía las reglas finales (motivos, plazos, evidencias, facultades,
> resoluciones). Todo lo no marcado ✅ queda 🟡.

### 5.1 Quién y cuándo

- **TS-050:** el **comprador** puede abrir un reclamo dentro de la ventana de
  protección (🟡 plazo por definir).
- **TS-051:** un reclamo se asocia siempre a una **orden** concreta.

### 5.2 Motivos del reclamo — 🟡 (a confirmar)

Preliminares: `producto no recibido`, `producto diferente al publicado`, `producto
falsificado`, `estado diferente al declarado`, `talle diferente`, `producto
dañado`, `descripción incorrecta`, `otro`. El conjunto final queda 🟡.

### 5.3 Datos que almacena una disputa

Una disputa **debe** almacenar: comprador, vendedor, orden, motivo, **evidencias**
(fotos, videos, mensajes, tracking, comprobantes), estado, resolución, importe
reembolsado, fechas y decisiones administrativas.

### 5.4 Estados de la disputa — flujo conceptual (DEC-009)

```
OPEN ──▶ WAITING_SELLER ──▶ UNDER_REVIEW ──▶ RESOLVED
```

| Estado | Significado |
|--------|-------------|
| `OPEN` | El comprador abrió el reclamo y cargó evidencia. |
| `WAITING_SELLER` | Se espera respuesta/evidencia del vendedor. |
| `UNDER_REVIEW` | Admin/Operaciones revisa el caso. |
| `RESOLVED` | Caso cerrado con una resolución. |

> **Contradicción señalada:** el 2º estado se renombra de `SELLER_RESPONSE`
> (ERD/versión previa) a **`WAITING_SELLER`** (nueva decisión). **Se prioriza el
> nuevo nombre.** Impacto en el enum `dispute_status` — ver
> `open-decisions-impact.md` (el ERD **no** se modifica todavía).

- **TS-052 (🟡):** **tiempo de respuesta del vendedor**, **tiempo del comprador**,
  **quién analiza**, **cuándo interviene administración** y las **facultades del
  administrador** (refund total, refund parcial, devolución, rechazo,
  penalización, suspensión) quedan **pendientes**.
- **TS-053:** los cambios de estado quedan auditados con timestamp y actor.

### 5.5 Resoluciones posibles

| Resolución | Efecto |
|------------|--------|
| `NO_ACTION` | Reclamo desestimado; no hay reembolso. |
| `PARTIAL_REFUND` | Reembolso parcial al comprador (importe definido en la resolución). |
| `FULL_REFUND` | Reembolso total al comprador. |
| `RETURN_REQUIRED` | El comprador debe devolver el producto (condición previa a reembolso). |
| `SELLER_PENALTY` | Penalización al vendedor (reputación/riesgo/limitación), con o sin reembolso. |
| `SELLER_SUSPENDED` | Suspensión del vendedor derivada del caso. |

- **TS-054:** una resolución puede combinar efectos (p. ej. `FULL_REFUND` +
  `SELLER_PENALTY`). El modelo de datos debe permitir múltiples efectos por
  resolución.
- **TS-055 (🌐):** todo `PARTIAL_REFUND`/`FULL_REFUND` se ejecuta según la
  mecánica de refund proporcional de MP (ver `orders-and-refunds.md`), incluyendo
  el caso de vendedor sin fondos.
- **TS-056:** toda decisión administrativa relevante (resolución, penalización,
  suspensión) queda **auditada** (quién decidió, cuándo, con qué evidencia y
  fundamento).

### 5.6 Evidencia

- **TS-060:** ambas partes pueden cargar evidencia (fotos, tracking, chats,
  comprobantes). El sistema versiona y timestampa cada carga.
- **TS-061:** la evidencia es inmutable una vez cargada (no se puede borrar, sí
  agregar) para integridad del caso.

## 6. Casos de uso

- **UC-TS-1 (falsificación):** comprador abre reclamo `producto falsificado` con
  fotos. Vendedor responde negando. Admin revisa (`UNDER_REVIEW`), confirma
  falsificación → `FULL_REFUND` + `SELLER_PENALTY` + eventual `SELLER_SUSPENDED`;
  el vendedor sube a riesgo CRÍTICO; todo auditado; refund se procesa con la
  mecánica de MP (y activa el manejo de "vendedor sin fondos" si corresponde).
- **UC-TS-2 (no recibido):** reclamo `producto no recibido`. El tracking de
  Correo Argentino (`shipping.md`) es evidencia central. Si muestra entrega →
  posible `NO_ACTION`; si no hay despacho → `FULL_REFUND` + penalización por
  no-despacho.
- **UC-TS-3 (talle diferente):** puede resolverse `RETURN_REQUIRED` +
  `PARTIAL_REFUND` según política.
- **UC-TS-4 (escalada de riesgo):** un vendedor con operaciones problemáticas pasa
  a `RIESGO` (opera con advertencias); ante una infracción confirmada →
  `RESTRINGIDO`; ante reincidencia/gravedad → `SUSPENDIDO`. Umbrales 🟡.

## 7. Estados (resumen) — ACTUALIZADO 2026-08-19

Tres dimensiones **independientes** (DEC-022):

- **A. Historial**: registro de compras/ventas/cancelaciones/reclamos/devoluciones/
  disputas/infracciones.
- **B. Nivel de usuario** (DEC-020): `NUEVO → CONFIABLE → DESTACADO → COLECCIONISTA →
  TIENDA`.
- **C. Nivel de riesgo** (DEC-021): `NORMAL → RIESGO → RESTRINGIDO → SUSPENDIDO`.

Un usuario puede combinar B y C (p. ej. `COLECCIONISTA + RIESGO`).

Además:
- Vendedor (habilitación): `no_aprobado → aprobado → limitado → suspendido →
  expulsado`.
- Disputa: `OPEN → WAITING_SELLER → UNDER_REVIEW → RESOLVED`.

## 8. Dependencias

- 🌐 **Mercado Pago:** KYC, capacidad de retener/recuperar fondos, refunds
  proporcionales. **A verificar; no inventar.**
- 🌐 **Correo Argentino:** tracking como evidencia (`shipping.md`).
- Interna: `orders-and-refunds.md` (ejecución financiera de resoluciones),
  `seller-system.md` (onboarding y estados del vendedor), `business-rules.md`
  (BR-050/051/052).

## 9. Decisiones tomadas

- ✅ Cuatro ejes de confianza independientes.
- ✅ MP conectado ≠ confianza automática (ni identidad completa).
- ✅ **DEC-022:** reputación, nivel de usuario y estado de riesgo son conceptos
  distintos; no mezclarlos.
- ✅ **DEC-020 (estructura):** niveles de usuario `NUEVO→CONFIABLE→DESTACADO→
  COLECCIONISTA→TIENDA` (umbrales preliminares).
- ✅ **DEC-021 (estructura):** estados de riesgo `RIESGO→RESTRINGIDO→SUSPENDIDO`
  (reemplazan BAJO/MEDIO/ALTO/CRÍTICO).
- ✅ Flujo de disputa `OPEN→WAITING_SELLER→UNDER_REVIEW→RESOLVED`.
- ✅ Auditoría obligatoria de decisiones administrativas.

## 10. Decisiones pendientes

- 🟡 **DEC-020** — Definición exacta de "compras y ventas" y umbrales finales.
- 🟡 **DEC-021** — Umbrales/reglas exactas de los estados de riesgo.
- 🟡 **DEC-010** — Evidencia requerida por cada categoría de autenticidad.
- 🟡 **DEC-009** — Disputas: motivos finales, plazos (vendedor/comprador), quién
  analiza, facultades del admin, resoluciones.
- 🟡 Fórmula de reputación.
- 🟡 **TS-001** — Definición de "identidad verificada" en Offside (combinación de
  señales) y relación con el KYC de MP (🔵 investigar qué expone MP).
- 🟡 Cómo se convierte un usuario en vendedor; aprobación auto/manual; límites de
  vendedores nuevos; particular vs profesional.
- 🔵/🌐 Alcance real de las acciones sobre fondos del vendedor (depende de MP).

## 11. Riesgos

- **Fraude/falsificación:** riesgo central del nicho; ataca directamente la
  propuesta de valor.
- **Financiero:** resoluciones de refund contra vendedores sin fondos
  (`orders-and-refunds.md`).
- **Reputacional/legal:** prometer autenticidad sin poder verificarla; sanciones
  no auditadas o arbitrarias.
- **Operativo:** cola de revisión manual saturada si los umbrales están mal
  calibrados.
