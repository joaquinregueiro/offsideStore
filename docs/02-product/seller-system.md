# Seller System — OFFSIDE STORE

## 1. Propósito

Especificar las **funcionalidades del vendedor** en el MVP: registro, conexión de
Mercado Pago (OAuth), perfil, gestión de publicaciones (crear/editar/pausar),
inventario, ventas, órdenes, envío y reputación. Debe permitir implementar el
onboarding del vendedor y su back-office.

## 2. Alcance

Perspectiva del vendedor. La mecánica financiera (OAuth, tokens, split, refunds)
se detalla en `03-operations/payments-and-commissions.md` y
`orders-and-refunds.md`; aquí se describe **qué hace el vendedor** y **en qué
estado** queda.

## 3. Conceptos principales

- **Vendedor:** usuario habilitado para publicar y vender. Requiere identidad
  verificada + Mercado Pago conectado + aprobación (`trust-and-safety.md`, eje 2).
- **Onboarding del vendedor:** proceso de alta que culmina en "vendedor
  aprobado".
- **Cuenta MP conectada:** cuenta de Mercado Pago del vendedor vinculada por
  **OAuth**, sobre la que MP acredita su parte del split.

## 4. Funcionalidades (MVP)

### 4.1 Registro

- **SS-001:** el vendedor se registra como usuario (BR-001) y solicita habilitar
  el rol de vendedor.
- **SS-002:** acepta términos específicos de vendedor (comisión, obligaciones de
  despacho, política de disputas/refunds).

### 4.2 Conexión de Mercado Pago (OAuth)

- **SS-010 (✅ DEC-005):** el vendedor **conecta su cuenta de Mercado Pago por
  OAuth**. OFFSIDE obtiene y almacena de forma segura los tokens necesarios
  (access token / refresh token) para operar el split en nombre de la relación.
- **SS-011 (🌐):** la mecánica exacta (scopes, KYC de MP, renovación de tokens)
  es **dependencia externa** y se detalla en `payments-and-commissions.md`. **No
  inventar** el flujo; seguir la documentación oficial de MP.
- **SS-012:** conectar MP **NO** aprueba ni da confianza automáticamente (BR-003 /
  TS: eje 2 y 3). Es un requisito, no un sello.
- **SS-013:** si el vendedor revoca el acceso o los tokens caducan sin renovarse,
  sus publicaciones no pueden venderse (no se puede ejecutar el split). El sistema
  debe detectar y comunicar este estado.

### 4.2.b `SELLER_TIER` — categoría comercial del vendedor — ✅ estructura / 🟡 valores (DEC-037)

- **SS-014:** cada vendedor tiene un **`SELLER_TIER`**: su **categoría comercial/
  operativa**, que podrá determinar **comisión, límites, beneficios, condiciones
  comerciales y reglas especiales**, todo **configurable desde Admin** (⚙️
  DEC-013/DEC-038), sin tocar código. **No** se asumen los valores definitivos de
  `SELLER_TIER` todavía (🟡); estructura inicial **simple y configurable**. No hay
  comisión promocional automática para vendedores nuevos.
- **SS-015 (I-5/DEC-037):** `SELLER_TIER` (categoría comercial) es **distinto** del
  **USER LEVEL** (trayectoria/confianza: NUEVO/CONFIABLE/DESTACADO/COLECCIONISTA/
  TIENDA, DEC-020) y del **estado de riesgo** (DEC-021). **No mezclar** — se usa el
  nombre `SELLER_TIER` justamente para evitar confusión con USER LEVEL. En
  particular, el nivel `TIENDA` **no** es lo mismo que un `SELLER_TIER`.

### 4.3 Perfil del vendedor

- **SS-020:** datos de tienda/vendedor, política de envíos, ubicación de despacho,
  medios de contacto. Perfil público: nombre, username, bio, ubicación, reputación,
  ventas, publicaciones, seguidores, estado, MP conectado.
- **SS-021:** el perfil muestra públicamente reputación y nivel de confianza
  (`trust-and-safety.md`).
- **SS-022 (🔴):** **datos fiscales** del vendedor (quién emite comprobante,
  monotributo/RI, etc.) quedan **pendientes de asesoramiento profesional** (DEC-011)
  y **no se modelan** todavía. Ver `01-business/legal.md`.

### 4.4 Crear publicación

- **SS-030:** formulario basado en el **modelo especializado**
  (`product-specification.md`), con validación de atributos obligatorios y
  obligatoriedad condicional por categoría.
- **SS-031:** carga de fotos (≥1), atributos de dominio, precio, stock, estado,
  autenticidad declarada.
- **SS-032:** la publicación nace en `BORRADOR` y pasa a `ACTIVA` al completarse y
  publicarse (y, si aplica, tras validaciones de la política de autenticidad
  DEC-010).

### 4.5 Editar publicación

- **SS-040:** editar atributos; cambios sensibles (precio, autenticidad, estado)
  quedan **auditados** (BR-015).
- **SS-041:** editar no afecta órdenes ya pagadas (BR-023).

### 4.6 Pausar / reactivar / eliminar publicación

- **SS-050:** el vendedor puede `PAUSAR` (no comprable), reactivar o `ELIMINAR`.
- **SS-051:** una publicación sin stock pasa a `AGOTADA` automáticamente.

### 4.7 Inventario

- **SS-060:** vista de todas sus publicaciones con estado y stock.
- **SS-061:** ajuste de stock (con las reglas anti-overselling — el descuento
  real ocurre al pago, MF-010/022).

### 4.8 Ventas y órdenes

- **SS-070:** bandeja de **órdenes** recibidas con su estado
  (`marketplace-flow.md`), importes, comisión aplicada y neto a recibir (según lo
  que exponga MP sobre el split).
- **SS-071:** detalle de cada orden: comprador (datos necesarios para el envío),
  ítems, importe, envío, y acciones (despachar, responder disputa).

### 4.9 Envío

- **SS-080:** desde la orden `PROCESSING` (DEC-029), el vendedor genera el envío por
  **Correo Argentino** (etiqueta + tracking) vía el servicio abstraído
  (`shipping.md`).
- **SS-081:** debe despachar dentro del **plazo de despacho** (BR-032, 🟡 valor a
  definir). Incumplir afecta reputación y habilita reclamo "no recibido".

### 4.10 Reputación

- **SS-090:** el vendedor ve su reputación, métricas (ventas, reclamos,
  cancelaciones, tiempos de despacho, calificaciones) y su **nivel de riesgo**
  (`trust-and-safety.md`).
- **SS-091:** puede responder disputas (cargar evidencia; estado
  `SELLER_RESPONSE`).

## 5. Casos de uso

- **UC-SS-1 (onboarding):** usuario pide ser vendedor → verifica identidad →
  conecta MP por OAuth → acepta términos → queda "aprobado" (si no está en riesgo
  alto). Nota: MP conectado no lo hace "confiable" por sí solo.
- **UC-SS-2 (publicar):** completa el formulario especializado de una camiseta
  retro; el sistema valida atributos obligatorios y la publica.
- **UC-SS-3 (vender y despachar):** recibe orden PAID → despacha por Correo
  Argentino dentro del plazo → carga tracking → la orden avanza a SHIPPED.
- **UC-SS-4 (token caducado):** el refresh token no se renovó; el sistema marca la
  cuenta como "MP desconectado" y pausa la venta hasta reconectar (SS-013).
- **UC-SS-5 (disputa):** recibe reclamo → responde con evidencia
  (`SELLER_RESPONSE`) → Admin resuelve.

## 6. Estados (perspectiva del vendedor)

- Habilitación: `no_aprobado → aprobado → limitado → suspendido → expulsado`
  (`trust-and-safety.md`).
- Conexión MP: `no_conectado → conectado → token_expirado/revocado →
  reconectado`.
- Publicación: `BORRADOR → ACTIVA → PAUSADA → AGOTADA → ELIMINADA`.

## 7. Dependencias

- Interna: `product-specification.md` (publicación),
  `payments-and-commissions.md` (OAuth/split), `orders-and-refunds.md`
  (comisión/refunds/riesgo de fondos), `shipping.md` (envío),
  `trust-and-safety.md` (aprobación/reputación/riesgo).
- 🌐 Externas: **Mercado Pago** (OAuth, tokens, KYC, split, acreditación),
  **Correo Argentino** (envío/tracking).

## 8. Decisiones tomadas

- ✅ DEC-005: OAuth para conectar la cuenta MP del vendedor.
- ✅ Requisitos de "vendedor aprobado" (identidad + MP + términos + no-riesgo).
- ✅ MP conectado ≠ vendedor confiable.
- ✅ Set de funcionalidades del vendedor (registro, conexión MP, perfil,
  crear/editar/pausar publicación, inventario, ventas, órdenes, envío,
  reputación).

## 9. Decisiones pendientes (DECISION REQUIRED)

- 🔴 Plazo de despacho comprometido (BR-032).
- 🔴 Scopes de OAuth y política de renovación de tokens (detallado en payments).
- 🔴 Qué datos de identidad exige OFFSIDE vs los que aporta el KYC de MP.
- 🔴 Requisitos de la política de autenticidad al publicar (DEC-010).

## 10. Riesgos

- **Tokens/credenciales:** manejo inseguro de access/refresh tokens (ver
  `payments` y `RISKS.md`).
- **Desconexión de MP:** ventas imposibles si el token caduca sin renovar.
- **Fondos insuficientes:** un vendedor puede vender, cobrar su parte y luego no
  tener fondos para un refund (riesgo central, `orders-and-refunds.md`).
- **Falsificación:** vendedores que declaran auténtico lo que no lo es
  (`trust-and-safety.md`).
