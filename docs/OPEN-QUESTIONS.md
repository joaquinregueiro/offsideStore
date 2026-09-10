# OPEN QUESTIONS — OFFSIDE STORE

Todo lo que **todavía debe definirse**. Cada entrada indica la pregunta, por qué
importa, de qué depende, y a qué documento/decisión pertenece. Las que dependen de
un tercero se marcan 🌐 (verificar contra documentación oficial — **no inventar**).

> **Actualización 2026-08-19.** Varias preguntas se **cerraron o cambiaron de
> naturaleza** con las decisiones DEC-013…DEC-026:
> - **Cerradas (✅):** base de comisión = total cobrado, IVA incluido, sin min/máx,
>   sin diferenciación por categoría, MP lo absorbe Offside (OQ-A1 base / OQ-B1);
>   carrito multi-vendedor → múltiples órdenes (OQ-F6).
> - **Convertidas en ⚙️ configurables:** casi toda la política de refunds (OQ-C1…C7),
>   ranking de búsqueda, límites de publicaciones.
> - **Reclasificadas 🔴 (profesional):** todo el bloque fiscal (OQ-H1).
> - **Nuevas estructuras decididas:** niveles de usuario, estados de riesgo, roles
>   de admin, tipos de vendedor.
>
> El **análisis de impacto** de lo que sigue pendiente vive ahora en
> `04-technical/open-decisions-impact.md` (con prioridades 🔴/🟠/🟡). Lo
> configurable, en `04-technical/configuration-registry.md`. Este archivo se
> mantiene como índice de preguntas; ante conflicto, **prevalece `DECISIONS.md`**.

Categorías:
- **A. Económicas / comisión**
- **B. Pagos / Mercado Pago (🌐)**
- **C. Refunds y riesgo de fondos**
- **D. Disputas y confianza**
- **E. Autenticidad**
- **F. Producto / catálogo**
- **G. Envíos / Correo Argentino (🌐)**
- **H. Fiscal / legal**
- **I. Técnicas / stack**
- **J. MVP**

---

## A. Económicas / comisión

- **OQ-A1 (DEC-007):** ¿Cuál es la **comisión exacta**? ~10% es hipótesis.
  *Importa:* define el negocio. *Depende de:* costo de MP (🌐), fiscal (H),
  provisión por refunds (C).
- **OQ-A2:** ¿Cuál es la **base de cálculo** de la comisión? (`P` producto vs
  `P+E` producto+envío; antes o después de la comisión de MP). *Importa:* cambia
  el ingreso real.
- **OQ-A3:** ¿El **comprador** paga algún fee, o toda la comisión la soporta el
  vendedor? *Hipótesis actual:* sólo el vendedor.
- **OQ-A4:** ¿Cómo se dimensiona y contabiliza la **provisión por pérdida
  esperada por refunds**?

## B. Pagos / Mercado Pago (🌐 verificar)

- **OQ-B1:** ¿**Quién absorbe la comisión de MP** en el Split 1:1 (vendedor,
  OFFSIDE, repartida)? *Importa:* unit economics. 🌐
- **OQ-B2:** Nombre/campo correcto de comisión por tipo de checkout
  (`marketplace_fee` vs `application_fee`) y su semántica. 🌐
- **OQ-B3:** Scopes de OAuth, URLs del flujo, vida útil de access/refresh tokens,
  ¿rota el refresh token en cada uso? 🌐
- **OQ-B4:** ¿Qué información de **KYC/identidad** del vendedor expone MP, y puede
  OFFSIDE apoyarse en ella? 🌐
- **OQ-B5:** Estados de pago exactos de MP y sus transiciones; mecánica de
  **webhooks** (firma/validación, reintentos, idempotencia). 🌐
- **OQ-B6:** ¿MP soporta **claves de idempotencia** en pagos/refunds? 🌐
- **OQ-B7:** Plazos de **acreditación** y liberación de fondos al vendedor;
  ¿existe posibilidad de **hold/retención** por parte del marketplace? 🌐
- **OQ-B8:** ¿**Checkout Pro o Checkout API** para el MVP?

## C. Refunds y riesgo de fondos

- **OQ-C1 (DEC-008):** ¿El **envío** es reembolsable? ¿La **comisión de MP** se
  recupera en un refund? (🌐)
- **OQ-C2:** Reversa de la **comisión de OFFSIDE**: ¿total o proporcional al monto
  reembolsado?
- **OQ-C3:** ¿**OFFSIDE adelanta/garantiza** el refund al comprador aunque no
  pueda recuperar la parte del vendedor? *Importa:* protección al comprador vs
  exposición financiera.
- **OQ-C4:** ¿Qué hace MP cuando la **parte del vendedor no puede debitarse**
  (sin fondos)? ¿Saldo negativo, retención de ventas futuras, refund fallido? 🌐
- **OQ-C5:** ¿Qué **mecanismos de mitigación** se adoptan? (hold de liberación,
  reserva por riesgo, recupero de ventas futuras) — todos 🌐 sujetos a MP.
- **OQ-C6:** En `RETURN_REQUIRED`, ¿el refund se hace **antes o después** de
  recibir la devolución? *Importa:* fraude del comprador.
- **OQ-C7:** ¿Quién paga el **envío de devolución**?

## D. Disputas y confianza

- **OQ-D1 (DEC-009):** **Plazos**: ventana de reclamo del comprador, plazo de
  respuesta del vendedor.
- **OQ-D2:** **Resolución por defecto** si el vendedor no responde (¿a favor del
  comprador?).
- **OQ-D3:** ¿Quién resuelve (rol) y con qué **SLA**?
- **OQ-D4:** **Fórmula de reputación** y **umbrales** de niveles de riesgo
  (BAJO/MEDIO/ALTO/CRÍTICO).
- **OQ-D5:** Mecanismo de **verificación de identidad** propio y su relación con
  el KYC de MP.
- **OQ-D6:** Detección de **reincidencia** (usuarios suspendidos que recrean
  cuenta).

## E. Autenticidad

- **OQ-E1 (DEC-010):** ¿Qué política de autenticidad? (declarada, documental,
  física para alto valor, autenticadores externos, badge "verificado").
- **OQ-E2:** Requisitos adicionales al publicar **retro/vintage** o **alto valor**.
- **OQ-E3:** ¿Cómo se comunica al comprador la diferencia entre "declarada" y
  "verificada" para no generar falsas garantías?

## F. Producto / catálogo

- **OQ-F1:** Matriz fina **"categoría → atributos obligatorios"**.
- **OQ-F2 — parcialmente cerrada (DEC-041, 2026-08-21):** el **mecanismo** de alta
  de catálogos está definido (`catalog_change_requests`, ERD §8.1: propuesta →
  revisión → aprobación/rechazo). **Sigue abierto: quién aprueba**, que depende de
  los permisos granulares por rol de **DEC-023**.
- **OQ-F3:** **Tabla de talles** canónica y su normalización.
- **OQ-F4:** Definición precisa del flag **retro/vintage**.
- **OQ-F5:** **Moneda(s)** soportada(s) (hipótesis: ARS).
- **OQ-F6:** ¿Carrito **multi-vendedor** o **1 orden = 1 vendedor** en el MVP?

## G. Envíos / Correo Argentino (🌐 verificar)

- **OQ-G1 (DEC-006):** Detalles reales de integración (endpoints, autenticación,
  formatos de etiqueta). 🌐
- **OQ-G2:** ¿Correo Argentino ofrece **webhooks** de tracking o hay que hacer
  **polling**? 🌐
- **OQ-G3:** Mapeo de **estados** reales del correo a los estados internos. 🌐
- **OQ-G4:** **Cobertura geográfica** y **modalidades** (domicilio/sucursal) del
  MVP. 🌐

## H. Fiscal / legal

- **OQ-H1 (DEC-011):** **Modelo fiscal**: ¿OFFSIDE factura su comisión?, ¿cómo se
  documenta la venta del vendedor?, IVA/impuestos, retenciones/percepciones
  (🌐 AFIP/ARCA y las que aplique MP).
- **OQ-H2:** Términos y condiciones, política de privacidad y protección de datos.
- **OQ-H3:** Defensa del consumidor: obligaciones legales de un marketplace en
  Argentina (garantías, arrepentimiento, etc.).
- **OQ-H4:** Responsabilidad legal por **falsificaciones** vendidas en la
  plataforma.

## I. Técnicas / stack

- **OQ-I1 (DEC-012):** **Stack**: lenguaje/framework, base de datos, hosting.
- **OQ-I2:** **Motor de búsqueda facetada** (diferencial del producto).
- **OQ-I3:** Storage/CDN de imágenes.
- **OQ-I4:** Monolito modular vs microservicios (💡 recomendación: monolito
  modular MVP).
- **OQ-I5:** Modelo de **roles/permisos** del back-office.

## J. MVP

- **OQ-J1:** ¿MVP contra **sandbox/test** de MP y ShippingService fake, o
  producción con montos/envíos reales? (💡 recomendación: sandbox/test primero).
- **OQ-J2:** Alcance funcional mínimo para considerar el MVP "completo" (qué ramas
  del flujo son obligatorias — ver `marketplace-flow.md` MVP-3).
- **OQ-J3:** Cómo se operan los **vendedores controlados** (cuentas MP de prueba,
  quién los opera).

---

### Prioridad sugerida (💡 recomendación, no decisión)

1. **Bloqueantes del negocio:** OQ-A1/A2, OQ-B1 (comisión y su viabilidad
   económica).
2. **Bloqueantes financieros de riesgo:** OQ-C3/C4/C5 (protección al comprador y
   recupero de fondos).
3. **Bloqueantes de integración:** OQ-B3/B5, OQ-G1/G2 (para poder construir).
4. **Producto:** OQ-F1/F6, OQ-E1 (para publicar y buscar bien).
5. **Legal/fiscal:** OQ-H1 (no lanzar sin claridad fiscal).
