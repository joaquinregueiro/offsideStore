# Architecture — OFFSIDE STORE

> Este documento describe la **arquitectura de software** propuesta a nivel
> conceptual y de servicios. **No es una decisión de stack cerrada** (DEC-012
> pendiente) ni contiene código. Su objetivo es que la implementación respete las
> reglas de negocio, aísle las **dependencias externas** detrás de servicios, y
> soporte los flujos descritos en el resto de la documentación.

## 1. Propósito

Definir la estructura técnica de alto nivel: dominios/servicios, cómo se aíslan
las integraciones externas (Mercado Pago, Correo Argentino), el modelo de datos
principal, los mecanismos transversales (auditoría, seguridad de credenciales,
webhooks, idempotencia) y los principios de diseño.

## 2. Alcance

Arquitectura lógica y de servicios, no infraestructura detallada ni elección
final de tecnologías. Marca claramente qué es 💡 recomendación vs 🔴 decisión
pendiente.

## 3. Principios de diseño

1. **Dominio primero, proveedores aislados.** El negocio no depende de MP ni de
   Correo Argentino directamente: cada integración externa vive detrás de un
   **servicio con interfaz agnóstica** (`PaymentService`, `ShippingService`).
   🌐 las dependencias externas nunca se filtran al dominio.
2. **Los webhooks son la fuente de verdad de los eventos externos** (pagos,
   envíos), no los redirects/UX (`payments`, `shipping`).
3. **Idempotencia** en todo lo que consuma eventos externos o reintente
   operaciones.
4. **Auditoría por diseño:** toda decisión sensible (dinero, sanciones,
   disputas, cambios de credenciales) queda registrada de forma inmutable.
5. **Seguridad de credenciales:** secretos y tokens cifrados, con acceso mínimo y
   auditado (`payments` PC-030..033).
6. **Fuente de verdad única del dinero es MP**; OFFSIDE **concilia**, no asume.
7. **No inventar comportamientos externos:** donde falte confirmación, el código
   se estructura para tolerar la incertidumbre (reintentos, conciliación,
   estados provisorios).
8. **Simple por defecto, configurable cuando sea necesario (✅ DEC-032):** no
   hardcodear reglas que van a cambiar (comisiones, transiciones de orden,
   publicaciones, refunds, reputación), pero **tampoco** construir un motor
   genérico de configuración excesivamente complejo para el MVP. Defaults
   **razonables y simples** + arquitectura que permita cambiarlos después. Los
   parámetros configurables se catalogan en `configuration-registry.md`.

> **Estados canónicos (Fase 1, con cierre de inconsistencias):** `Payment`
> (DEC-028/DEC-035) `PENDING/IN_PROCESS/APPROVED/REJECTED/CANCELLED/REFUNDED/
> PARTIALLY_REFUNDED/CHARGED_BACK`; `Order` (DEC-029) `PENDING_PAYMENT/PAID/
> PROCESSING/SHIPPED/DELIVERED/COMPLETED/CANCELLED`; `Refund` (DEC-031)
> `REQUESTED/UNDER_REVIEW/APPROVED/PROCESSING/COMPLETED|REJECTED`; `Dispute`
> (DEC-009) `OPEN/WAITING_SELLER/UNDER_REVIEW/RESOLVED`.
>
> **Ciclos separados (DEC-034):** Order (logístico), Payment (financiero), Refund y
> Dispute son entidades con estados propios; se relacionan por **referencia**, no
> por estado compartido. Un pago `REJECTED` **no** cancela la Order (DEC-033).
> **Mapeo MP↔Offside (DEC-035):** el módulo `payments` mantiene un mapeo explícito
> entre el estado crudo de MP (persistido) y el estado normalizado de Offside.
> **Config Store (DEC-038):** parámetros de negocio configurables, con **snapshot
> económico** por transacción (DEC-030). **Confianza (DEC-036):** el HISTORIAL es la
> fuente de verdad; no hay score como autoridad. El **ERD `database-design.md` aún
> no refleja estos enums/entidades** — ver `open-decisions-impact.md`.

## 4. Vista de servicios (dominios)

💡 **RECOMENDACIÓN** — organización modular (monolito modular en el MVP, con
límites claros que permitan extraer servicios luego). No decidido (DEC-012).

| Servicio / módulo | Responsabilidad | Se apoya en |
|-------------------|-----------------|-------------|
| **Identity & Accounts** | Registro, login, sesión, roles (comprador/vendedor), verificación de identidad. | `buyer-system.md`, `seller-system.md`, `trust-and-safety.md` |
| **Catalog & Listings** | Modelo especializado de producto, categorías, catálogos controlados, estados de publicación. | `product-specification.md` |
| **Search** | Índice facetado, filtros especializados, sinónimos/alias. | `product-specification.md` §5 |
| **Cart & Checkout** | Carrito, revalidación de stock/precio, inicio de pago. | `marketplace-flow.md`, `buyer-system.md` |
| **PaymentService (abstracción MP)** | OAuth, tokens, split, comisión, estados de pago, webhooks, refunds, chargebacks, conciliación — **detrás de una interfaz**. | `payments-and-commissions.md`, `orders-and-refunds.md` |
| **Orders** | Orden como registro central (importes, split, estados, refunds). | `marketplace-flow.md`, `orders-and-refunds.md` |
| **ShippingService (abstracción Correo Argentino)** | Cotización, envío, etiqueta, tracking, estados — **detrás de una interfaz**. | `shipping.md` |
| **Trust & Safety** | Ejes de confianza, reputación, niveles de riesgo, disputas, sanciones. | `trust-and-safety.md` |
| **Admin / Back-office** | Dashboard, gestión de usuarios/vendedores/publicaciones/órdenes/pagos/disputas/refunds/sanciones/autenticidad/métricas. | Admin (§7) |
| **Audit** | Log inmutable transversal de decisiones y cambios sensibles. | Todos |
| **Notifications** | Emails/avisos a compradores y vendedores (estados de pago, envío, disputas). | Varios |

## 5. Integraciones externas (aisladas)

### 5.1 PaymentService (Mercado Pago)

- Expone operaciones de dominio: `connectSeller(oauth)`, `refreshCredentials()`,
  `createPaymentWithSplit(order)`, `handlePaymentWebhook(evt)`, `refund(order,
  amount)`, `getReconciliationReport(period)`.
- Internamente traduce a las llamadas reales de MP. 🌐 **VERIFY** cada una contra
  doc. oficial (`payments-and-commissions.md`).
- Almacena tokens de vendedor cifrados; gestiona su renovación (PC-011).
- Valida y procesa webhooks de forma idempotente; **reconsulta** el estado a MP.

### 5.2 ShippingService (Correo Argentino)

- Expone: `quote()`, `createShipment()`, `getLabel()`, `getTracking()`,
  `handleWebhook()` (o polling). 🌐 según lo que provea Correo Argentino.
- Traduce estados del correo a los **estados internos normalizados**
  (`shipping.md` §5).
- Permite un proveedor **fake** para el MVP/tests.

## 6. Modelo de datos principal (entidades)

Resumen de entidades y sus documentos de referencia (esquema fino en cada doc):

- `User` (con roles), `SellerProfile`, `IdentityVerification` — Identity /
  `seller-system.md` / `trust-and-safety.md`.
- `Listing` + `Category` + catálogos (`Club`, `Selection`, `Brand`,
  `Competition`, `Country`, `Season`, `SizeChart`) — `product-specification.md`.
- `Cart`, `Order`, `OrderItem` — `marketplace-flow.md`.
- `Payment`, `Split`, `Commission`, `Refund`, `Chargeback`, `SellerLiability`
  (deuda del vendedor), `ReconciliationRecord` — `payments` / `orders-and-refunds`.
- `Shipment` + `TrackingEvent` — `shipping.md`.
- `SellerReputation`, `RiskLevel`, `Dispute` (+ `DisputeEvidence`,
  `DisputeDecision`), `Sanction` — `trust-and-safety.md`.
- `AuditLog` — transversal.

## 7. Back-office / Admin

El panel de administración (funcionalidades listadas en el pedido de negocio)
debe cubrir: **dashboard, usuarios, vendedores, publicaciones, órdenes, pagos,
disputas, refunds, sanciones, autenticidad, métricas**. Requisitos:

- **AR-001:** toda acción administrativa sensible pasa por **Audit** (quién,
  cuándo, por qué).
- **AR-002:** colas de trabajo para **revisión manual** de riesgo y disputas
  (`trust-and-safety.md` TS-041).
- **AR-003:** vistas de conciliación y de `SellerLiability` (deudas por refunds
  no recuperados).
- **AR-004 (✅ set de roles — DEC-023):** roles de administración: **`SUPER_ADMIN`,
  `ADMIN`, `MODERATOR`, `SUPPORT`, `FINANCE`**. Los **permisos granulares por rol**
  quedan 🟡 (a definir posteriormente).
- **AR-005 (⚙️ DEC-013):** el Admin es también el lugar donde se editan las
  **configuraciones** del sistema (comisiones, refunds, reputación, publicaciones,
  envíos). Catálogo en `04-technical/configuration-registry.md`.
- **AR-006:** capacidades del back-office (Bloque 12): usuarios y **suspensiones**;
  vendedores y **aprobaciones**; publicaciones y **moderación**; órdenes; pagos;
  refunds; disputas y **evidencias**; **bloqueos**; **audit logs**.

## 8. Mecanismos transversales

- **Webhooks:** endpoints validados, idempotentes, con reconsulta a la fuente
  (`payments` PC-041, `shipping` §3.2). Cola/worker para procesamiento asíncrono.
- **Idempotencia:** claves de idempotencia en operaciones de pago/refund y en el
  consumo de webhooks.
- **Auditoría:** `AuditLog` append-only; las evidencias de disputa son inmutables
  (`trust-and-safety.md` TS-061).
- **Seguridad:** TLS, secretos en gestor de secretos, tokens cifrados en reposo,
  principio de mínimo privilegio, y registro de accesos a credenciales
  (`payments` PC-030..033).
- **Observabilidad:** logs, métricas y trazas para pagos, webhooks y
  conciliación (críticos por la dependencia de MP).
- **Manejo de errores externos:** reintentos con backoff, estados provisorios,
  conciliación como red de seguridad (`payments` §8).

## 9. Entornos

- 💡 **RECOMENDACIÓN:** entornos separados (dev / test-sandbox / prod). El MVP
  debería ejercitarse primero contra **sandbox/test de MP** y un **ShippingService
  fake o test** antes de tocar dinero/envíos reales (ligado a la DECISION REQUIRED
  del MVP en `marketplace-flow.md`).

## 10. Casos de uso (arquitectónicos)

- **UC-AR-1 (pago):** Checkout → PaymentService.createPaymentWithSplit → MP →
  webhook → PaymentService.handlePaymentWebhook (idempotente, reconsulta) →
  Orders marca `PAID` → Notifications avisa al vendedor.
- **UC-AR-2 (refund con vendedor sin fondos):** Dispute resuelve FULL_REFUND →
  PaymentService.refund → MP no debita parte del vendedor 🌐 → se crea
  `SellerLiability PENDING` → Admin/back-office lo ve → política DEC-008.
- **UC-AR-3 (envío):** Order `AWAITING_SHIPMENT` → ShippingService.createShipment
  (Correo Argentino) → TrackingEvents → Order avanza; tracking abstraído al
  comprador.

## 11. Dependencias

- 🌐 **Mercado Pago** y **Correo Argentino** (aisladas tras servicios).
- Interna: **todos** los documentos de negocio, producto y operaciones (esta
  arquitectura los materializa).

## 12. Decisiones tomadas

- ✅ Aislar integraciones externas detrás de servicios (`PaymentService`,
  `ShippingService`).
- ✅ Webhooks como fuente de verdad + idempotencia + reconsulta.
- ✅ Auditoría inmutable transversal.
- ✅ Seguridad de credenciales (cifrado, secretos, mínimo privilegio, auditoría).
- ✅ MP es la fuente de verdad del dinero; OFFSIDE concilia.

## 13. Decisiones pendientes (DECISION REQUIRED)

- 🔴 **DEC-012** — Stack definitivo (lenguaje, framework, base de datos, motor de
  búsqueda, hosting).
- 🔴 Monolito modular vs microservicios para el MVP (💡 recomendación: monolito
  modular).
- 🔴 Modelo de roles/permascos del back-office (AR-004).
- 🔴 Entornos y uso de sandbox/test en el MVP.
- 🔴 Motor de búsqueda concreto.

## 14. Riesgos

- **Acoplamiento a proveedores** si no se respetan las abstracciones.
- **Complejidad de webhooks/idempotencia** mal implementada → estados
  inconsistentes o efectos duplicados.
- **Seguridad de credenciales:** superficie crítica (tokens de terceros).
- **Elegir stack antes de tiempo** o sin considerar el motor de búsqueda facetada
  (diferencial del producto).
