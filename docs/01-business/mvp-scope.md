# MVP Scope — OFFSIDE STORE

> Fuente de verdad del **alcance**. Registra qué entra en el MVP, qué queda
> **fuera del MVP** y qué es **escalabilidad futura**. Decisión DEC-024.
> Actualizado 2026-08-19.

## 1. Propósito

Evitar scope creep: dejar explícito qué se construye ahora y qué no, para que
ninguna decisión posterior "arrastre" features no acordadas.

## 2. Dentro del MVP (resumen)

El MVP ejercita el **flujo completo** (no sólo el catálogo):
`usuario → búsqueda → publicación → compra → checkout → Mercado Pago → Split →
orden → vendedor → envío → tracking → entrega → reputación → reclamo → refund`
(ver `02-product/marketplace-flow.md`). Incluye compradores, vendedores y un
back-office de administración (ver `buyer-system.md`, `seller-system.md`,
`04-technical/architecture.md`). Simulación con ~100 camisetas y vendedores
controlados.

## 3. Fuera del MVP — ✅ DECIDIDO (Bloque 20)

Quedan **explícitamente fuera** del MVP:

- App móvil.
- IA (clasificación, autenticidad, etc.).
- Chat avanzado.
- Motor de búsqueda externo (Elastic/Meili/Typesense) — la búsqueda del MVP es
  PostgreSQL.
- Multi-vendedor complejo (más allá de "carrito se divide en órdenes", DEC-026).
- Suscripciones.
- Publicidad.
- Autenticación física avanzada.
- Internacionalización (i18n).
- Multi-moneda.
- Gamificación.

## 4. Escalabilidad futura (post-MVP) — Bloque 19

Se mantienen como **futuro** (no ahora, pero el diseño no debe impedirlos):

- Motor de búsqueda externo (el modelo de datos queda preparado para migrar).
- App mobile.
- Multi-vendedor avanzado.
- Internacionalización / multi-moneda / otros países.
- Otros deportes / otras categorías de indumentaria.
- IA de clasificación y de autenticidad.
- Verificación física de productos.
- Suscripciones y publicidad.
- Sellers profesionales (tipos de vendedor avanzados, DEC-015).

## 5. Dependencias

- `DECISIONS.md` (DEC-024), `marketplace-flow.md` (flujo MVP), `tech-stack.md`
  (búsqueda por fases).

## 6. Decisiones

- ✅ **DEC-024:** alcance del MVP y lista de fuera de alcance.
- 🟡 Criterios de "MVP completo" (qué ramas del flujo son obligatorias) — ver
  `marketplace-flow.md` MVP-3.

## 7. Riesgos

- **Scope creep:** sumar features de la lista "fuera del MVP" retrasa el lanzamiento.
- **Liquidez del marketplace** (oferta/demanda) — ver `RISKS.md` RISK-C1.
