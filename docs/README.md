# OFFSIDE STORE — Documentación Fundacional

> Marketplace especializado en fútbol (camisetas e indumentaria).
> Esta documentación es la **fuente de verdad** para el desarrollo del producto.
> Estado: **v0.1 — Documentación fundacional (pre-desarrollo).**
> Última actualización: 2026-08-19.

---

## 1. Qué es este repositorio

Este repositorio contiene la documentación de negocio, producto, operaciones y
arquitectura de **OFFSIDE STORE**, un marketplace vertical especializado en
indumentaria de fútbol que conecta compradores y vendedores, procesa pagos vía
**Mercado Pago Split Payments 1:1**, gestiona envíos con **Correo Argentino**, y
monetiza mediante una **comisión sobre cada venta**.

Todavía **no hay código**. El objetivo de esta fase es dejar escrita la lógica de
negocio con suficiente detalle para que cualquier desarrollador pueda
implementarla sin reinterpretar las reglas.

## 2. Cómo leer esta documentación

Cada documento sigue una estructura homogénea:

1. **Propósito**
2. **Alcance**
3. **Conceptos principales**
4. **Reglas**
5. **Casos de uso**
6. **Estados**
7. **Dependencias** (internas y externas)
8. **Decisiones tomadas**
9. **Decisiones pendientes** (bloques `DECISION REQUIRED`)
10. **Riesgos**

### Convenciones de estado (taxonomía canónica — actualizada 2026-08-19)

A lo largo de todos los documentos se usa un vocabulario común de **5 estados**
para separar lo que está resuelto de lo que no:

| Marca | Significado |
|-------|-------------|
| ✅ **DECIDIDO** | Decisión tomada y estable. Se puede construir sobre ella. |
| ⚙️ **CONFIGURABLE** | Decidido que se gobierna desde el panel de Admin; el valor no se fija en código. Ver `04-technical/configuration-registry.md`. |
| 🟡 **PENDIENTE** | Falta definir; decisión interna del equipo. |
| 🔵 **REQUIERE INVESTIGACIÓN** | Depende de investigar un tercero/tecnología (Mercado Pago, Correo Argentino) antes de decidir. |
| 🔴 **REQUIERE ASESORAMIENTO PROFESIONAL** | Necesita contador/abogado antes del lanzamiento (fiscal, legal). |

Marcas **ortogonales** (tags, no estados):

| Tag | Significado |
|-----|-------------|
| 🌐 **DEPENDENCIA EXTERNA** | El comportamiento depende de un tercero (Mercado Pago, Correo Argentino, AFIP/ARCA). **No debe inventarse.** Muchos ítems 🌐 son además 🔵. |
| 💡 **RECOMENDACIÓN** | Sugerencia no vinculante. |

> **Nota de migración.** Documentos escritos antes de esta fecha pueden usar 🔴
> con el sentido antiguo de "DECISION REQUIRED". Reinterpretar según la tabla de 5
> estados: lo que antes era "decisión pendiente interna" es hoy 🟡; lo que depende
> de MP/Correo es 🔵; lo fiscal/legal es 🔴.

> **Regla de oro:** cuando un comportamiento dependa de un tercero y no esté
> documentado oficialmente, se marca 🌐 + 🔵 con nota "a verificar contra
> documentación oficial". **No se inventan endpoints, campos ni comportamientos de
> Mercado Pago o Correo Argentino.**

## 3. Estructura de carpetas

```
OFFSIDE-STORE/
├── README.md                          ← este archivo (índice)
├── DECISIONS.md                       ← decisiones tomadas
├── OPEN-QUESTIONS.md                  ← decisiones pendientes / a definir
├── RISKS.md                           ← riesgos técnicos, comerciales, financieros, legales, de fraude, operativos
│
├── 01-business/
│   ├── business-model.md              ← modelo de negocio, monetización, unit economics
│   ├── business-rules.md              ← reglas de negocio transversales
│   ├── trust-and-safety.md            ← confianza: reputación, nivel de usuario, riesgo, disputas
│   ├── mvp-scope.md                   ← alcance del MVP y fuera de alcance / futuro
│   └── legal.md                       ← marco legal (pendiente, requiere abogado)
│
├── 02-product/
│   ├── product-specification.md       ← modelo de datos del producto (camiseta especializada), búsqueda y filtros
│   ├── marketplace-flow.md            ← flujo end-to-end del marketplace
│   ├── buyer-system.md                ← funcionalidades del comprador
│   ├── seller-system.md               ← funcionalidades del vendedor
│   └── notifications-and-engagement.md ← notificaciones, favoritos, alertas, follows
│
├── 03-operations/
│   ├── payments-and-commissions.md    ← Mercado Pago Split, OAuth, webhooks, comisiones, cuotas
│   ├── orders-and-refunds.md          ← órdenes, refunds (configurables), fondos, chargebacks
│   └── shipping.md                    ← Correo Argentino, tracking, estados, costos
│
└── 04-technical/
    ├── architecture.md                ← arquitectura de software, servicios, roles admin
    ├── tech-stack.md                  ← stack oficial (DEC-012)
    ├── database-design.md             ← ERD v1.0 CERRADO (Drizzle/PostgreSQL)
    ├── erd-audit-fase2.md             ← auditoría del ERD (Fase 2) previa al cierre
    ├── open-decisions-impact.md       ← impacto de decisiones pendientes sobre el sistema/ERD
    ├── configuration-registry.md      ← todo lo que debe ser configurable desde Admin
    └── security-observability-analytics.md ← seguridad, observabilidad, analytics/KPIs
```

## 4. Orden de lectura recomendado

1. `01-business/business-model.md` — entender qué es y cómo gana dinero.
2. `01-business/business-rules.md` — reglas transversales.
3. `02-product/product-specification.md` — qué se vende y cómo se modela.
4. `02-product/marketplace-flow.md` — cómo fluye una operación de punta a punta.
5. `03-operations/payments-and-commissions.md` — el corazón financiero (Mercado Pago).
6. `03-operations/orders-and-refunds.md` — órdenes, reembolsos y el riesgo de fondos.
7. `01-business/trust-and-safety.md` — confianza, reputación, disputas.
8. `03-operations/shipping.md` — envíos.
9. `04-technical/architecture.md` — cómo se implementa técnicamente.
10. `DECISIONS.md`, `OPEN-QUESTIONS.md`, `RISKS.md` — estado del proyecto.

## 5. Resumen ejecutivo (una página)

**OFFSIDE STORE** es un marketplace C2C/B2C especializado en fútbol. No es dueño
del stock: es **intermediario**. Un comprador busca una camiseta con filtros
especializados (club, temporada, versión, jugador, autenticidad, etc.), la
compra, y paga por Mercado Pago. Mercado Pago **divide automáticamente** el pago
(Split 1:1) entre el vendedor y OFFSIDE STORE, aplicando la **comisión** de la
plataforma. La orden se crea, el vendedor despacha por Correo Argentino, el
comprador recibe y califica. Si algo sale mal, se abre una **disputa** que puede
terminar en un **refund** (total o parcial).

El diferencial es doble: (a) **búsqueda y filtros especializados** imposibles en
un marketplace generalista, y (b) un **sistema de confianza y autenticidad**
pensado para coleccionistas, donde la falsificación es el riesgo central.

El MVP simula un marketplace real con ~100 camisetas propias repartidas entre
vendedores controlados, para ejercitar **todo el flujo** (no sólo el catálogo).

### Estado de las decisiones fundacionales (resumen)

Hay **38 decisiones** registradas (DEC-001 … DEC-038). Extracto (incluye cierre de
Fase 1 y resolución de inconsistencias I-1…I-5):

| ID | Decisión | Estado |
|------|----------|--------|
| DEC-002 | Modelo marketplace intermediario | ✅ |
| DEC-003 | Monetización por comisión | ✅ |
| DEC-004 | Mercado Pago Split Payments | ✅ |
| DEC-012 | Stack definitivo | ✅ |
| DEC-013 | Configurabilidad operativa desde Admin | ✅ |
| DEC-014 | Reglas de cálculo de comisión (base=total, IVA incl., sin min/máx) | ✅ |
| DEC-019 | Liberación de fondos sujeta a conformidad | ✅ / 🔵 MP |
| DEC-020 | Niveles de usuario (NUEVO→…→TIENDA) | ✅ / 🟡 umbrales |
| DEC-021 | Estados de riesgo (NORMAL→RIESGO→RESTRINGIDO→SUSPENDIDO) | ✅ / 🟡 umbrales |
| DEC-027 | Checkout Pro inicial | ✅ |
| DEC-028 | Estados de Payment (PENDING…CHARGED_BACK) | ✅ |
| DEC-029 | Estados técnicos de Order (PENDING_PAYMENT…CANCELLED) | ✅ |
| DEC-030 | Snapshot financiero; tasa MP no hardcodeada | ✅ |
| DEC-031 | Estados de Refund | ✅ estructura |
| DEC-032 | Simple por defecto, configurable cuando sea necesario | ✅ |
| DEC-033 | Pago rechazado no cancela la Order (I-1) | ✅ |
| DEC-034 | Ciclos separados Order/Payment/Refund/Dispute (I-2) | ✅ |
| DEC-035 | `IN_PROCESS` + mapeo estados MP↔Offside (I-3) | ✅ |
| DEC-036 | Historial = fuente de verdad; sin score autoridad (I-4) | ✅ |
| DEC-037 | `SELLER_TIER` ≠ USER LEVEL (I-5) | ✅ / 🟡 valores |
| DEC-038 | Config Store administrativo + snapshot económico | ✅ concepto |
| DEC-007 | Comisión exacta (%) | ⚙️ / 🟡 |
| DEC-008 | Política de refunds | ⚙️ / 🟡 |
| DEC-009 | Sistema de disputas | 🟡 |
| DEC-010 | Política de autenticidad | 🟡 |
| DEC-011 | Modelo fiscal e impuestos | 🔴 |

Ver la tabla completa y el detalle en [`DECISIONS.md`](./DECISIONS.md).
Ver impacto de lo pendiente en
[`04-technical/open-decisions-impact.md`](./04-technical/open-decisions-impact.md)
y lo configurable en
[`04-technical/configuration-registry.md`](./04-technical/configuration-registry.md).
