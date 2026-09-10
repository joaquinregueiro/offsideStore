# Marketplace Flow — OFFSIDE STORE

## 1. Propósito

Describir el **flujo end-to-end** del marketplace: desde que un usuario busca un
producto hasta que la operación se completa (o se disputa y reembolsa). Es el
mapa que conecta todos los subsistemas y el guion que el MVP debe poder recorrer
completo.

## 2. Alcance

Incluye: el flujo canónico "happy path", los caminos alternativos (pago
rechazado, sin stock, disputa, refund), la anatomía de la **orden**, y la
definición del MVP (los ~100 productos y la simulación del marketplace).

Los detalles de cada etapa viven en sus documentos (pagos, envíos, disputas); aquí
se muestra cómo encajan.

## 3. Conceptos principales

### 3.1 El flujo canónico (happy path)

```
usuario
  → búsqueda / filtros
    → detalle de producto
      → (favoritos) → carrito
        → checkout
          → Mercado Pago (pago del comprador)
            → Split 1:1 (división vendedor / OFFSIDE)
              → creación de ORDEN
                → notificación al vendedor
                  → envío (Correo Argentino) + etiqueta + tracking
                    → tránsito
                      → entrega
                        → confirmación / cierre
                          → reputación (calificaciones)
```

Y el camino de conflicto, que puede ramificar tras la entrega (o su ausencia):

```
... → reclamo (disputa) → resolución → refund (total/parcial) → conciliación
```

### 3.2 Actores en el flujo

Comprador, Vendedor, OFFSIDE (plataforma/back-office), 🌐 Mercado Pago, 🌐 Correo
Argentino, Admin/Operaciones (para disputas).

## 4. Reglas del flujo

### 4.1 Búsqueda → detalle

- **MF-001:** cualquiera puede buscar y ver detalle sin registrarse; para
  comprar/favoritos/carrito se requiere sesión (BR-001).
- **MF-002:** la búsqueda usa el modelo especializado y facetas
  (`product-specification.md`).

### 4.2 Carrito y stock

- **MF-010:** agregar al carrito **no reserva stock**. El stock se descuenta al
  **confirmarse el pago** (BR-022), para evitar bloqueos y overselling.
- **MF-011 (multi-vendedor) — ✅ DECIDIDO (DEC-026):** el carrito **puede** contener
  ítems de **varios vendedores**, pero **1 orden = 1 vendedor**: al hacer checkout,
  el carrito **se divide en múltiples órdenes** (una por vendedor), cada una con su
  **propio split/pago** (cuenta MP del vendedor). Esto reemplaza el "DECISION
  REQUIRED" previo.
- **MF-012:** al llegar a checkout se **revalida** disponibilidad y precio; si la
  última unidad se vendió, se informa "agotado" y no se cobra (UC-BR-2).

> 🟡 **PENDIENTE (Bloque 7):** **reserva de stock** y su **tiempo**, comportamiento
> ante **producto agotado**, **cambio de precio** entre carrito y checkout, y
> **publicación eliminada** mientras está en el carrito. Además, para la **orden**:
> reglas de **cancelación** (quién y cuándo), **vendedor que no envía**,
> **comprador que no paga**, e **historial**. Varios de estos serán ⚙️ configurables.

### 4.3 Checkout → pago → split

- **MF-020:** el checkout inicia el pago vía Mercado Pago (Checkout Pro o Checkout
  API — `payments-and-commissions.md`).
- **MF-021 (🌐):** MP procesa el pago del comprador y, mediante **Split 1:1**,
  divide el importe entre el **vendedor** (su cuenta MP conectada por OAuth) y
  **OFFSIDE** (comisión vía `marketplace_fee`/`application_fee`).
- **MF-022:** la **orden se crea/confirma** cuando el pago queda **aprobado**
  (estado de pago `approved`). Pagos `pending`/`in_process` mantienen la orden en
  estado provisorio; `rejected`/`cancelled` no crean obligación de envío.
- **MF-023 (🌐):** OFFSIDE se entera del resultado del pago por **webhooks** de MP
  (no confía sólo en el redirect del navegador). Ver payments doc.

### 4.4 Orden → vendedor → envío

- **MF-030:** con pago aprobado, se notifica al vendedor y comienza a correr su
  **plazo de despacho** (BR-032).
- **MF-031:** el vendedor genera el envío por **Correo Argentino** (etiqueta +
  tracking) a través del servicio abstraído (`shipping.md`).
- **MF-032:** el estado de envío se refleja en la orden: `despacho → tránsito →
  entrega` (y estados de problema).

### 4.5 Entrega → cierre → reputación

- **MF-040:** la orden pasa a **completada** con la entrega confirmada o al vencer
  la ventana de protección sin reclamo (BR-033).
- **MF-041:** completada la orden, comprador y vendedor pueden **calificarse**;
  las señales alimentan la reputación (`trust-and-safety.md`).

### 4.6 Camino de conflicto

- **MF-050:** dentro de la ventana de protección, el comprador puede abrir un
  **reclamo** (`trust-and-safety.md`). La orden pasa a un estado de disputa.
- **MF-051:** la resolución puede derivar en **refund total/parcial**, ejecutado
  con la mecánica proporcional de MP y el manejo del riesgo de vendedor sin
  fondos (`orders-and-refunds.md`).
- **MF-052:** todo se **concilia**: pagos, comisiones, refunds y estados
  (`orders-and-refunds.md`).

## 5. Anatomía de la Orden

La **Orden** es la entidad central que une todo. Debe registrar al menos:

| Campo | Descripción |
|-------|-------------|
| id | Identificador de la orden. |
| comprador | Referencia al comprador. |
| vendedor | Referencia al vendedor (1 vendedor por orden — ver MF-011). |
| ítems | Publicación(es), cantidad, precio unitario al momento de compra. |
| importe_producto | Subtotal de productos. |
| importe_envío | Costo de envío (Correo Argentino). |
| importe_total | Lo que pagó el comprador. |
| comisión_offside | Monto de comisión de OFFSIDE (split). |
| comisión_mp | 🌐 Comisión de MP (a registrar según lo que exponga MP). |
| pago | Referencia al pago MP (id, estado, medio). |
| split | Detalle de la división (parte vendedor / parte OFFSIDE). |
| envío | Referencia al envío (tracking, estado). |
| estado_orden | Ver 6. |
| disputa | Referencia a disputa si existe. |
| refunds | Lista de refunds (total/parciales) aplicados. |
| timestamps | Creación, pago, despacho, entrega, cierre. |
| auditoría | Log de cambios de estado y decisiones. |

## 6. Estados de la Orden — ✅ DECIDIDO (DEC-029, cierre Fase 1)

Conjunto **técnico inicial definitivo**:

```
PENDING_PAYMENT → PAID → PROCESSING → SHIPPED → DELIVERED → COMPLETED
                                                              ↘ CANCELLED
```

| Estado | Significado |
|--------|-------------|
| `PENDING_PAYMENT` | Orden creada; pago aún no validado por el backend. |
| `PAID` | Backend recibió y **validó** el pago aprobado en MP (DEC-028); split ejecutado; stock descontado. |
| `PROCESSING` | Pago confirmado; corre el plazo de despacho del vendedor. |
| `SHIPPED` | Despachado; hay tracking. |
| `DELIVERED` | Entregado (según tracking Correo Argentino). |
| `COMPLETED` | Cerrada; habilita reputación definitiva. |
| `CANCELLED` | Cancelada. |

Las **reglas de transición** (plazo de pago, cancelación, despacho, confirmación,
acciones automáticas, notificaciones) se diseñan para ser **configurables a
futuro** desde Admin, pero **no** se construye ahora un motor complejo (DEC-032).

> **Ciclos de vida separados — ✅ RESUELTO (DEC-034, cierre I-2).** La `Order`
> representa **exclusivamente** el ciclo logístico (los 7 estados de arriba). El
> ciclo **financiero** vive en `Payment` (`PENDING/IN_PROCESS/APPROVED/REJECTED/
> CANCELLED/REFUNDED/PARTIALLY_REFUNDED/CHARGED_BACK`, DEC-028/035) y los reclamos
> en `Dispute` (`OPEN…RESOLVED`) y `Refund` (DEC-031). **No se mezclan.** Ejemplo
> válido: Order `COMPLETED` + Payment `PARTIALLY_REFUNDED` + Dispute relacionada.
> Se relacionan por **referencia**, no por estado compartido.
>
> *(Naming previo: `CREATED`→`PENDING_PAYMENT`, `AWAITING_SHIPMENT`→`PROCESSING`.
> El ERD aún tiene el enum viejo — ver `open-decisions-impact.md` D5.)*

### 6.1 Pago rechazado y ventana de pago — ✅ RESUELTO (DEC-033, cierre I-1)

Un `Payment REJECTED` **no cancela** la Order. Si la Order está en `PENDING_PAYMENT`
y un intento resulta `REJECTED`, la Order **permanece `PENDING_PAYMENT`** y el
comprador **puede reintentar** mientras siga dentro de la **ventana de pago**
(⚙️ configurable, valor 🟡). La Order pasa a `CANCELLED` **sólo** cuando:

- vence la **ventana de pago**;
- el **comprador** cancela;
- un **administrador** la cancela;
- o una **regla de negocio posterior** determina su cancelación.

🟡 **PENDIENTE (valor):** duración de la ventana de pago y demás plazos de
transición (se resolverán como configuración, DEC-029/DEC-038).

## 7. Casos de uso (caminos)

- **UC-MF-1 (happy path):** búsqueda → compra → pago aprobado → split → orden
  PAID → vendedor despacha → SHIPPED → DELIVERED → COMPLETED → calificaciones.
- **UC-MF-2 (pago rechazado):** checkout → `Payment REJECTED` → la orden
  **permanece `PENDING_PAYMENT`** (DEC-033); no se descuenta stock; se invita a
  reintentar dentro de la ventana de pago.
- **UC-MF-3 (sin stock en checkout):** última unidad vendida antes de pagar →
  revalidación falla → no se cobra.
- **UC-MF-4 (no recibido):** `PAID → PROCESSING` → vendedor no despacha → comprador
  abre reclamo (`Dispute OPEN`) → resolución → `Refund` (estados DEC-031) +
  penalización *(reglas de disputa/refund PENDIENTES, DEC-031)*.
- **UC-MF-5 (falsificación):** `DELIVERED` → reclamo `falsificado` (`Dispute`) →
  resolución con refund + sanción → refund con la mecánica de MP *(detalle
  PENDIENTE)*.

## 8. MVP — Definición del flujo a probar

✅ **DECISIÓN:** el primer MVP tendrá **~100 camisetas propias** distribuidas
entre **múltiples vendedores ficticios/controlados** para **simular un
marketplace real**.

- **MVP-1:** el objetivo **no** es sólo probar el catálogo, sino ejercitar el
  **flujo completo**:
  `usuario → búsqueda → publicación → compra → checkout → Mercado Pago → Split →
  orden → vendedor → envío → tracking → entrega → reputación → reclamo → refund`.
- **MVP-2:** los "vendedores ficticios/controlados" son cuentas reales de
  vendedor (con MP conectado en entorno de pruebas 🌐) operadas por el equipo,
  para que el split, los webhooks, los envíos y las disputas se ejerciten de
  verdad.
- **MVP-3:** debe poder recorrerse al menos un caso de cada rama: happy path,
  pago rechazado, disputa con refund total, disputa con refund parcial.
- 🔴 **DECISION REQUIRED:** si el MVP usa el entorno **sandbox/test** de MP y de
  Correo Argentino o producción con montos reales. 💡 Recomendación: sandbox/test
  primero. (Ligado a payments/shipping docs.)

## 9. Dependencias

- Interna: `payments-and-commissions.md`, `orders-and-refunds.md`, `shipping.md`,
  `trust-and-safety.md`, `product-specification.md`, `buyer-system.md`,
  `seller-system.md`.
- 🌐 Externas: Mercado Pago (pago, split, webhooks), Correo Argentino (envío,
  tracking).

## 10. Decisiones tomadas

- ✅ Flujo canónico end-to-end.
- ✅ Stock se descuenta al pago aprobado.
- ✅ Orden como entidad central que une pago, split, envío, disputa y refunds.
- ✅ MVP: ~100 camisetas, vendedores controlados, flujo completo (no sólo
  catálogo).

## 11. Decisiones pendientes (DECISION REQUIRED)

- 🔴 Carrito multi-vendedor vs 1 orden = 1 vendedor (MF-011).
- 🔴 Política de cancelación de órdenes.
- 🔴 MVP en sandbox/test vs producción.

## 12. Riesgos

- **Overselling** si el descuento de stock no es atómico en el pago.
- **Complejidad del split multi-vendedor** si se permite carrito mixto.
- **Confianza en el redirect** en lugar de webhooks → estados de orden
  inconsistentes (ver payments doc).
