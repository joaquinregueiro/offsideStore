# Payments & Commissions — OFFSIDE STORE

> ⚠️ **Advertencia central de este documento.**
> Toda la mecánica de Mercado Pago descrita aquí es una **especificación de
> requisitos y de integración**, no una afirmación sobre el comportamiento exacto
> de Mercado Pago. **No se inventan endpoints, nombres de campos, tiempos ni
> comportamientos de MP.** Cada punto que dependa de MP está marcado 🌐
> **DEPENDENCIA EXTERNA — a verificar contra la documentación oficial de Mercado
> Pago** antes de implementar. Donde el comportamiento no está confirmado, se
> marca 🔴 **DECISION REQUIRED / VERIFY**.

## 1. Propósito

Especificar la integración de pagos con **Mercado Pago Split Payments 1:1**: cómo
el vendedor conecta su cuenta (OAuth), cómo se procesa el pago del comprador, cómo
se divide el importe entre vendedor y OFFSIDE, cómo se aplica la comisión, cómo se
gestionan los estados de pago y webhooks, y cómo se manejan errores y seguridad de
credenciales. Los refunds y la conciliación tienen su propio documento
(`orders-and-refunds.md`), pero se referencian aquí.

## 2. Alcance

Incluye: OAuth de vendedores, tokens (access/refresh) y su renovación, KYC,
elección de checkout (Pro vs API), aplicación de comisión
(`marketplace_fee`/`application_fee`), estados de pago, webhooks, errores de
integración, y seguridad de credenciales. Refunds/chargebacks/conciliación se
tratan en detalle en `orders-and-refunds.md`.

## 3. Conceptos principales

### 3.1 Split Payments 1:1 (modelo elegido)

✅ **DECISIÓN (DEC-004):** la plataforma usa **Mercado Pago Split Payments 1:1**.

Idea de negocio (a validar técnicamente 🌐): en un pago, MP **divide
automáticamente** el importe entre **dos** destinatarios — el **vendedor** (dueño
de la cuenta MP conectada) y **OFFSIDE STORE** (que retiene su **comisión**). "1:1"
refiere al esquema de una relación marketplace↔vendedor por transacción.

🌐 **VERIFY:** el nombre comercial exacto, los requisitos de habilitación de la
cuenta marketplace, y el mecanismo preciso de división deben confirmarse en la
documentación oficial de MP. Este documento asume el modelo conceptual descrito
por el negocio.

### 3.2 Roles en el pago

| Rol | Quién | Cuenta MP |
|-----|-------|-----------|
| Pagador (payer) | Comprador | No requiere cuenta conectada; paga en el checkout. |
| Collector / vendedor | Vendedor | Su cuenta MP **conectada por OAuth**. |
| Marketplace / aplicación | OFFSIDE STORE | Aplicación MP registrada; retiene comisión. |

### 3.3 Comisión de OFFSIDE vs comisión de MP

- **Comisión de OFFSIDE:** ✅ **6% del total de la venta** (DEC-043, cierra
  DEC-007). Con **Checkout Pro** (DEC-027) se aplica vía **`marketplace_fee`** en
  la preferencia; `application_fee` es el campo equivalente de Checkout
  API/Transparente 🔴. Offside cobra ese 6% **íntegro**.
- **Comisión de Mercado Pago:** el costo de procesamiento que cobra MP. 🌐
  **DEPENDENCIA EXTERNA**: varía según medio de pago, cuotas y plazo de
  acreditación, y **no existe API que lo informe antes del pago** 🔴.
  ✅ **Quién la absorbe está decidido (DEC-043): NO la absorbe Offside.** Rige el
  **comportamiento nativo de Split 1:1** 🔴: MP descuenta primero su comisión —del
  importe del vendedor— y recién después el `marketplace_fee` sobre el remanente.
  El neto del vendedor es `total − costo MP − 6%`.

## 4. OAuth del vendedor y credenciales

### 4.1 Conexión (OAuth)

- **PC-001 (✅ DEC-005):** el vendedor autoriza a OFFSIDE mediante el flujo
  **OAuth** de Mercado Pago. Al completarse, OFFSIDE recibe credenciales para
  operar cobros con split sobre esa cuenta.
- **PC-002 (🌐 VERIFY):** scopes/permisos requeridos, URL de autorización,
  intercambio de `code` por tokens, y el tiempo de vida de los tokens **se toman
  de la documentación oficial de MP**. No se inventan aquí.

### 4.2 Access token y refresh token

- **PC-010:** OFFSIDE almacena, por vendedor: **access token** (para operar) y
  **refresh token** (para renovar), más metadatos (fecha de emisión, expiración,
  scopes, `user_id` de MP del vendedor).
- **PC-011 (renovación):** antes de que el access token expire, OFFSIDE lo
  **renueva** usando el refresh token (flujo 🌐 según MP). El sistema debe:
  - detectar expiración inminente,
  - renovar proactivamente,
  - reintentar con backoff ante fallos,
  - marcar la cuenta como "MP desconectado" si la renovación falla
    definitivamente (SS-013).
- **PC-012 (revocación):** si el vendedor revoca el acceso desde MP, OFFSIDE debe
  detectarlo (error al operar/renovar) y bloquear nuevas ventas de ese vendedor.
- **PC-013 (🌐 VERIFY):** la vida útil exacta de access/refresh tokens y si el
  refresh token rota en cada uso **se confirman con MP**.

### 4.3 KYC

- **PC-020 (🌐 DEPENDENCIA EXTERNA):** Mercado Pago realiza su propio **KYC** sobre
  la cuenta del vendedor. OFFSIDE **no** reimplementa el KYC de MP ni asume su
  resultado como "identidad verificada en OFFSIDE" (ver `trust-and-safety.md`
  TS-001). A verificar qué información de estado/verificación expone MP.
- **PC-021:** si MP no habilita a una cuenta para recibir split (por KYC
  incompleto u otra razón 🌐), el vendedor no puede vender; el sistema lo comunica.

### 4.4 Seguridad de credenciales

- **PC-030 (MUST):** access/refresh tokens y secretos de la aplicación se guardan
  **cifrados en reposo**, con acceso mínimo y auditado; **nunca** en el cliente,
  logs, ni repositorio.
- **PC-031 (MUST):** las credenciales de la aplicación (client secret, tokens de
  la app) se gestionan como **secretos** (gestor de secretos / variables seguras),
  con rotación.
- **PC-032 (MUST):** todo acceso a credenciales queda auditado. Ver `RISKS.md`
  (seguridad) y `architecture.md`.
- **PC-033 (MUST):** las comunicaciones con MP van sobre TLS; se validan las
  firmas de webhooks (sección 6).

## 5. Checkout — ✅ DECIDIDO: Checkout Pro (DEC-027)

✅ **DECIDIDO (DEC-027, cierre Fase 1):** el checkout inicial es **Mercado Pago
Checkout Pro**, sobre **Split Payments 1:1** (DEC-004). Cierra la pregunta previa
"Pro vs API". Checkout API queda como posible fase posterior si se necesita más
control (fuera del MVP).

Motivos: menor esfuerzo y **menor superficie PCI** (UX de pago hosteada por MP).

🌐/🔵 **VERIFY:** el nombre exacto del campo de comisión en Checkout Pro
(`application_fee`/`marketplace_fee` según lo que exponga MP) se confirma contra la
documentación oficial. El negocio ya definió que la comisión se aplica por el
mecanismo de fee del split; el mapeo fino es dependencia externa.

## 6. Estados de pago y webhooks

### 6.1 Estados de pago

✅ **DECIDIDO (DEC-028 + DEC-035, cierre Fase 1) — Estados iniciales de `Payment`:**

```
PENDING · IN_PROCESS · APPROVED · REJECTED · CANCELLED · REFUNDED · PARTIALLY_REFUNDED · CHARGED_BACK
```

| Estado de Payment | Efecto en la orden |
|-------------------|--------------------|
| `PENDING` | Orden `PENDING_PAYMENT`; se espera resolución vía webhook. |
| `IN_PROCESS` | Pago en proceso/en revisión de MP; la orden sigue en `PENDING_PAYMENT`. |
| `APPROVED` | Tras validación en backend, la orden pasa a `PAID`, se ejecuta el split y se descuenta stock. |
| `REJECTED` | La orden **no** avanza a `PAID` y **permanece `PENDING_PAYMENT`** (no se cancela, DEC-033); se ofrece reintento dentro de la ventana de pago. |
| `CANCELLED` | El intento de pago se canceló; la orden **no** avanza a `PAID`. |
| `REFUNDED` / `PARTIALLY_REFUNDED` | Reembolso total/parcial (ver `orders-and-refunds.md`). |
| `CHARGED_BACK` | Contracargo (ver `orders-and-refunds.md` §6). |

Reglas ✅ (DEC-028/DEC-035):

- **Mercado Pago es la fuente de verdad** del estado del pago.
- Una **Order pasa a `PAID` sólo cuando el backend recibió y validó** la
  información de MP (nunca por el frontend).
- **Estado normalizado vs estado original (DEC-035):** se distingue el **estado
  normalizado de Offside** (el enum de arriba) del **estado original de Mercado
  Pago**, que se **conserva** para auditoría/investigación (`payments.mp_status` /
  `raw`). Debe existir un **mecanismo explícito de mapeo** MP→Offside (ver §6.1.b).
- Un `Payment REJECTED` **no cancela la Order** (I-1/DEC-033): la Order sigue en
  `PENDING_PAYMENT` y admite reintento; ver `marketplace-flow.md`.

### 6.1.b Mapeo de estados MP ↔ Offside (DEC-035)

El backend mantiene una **tabla/función de mapeo explícita** entre los estados
crudos de MP y los estados normalizados de Offside. Principios:

- El estado normalizado se **deriva** del estado de MP; el crudo **se persiste**.
- 🌐/🔵 **VERIFY:** los nombres/estados crudos exactos de MP (incluido cómo expone
  "in_process"/"pending"/etc.) se confirman contra la doc. oficial. **No inventar**
  el mapeo fino hasta verificarlo; la **estructura** (normalizado + crudo + mapeo)
  ya está decidida.

> 🔵 **Sigue a investigar (mecánica fina de MP):** vida/refresh de tokens OAuth,
> desconexión/cambio/cuenta inválida o bloqueada, comportamiento si MP está caído,
> conciliación, y el detalle de chargebacks. El **enfoque** (webhooks obligatorios,
> idempotencia, reconsulta, MP = fuente de verdad) ya está **decidido** (DEC-028);
> lo que resta es el detalle técnico contra la doc. oficial.

### 6.2 Webhooks (fuente de verdad del pago)

- **PC-040 (MUST):** OFFSIDE se entera del resultado real del pago por **webhooks
  de MP**, **no** por el redirect del navegador (el usuario puede cerrar la
  pestaña). El redirect es sólo UX; el webhook es la verdad.
- **PC-041 (MUST):** el endpoint de webhook debe:
  - **validar la autenticidad** de la notificación (firma/secreto 🌐 según MP),
  - ser **idempotente** (MP puede reenviar la misma notificación),
  - responder rápido y procesar de forma asíncrona,
  - **reconsultar** el recurso a la API de MP para confirmar el estado (no confiar
    sólo en el payload). 🌐 VERIFY mecánica exacta.
- **PC-042:** cada webhook procesado se registra (auditoría) con su efecto en la
  orden/pago.
- **PC-043:** ante webhooks fuera de orden o duplicados, el sistema resuelve por
  el **estado consultado a MP**, no por el orden de llegada.

## 7. Comisiones — reglas

> **Actualizado 2026-08-19 (DEC-014 a DEC-018).** Se cierran base de cálculo,
> absorción de la comisión de MP, cuotas y descuentos.

- **PC-050 (✅ DEC-014 + DEC-043):** la comisión de OFFSIDE es una **tasa del 6%**
  (⚙️ configurable desde Admin, valor cerrado por DEC-043) aplicada sobre la
  **base = TOTAL cobrado al comprador** (precio final con descuentos). **Sin
  mínimo/máximo**, **sin diferenciación por categoría de producto**, **IVA
  incluido**.
- **PC-050.b (❌ REVOCADO el 2026-08-24 por DEC-043):** ~~la comisión de Mercado
  Pago la absorbe OFFSIDE (contemplada dentro de su comisión); no se traslada al
  vendedor ni al comprador.~~
  **Vigente:** el costo de Mercado Pago **es independiente** de la comisión de
  Offside. Offside cobra su 6% íntegro y **no** absorbe el costo de MP, que se
  descuenta según el comportamiento nativo de Split 1:1 (§3.3). Quedan
  explícitamente **fuera del MVP**: estimar el costo de MP, conciliarlo,
  restringir medios de pago/cuotas para volverlo predecible y compensar
  diferencias por cuenta corriente. Una **optimización comercial** con Mercado
  Pago es posible más adelante y no bloquea el MVP.
- **PC-050.c (✅ estructura, 🟡 valores — DEC-037):** la tasa puede **variar por
  `SELLER_TIER`** (categoría comercial del vendedor; valores 🟡, no asumidos). El
  motor de comisión resuelve la tasa aplicable **desde el Config Store** (Admin), no
  desde código (⚙️ DEC-013/DEC-038), y la **snapshotea** en la transacción
  (`commission_rate_at_transaction`, §7.b). `SELLER_TIER` ≠ USER LEVEL (I-5).
- **PC-050.d (✅/🔵 DEC-016 — cuotas):** si el vendedor **ofrece cuotas**, el costo
  financiero de las cuotas lo **absorbe el vendedor**; si **no** las ofrece, el
  costo lo **absorbe el comprador** según la modalidad. 🔵 **Investigar** cómo se
  implementa exactamente en Mercado Pago (quién define cuotas, cómo se refleja el
  costo) — **no inventar**.
- **PC-050.e (✅ DEC-017 — descuentos):** descuento del vendedor → costo del
  vendedor; descuento propio de Offside → costo de Offside. La comisión se calcula
  sobre el **precio final efectivamente cobrado**.
- **PC-051 (✅ DEC-043):** la comisión se materializa en el split en el momento
  del pago: con Checkout Pro, `marketplace_fee = commission_amount` (el 6% ya
  snapshoteado en la orden), **sin ajustes ni estimaciones**.
- **PC-052 (🌐/🔵):** la comisión de **MP** se registra en la orden según lo que MP
  informe (no se estima a mano en producción); su **valor** debe investigarse para
  calibrar el % de Offside.
- **PC-053:** ante refund parcial, la comisión asociada al importe reembolsado la
  **absorbe OFFSIDE** (⚙️ configurable, DEC-018); la reversa de comisión sigue la
  política de `orders-and-refunds.md`.
- **PC-054:** todos los importes (producto, envío, comisión OFFSIDE, comisión MP,
  neto vendedor, `SELLER_TIER` y tasa aplicada) se **persisten** en la orden como
  **snapshot** (§7.b) para conciliación y reporting.

> **Impacto ERD (no se modifica ahora, ver `open-decisions-impact.md`):**
> `SELLER_TIER` (DEC-037) sugiere una entidad `seller_tiers` (comisión/límites/
> beneficios) + FK desde `seller_profiles`, con su fuente de configuración en el
> Config Store (DEC-038); hoy `orders.commission_rate` guarda la tasa aplicada
> (snapshot) pero falta el catálogo de tiers.

## 7.b Snapshot financiero por transacción — ✅ DECIDIDO (DEC-030)

Cada transacción **conserva un snapshot financiero** inmutable. Campos mínimos a
poder representar:

| Campo | Descripción |
|-------|-------------|
| `order_total` | Total final cobrado al comprador (base de la comisión, DEC-014). |
| `commission_rate` | Tasa de comisión de OFFSIDE **aplicada en ese momento**. |
| `commission_amount` | Monto de comisión de OFFSIDE. |
| `mp_fee` | Costo real de Mercado Pago de esa operación. |
| `seller_amount` | Neto que recibe el vendedor. |
| `offside_amount` | Neto de OFFSIDE (comisión − costo MP absorbido). |
| `discount_amount` | Descuentos aplicados. |
| `shipping_amount` | Costo de envío. |

Reglas (DEC-030):

- **La tasa de MP NO se hardcodea** en el código; se resuelve desde configuración/
  datos, de modo que el **costo real de MP pueda cambiar sin afectar operaciones
  históricas**.
- **La comisión histórica nunca se recalcula** con una configuración futura: el
  snapshot es la verdad de esa operación.
- La comisión se calcula sobre el **precio final después de descuentos**
  (DEC-014/017).
- **Tratamiento fiscal** de la comisión: **🔴 PENDIENTE** (DEC-011) — no se resuelve
  ahora.

> **Impacto ERD (no se modifica ahora):** el ERD ya tiene la mayoría de estos
> importes en `orders`/`payment_splits`, pero conviene revisar que el conjunto
> completo del snapshot (incl. `discount_amount`, `offside_amount`) esté
> representado de forma inmutable. Ver `open-decisions-impact.md`.

## 8. Errores de integración

- **PC-060:** el sistema debe manejar y registrar: timeouts, errores 4xx/5xx de
  MP, tokens inválidos/expirados, cuenta de vendedor no habilitada para split,
  webhooks inválidos, e inconsistencias entre estado local y estado en MP.
- **PC-061:** política de **reintentos con backoff** para operaciones idempotentes;
  para no idempotentes, usar claves de idempotencia (🌐 si MP las soporta — VERIFY).
- **PC-062:** ante discrepancia local↔MP, **MP es la fuente de verdad**; se
  concilia (`orders-and-refunds.md`).
- **PC-063:** los errores que bloquean una venta se comunican claramente al
  usuario y se registran para operaciones.

## 9. Casos de uso

- **UC-PC-1 (pago aprobado):** comprador paga → MP procesa → split ejecutado
  (vendedor + comisión OFFSIDE) → webhook `approved` → orden `PAID`.
- **UC-PC-2 (pago rechazado):** `Payment REJECTED` → webhook → la orden **permanece
  `PENDING_PAYMENT`** (DEC-033) y admite reintento dentro de la ventana de pago.
- **UC-PC-3 (renovación de token):** access token por expirar → renovación con
  refresh token → continúa operando; si falla → cuenta "MP desconectado".
- **UC-PC-4 (webhook duplicado):** MP reenvía la misma notificación → el
  procesamiento idempotente no duplica el efecto.

## 10. Estados (resumen)

- Pago (🌐 de MP): aprobado / pendiente / rechazado / cancelado (+ los que MP
  defina).
- Conexión MP del vendedor: no_conectado / conectado / token_expirado /
  revocado.

## 11. Dependencias

- 🌐 **Mercado Pago** (todo el documento): OAuth, tokens, KYC, split, campos de
  comisión, estados de pago, webhooks, idempotencia, refunds. **Verificar cada
  punto contra doc. oficial.**
- Interna: `orders-and-refunds.md` (refunds/chargebacks/conciliación),
  `business-model.md` (unit economics), `seller-system.md` (onboarding),
  `architecture.md` (seguridad de credenciales, servicio de pagos).

## 12. Decisiones tomadas

- ✅ DEC-004: Mercado Pago Split Payments 1:1.
- ✅ DEC-005: OAuth para vendedores.
- ✅ La comisión de OFFSIDE se aplica vía `marketplace_fee`/`application_fee`
  según el checkout.
- ✅ Los webhooks (no el redirect) son la fuente de verdad del pago.
- ✅ Seguridad de credenciales: cifrado en reposo, gestor de secretos, auditoría.

## 13. Decisiones pendientes (DECISION REQUIRED)

- ~~🔴 DEC-007: comisión exacta y **base de cálculo**.~~ ✅ **CERRADA**: 6%
  (DEC-043); base = total cobrado (DEC-014).
- ~~🔴 Checkout Pro vs API para el MVP.~~ ✅ **CERRADA**: Checkout Pro (DEC-027).
- ~~🔴 🌐 Quién absorbe la comisión de MP en el split.~~ ✅ **CERRADA**: no la
  absorbe Offside; rige el comportamiento nativo de Split 1:1 (DEC-043).
- 🔴 🌐 Scopes de OAuth, vida de tokens, rotación de refresh, idempotencia — a
  verificar con MP.
- 🔴 MVP en sandbox/test vs producción.

## 14. Riesgos

- **Seguridad de credenciales:** fuga de access/refresh tokens = acceso a cobros
  de terceros. Riesgo alto (`RISKS.md`).
- **Dependencia total de MP:** cambios en su API/tarifas afectan negocio y
  técnica.
- **Estados asíncronos:** confiar en el redirect en vez del webhook → órdenes
  inconsistentes.
- **Comisión de MP no modelada:** unit economics erróneos si se asume mal quién la
  paga.
