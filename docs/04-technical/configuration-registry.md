# Configuration Registry — OFFSIDE STORE

> Cataloga **todo lo que debe ser configurable desde el panel de Admin** (⚙️),
> según el principio DEC-013. **No implementa nada**: sólo documenta **qué** debe
> ser configurable y a **qué nivel** aplica. Actualizado 2026-08-19.

## 1. Propósito y principio

✅ **DEC-013:** todas las reglas **operativas razonables** deben poder modificarse
desde administración **sin cambiar código**. Este registro es la lista maestra de
esos parámetros.

✅ **DEC-032 — "Simple por defecto, configurable cuando sea necesario":** el MVP
arranca con **defaults razonables y simples**; **no** se construye un motor genérico
de configuración complejo. La configurabilidad es una **capacidad de arquitectura**,
no una feature completa del MVP.

> **Distinción clave (repetida del pedido):** separar **configuración
> administrativa** (parámetros del sistema) de los **datos propios de cada
> publicación/orden** (que NO son configuración global). Un precio o una foto son
> datos del listing; el "máximo de fotos permitido" es configuración.

### 1.b Config Store — ✅ concepto (DEC-038)

Existe un **Config Store administrativo** (concepto cerrado, DEC-038): un lugar
**simple y controlado** para modificar parámetros de negocio sin código. **Regla
firme (DEC-038/DEC-030):** toda configuración que afecte una **transacción
económica** se **snapshotea dentro de la transacción** (p. ej.
`commission_rate_at_transaction`, `commission_amount`); **nunca** se recalcula lo
histórico con la configuración actual. El **modelo de datos** del store queda 🟡
(ver `open-decisions-impact.md` E1).

## 2. Niveles de configuración

| Nivel | Alcance |
|-------|---------|
| **Global** | Aplica a toda la plataforma. |
| **Por `SELLER_TIER`** | Overrides por categoría comercial del vendedor (DEC-037; valores 🟡). |
| **Por categoría** | Overrides por categoría de producto (donde aplique). |
| **Por publicación** | Datos del listing (no configuración global; se lista para contraste). |

> **Nota de resolución:** cuando un parámetro exista en varios niveles, se define
> un **orden de precedencia** (p. ej. publicación > categoría > `SELLER_TIER` >
> global). El orden exacto es 🟡 a definir.

## 3. Configuración GLOBAL

- Moneda (🟡; hipótesis ARS).
- Textos legales/políticas (enlaces a T&C, privacidad) — contenido 🔴 legal.
- Feature flags de MVP (qué está activo).
- Parámetros de seguridad operables (p. ej. límites de rate limiting) — 🟡.

## 4. Configuración de PAGOS

- **% de comisión** por defecto (DEC-007, ⚙️).
- **% de comisión por `SELLER_TIER`** (DEC-037).
- **Ventana de pago** (tiempo máximo para pagar antes de expirar `PENDING_PAYMENT`,
  DEC-033), **ventana de cancelación** y **ventana de refund** (DEC-038).
- Regla de **base de cálculo** = total cobrado (DEC-014 — fija; se documenta como
  no editable salvo decisión de negocio).
- Tratamiento de **cuotas** (quién absorbe según oferta del vendedor, DEC-016) —
  parámetros operables donde aplique.
- Tratamiento de **descuentos** (vendedor vs Offside, DEC-017).
- **Checkout** utilizado (Pro/API) — 🟠 (más bien setting técnico que de negocio).

## 5. Configuración de REFUNDS (DEC-008 / DEC-018)

Todos configurables (valores por defecto 🟡):

- Habilitar refund **total** / **parcial**.
- Refund **antes del envío** / **después del envío** / **después de la entrega**.
- **Quién puede iniciar** un refund.
- **Cuándo** puede iniciarlo el comprador y **plazo máximo para reclamar**.
- **Quién decide** el refund.
- Tratamiento de la **comisión de Offside** ante refund (default: reversa; en
  parcial la absorbe Offside — DEC-018).
- Tratamiento de los **costos de Mercado Pago** ante refund.
- Tratamiento del **costo de envío** ante refund.
- **Quién paga la devolución**.
- Orden de operaciones en **`RETURN_REQUIRED`** (refund antes/después de recibir).
- **Cómo se registra** el refund.
- ¿Offside **adelanta** el refund al comprador ante vendedor sin fondos? (B3).

## 5.b Configuración de ÓRDENES (transiciones) — futuro (DEC-029/DEC-032)

Las **reglas de transición** de la Order (estados DEC-029) se diseñan para poder
configurarse a futuro, con **defaults simples en el MVP** (DEC-032). Parámetros:

- **Tiempo máximo de pago** (antes de expirar `PENDING_PAYMENT`).
- **Plazo de cancelación** (quién y cuándo).
- **Tiempo máximo para despachar** (`PROCESSING`).
- **Tiempo de confirmación** (paso a `COMPLETED`).
- **Acciones automáticas** y **notificaciones** por transición.

> No se construye ahora un motor complejo; sólo se deja la puerta abierta.

## 6. Configuración de FONDOS / RIESGO

- **Condición automática de liberación** de fondos del vendedor (DEC-019, tras
  conformidad o X días) — ⚙️ (mecánica 🔵 MP).
- Reglas de `seller_liabilities`: **bloqueo de nuevas ventas** con deuda,
  **descuento de ventas futuras**, **límite de exposición por vendedor** (🟡).

## 7. Configuración de REPUTACIÓN / NIVELES / RIESGO

- **Umbrales de niveles de usuario** (DEC-020: CONFIABLE +5, DESTACADO +10,
  COLECCIONISTA +20…) y definición de "compras y ventas" (🟡).
- **Umbrales/reglas de estados de riesgo** (DEC-021: RIESGO/RESTRINGIDO/
  SUSPENDIDO) (🟡).
- **Pesos de la fórmula de reputación** (🟡).

## 8. Configuración de PUBLICACIONES (Bloque 6)

Configuración administrativa (⚙️):

- Cantidad **máxima de fotos**.
- **Tamaño máximo** de archivo.
- **Formatos** permitidos.
- **Compresión** / generación de variantes (thumbnail/medium/large).
- Si se admite **video** (y sus límites).
- **Atributos obligatorios** por categoría (matriz, D4).
- Reglas de **moderación** (pre/post publicación) — 🟡 sin definir.
  > ⚠️ **Mientras tanto, DEC-045:** las publicaciones nacen `APPROVED` y no
  > hay revisión previa. Es **transitorio**, viable sólo con volumen bajo y
  > vendedores conocidos: RISK-FR1 (falsificaciones) es Crítico / Alta.
- Si se permite **edición posterior** y **cambios de precio** (y si quedan en
  historial).

**Datos por publicación (NO configuración global):** foto principal, orden de
fotos, descripción, precio, stock, estado, autenticidad, historial, pausar,
eliminar.

## 9. Configuración de BÚSQUEDA / RANKING (Bloque 9)

- **Pesos del ranking** (relevancia, precio, popularidad, recencia, reputación,
  destacadas) (🟡).
- Gestión de **sinónimos/alias** de catálogos.

## 10. Configuración de ENVÍOS (Bloque 8)

- **Quién paga** el envío (comprador/vendedor) por defecto.
- **Envío incluido** en precio / **envío gratis** / **subsidio** de Offside.
- **Retiro presencial** habilitado o no.
- Plazos de despacho comprometidos (BR-032).
- (Futuro) selección de **empresa** de logística.

## 11. Configuración de NOTIFICACIONES (Bloque 13)

- Qué eventos disparan email / in-app.
- Preferencias del usuario (opt-in/opt-out).
- Plantillas (contenido).

## 12. Impacto en el sistema (resumen)

> **Actualizado 2026-08-20.** Esta sección afirmaba que el almacén de
> configuración estaba "aún no modelado" y que "el ERD actual **no** incluye
> tablas de configuración". Ambas afirmaciones quedaron **superadas por DEC-039**
> (cierre del ERD v1.0, 2026-08-19), que adopta la **Alternativa C**. No es una
> decisión nueva: se alinea el texto con la decisión ✅ ya tomada.

El almacén de configuración **ya está modelado** en el ERD v1.0:

- **`app_settings`** (`database-design.md` §17.1) — key-value **acotado y tipado**
  para parámetros simples, con `scope` (global / seller_tier / category),
  `value jsonb`, `value_type` y `version`.
- **`seller_tiers`** (`database-design.md` §7.1) — lo relacional/rico vive en
  tabla de dominio, no en el key-value.
- **Versionado y auditoría:** columna `version` + registro en `audit_log`.

Es decir, la pregunta "clave-valor tipado **vs** tablas por dominio" se resolvió
como **ambas**: key-value para lo simple, tabla de dominio para lo rico.

Sigue vigente la regla firme de DEC-030/DEC-038: toda configuración que afecte
una transacción económica se **snapshotea dentro de la transacción** y **nunca**
se recalcula lo histórico con la configuración actual.

## 13. Estado

- ✅ **DEC-013:** principio de configurabilidad.
- ✅ **Modelo de almacenamiento** — cerrado por **DEC-039** (Alternativa C):
  `app_settings` + `seller_tiers`. Ver `database-design.md` §17.1 y §7.1.
- 🟦 **Valores por defecto** de casi todos los parámetros, y el **orden fino de
  precedencia** (publicación > categoría > seller_tier > global). La estructura
  ya soporta cargarlos desde Admin; los valores no se inventan desde el código.
