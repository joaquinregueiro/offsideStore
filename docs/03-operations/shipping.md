# Shipping — OFFSIDE STORE

> ⚠️ **No se inventan endpoints de Correo Argentino.** Toda integración con
> Correo Argentino se describe a nivel de **requisitos y capacidades esperadas**,
> y queda **abstraída detrás de un servicio interno** (`ShippingService`). Los
> detalles reales (endpoints, campos, autenticación, formatos de etiqueta y de
> tracking) son 🌐 **DEPENDENCIA EXTERNA — a verificar contra la documentación
> oficial de Correo Argentino.**

## 1. Propósito

Definir cómo OFFSIDE gestiona el **envío** de las órdenes a través de **Correo
Argentino**: creación del envío, etiqueta, tracking, estados, y manejo de
problemas de entrega — todo detrás de una capa de abstracción que aísle a la
plataforma de la API concreta del correo.

## 2. Alcance

Incluye: el modelo de envío, el ciclo de estados, la abstracción del servicio de
shipping, y su relación con las órdenes y disputas. No incluye la mecánica de
pago (`payments`) ni de disputas (`trust-and-safety`), sólo su interacción.

## 3. Conceptos principales

### 3.1 Correo Argentino como proveedor

✅ **DECISIÓN (DEC-006, 🟡 estado):** la plataforma se integrará con **Correo
Argentino** como proveedor de logística del MVP. Está tomada la dirección
(Correo Argentino), pero los detalles de integración y su alcance exacto son 🟡 /
🌐 y deben confirmarse.

### 3.2 Abstracción: `ShippingService`

> 💡 **RECOMENDACIÓN / DECISIÓN de diseño:** todas las integraciones externas de
> logística se ocultan detrás de una interfaz interna `ShippingService` con
> operaciones **agnósticas del proveedor**. Esto permite:
> - no acoplar el dominio a Correo Argentino,
> - poder sumar otros couriers en el futuro sin reescribir el negocio,
> - testear con un proveedor "fake" en el MVP.

Operaciones esperadas de la interfaz (nombres internos, **no** de Correo
Argentino):

| Operación (interna) | Qué hace | Depende de 🌐 |
|---------------------|----------|---------------|
| `quote(origen, destino, paquete)` | Cotiza el costo/plazo de envío. | Sí |
| `createShipment(orden, datos)` | Crea el envío y devuelve id + etiqueta. | Sí |
| `getLabel(envío)` | Obtiene la etiqueta imprimible. | Sí |
| `getTracking(envío)` | Obtiene estado y tracking histórico. | Sí |
| `handleWebhook(evento)` | Recibe actualizaciones de estado (si el correo las provee). | Sí (🌐 verificar si hay webhooks/polling) |

🌐 **VERIFY:** si Correo Argentino ofrece **webhooks** de actualización o si hay
que hacer **polling** del tracking; el mecanismo real determina cómo se
actualizan los estados. No inventar.

## 4. Modelo de datos del envío

| Campo | Descripción |
|-------|-------------|
| id | Id interno del envío. |
| orden | Orden asociada. |
| origen | Dirección/localidad de despacho (vendedor). |
| destino | Dirección de entrega (comprador). |
| paquete | Peso/dimensiones declaradas. |
| costo | Costo del envío (de `quote`). |
| proveedor | "correo_argentino" (extensible). |
| tracking_number | Número de seguimiento (🌐 provisto por el correo). |
| etiqueta | Referencia a la etiqueta imprimible. |
| estado | Ver sección 5. |
| tracking_historico | Lista de eventos (estado, fecha, descripción). |
| timestamps | Creación, despacho, entrega. |

## 5. Estados del envío

El sistema define un **conjunto de estados internos normalizados**, y **mapea** a
ellos los estados reales que informe Correo Argentino (🌐 — no se asumen los
nombres del correo):

```
CREATED (envío creado, etiqueta generada)
  → DISPATCHED (despachado / admitido por el correo)
    → IN_TRANSIT (en tránsito)
      → DELIVERED (entregado)

Ramas de problema:
  → DELIVERY_ISSUE (problema de entrega: ausente, dirección incorrecta, etc.)
  → RETURNED (devuelto al remitente)
```

| Estado interno | Significado | Efecto en la orden |
|----------------|-------------|--------------------|
| `CREATED` | Envío y etiqueta generados; aún no despachado. | Orden `PROCESSING`. |
| `DISPATCHED` | El vendedor despachó / el correo admitió. | Orden `SHIPPED`. |
| `IN_TRANSIT` | En movimiento. | Orden `SHIPPED`. |
| `DELIVERED` | Entregado. | Orden `DELIVERED` → habilita cierre. |
| `DELIVERY_ISSUE` | Problema de entrega. | Puede habilitar reclamo / reintento. |
| `RETURNED` | Devuelto al vendedor. | Puede derivar en refund/disputa. |

- **SH-001:** cada cambio de estado se agrega al **tracking histórico** con
  timestamp y descripción, y es visible para comprador (`buyer-system.md` BS-090)
  y vendedor.
- **SH-002:** el estado `DELIVERED` (según el correo) es evidencia clave en
  disputas de "producto no recibido" (`trust-and-safety.md` UC-TS-2).
- **SH-003 (🌐 VERIFY):** el mapeo exacto de los estados de Correo Argentino a los
  estados internos se define al conocer su API real. Aquí se fija el **conjunto
  destino**; el mapeo es dependencia externa.

## 5.b Costos de envío — 🟡 PENDIENTE (Bloque 8)

Quedan por definir (varios serán ⚙️ configurables): **quién paga** el envío
(comprador/vendedor), **envío incluido** en el precio, **envío gratis**,
**subsidio** de Offside, **retiro presencial**, y la incorporación de **otras
empresas** de logística a futuro. **No** se fijan valores todavía. Ver
`configuration-registry.md`.

> 🔵 **PENDIENTE (Bloque 8 — Correo Argentino):** API, credenciales, crear envío,
> etiqueta, tracking, estados, webhooks/polling, y manejo de **errores, pérdida,
> demora, dirección incorrecta y rechazo**. **No inventar** endpoints; investigar
> la documentación oficial. Se mantiene la abstracción `ShippingService`.

## 6. Reglas

- **SH-010:** el envío se crea desde la orden en `PROCESSING` (tras pago validado,
  DEC-029). El vendedor obtiene la **etiqueta** y despacha dentro del plazo
  (BR-032).
- **SH-011:** el **costo de envío** (`quote`) se calcula en checkout
  (`buyer-system.md` BS-070) y se persiste en la orden (`importe_envío`).
- **SH-012:** el tracking se muestra **abstraído** (estados internos + histórico),
  sin exponer la API cruda del correo.
- **SH-013:** problemas de entrega (`DELIVERY_ISSUE`, `RETURNED`) se comunican a
  ambas partes y pueden habilitar reclamo/refund según `orders-and-refunds.md`.
- **SH-014 (🔴 DECISION REQUIRED):** ¿quién paga el envío de **devolución** en
  `RETURN_REQUIRED`? (comprador, vendedor, OFFSIDE). Impacta disputas y costos.
- **SH-015 (🔴):** cobertura geográfica del MVP (¿todo el país?, ¿sólo ciertas
  zonas?) y modalidades (a domicilio, a sucursal) — 🌐 según Correo Argentino.

## 7. Casos de uso

- **UC-SH-1:** orden PAID → vendedor crea envío (`createShipment`) → imprime
  etiqueta → despacha → `DISPATCHED` → `IN_TRANSIT` → `DELIVERED` → orden avanza a
  DELIVERED.
- **UC-SH-2 (no recibido):** tracking se detiene / nunca `DELIVERED` → comprador
  reclama → el tracking histórico es la evidencia central.
- **UC-SH-3 (problema de entrega):** `DELIVERY_ISSUE` (comprador ausente) →
  reintento o `RETURNED` → posible refund/disputa.

## 8. Dependencias

- 🌐 **Correo Argentino:** cotización, creación de envío, etiqueta, tracking,
  estados, webhooks/polling, cobertura, modalidades. **Verificar todo; no
  inventar endpoints.**
- Interna: `marketplace-flow.md` (estados de orden), `buyer-system.md` (tracking,
  costo en checkout), `seller-system.md` (despacho), `trust-and-safety.md`
  (tracking como evidencia), `orders-and-refunds.md` (devoluciones),
  `04-technical/architecture.md` (abstracción `ShippingService`).

## 9. Decisiones tomadas

- ✅ Integración con Correo Argentino (dirección tomada; detalles 🟡/🌐).
- ✅ Abstracción `ShippingService` agnóstica del proveedor (integraciones
  externas detrás de servicios).
- ✅ Conjunto de estados internos normalizados de envío y su mapeo (mapeo fino a
  verificar).
- ✅ Tracking histórico visible y usable como evidencia en disputas.

## 10. Decisiones pendientes (DECISION REQUIRED)

- 🔴 Detalles reales de integración con Correo Argentino (🌐 API, webhooks vs
  polling, formatos).
- 🔴 Quién paga el envío de devolución (SH-014).
- 🔴 Cobertura geográfica y modalidades del MVP (SH-015).
- 🔴 MVP con envíos reales vs simulados (ligado al MVP en sandbox/test).

## 11. Riesgos

- **Dependencia externa:** cambios o límites de la API de Correo Argentino.
- **Evidencia de entrega:** si el tracking no es confiable/actualizado, las
  disputas de "no recibido" se vuelven difíciles de resolver.
- **Costos de devolución** no definidos → fricción y pérdidas.
- **Acoplamiento:** si no se respeta la abstracción, sumar otro courier costará
  reescritura.
