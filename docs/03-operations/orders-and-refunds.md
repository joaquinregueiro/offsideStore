# Orders & Refunds — OFFSIDE STORE

> ⚠️ Este documento gira alrededor de un **riesgo estructural**: en Split
> Payments 1:1, un refund se reparte proporcionalmente entre vendedor y
> marketplace, y **el vendedor puede no tener fondos** para cubrir su parte.
> OFFSIDE **no debe asumir** que siempre puede recuperar automáticamente ese
> dinero. Todo el diseño se organiza en torno a esta realidad.

## 1. Propósito

Definir el ciclo de vida de la **orden** en su dimensión financiera y el
tratamiento de **refunds** (totales y parciales), **chargebacks** y
**conciliación**, incluyendo el manejo del riesgo de vendedor sin fondos.

## 2. Alcance

Incluye: la orden como registro financiero, refunds totales/parciales, la
distribución proporcional del refund en el split, el caso de fondos insuficientes,
chargebacks, y conciliación. La mecánica de pago/OAuth está en
`payments-and-commissions.md`; la de disputas (por qué se llega a un refund) en
`trust-and-safety.md`.

## 3. Conceptos principales

### 3.1 La orden como registro financiero

La orden (anatomía completa en `marketplace-flow.md`) persiste todos los importes
necesarios para operar refunds y conciliar: `importe_producto`, `importe_envío`,
`importe_total`, `comisión_offside`, `comisión_mp` (🌐), `neto_vendedor`, el
detalle del **split**, y la lista de **refunds** aplicados.

### 3.0 Principio rector — TODAS las reglas de refund son configurables — ✅ (DEC-008/DEC-013)

> **Decisión fundamental del owner (2026-08-19):** **todas** las reglas de refunds
> deben poder **configurarse desde el panel de administración** (⚙️), sin cambiar
> código. El sistema se **diseña alrededor de esta configurabilidad**; **no** se
> fijan todavía los **valores** concretos (siguen 🟡).

Deben ser configurables al menos: refund **total** y **parcial**; refund **antes
del envío**, **después del envío** y **después de la entrega**; **quién puede
iniciar** un refund; **cuándo** puede iniciarlo el comprador y el **plazo máximo
para reclamar**; **quién decide** el refund; **qué ocurre con la comisión de
Offside**, con los **costos de Mercado Pago** y con el **costo de envío**; **quién
paga la devolución**; y **cómo se registra** el refund. Catálogo en
`04-technical/configuration-registry.md`.

> **Contradicción resuelta:** los "DECISION REQUIRED" previos sobre envío
> reembolsable, reversa de comisión, orden de operaciones en devolución, etc., ya
> **no** son preguntas de código: se resuelven como **parámetros configurables**.
> Lo que queda 🟡 es el **valor por defecto** de cada parámetro.

### 3.2 Refund total vs parcial

- **Refund total:** se devuelve al comprador el 100% del importe reembolsable.
- **Refund parcial:** se devuelve una porción (p. ej. compensación por "estado
  diferente al declarado" sin devolución del producto).

**Comisión sobre refund parcial (✅ DEC-018, ⚙️):** la comisión asociada al importe
reembolsado la **absorbe Offside** por defecto, y esta política es **configurable
desde Admin**.

🟡 **PENDIENTE (valores, DEC-008):** ¿el **envío** es reembolsable? ¿la **comisión
de MP** se recupera en un refund? Ambos quedan como **parámetros configurables**
con valor por defecto a definir. 🌐/🔵 la recuperabilidad de la comisión de MP
depende de MP — **investigar, no inventar**.

### 3.3 Distribución proporcional del refund (el corazón del riesgo)

🌐 **DEPENDENCIA EXTERNA (confirmada por el negocio como comportamiento de MP en
Split 1:1):** al ejecutar un refund, **Mercado Pago distribuye proporcionalmente
el importe del refund entre el vendedor y el marketplace**. Es decir:

```
refund_total_al_comprador = parte_del_vendedor + parte_de_OFFSIDE
```

donde cada parte es proporcional a lo que cada uno recibió en el split original.
En consecuencia, **OFFSIDE puede tener que devolver su comisión** (total o
proporcionalmente al monto reembolsado).

> 🌐 **VERIFY:** la fórmula exacta de proporcionalidad, si incluye o no la
> comisión de MP, y el mecanismo por el cual MP debita cada parte, **se confirman
> con la documentación oficial de MP.** No se inventa el detalle contable.

## 4. Reglas de refunds

- **OR-001:** un refund siempre se origina en una causa trazable: resolución de
  **disputa** (`trust-and-safety.md`), **cancelación** (política 🔴 a definir), o
  **chargeback** (sección 6).
- **OR-002:** el importe del refund lo determina la **resolución** (FULL_REFUND /
  PARTIAL_REFUND) o la causa (chargeback = lo que MP/el emisor determinen 🌐).
- **OR-003:** el refund se ejecuta contra MP (🌐 mecánica/endpoint según doc.
  oficial — no inventar) y su resultado se persiste en la orden.
- **OR-004:** tras el refund, la orden pasa a `REFUNDED` o `PARTIALLY_REFUNDED`
  (`marketplace-flow.md`), y la **comisión de OFFSIDE se revierte
  proporcionalmente** (política DEC-008).
- **OR-005:** todo refund queda **auditado**: causa, importe, partes afectadas,
  resultado en MP, timestamps, y si quedó saldo pendiente (sección 5).
- **OR-006:** `RETURN_REQUIRED` condiciona el refund a la devolución/recepción del
  producto. El orden de operaciones (¿refund antes o después de recibir la
  devolución?) es un **parámetro configurable** (⚙️ DEC-008) con valor por defecto
  🟡 a definir (afecta al riesgo de fraude del comprador).

## 4.b Liberación de fondos del vendedor — ✅ CERRADA (DEC-019, reescrita 2026-09-01)

> **La decisión original del owner (2026-08-19) NO es implementable.** Decía que
> el dinero del vendedor no se consideraba liberado hasta que el comprador
> confirmara conformidad. La investigación técnica de OR-007 quedó cerrada el
> 2026-09-01 y su respuesta es que **Mercado Pago no ofrece retención de fondos
> configurable** para este stack.

**Lo que Mercado Pago NO permite:**

- Diferir la acreditación al vendedor en **Split 1:1**: al aprobarse el pago, el
  dinero se acredita según los plazos propios de esa cuenta.
- Ningún parámetro público de `hold`, `release_date` ni escrow.
- `capture=false` en **Checkout Pro** (existe sólo en Checkout API, con ventana
  de 7 días y cambiando el checkout entero).

El *delayed settlement* real exige **acuerdo comercial** con Mercado Pago.

**Decisión vigente:** Offside **asume el riesgo** y lleva la deuda en
`seller_liabilities` (§5.4). Es la primera mitigación que RISK-F1 ya listaba.

- ~~**OR-007**~~ ✅ investigación cerrada: la respuesta es que no se puede.
- ~~**OR-008**~~ sin efecto: la "condición automática de liberación" no tiene
  sobre qué operar si no hay fondos retenidos.
- **Impacto ERD: ninguno.** No hacen falta estados de "fondos
  retenidos/liberados": no existen fondos retenidos. `seller_liabilities` ya
  está en el ERD.

⚠️ Verificado en la práctica el **2026-08-26**: en la primera venta real el
reparto ocurrió al aprobarse el pago, sin paso intermedio.

## 5. Riesgo central: vendedor sin fondos

### 5.1 El problema

Cuando MP intenta debitar la **parte del vendedor** para el refund y el vendedor
**no tiene saldo suficiente** en su cuenta MP, esa parte **no puede recuperarse
automáticamente**. Escenarios que lo provocan:

- el vendedor ya retiró/transfirió su parte del split,
- la cuenta MP quedó sin saldo,
- el vendedor desapareció / revocó accesos.

> 🌐 **VERIFY / DEPENDENCIA EXTERNA:** qué hace MP exactamente cuando la parte del
> vendedor no puede debitarse (¿deja saldo negativo?, ¿retiene de ventas
> futuras?, ¿falla el refund?, ¿lo cubre el marketplace?) **debe confirmarse con
> MP.** OFFSIDE **no asume** un comportamiento automático favorable.

### 5.2 Principio de diseño

> **El sistema se diseña asumiendo que OFFSIDE NO siempre podrá recuperar la parte
> del vendedor.** Por lo tanto debe: (a) minimizar la exposición, (b) registrar la
> deuda, (c) tener una política explícita de quién absorbe la pérdida y cómo se
> intenta recuperar.

### 5.3 Mecanismos de mitigación (marco; valores 🔴 a decidir)

Estas son **opciones** a evaluar y decidir; ninguna está cerrada:

1. **Retención/hold de liberación de fondos al vendedor** durante la ventana de
   protección al comprador, si MP lo permite 🌐. Reduce la exposición porque el
   dinero aún no fue retirado cuando puede surgir un refund. 🔴 depende de MP.
2. **Reserva/garantía por nivel de riesgo:** exigir un colchón a vendedores de
   riesgo ALTO. 🔴 depende de MP y de política.
3. **Recupero de ventas futuras:** descontar la deuda de próximos splits del
   vendedor. 🔴 depende de MP.
4. **Provisión contable por pérdida esperada** (fondo de OFFSIDE) para cubrir
   refunds no recuperables — impacto en unit economics (`business-model.md`).
5. **Sanción** al vendedor moroso (suspensión/expulsión, riesgo CRÍTICO) y, si
   corresponde, acciones legales. No garantiza recupero.

### 5.4 `seller_liabilities` como entidad de primera clase — ✅ (DEC-019 relacionado)

Se **mantiene** `seller_liabilities` como entidad de primera clase (ya existe en el
ERD). Debe contemplar **potencialmente** (valores/reglas 🟡, sin definir aún):

1. **Recuperación de deuda.**
2. **Bloqueo de nuevas ventas** mientras haya deuda.
3. **Descuento de ventas futuras** (si MP lo permite 🔵🌐).
4. **Suspensión de cuenta.**
5. **Condición de deuda incobrable** (`WRITTEN_OFF`).
6. **Límite de exposición por vendedor** (tope de riesgo tolerado).

- **OR-010:** cuando la parte del vendedor no se recupera, se registra la **deuda**
  (`seller_liabilities`): vendedor, orden, importe, causa, estado (`PENDING` /
  `RECOVERED` / `WRITTEN_OFF`), intentos de recupero, decisión administrativa.
- **OR-011:** el estado de la orden refleja que hubo refund al comprador aun si el
  recupero al vendedor quedó pendiente (ver 5.5).

> **Impacto ERD (no se modifica ahora):** los ítems 2, 3 y 6 pueden requerir campos
> nuevos (p. ej. `block_sales_on_debt`, `exposure_limit`) o lógica adicional. Ver
> `open-decisions-impact.md`.

### 5.5 ¿OFFSIDE adelanta el refund al comprador? — 🟡 (⚙️ configurable)

Queda **pendiente** definir si OFFSIDE **garantiza/adelanta** el refund al comprador
aunque no pueda recuperar la parte del vendedor (asumiendo la pérdida), o si el
refund depende de lo que MP logre debitar. Debe ser un **parámetro configurable**
(⚙️) con valor por defecto 🟡. Impacta protección al comprador vs exposición
financiera. **No se asume** que Offside siempre recupera del vendedor.

## 6. Chargebacks / contracargos

> 🟡/🔵 **PENDIENTE (lista del owner, 2026-08-19):** quedan sin definir **quién
> absorbe** el chargeback, **cómo afecta al vendedor**, **cómo afecta a Offside**,
> **cómo afecta la reputación**, y **qué ocurre con vendedores reincidentes**. El
> flujo técnico depende de MP/redes de tarjetas (🌐, investigar, no inventar).

- **OR-020 (🌐 DEPENDENCIA EXTERNA):** un chargeback (contracargo iniciado por el
  comprador ante su banco/emisor) sigue las **reglas de MP y de las redes de
  tarjetas**, no las de OFFSIDE. **No inventar** el flujo ni los plazos.
- **OR-021:** el sistema debe **recibir** notificaciones de chargeback (vía
  webhooks/estados de MP 🌐), registrarlas en la orden, y disparar el mismo marco
  de riesgo de fondos (sección 5) porque el dinero puede debitarse del split.
- **OR-022:** el sistema debe permitir **aportar evidencia** de defensa del
  chargeback si MP lo habilita 🌐 (tracking, fotos, comunicación).
- **OR-023:** un chargeback fraudulento del comprador es un riesgo propio
  (distinto del vendedor sin fondos) — ver `RISKS.md`.

## 7. Conciliación

- **OR-030:** OFFSIDE debe **conciliar** periódicamente sus registros con los de
  MP: pagos, splits, comisiones (OFFSIDE y MP), refunds, chargebacks y saldos.
- **OR-031 (🌐):** la conciliación usa reportes/consultas de MP como fuente de
  verdad. **No inventar** formato de reportes; usar lo que MP provea.
- **OR-032:** discrepancias se registran y resuelven; MP es la fuente de verdad
  (PC-062).
- **OR-033:** la conciliación alimenta el reporting financiero y el cálculo real
  de márgenes y pérdidas por refunds (`business-model.md`).
- **OR-034:** toda la conciliación es **auditable**.

## 8. Casos de uso

- **UC-OR-1 (refund total, vendedor con fondos):** disputa → FULL_REFUND → MP
  debita parte del vendedor + parte de OFFSIDE → comprador reembolsado → comisión
  OFFSIDE revertida → orden `REFUNDED` → conciliado.
- **UC-OR-2 (refund total, vendedor SIN fondos):** FULL_REFUND → MP no puede
  debitar la parte del vendedor 🌐 → se crea `seller_liability PENDING` → (según
  DEC-008) OFFSIDE decide si adelanta al comprador → intento de recupero de ventas
  futuras / sanción → posible `WRITTEN_OFF` (pérdida) → provisión aplicada.
- **UC-OR-3 (refund parcial):** PARTIAL_REFUND por "estado diferente" sin
  devolución → importe parcial → reversa proporcional de comisión → orden
  `PARTIALLY_REFUNDED`.
- **UC-OR-4 (chargeback):** comprador inicia contracargo → webhook MP →
  registro en orden → aporte de evidencia (si MP lo permite) → resultado 🌐 → si se
  pierde, mismo marco de riesgo de fondos.

## 9. Estados

### 9.1 Estados iniciales de Refund — ✅ DECIDIDO (DEC-031, estructura)

```
REQUESTED → UNDER_REVIEW → APPROVED → PROCESSING → COMPLETED
REQUESTED → REJECTED
```

| Estado | Significado |
|--------|-------------|
| `REQUESTED` | Se solicitó un refund. |
| `UNDER_REVIEW` | En análisis. |
| `APPROVED` | Aprobado; pendiente de ejecutar. |
| `PROCESSING` | Ejecutándose contra MP. |
| `COMPLETED` | Reembolso completado. |
| `REJECTED` | Solicitud rechazada. |

> ⚠️ **Estructura inicial únicamente.** Sólo se fija el ciclo de estados para poder
> evolucionar el módulo. Explícitamente **PENDIENTE (no resolver ahora, DEC-031):**
> política completa de devoluciones, **motivos** de refund, **evidencia** requerida,
> **plazos**, **responsabilidad económica**, **costos de devolución**,
> `seller_liabilities`, **chargebacks**, **penalizaciones**, **reincidencia** y
> **reglas avanzadas de resolución**.

### 9.2 Otros estados

- Estado de pago (`Payment`): `REFUNDED` / `PARTIALLY_REFUNDED` / `CHARGED_BACK`
  (DEC-028).
- Orden: ver `marketplace-flow.md` §6 (set DEC-029; refund/disputa ya **no** son
  estados de la Order — **DEC-034**, ciclos separados).
- Disputa: `OPEN → WAITING_SELLER → UNDER_REVIEW → RESOLVED` (DEC-009).
- Deuda del vendedor (`seller_liabilities`): `PENDING → RECOVERED` / `WRITTEN_OFF`.

## 10. Dependencias

- 🌐 **Mercado Pago:** ejecución del refund, distribución proporcional, débito de
  la parte del vendedor, comportamiento ante fondos insuficientes, chargebacks,
  reportes de conciliación. **Verificar cada punto; no inventar.**
- Interna: `trust-and-safety.md` (disputas que originan refunds),
  `payments-and-commissions.md` (mecánica de pago/split), `business-model.md`
  (provisión por pérdidas), `seller-system.md` (deuda y sanción del vendedor).

## 11. Decisiones tomadas

- ✅ El refund se distribuye proporcionalmente entre vendedor y OFFSIDE (🌐
  comportamiento de MP asumido por el negocio; detalle a verificar).
- ✅ El sistema **no asume** recupero automático de la parte del vendedor.
- ✅ Se registra deuda del vendedor (`seller_liability`) cuando el recupero queda
  pendiente.
- ✅ Soporte de refunds totales y parciales, chargebacks y conciliación.

## 12. Decisiones pendientes (DECISION REQUIRED)

- 🔴 **DEC-008** — Política de refunds: ¿envío reembolsable?, ¿comisión de MP
  recuperable? (🌐), reversa de comisión de OFFSIDE (total/proporcional),
  orden de operaciones en `RETURN_REQUIRED`.
- 🔴 ¿OFFSIDE **adelanta/garantiza** el refund al comprador ante vendedor sin
  fondos? (5.5) — define protección al comprador vs exposición.
- 🔴 Mecanismos de mitigación a adoptar (hold de fondos, reserva por riesgo,
  recupero de ventas futuras) — **todos 🌐 sujetos a lo que MP permita.**
- 🔴 Política de cancelación y su relación con refunds.

## 13. Riesgos

- **Financiero (central):** refunds no recuperables de vendedores sin fondos →
  pérdida directa de OFFSIDE.
- **Fraude del vendedor:** vender, cobrar, retirar y desaparecer ante el refund.
- **Fraude del comprador:** chargebacks abusivos o `RETURN_REQUIRED` sin devolver.
- **Contable:** mala conciliación → márgenes y pérdidas mal medidos.
- **Legal/reputacional:** no proteger al comprador daña la marca; sobreproteger
  sin recupero daña las finanzas. El balance es una decisión de negocio (DEC-008).
