# Business Rules — OFFSIDE STORE

## 1. Propósito

Consolidar las **reglas de negocio transversales** que gobiernan el marketplace y
que no pertenecen a un único subsistema. Es el documento de referencia rápida:
"¿qué está permitido, qué está prohibido, qué es obligatorio?".

## 2. Alcance

Reglas que afectan a más de un actor o subsistema: publicaciones, precios,
elegibilidad de vendedores/compradores, obligaciones, prohibiciones y reglas del
ciclo de venta. Las reglas específicas de pagos, disputas, envíos, confianza y
producto viven en sus documentos y aquí sólo se referencian.

## 3. Conceptos principales

- **Regla dura (MUST):** obligatoria; su violación bloquea la operación o
  sanciona.
- **Regla blanda (SHOULD):** recomendada; su violación puede penalizar
  reputación pero no bloquea.
- **Regla condicional:** depende de un estado (nivel de vendedor, tipo de
  producto, etc.).

Cada regla tiene un ID (`BR-xxx`) para poder referenciarla desde otros
documentos y desde el código.

## 4. Reglas

### 4.1 Cuentas e identidad

- **BR-001 (MUST):** todo usuario (comprador o vendedor) debe registrarse con
  email verificado antes de operar.
- **BR-002 (MUST):** para **vender**, el vendedor debe (a) tener identidad
  verificada y (b) conectar una cuenta de Mercado Pago vía OAuth. Ver
  `seller-system.md` y `trust-and-safety.md`.
- **BR-003 (MUST):** conectar Mercado Pago **NO** convierte automáticamente a un
  vendedor en "vendedor confiable". La confianza se construye por separado
  (`trust-and-safety.md`). ✅ regla explícita del negocio.
- **BR-004 (MUST):** un usuario suspendido o expulsado no puede crear una cuenta
  nueva para evadir la sanción. 🟡 mecanismo de detección a definir.

### 4.2 Publicaciones

- **BR-010 (MUST):** una publicación debe usar el **modelo de datos especializado**
  de producto (ver `product-specification.md`). No se admite el modelo pobre
  "nombre + precio + descripción".
- **BR-011 (MUST):** campos mínimos obligatorios para publicar: categoría, título,
  precio, al menos 1 foto real del artículo, estado (nuevo/usado…), talle, y los
  atributos obligatorios de la categoría. Lista exacta en
  `product-specification.md`.
- **BR-012 (MUST):** las fotos deben ser del artículo real o claramente indicadas
  como "foto ilustrativa"; declarar autenticidad falsa es sancionable
  (`trust-and-safety.md`).
- **BR-013 (SHOULD):** el vendedor debería declarar medidas reales, país de
  fabricación y detalles de autenticidad para mejorar conversión y reducir
  disputas.
- **BR-014 (MUST):** una publicación puede estar `ACTIVA`, `PAUSADA`, `AGOTADA` o
  `ELIMINADA`. Sólo publicaciones `ACTIVA` con stock ≥ 1 son comprables.
- **BR-015 (MUST):** el vendedor puede editar una publicación, pero cambios
  sensibles (precio, autenticidad, estado) quedan **auditados** (histórico).
- **BR-016 (MUST):** está prohibido publicar productos fuera de las categorías
  habilitadas (ver alcance de producto). Publicaciones fuera de nicho se
  rechazan/despublican.
- **BR-017 (condicional):** productos declarados **retro/vintage** o de **alto
  valor** pueden requerir verificación adicional según la política de
  autenticidad (DEC-010, pendiente).

### 4.3 Precios y stock

- **BR-020 (MUST):** el precio lo fija el vendedor, en la moneda soportada (🟡
  ARS por defecto — a confirmar en `OPEN-QUESTIONS.md`).
- **BR-021 (MUST):** el precio mostrado al comprador es el precio del producto; el
  **envío** se calcula/agrega según `shipping.md`; la **comisión de OFFSIDE** no
  se le cobra por separado al comprador (🟡 hipótesis, ver business-model).
- **BR-022 (MUST):** el stock se descuenta al **confirmarse el pago**, no al
  agregar al carrito. Regla anti-overselling: ver `marketplace-flow.md`.
- **BR-023 (SHOULD):** cambios de precio no afectan órdenes ya pagadas.

### 4.4 Ciclo de venta

- **BR-030 (MUST):** una compra sólo se concreta con **pago aprobado** por Mercado
  Pago. Estados intermedios no crean obligación de envío.
- **BR-031 (MUST):** tras el pago aprobado y el split, se crea una **orden** que
  vincula comprador, vendedor, publicación, importes y comisión.
- **BR-032 (MUST):** el vendedor debe despachar dentro del **plazo de despacho**
  comprometido (🟡 valor a definir, p. ej. 3 días hábiles). Incumplir afecta
  reputación y habilita reclamo "producto no recibido".
- **BR-033 (MUST):** la orden no se considera **completada** hasta la entrega
  confirmada (o el plazo de protección al comprador vencido sin reclamo). Ver
  `orders-and-refunds.md`.
- **BR-034 (MUST):** el comprador puede abrir un **reclamo** dentro de la ventana
  de protección (🟡 plazo a definir). Motivos y flujo en `trust-and-safety.md`.

### 4.5 Comisión y dinero

- **BR-040 (MUST):** OFFSIDE cobra su comisión vía split de MP en el momento del
  pago (`payments-and-commissions.md`). No factura la comisión por fuera del
  split en el MVP. 🟡
- **BR-041 (MUST):** ante refund, la comisión de OFFSIDE puede revertirse
  proporcionalmente (política DEC-008, pendiente). El sistema debe soportar
  reversa parcial y total.
- **BR-042 (MUST):** OFFSIDE **no garantiza** poder recuperar del vendedor su
  parte de un refund si el vendedor no tiene fondos. La regla de negocio asume
  este riesgo explícitamente (ver `orders-and-refunds.md`).

### 4.6 Conducta y sanciones

- **BR-050 (MUST):** vender falsificaciones declarándolas auténticas es la falta
  más grave; puede derivar en suspensión/expulsión y retención de fondos según
  política (DEC-010).
- **BR-051 (MUST):** manipular reputación (autocompras, reviews falsas) está
  prohibido.
- **BR-052 (MUST):** todo evento sancionable y toda decisión administrativa queda
  **auditada** (quién, cuándo, por qué). Ver `trust-and-safety.md`.
- **BR-053 (SHOULD):** la comunicación comprador↔vendedor debería ocurrir dentro
  de la plataforma (para trazabilidad de disputas). 🟡 mensajería in-app es
  feature futura.

## 5. Casos de uso (ejemplos de aplicación de reglas)

- **UC-BR-1:** Un vendedor intenta publicar "Camiseta - $50000 - linda". El
  sistema rechaza por BR-010/BR-011 (faltan atributos obligatorios).
- **UC-BR-2:** Comprador agrega al carrito la última unidad; otro comprador paga
  primero. Por BR-022 el stock se descuenta al pago, así que el segundo
  comprador ve "agotado" en checkout. Ver manejo en `marketplace-flow.md`.
- **UC-BR-3:** Vendedor conecta MP y espera vender de inmediato con badge de
  confianza. Por BR-003, no obtiene confianza automática.
- **UC-BR-4:** Comprador recibe una falsificación. Abre reclamo (BR-034),
  disputa determina FULL_REFUND; por BR-041 se revierte comisión y por BR-042 se
  activa el manejo de riesgo si el vendedor no tiene fondos.

## 6. Estados

Este documento no define estados propios; referencia los de publicación (BR-014),
pago (`payments`), orden (`orders-and-refunds`) y disputa (`trust-and-safety`).

## 7. Dependencias

- Interna: todos los documentos (es el índice de reglas).
- 🌐 Externas: Mercado Pago (BR-040/041/042), fisco (facturación), Correo
  Argentino (BR-032 plazos).

## 5.b Principio de configurabilidad — ✅ (DEC-013)

- **BR-060 (⚙️):** todas las reglas **operativas razonables** (comisiones, refunds,
  reputación/niveles/riesgo, publicaciones, envíos, ranking) deben poder
  **configurarse desde Admin** sin cambiar código. Se distingue **configuración
  administrativa** de **datos propios** de cada publicación/orden. Catálogo en
  `04-technical/configuration-registry.md`.

## 8. Decisiones tomadas

- ✅ BR-003 (Mercado Pago ≠ confianza automática).
- ✅ BR-010 (modelo de producto especializado obligatorio).
- ✅ BR-042 (el negocio asume el riesgo de no recuperar refunds).
- ✅ BR-060 (DEC-013: configurabilidad operativa desde Admin).

## 9. Decisiones pendientes

> Taxonomía actualizada (ver `README.md`). "Pendiente interna" = 🟡; dependencia de
> MP/Correo = 🔵; fiscal/legal = 🔴.

- 🟡 Plazo de despacho comprometido (BR-032).
- 🟡 Ventana de protección al comprador / plazo de reclamo (BR-034).
- 🟡 Moneda(s) soportada(s) (BR-020).
- 🟡 ¿El comprador paga algún fee? (BR-021; hipótesis: no, salvo cuotas DEC-016).
- 🟡 Detección de reincidencia de cuentas suspendidas (BR-004).

## 10. Riesgos

- Reglas mal aplicadas por ambigüedad → disputas y pérdida de confianza.
- Falta de auditoría → decisiones no defendibles legalmente.
- Reglas demasiado estrictas → fricción para vendedores; demasiado laxas →
  fraude. Balance en `trust-and-safety.md`.
