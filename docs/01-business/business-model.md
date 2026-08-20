# Business Model — OFFSIDE STORE

## 1. Propósito

Definir **qué es** OFFSIDE STORE como negocio, **cómo genera ingresos**, cuáles
son sus **unit economics** y qué variables condicionan su rentabilidad. Este
documento es la base económica sobre la que se apoyan las decisiones de comisión,
refunds y fiscalidad.

## 2. Alcance

Incluye: propuesta de valor, actores del marketplace, modelo de monetización,
estructura de costos, unit economics de una venta, y las palancas de negocio.

No incluye: la mecánica técnica de Mercado Pago (ver
`03-operations/payments-and-commissions.md`), ni las reglas operativas de
refunds (ver `03-operations/orders-and-refunds.md`).

## 3. Conceptos principales

### 3.1 Qué es OFFSIDE STORE

Un **marketplace vertical especializado en fútbol**. Conecta a compradores
(fanáticos y coleccionistas) con vendedores (particulares, revendedores, tiendas
pequeñas) de camisetas e indumentaria de fútbol.

Analogía útil: **un Mercado Libre verticalizado**, pero el objetivo **no** es
competir por volumen de catálogo, sino ser **el mejor** marketplace especializado
para el nicho del fútbol.

### 3.2 Qué NO es (en el MVP)

- **No es dueño del stock** de terceros. ✅ **DECISIÓN (DEC-002)**: OFFSIDE STORE
  es **intermediario/marketplace**, no revendedor ni propietario de los productos
  publicados por terceros.
- No es una tienda propia. (Matiz: en el MVP existen ~100 camisetas "propias"
  cargadas a través de vendedores controlados **para simular** el marketplace;
  esto es un artificio de bootstrapping, no un cambio de modelo — ver
  `02-product/marketplace-flow.md`, sección MVP).
- No es un servicio de autenticación físico (no recibe ni inspecciona la prenda
  antes de la venta en el MVP; ver `trust-and-safety.md`).

### 3.3 Rol del marketplace

OFFSIDE STORE facilita, sobre la transacción entre dos terceros:

- publicación de productos con estructura especializada,
- búsqueda y filtros especializados,
- checkout y pago (vía Mercado Pago),
- creación y seguimiento de la orden,
- envío (vía Correo Argentino),
- reputación y confianza,
- resolución de conflictos (disputas y refunds).

## 4. Actores

| Actor | Descripción | Qué obtiene |
|-------|-------------|-------------|
| **Comprador** | Fanático/coleccionista que busca y compra. | Catálogo especializado, filtros, confianza, protección al comprador. |
| **Vendedor** | Particular, revendedor o tienda pequeña. | Acceso a demanda calificada, cobro vía su propia cuenta MP, reputación. |
| **OFFSIDE STORE (plataforma)** | Intermediario. | Comisión por venta. |
| **Mercado Pago** | 🌐 Procesador de pagos + split. | Comisión de procesamiento. |
| **Correo Argentino** | 🌐 Logística. | Tarifa de envío. |
| **Admin/Operaciones** | Equipo interno de OFFSIDE. | Gestiona disputas, sanciones, autenticidad, métricas. |
| **Fisco (AFIP/ARCA)** | 🌐 Autoridad tributaria. | Impuestos, retenciones, percepciones. |

## 5. Modelo de monetización

> **Actualizado 2026-08-19** con las decisiones del owner (DEC-014 a DEC-018).
> Reemplaza lo que antes quedaba abierto sobre base de cálculo y absorción de la
> comisión de MP.

### 5.1 Fuente de ingreso principal

✅ **DECIDIDO (DEC-003)**: **comisión sobre cada venta** (take rate), a cargo del
**vendedor**.

⚙️/🟡 **(DEC-007)**: el **porcentaje** exacto **todavía no está definido** y **no es
bloqueante** en esta etapa. Debe ser **configurable desde Admin** (sin cambiar
código). El histórico "~10%" queda sólo como referencia, **no** como decisión.

### 5.2 Reglas de cálculo de la comisión — ✅ DECIDIDO (DEC-014)

| Regla | Decisión |
|-------|----------|
| **Base de cálculo** | Sobre el **TOTAL cobrado al comprador**. |
| **Precio final** | Se calcula sobre el **precio final efectivamente cobrado** (con descuentos aplicados, DEC-017). |
| **IVA** | La comisión de Offside se considera **IVA incluido**. |
| **Mínimo / máximo** | **No** hay mínimo ni máximo de comisión. |
| **Por categoría de producto** | **No** hay comisiones distintas según categoría de producto. |
| **Costo de Mercado Pago** | Lo **absorbe Offside**, contemplado **dentro** de su comisión. |

> **Contradicción resuelta:** versiones previas de este documento y de
> `payments-and-commissions.md` dejaban la **base** y **quién absorbe la comisión
> de MP** como decisiones abiertas (🔴). **Se prioriza DEC-014**: base = total
> cobrado; MP lo absorbe Offside. El unit economics de §7 debe leerse con esta
> base.

### 5.2.b Cómo se cobra técnicamente

🌐/🔵 La comisión se aplica en el **Split de Mercado Pago** (`marketplace_fee` /
`application_fee` según el checkout). El detalle técnico y **qué checkout se usa**
sigue a investigar (`payments-and-commissions.md`).

### 5.2.c `SELLER_TIER` y comisión — ✅ estructura / 🟡 valores (DEC-015 → DEC-037)

El sistema **debe permitir** distintos **`SELLER_TIER`** (categoría comercial del
vendedor) con **comisiones distintas** (y eventualmente límites/beneficios/
condiciones), configurables sin tocar código (Config Store, DEC-038). **`SELLER_TIER`
es distinto del USER LEVEL** (trayectoria/confianza) — ver `seller-system.md`
(I-5/DEC-037). **No** hay comisión promocional para vendedores nuevos. Los valores
definitivos de `SELLER_TIER` quedan 🟡 (no se asumen).

### 5.2.d Cuotas y descuentos — ✅ / 🔵 (DEC-016, DEC-017)

- **Cuotas:** si el vendedor **ofrece cuotas**, el **costo lo absorbe el
  vendedor**; si **no** ofrece, el costo correspondiente lo absorbe el **comprador**
  según la modalidad. 🔵 mecánica exacta de MP a investigar.
- **Descuentos:** descuento del **vendedor** → costo del **vendedor**;
  descuento/beneficio **propio de Offside** → costo de **Offside** según campaña.

### 5.2.e Snapshot financiero e inmutabilidad histórica — ✅ DECIDIDO (DEC-030)

Cada transacción **guarda un snapshot financiero** (`order_total`,
`commission_rate`, `commission_amount`, `mp_fee`, `seller_amount`, `offside_amount`,
`discount_amount`, `shipping_amount`). Reglas:

- La **tasa de Mercado Pago no se hardcodea**; puede cambiar sin afectar
  operaciones históricas.
- La **comisión histórica nunca se recalcula** con configuración futura.
- El **tratamiento fiscal** definitivo queda 🔴 **PENDIENTE** (DEC-011).

Detalle en `payments-and-commissions.md` §7.b.

### 5.3 Fuentes de ingreso secundarias (futuras, NO en MVP)

💡 **RECOMENDACIÓN** — listadas como hipótesis para roadmap, ninguna decidida:

- Publicaciones destacadas / posicionamiento pago.
- Suscripción para vendedores profesionales (menor comisión + herramientas).
- Servicio de autenticación premium (verificación física).
- Comisión diferencial por categoría o por nivel de vendedor.
- Publicidad de marcas.

### 5.3 Fuentes de ingreso secundarias (futuras, NO en MVP)

💡 **RECOMENDACIÓN** — listadas como hipótesis para roadmap, ninguna decidida:

- Publicaciones destacadas / posicionamiento pago.
- Suscripción para vendedores profesionales (menor comisión + herramientas).
- Servicio de autenticación premium (verificación física).
- Comisión diferencial por categoría o por nivel de vendedor.
- Publicidad de marcas.

Ninguna se implementa en el MVP. Se registran en `OPEN-QUESTIONS.md`.

## 6. Estructura de costos

| Costo | Naturaleza | Notas |
|-------|-----------|-------|
| Comisión de Mercado Pago | Variable por transacción 🌐 | Depende del medio de pago, cuotas, plazo de acreditación. **A verificar contra la documentación/tarifario oficial de MP.** |
| Costos de infraestructura | Semi-fijo | Hosting, base de datos, almacenamiento de imágenes, CDN. |
| Operaciones / soporte / disputas | Variable con volumen | Equipo que resuelve disputas y revisa autenticidad. |
| Pérdidas por refunds no recuperables | Riesgo variable | **Central** en este modelo — ver sección 7.4 y `RISKS.md`. |
| Chargebacks | Riesgo variable 🌐 | Comportamiento y responsabilidad dependen de MP. |
| Impuestos / retenciones | Variable 🌐 | Depende del modelo fiscal (DEC-011). |
| Costos legales y de cumplimiento | Fijo/variable | Términos, protección de datos, defensa del consumidor. |

## 7. Unit economics de una venta

> ⚠️ Las cifras siguientes son un **modelo ilustrativo con variables**, NO
> números confirmados. Sirven para mostrar **qué** hay que calcular, no para
> afirmar cuánto gana OFFSIDE. Los valores reales dependen de 🌐 dependencias
> externas (MP, fisco).

### 7.1 Variables

| Símbolo | Significado |
|---------|-------------|
| `P` | Precio del producto publicado (lo que paga el comprador por la prenda). |
| `E` | Costo de envío (Correo Argentino). |
| `c_off` | Tasa de comisión de OFFSIDE (🟡 ~10%). |
| `c_mp` | Tasa de comisión de Mercado Pago (🌐 variable, a verificar). |
| `B` | **Base de cálculo** = **TOTAL cobrado al comprador** (✅ DEC-014). Incluye lo que efectivamente paga el comprador (precio final con descuentos; el tratamiento del envío en la base se detalla en `payments-and-commissions.md`). |

### 7.2 Ingreso bruto de OFFSIDE por venta

```
ingreso_bruto_offside = c_off * B
```

### 7.3 Ingreso neto de OFFSIDE por venta (aproximación)

```
ingreso_neto_offside ≈ (c_off * B) − costos_atribuibles
```

donde `costos_atribuibles` incluye la **comisión de MP** (✅ DEC-014: **la absorbe
OFFSIDE**, dentro de su comisión), soporte prorrateado, y una **provisión por
riesgo de refund**.

✅ **RESUELTO (DEC-014) — Absorción de la comisión de Mercado Pago.** La comisión de
MP la **absorbe OFFSIDE** (contemplada dentro de su comisión). Esto reemplaza el
"DECISION REQUIRED" anterior. Consecuencia directa: como el porcentaje de OFFSIDE
(DEC-007) todavía no está fijado, el **ingreso neto** depende de que ese % cubra la
comisión de MP + provisión por refunds + costos. 🔵 Sigue pendiente **investigar el
valor real de la comisión de MP** (varía por medio de pago/cuotas/plazo) para
calibrar el %.

### 7.4 El costo oculto: refunds no recuperables

En Split 1:1, cuando hay un refund, 🌐 **Mercado Pago distribuye proporcionalmente
el importe del refund entre vendedor y marketplace**. Es decir, OFFSIDE puede
tener que **devolver su parte de la comisión**. Y hay un riesgo peor:

> **Si el vendedor no tiene fondos suficientes** para cubrir su parte del
> reembolso, OFFSIDE **no puede asumir automáticamente** que recuperará ese
> dinero.

Esto significa que el modelo económico **debe incluir una provisión por pérdida
esperada por refunds**. No es un caso borde: es una variable estructural del
negocio. Ver `03-operations/orders-and-refunds.md` y `RISKS.md`.

### 7.5 Punto de equilibrio (qué calcular, no un número)

El negocio es rentable cuando, a nivel agregado:

```
Σ (comisiones netas cobradas) > Σ (costos fijos + costos variables + pérdidas por refunds + chargebacks + impuestos)
```

La comisión (`c_off`) debe fijarse de modo que **después** de la comisión de MP,
de impuestos y de la provisión por refunds, quede margen positivo y competitivo
frente al comprador/vendedor. Por eso DEC-007 no puede cerrarse sin el análisis
completo.

## 8. Reglas de negocio (económicas)

1. OFFSIDE no toma posesión del dinero de la venta completa: el split lo dirige
   MP. (🌐 sujeto a cómo opere el split — ver payments doc.)
2. La comisión se cobra **por venta efectivamente concretada** (no por
   publicación). MVP: sin costo de publicación.
3. Ante un refund, OFFSIDE **puede** tener que devolver su comisión
   proporcional. La política exacta es 🟡 (DEC-008).
4. Ningún cobro adicional al comprador por usar la plataforma en el MVP (el
   comprador paga producto + envío; la comisión la soporta el vendedor). 🟡 a
   confirmar (salvo el costo de cuotas cuando el vendedor no las ofrece, DEC-016).
5. La base de cálculo de la comisión es **única y explícita**: el **TOTAL cobrado
   al comprador** (✅ DEC-014). Debe versionarse el % aplicado por orden.
6. **Comisión sobre refund parcial:** la comisión asociada al importe reembolsado
   la **absorbe OFFSIDE**, y esta política es **⚙️ configurable** desde Admin
   (DEC-018). Ver `orders-and-refunds.md`.
7. **Impuestos:** 🔴 **REQUIERE ASESORAMIENTO PROFESIONAL** (DEC-011). Offside aún
   no tiene estructura jurídica ni régimen fiscal definidos; **no se modela nada
   fiscal**. Debe resolverse con contador antes del lanzamiento comercial. Ver
   `01-business/legal.md`.

## 9. Estados (del punto de vista de negocio)

Una venta atraviesa, económicamente: `pendiente_de_pago → pagada (split
ejecutado) → en_cumplimiento (envío) → completada → [posible disputa] →
[posible refund total/parcial] → conciliada`. El detalle de estados de pago y de
orden está en los documentos de operaciones.

## 10. Dependencias

- 🌐 **Mercado Pago**: comisión, split, plazos de acreditación, reparto de
  comisión, refunds proporcionales. **Todo a verificar contra doc. oficial.**
- 🌐 **AFIP/ARCA (fisco)**: impuestos, retenciones, facturación (DEC-011).
- 🌐 **Correo Argentino**: costo de envío que entra en la ecuación si la base
  incluye envío.
- Interna: `trust-and-safety.md` (fraude afecta pérdidas), `orders-and-refunds.md`
  (provisión por refunds).

## 11. Decisiones tomadas

- ✅ DEC-002: modelo marketplace intermediario, no propietario del stock.
- ✅ DEC-003: monetización por comisión sobre la venta.
- ✅ DEC-014: reglas de cálculo de comisión (base = total cobrado; IVA incluido;
  sin min/máx; sin diferenciación por categoría; MP lo absorbe Offside).
- ✅ DEC-015 (estructura): tipos de vendedor con comisión configurable.
- ✅ DEC-016/017: absorción de costos de cuotas y descuentos.
- ⚙️ DEC-007: el % de comisión es configurable desde Admin (valor 🟡).
- ⚙️ DEC-018: comisión sobre refund parcial la absorbe Offside (configurable).

## 12. Decisiones pendientes

- ⚙️/🟡 **DEC-007** — Valor del % de comisión (no bloqueante; configurable).
- 🟡 **DEC-015** — Categorías definitivas de tipo de vendedor y sus %.
- 🔵 **Comisión real de Mercado Pago** — investigar su valor (por medio de pago/
  cuotas/plazo) para calibrar el %.
- 🔵 **DEC-016** — Mecánica exacta de cuotas en MP.
- 🟡 **¿El comprador paga algún fee?** (hipótesis: no, salvo cuotas si el vendedor
  no las ofrece).
- 🟡 **Provisión por pérdida esperada por refunds** (cómo se dimensiona/contabiliza).
- 🔴 **DEC-011 (fiscal/impuestos)** — requiere contador; no se modela.
- 🟡 **Registro contable** de la comisión — no definido; no inventar solución.

## 13. Riesgos (resumen; detalle en RISKS.md)

- **Financiero:** comisión mal calibrada → margen negativo tras MP + impuestos +
  refunds.
- **Financiero/fraude:** refunds no recuperables de vendedores sin fondos.
- **Comercial:** take rate demasiado alto → vendedores no publican; demasiado
  bajo → no hay negocio.
- **Regulatorio:** cambios fiscales o de MP que alteren los unit economics.
