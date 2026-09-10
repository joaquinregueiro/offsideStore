# Buyer System — OFFSIDE STORE

## 1. Propósito

Especificar las **funcionalidades del comprador** en el MVP con suficiente detalle
para implementarlas: registro, login, perfil, búsqueda, filtros, detalle de
producto, favoritos, carrito, checkout, historial, tracking, calificaciones y
reclamos.

## 2. Alcance

Todo lo que un comprador puede hacer en el MVP. Las mecánicas que comparte con
otros subsistemas (pago, envío, disputa) se referencian; aquí se describe la
**perspectiva del comprador**.

## 3. Conceptos principales

- **Comprador:** usuario con sesión que busca y adquiere productos. No requiere
  cuenta de Mercado Pago propia (paga como pagador en el checkout de MP).
- **Protección al comprador:** ventana temporal en la que puede reclamar
  (`trust-and-safety.md`, plazo 🟡 a definir).

## 4. Funcionalidades (MVP)

### 4.1 Registro

- **BS-001:** registro con email + contraseña (o 🟡 social login — a definir),
  con **verificación de email** obligatoria (BR-001).
- **BS-002:** aceptación de términos y política de privacidad en el alta.

### 4.2 Login

- **BS-010:** login con credenciales; manejo de sesión seguro (ver
  `architecture.md`).
- **BS-011:** recuperación de contraseña.

### 4.3 Perfil

- **BS-020:** datos personales, direcciones de envío, medios de contacto.
- **BS-021:** el comprador puede ser también vendedor (un mismo usuario, dos
  roles); ver `seller-system.md`.

### 4.4 Búsqueda y filtros

- **BS-030:** buscador por texto libre + **filtros facetados** especializados
  (`product-specification.md`, sección 5).
- **BS-031:** ordenamiento (relevancia, precio, novedad, reputación del
  vendedor).
- **BS-032:** ver conteos por faceta y limpiar/combinar filtros.

### 4.5 Detalle de producto

- **BS-040:** ficha con todos los atributos estructurados, galería de fotos,
  estado, autenticidad **declarada** (con leyenda de que es declarada por el
  vendedor si no está verificada — TS-032), precio, envío estimado, e info del
  vendedor (reputación, nivel de confianza).
- **BS-041:** call-to-action: comprar / agregar al carrito / favorito.

### 4.6 Favoritos

- **BS-050:** guardar productos en favoritos; listado propio.
- **BS-051 (SHOULD):** avisos si un favorito baja de precio o se agota (feature
  futura; no bloquear el modelo).

### 4.7 Carrito

- **BS-060:** agregar/quitar ítems; el carrito **no reserva stock** (MF-010).
- **BS-061:** revalidación de precio y disponibilidad al ir a checkout (MF-012).
- **BS-062 (🔴):** comportamiento con múltiples vendedores depende de la decisión
  MF-011 (1 orden = 1 vendedor recomendado para MVP).

### 4.8 Checkout

- **BS-070:** selección de dirección de envío y método de envío (Correo
  Argentino) con costo calculado (`shipping.md`).
- **BS-071:** pago vía Mercado Pago (Checkout Pro o API — `payments`); el
  comprador es el pagador; MP ejecuta el split.
- **BS-072:** confirmación de compra **supeditada al webhook** de pago aprobado
  (MF-023): el comprador ve "pago en proceso/aprobado" según estado real.
- **BS-073:** manejo de pago rechazado/cancelado con opción de reintento
  (`payments`).

### 4.9 Historial de compras

- **BS-080:** lista de órdenes con su estado (ver estados de orden en
  `marketplace-flow.md`), importes, y accesos a tracking/reclamo/calificación.

### 4.10 Tracking

- **BS-090:** seguimiento del envío con estados de Correo Argentino y tracking
  histórico (`shipping.md`). El tracking se muestra abstraído (no se expone la
  API cruda del correo).

### 4.11 Calificaciones

- **BS-100:** al completarse la orden, el comprador puede **calificar** al
  vendedor (puntaje + comentario). Alimenta reputación (`trust-and-safety.md`).
- **BS-101:** prohibido manipular calificaciones (BR-051).

### 4.12 Reclamos (apertura de disputa)

- **BS-110:** dentro de la ventana de protección, el comprador abre un **reclamo**
  eligiendo un **motivo** (lista en `trust-and-safety.md`, sección 5.2) y cargando
  **evidencia**.
- **BS-111:** el comprador ve el estado de la disputa (`OPEN → WAITING_SELLER →
  UNDER_REVIEW → RESOLVED`) y la resolución/refund resultante.

## 5. Casos de uso

- **UC-BS-1:** comprador busca "camiseta selección Argentina 2022 talle M
  auténtica", filtra, entra al detalle, agrega a favoritos y luego compra.
- **UC-BS-2:** al pagar, MP responde `pending`; el comprador ve "pago en proceso"
  y recibe confirmación cuando llega el webhook `approved`.
- **UC-BS-3:** recibe un producto dañado, abre reclamo `producto dañado` con
  fotos; sigue el estado hasta `RESOLVED` con `PARTIAL_REFUND`.

## 6. Estados (perspectiva del comprador)

- Cuenta: `no_registrado → registrado (email verificado) → activo → [suspendido]`.
- Sus órdenes siguen los estados de `marketplace-flow.md`.
- Sus reclamos siguen los estados de disputa de `trust-and-safety.md`.

## 7. Dependencias

- Interna: `product-specification.md` (búsqueda/detalle),
  `marketplace-flow.md` (compra), `payments-and-commissions.md` (checkout),
  `shipping.md` (tracking), `trust-and-safety.md` (reclamos/calificaciones).
- 🌐 Externas: Mercado Pago (pago), Correo Argentino (tracking).

## 8. Decisiones tomadas

- ✅ Set de funcionalidades del comprador en el MVP (registro, login, perfil,
  búsqueda, filtros, detalle, favoritos, carrito, checkout, historial, tracking,
  calificaciones, reclamos).
- ✅ El comprador no necesita cuenta MP propia.

## 9. Decisiones pendientes (DECISION REQUIRED)

- 🔴 Social login sí/no (BS-001).
- 🔴 Ventana de protección al comprador (plazo de reclamo).
- 🔴 Comportamiento de carrito multi-vendedor (MF-011).
- 🔴 Avisos de favoritos (precio/stock) — alcance.

## 10. Riesgos

- **UX de checkout** dependiente de estados asíncronos de MP (webhooks): mala
  comunicación del estado genera desconfianza.
- **Expectativa de autenticidad:** el comprador puede asumir "verificado" cuando
  es "declarado" → riesgo de disputa/reputación.
- **Fricción de registro** vs necesidad de identificar al usuario.
