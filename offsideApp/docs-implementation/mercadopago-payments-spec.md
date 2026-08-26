# Mercado Pago Payments / Split 1:1 — Especificación arquitectónica

Especificación del cobro de una orden del marketplace mediante **Mercado Pago
Split de Pagos 1:1**. **Fecha: 2026-08-24.**

> **Estado: IMPLEMENTADA (2026-08-25).** Este documento sigue siendo el contrato
> de diseño; lo que quedó construido está en
> [mercadopago-payments-module.md](mercadopago-payments-module.md).
>
> Del §27 se aplicó **el único cambio necesario**: `payments.mp_preference_id`
> (migration `0002`). Los recomendados **no** se implementaron.
>
> ⚠️ Lo que sigue faltando para probar el flujo de punta a punta: cargar
> **listings** desde la app, Config Store operativo, refresh de tokens y el
> registro de la aplicación en Mercado Pago. Ver §28.
>
> **Decisión de negocio cerrada (2026-08-24):** la comisión de Offside es un
> **6% simple sobre el total de la venta**, y **Offside no intenta absorber el
> costo de Mercado Pago**. MP descuenta sus costos como lo hace nativamente.
> Ver **§8**. Esta decisión **elimina** el bloqueo económico que esta
> especificación tenía en su versión anterior.

Convención de marcas, usada en todo el documento:

|     |                                                         |
| --- | ------------------------------------------------------- |
| 🔴  | Confirmado por documentación oficial de Mercado Pago    |
| 🟡  | Decisión de arquitectura de Offside                     |
| ⚠️  | Decisión de negocio del owner — **no se inventa**       |
| 🔵  | Pendiente de verificar en sandbox / primera integración |

---

## 1. Alcance

### Incluye

Creación de la preferencia de pago sobre la cuenta conectada del vendedor ·
Split 1:1 · comisión de Offside (`marketplace_fee`) · idempotencia · recepción y
procesamiento de webhooks de pago · mapeo de estados MP → Offside · transición
de la orden a `PAID` · snapshot financiero · reembolsos y cancelaciones a nivel
estructura · auditoría · frontera con `sellers` · frontera con una futura
liquidación.

### No incluye

Carrito · creación de la orden · catálogo y listings · envíos · disputas ·
motor de recupero de `seller_liabilities` · liquidación/settlement propiamente
dicha · tratamiento fiscal (DEC-011 🔴) · frontend · Checkout API/Transparente
(fuera del MVP por DEC-027).

**Fuera de alcance por decisión explícita del owner (2026-08-24):** estimación
del costo de Mercado Pago · conciliación estimado-vs-real de ese costo ·
restricción de medios de pago o cuotas con fines de previsibilidad de margen ·
cuenta corriente por vendedor por diferencias de fee. Ver §8.4.

### Separación que esta especificación preserva

```
ORDERS  ≠  PAYMENTS  ≠  CONEXIÓN MP DEL VENDEDOR  ≠  LIQUIDACIÓN
```

- `orders` es la **fuente comercial**: qué se vendió y a cuánto.
- `payments` es la **fuente de cobro**: qué pasó con el dinero en Mercado Pago.
- `sellers` es el **dueño de la conexión OAuth**. Payments la consume; **no la
  crea, no la renueva, no la administra** (spec de OAuth §17).
- La liquidación es un problema posterior (§20).

---

## 2. Fuentes oficiales

Todo lo marcado 🔴 en este documento sale de estas páginas, consultadas el
**2026-08-24**:

| Tema                                  | Fuente                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Split 1:1 — panorama y países         | [Split Payments 1:1 Overview](https://docs02.mercadopago.com.br/developers/en/docs/split-payments/split-1-1/overview)                                                    |
| Integración del checkout con split    | [Integrate checkout in Split Payments 1:1](https://www.mercadopago.com.br/developers/en/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace)   |
| Reparto y reembolsos en el split (pt) | [Integrar o checkout em Split de Pagamentos](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace) |
| `marketplace_fee` en Checkout Pro     | [How to integrate checkout in marketplace](https://www.mercadopago.com.br/developers/en/docs/checkout-pro/how-tos/integrate-marketplace)                                 |
| Campos de la preferencia              | [Create preference — API Reference](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-pro/preferences/create-preference/post)              |
| Campos de la respuesta del pago       | [Get payment — API Reference](https://www.mercadopago.com.ar/developers/en/reference/online-payments/checkout-pro/get-payment/get)                                       |
| Reembolsos                            | [Create refund — API Reference](https://www.mercadopago.com.ar/developers/en/reference/online-payments/checkout-api-payments/create-refund/post)                         |
| Idempotencia obligatoria              | [Idempotency key usage will be mandatory](https://www.mercadopago.com.ar/developers/en/news/2023/01/04/Idempotency-key-usage-will-be-mandatory)                          |
| Webhooks de split                     | [Webhooks — Split Payments](https://www.mercadopago.com.ar/developers/en/docs/split-payments/additional-content/your-integrations/notifications/webhooks)                |
| Firma de webhooks                     | [Ensure the validity of notifications](https://www.mercadopago.com.br/developers/en/news/2024/02/27/Ensure-the-validity-of-notifications-sent-by-Mercado-Pago)           |
| Reporte de ventas de Split (API)      | [Report fields — Split Payments sales report](https://www.mercadopago.com.ar/developers/en/docs/split-payments/additional-content/reports/sales-report/report-fields)    |
| Liberación de dinero                  | [Reporte de liberaciones](https://www.mercadopago.com.ar/developers/es/docs/vtex/additional-content/reports/released-money)                                              |
| OAuth del vendedor                    | ver [mercadopago-oauth-spec.md](mercadopago-oauth-spec.md) §2                                                                                                            |

Documentación interna que manda sobre este documento: `docs/03-operations/payments-and-commissions.md`,
`docs/03-operations/orders-and-refunds.md`, `docs/04-technical/database-design.md`
§11 y §12, `docs/DECISIONS.md`.

---

## 3. Modelo conceptual

### 3.1 Qué es Split 1:1 🔴

Solución **PSP** de Mercado Pago para modelos de marketplace, que _"divide el
dinero de la transacción entre las partes involucradas"_ y reparte
automáticamente tasas, impuestos y comisión. Disponible en **Argentina, Brasil,
Chile, Colombia, México, Perú y Uruguay**. 🔴

"1:1" es una relación **marketplace ↔ un vendedor por transacción**, que encaja
exactamente con DEC-026 (**1 orden = 1 vendedor**): un carrito multi-vendedor se
divide en órdenes, y cada orden produce **un** pago con **un** split.

### 3.2 Los tres actores

| Rol                  | Quién     | Credencial usada                                     |
| -------------------- | --------- | ---------------------------------------------------- |
| Pagador              | Comprador | ninguna: paga en el checkout hospedado por MP        |
| Collector / vendedor | Vendedor  | **su** `access_token`, obtenido por OAuth 🔴         |
| Marketplace          | Offside   | su aplicación registrada; cobra `marketplace_fee` 🔴 |

**El pago se crea con el `access_token` DEL VENDEDOR**, no con el de Offside 🔴:
_"insert the seller's `access_token` (obtained in step 1) in the backend or in
the request header"_. Ésta es la razón técnica por la que la fase de OAuth iba
antes que ésta, y por la que el dinero **nunca pasa por una cuenta de Offside**:
cumple el requisito de negocio de que el marketplace no maneje manualmente el
dinero del vendedor.

### 3.3 Dónde entra la comisión 🔴

| Checkout                    | Campo de comisión     | Dónde va              |
| --------------------------- | --------------------- | --------------------- |
| **Checkout Pro** (DEC-027)  | **`marketplace_fee`** | en la **preferencia** |
| Checkout API / Transparente | `application_fee`     | en el **pago**        |

Offside usa **Checkout Pro** (DEC-027 ✅), por lo tanto el campo es
**`marketplace_fee`** y viaja en la preferencia. `application_fee` **no aplica**
a esta fase; queda documentado sólo para no confundirlos más adelante.

Restricción oficial: `marketplace_fee` _"must not be greater than total amount"_ 🔴.

### 3.4 Orden de descuento 🔴

Documentación oficial, textual:

> _"The Mercado Pago commission is deducted from the amount received by the
> seller. In other words, the Mercado Pago commission is deducted first and the
> Marketplace commission is deducted from the remaining amount."_

Es decir:

```
total pagado por el comprador
  − comisión de Mercado Pago      ← se descuenta PRIMERO, del lado del vendedor
  − marketplace_fee (Offside)     ← se descuenta del REMANENTE
  = neto que recibe el vendedor
```

**Offside adopta este comportamiento tal como es** (§8.3): no lo corrige, no lo
compensa y no intenta revertirlo. Es la decisión que mantiene la comisión simple
y predecible.

---

## 4. Arquitectura

```
apps/web
    │
    ▼
Route Handler                app/api/checkout/*  ·  app/api/webhooks/mercadopago/payments
    │                        (sólo delegan)
    ▼
Controller                   modules/payments/controllers/
    │
    ▼
Payment Service              modules/payments/services/
    │                        DOMINIO: decide. No sabe HTTP ni hablar con MP
    │
    ├──────────► Repository ──────► payments · payment_splits ·
    │            modules/payments/repositories/   payment_webhook_events · refunds
    │
    ├──────────► orders (Service)      ← estado de la orden y snapshot
    ├──────────► audit  (Service)      ← modules/audit, ya implementado
    │
    └──────────► modules/payments/infrastructure/mercadopago/
                 conoce endpoints, campos y payloads de PAGOS de MP
                          │
                          │  necesita una llamada AUTORIZADA como el vendedor
                          ▼
                 modules/sellers  (Service)
                 dueño de la conexión OAuth · descifra el token · ejecuta la llamada
                          │
                          ▼
                 api.mercadopago.com
```

### 4.1 La pieza nueva: `MercadoPagoAuthorizedRequester` 🟡

**Problema:** `payments` necesita llamar a Mercado Pago **como el vendedor**,
pero no puede ver el `access_token` (spec de OAuth §8), y tampoco puede existir
una segunda implementación de OAuth.

**Solución propuesta:** `sellers` expone a otros módulos un **ejecutor de
requests autorizado**, no una credencial:

```ts
// modules/sellers/services/mercadopago-connection.service.ts  (ampliación)
export interface AuthorizedRequest {
  path: string; // p. ej. '/checkout/preferences'
  method: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  idempotencyKey?: string;
}

/** Ejecuta la llamada firmada con las credenciales del vendedor. */
export function requestAsSeller(
  sellerId: string,
  request: AuthorizedRequest,
): Promise<AuthorizedResponse>;
```

Propiedades:

- El token se descifra **dentro de `sellers/infrastructure/mercadopago/`**, se
  usa y se descarta. `payments` nunca lo recibe. La frontera de secretos ya
  construida no se toca.
- `payments` decide **qué** pedir (endpoint, cuerpo, semántica de pago);
  `sellers` decide **con qué identidad** se pide. Ninguno invade al otro.
- Un solo lugar sigue conociendo `client_secret`, refresh y estados de conexión.
- Si la conexión no está `connected`, `requestAsSeller` **falla antes de salir a
  la red** con un error de dominio, y `payments` lo traduce a "vendedor no
  operativo".

**Alternativa descartada:** que `sellers` devuelva el token a `payments`
(`getAccessToken(sellerId)`). Es más simple, pero rompe la regla de que el token
no sale de infraestructura y multiplicaría los lugares donde puede filtrarse.

⚠️ Esta ampliación **toca `modules/sellers`**, que hoy está terminado y verde.
Es una decisión de arquitectura que conviene confirmar antes de implementarla.

### 4.2 Reglas que no se negocian

- **Ningún controller llama a Mercado Pago.** Ni directa ni indirectamente.
- **`payments` no crea, no renueva y no revoca conexiones OAuth.**
- **`sellers` no sabe qué es una orden, un pago ni una comisión.**
- El cliente HTTP de pagos vive en `modules/payments/infrastructure/mercadopago/`.
- Ningún token, `client_secret` ni payload crudo con credenciales va a logs.

---

## 5. Estado del repositorio frente a esta fase

Actualizado tras la implementacion, **2026-08-25**:

| Pieza                                                             | Tablas migradas | Código                                                                            |
| ----------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------- |
| `mercadopago_accounts`                                            | ✅              | ✅ conexión OAuth completa                                                        |
| `audit_log`                                                       | ✅              | ✅ `modules/audit`                                                                |
| `seller_profiles`, `seller_tax_profiles`                          | ✅              | ✅                                                                                |
| `orders`, `order_items`, `order_status_history`                   | ✅              | ✅ `modules/orders`                                                               |
| `payments`, `payment_splits`, `payment_webhook_events`, `refunds` | ✅              | ✅ `modules/payments`                                                             |
| `chargebacks`, `seller_liabilities`, `reconciliation_records`     | ✅              | ❌ sin código                                                                     |
| `carts`, `cart_items`, `listings`                                 | ✅              | ❌ sin código: **una orden sólo puede nacer de un listing ya cargado en la base** |
| `app_settings`, `seller_tiers` (Config Store)                     | ✅              | ❌ **vacías y sin código que las lea**: el 6% vive en una constante               |

**El cobro funciona.** Lo que falta para probarlo de punta a punta sin tocar la
base es cargar listings desde la app. Ver §28.

---

## 6. Flujo completo de checkout

```
 1. Existe una Order en PENDING_PAYMENT, con snapshot financiero  (módulo orders)
 2. El comprador inicia el pago
 3. Verificar sesión y que la orden sea del comprador          → 401 / 403
 4. Verificar order.status = PENDING_PAYMENT                    → 409
 5. Verificar payment_deadline no vencido (DEC-033)             → 409
 6. Resolver el vendedor de la orden y su conexión MP
 7. Verificar que la conexión esté 'connected'                  → 409
 8. marketplace_fee = orders.commission_amount   (el 6%, ya calculado)
 9. Crear (o reutilizar) el registro local `payments` en PENDING
10. Crear la preferencia en MP  → con el access_token DEL VENDEDOR
11. Persistir preference_id  (⚠️ SCHEMA CHANGE REQUIRED, §27)
12. Auditar PAYMENT_PREFERENCE_CREATED
13. Devolver init_point al frontend
────────────────────────────────────────────────────────────────
14. El comprador paga en el checkout HOSPEDADO POR MERCADO PAGO
────────────────────────────────────────────────────────────────
15. MP redirige al comprador a back_urls          ← SÓLO UX, no es la verdad
16. MP envía el webhook `payment`                 ← ÉSTA es la verdad (PC-040)
17. Validar firma, registrar el evento, responder 200 rápido
18. Procesar de forma asíncrona: reconsultar el pago a la API de MP
19. Mapear estado MP → estado Offside y persistir el crudo
20. Si aprobado: Order → PAID, registrar payment_split, auditar
```

**El paso 8 es una lectura, no un cálculo.** No hay estimaciones ni ajustes: el
`marketplace_fee` es la comisión nominal del snapshot de la orden (§8).

**El paso 15 nunca cambia estado.** El redirect es sólo experiencia de usuario;
si el comprador cierra la pestaña, el pago igual se resuelve por el paso 16
(PC-040 ✅).

---

## 7. Creación de la preferencia

### 7.1 Endpoint y credencial 🔴

```
POST https://api.mercadopago.com/checkout/preferences
Authorization: Bearer <access_token DEL VENDEDOR>
X-Idempotency-Key: <clave de idempotencia>
```

### 7.2 Campos que Offside envía

| Campo                           | Valor                                    | Fuente       |
| ------------------------------- | ---------------------------------------- | ------------ |
| `items`                         | snapshot de `order_items`                | 🔴 requerido |
| `marketplace_fee`               | `orders.commission_amount` (el 6%)       | 🔴           |
| `external_reference`            | `orders.id` (UUID)                       | 🟡           |
| `notification_url`              | endpoint de webhook de Offside           | 🔴           |
| `back_urls`                     | success / pending / failure del frontend | 🔴           |
| `auto_return`                   | `approved`                               | 🔴           |
| `expires`, `expiration_date_to` | derivado de `orders.payment_deadline`    | 🟡           |
| `payer`                         | datos del comprador                      | 🔴           |

- **`external_reference` = `orders.id`** 🟡. Es lo que permite reconciliar un
  webhook con una orden aunque se pierda el `preference_id`.
- **`expiration_date_to` se deriva de `payment_deadline`** 🟡, para que la
  ventana de pago de Offside (DEC-033, ⚙️ configurable) y la de MP no se
  contradigan.
- **`payment_methods` NO se envía con restricciones.** Existe (🔴 permite
  excluir medios y fijar cuotas) pero **Offside decidió no restringir**
  (§8.4): el comprador elige libremente. Si en el futuro se restringiera, sería
  por una razón comercial o de fraude, **no** por previsibilidad de costo.
- **`sponsor_id`** 🔵: la referencia lo documenta como _"activates marketplace
  mode; site must be the same as collector_id"_, pero **no está claro si es
  necesario cuando la preferencia ya se crea con el token del vendedor**. No se
  envía hasta verificarlo en sandbox. No se inventa.
- **`marketplace`** 🔵: campo documentado ("identifies the marketplace type",
  ej. `NONE`); su uso en Split 1:1 no está confirmado.

### 7.3 Respuesta 🔴

`id` (preference_id) · `init_point` · `sandbox_init_point` · `collector_id` ·
`client_id` · `date_created` · `preference_expired`.

- `init_point` es la URL a la que **navega el frontend**. Mismo criterio que
  MP-OAUTH-014: el backend devuelve la URL, no redirige.
- `collector_id` debe coincidir con el `mp_user_id` guardado en
  `mercadopago_accounts` 🟡. Si no coincide, se está cobrando a la cuenta
  equivocada: es un error grave y se aborta.

### 7.4 Importes: unidades 🟡

El ERD guarda **centavos en `bigint`** (ERD §1). Mercado Pago trabaja con
**unidades decimales de la moneda** (`unit_price: 75.76`) 🔴. La conversión
—centavos → decimal al enviar, decimal → centavos al recibir— ocurre
**exclusivamente en `payments/infrastructure/mercadopago/`**, con redondeo
explícito y sin `float` intermedio. Ningún importe decimal cruza hacia el
dominio.

---

## 8. Comisión de Offside

### 8.1 La tasa — ✅ DECISIÓN CERRADA: 6%

> **Decisión del owner, 2026-08-24 — cierra DEC-007:** la comisión de Offside es
> el **6% del total de la venta**. Simple, sin mínimos ni máximos, sin
> diferenciación por categoría, sin ajustes por costo de Mercado Pago.

```
commission_amount = orders.total_amount × 0,06
marketplace_fee   = commission_amount        ← se envía tal cual, sin ajustes
```

Esto cierra el valor que faltaba de DEC-007 y **no cambia** las reglas de cálculo
de DEC-014, que ya estaban decididas: base = total cobrado al comprador (precio
final con descuentos), IVA incluido.

⚙️ **El 6% vive en el Config Store, no en el código** (DEC-013 / DEC-038). Que
el valor esté decidido no lo convierte en una constante: se carga como
`commission_rate_default` en `app_settings` y se **snapshotea** en cada orden
(`commission_rate_at_transaction`, DEC-030). Hardcodearlo rompería DEC-030 y
haría irrepetible el histórico si algún día cambia.

🟡 La estructura de **tiers** (DEC-037: la tasa puede variar por `SELLER_TIER`)
sigue existiendo en el ERD y no se toca. Hoy hay **un solo valor global**: 6%.

### 8.2 Momento del cálculo 🟡

La comisión se calcula **al crear la orden**, no al crear el pago. Si se
calculara al pagar, dos intentos de pago de la misma orden en días distintos
podrían arrojar comisiones distintas si la configuración cambió en el medio —
exactamente lo que DEC-030 prohíbe.

`payments` **lee** `orders.commission_amount` y lo envía. No lo recalcula, no lo
ajusta, no lo interpreta.

### 8.3 El costo de Mercado Pago — ✅ DECISIÓN CERRADA: comportamiento nativo

> **Decisión del owner, 2026-08-24:** Offside **no intenta absorber** el costo de
> Mercado Pago dentro del 6%. Mercado Pago cobra sus costos normalmente, según
> medio de pago, cuotas y plazo de acreditación.

En la mecánica del split (§3.4), eso significa:

```
total pagado por el comprador
  − costo de Mercado Pago     ← lo determina MP; sale del lado del vendedor
  − 6% de Offside             ← marketplace_fee, entero
  = neto del vendedor
```

Con el ejemplo de una venta de $100.000 y un costo de MP de $5.000:

| Concepto                     | Importe     |
| ---------------------------- | ----------- |
| Venta                        | $100.000    |
| Costo de Mercado Pago        | $5.000      |
| **Comisión de Offside (6%)** | **$6.000**  |
| **Neto del vendedor**        | **$89.000** |

⚠️ **Consecuencia que hay que comunicar bien al vendedor:** su neto **no** es
`total − 6%`. Es `total − costo de MP − 6%`, y **el costo de MP varía** con el
medio de pago que elija el comprador, las cuotas y el plazo de acreditación que
el propio vendedor tenga configurado en su cuenta de Mercado Pago. Offside no
controla ese número ni lo promete. Ver §24.2 nº 1.

⚠️ **Esto reemplaza a PC-050.b / DEC-014**, que decía que la comisión de MP la
absorbía Offside. **`docs/` todavía dice lo contrario** y debe actualizarse:
`docs/03-operations/payments-and-commissions.md` §7 y `docs/DECISIONS.md`
(DEC-014). Esta especificación no puede editar `docs/` (CLAUDE.md §3).

**A favor de esta decisión:** la comisión de Offside es **fija, predecible y
auditable**; el margen no depende de variables externas; no hay estimadores, ni
conciliaciones de fee, ni cuentas corrientes, ni campos nuevos en el ERD por
este motivo.

### 8.4 Explícitamente fuera de alcance

Todo lo siguiente se analizó, se documentó y **se descartó para el MVP** por
decisión del owner. No se implementa, y **ninguna otra sección de esta spec debe
asumir que existe**:

| Descartado                                                                        | Motivo                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Estimar el costo de MP** antes de crear la preferencia                          | Sin estimación no hace falta tarifario en el Config Store ni lógica de cálculo |
| **`marketplace_fee = comisión − mp_fee_estimado`**                                | El fee que se envía es la comisión nominal, sin ajuste                         |
| **Conciliación estimado-vs-real del fee de MP**                                   | No hay estimación que conciliar                                                |
| **Cuenta corriente por vendedor** por diferencias de fee                          | No hay diferencias que compensar                                               |
| **Restringir medios de pago o cuotas** para volver predecible el costo            | El comprador elige libremente; la conversión manda                             |
| **Campos `payments.marketplace_fee_amount` y `payments.estimated_mp_fee_amount`** | Existían **sólo** para sostener la absorción. **Se retiran de §27**            |
| **Bloquear ventas por "margen negativo"**                                         | Ya no existe el caso: Offside cobra su 6% entero, siempre                      |

> **Optimización futura, fuera del MVP:** una **negociación comercial con
> Mercado Pago** podría mejorar el costo efectivo —tarifario preferencial,
> condiciones de acreditación, o el esquema en que el marketplace asume la
> tarifa, si existiera (§8.5)—. Eso es una conversación comercial, no una tarea
> de ingeniería, y **no bloquea nada** de esta especificación.

### 8.5 Lo que Mercado Pago no documenta 🔵 — sin impacto en el MVP

Registrado para no volver a investigarlo, **sin consecuencias sobre esta fase**:

- **No hay API que informe el costo de MP antes del pago.**
  `GET /v1/payment_methods` devuelve `accreditation_time`, límites y
  configuración de la tarjeta, pero **ningún campo de tarifa** 🔴. El endpoint de
  cuotas informa el costo financiero **del comprador** (CFT), que es otra cosa.
- **No hay tarifario consultable por API**: se publica en el centro de ayuda y se
  configura dentro de la cuenta de cada titular ("Costos y cuotas" → plazos de
  acreditación) 🔴.
- **No está documentado un modo en el que el marketplace asuma la tarifa de MP.**
  Material comercial de MP lo sugiere; la documentación técnica no lo dice.
  🔵 **No se asume.** Sería, si existiera, materia de la negociación comercial
  futura.
- El costo real **sí** se conoce ex post: el **reporte de ventas de Split**
  (por API) informa `MERCADOPAGO_FEE_AMOUNT`, `MARKETPLACE_FEE_AMOUNT`,
  `NET_RECEIVED_AMOUNT` y `Financing fee` 🔴. Sirve para **finanzas y
  reporting**, no para ninguna lógica de esta fase.

### 8.6 Cuotas y financiación

Con esta decisión, **DEC-016 se cumple de forma nativa**: si el vendedor ofrece
cuotas, el costo financiero sale de su lado del split, que es exactamente lo que
DEC-016 decidió. No hace falta implementar nada para que eso ocurra.

🔵 Cómo se imputa exactamente el costo financiero dentro del split sigue sin
verificarse, pero **ya no bloquea**: Offside cobra su 6% igual.

---

## 9. Idempotencia

### 9.1 Lo que exige Mercado Pago 🔴

El header **`X-Idempotency-Key` es obligatorio** en las APIs de Payments y
Refunds: _"the server can recognize duplicated requests and ensure that only the
first one is processed"_.

### 9.2 Cómo la construye Offside 🟡

| Operación         | Clave                                                            | Por qué                                                         |
| ----------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Crear preferencia | `payments.idempotency_key`, UUID generado al crear la fila local | La columna y su `UNIQUE` parcial **ya existen** en el ERD §12.1 |
| Reembolso         | derivada de `refunds.id`                                         | Un reintento no puede devolver dos veces                        |

Regla dura 🟡: **la fila local se crea ANTES de llamar a Mercado Pago**. Si se
creara después, un timeout dejaría un cobro en MP sin registro en Offside — el
peor estado posible. Crear primero significa que, en el peor caso, queda una
fila `PENDING` sin pago, que es reconciliable.

### 9.3 Idempotencia de los webhooks 🟡

`payment_webhook_events.idempotency_key` es `UNIQUE` (ERD §12.3). El
procesamiento es: **insertar el evento primero**; si la inserción viola el
único, el evento ya se procesó y se responde 200 sin volver a aplicarlo.

**El efecto se decide por el estado consultado a MP, no por el orden de llegada**
(PC-043 ✅): los webhooks llegan desordenados y una transición no puede depender
de cuál llegó antes.

---

## 10. Estados de Payment

### 10.1 Estados de Offside (ya decididos)

Enum `payment_status`, migrado (DEC-028 + DEC-035 ✅):

```
PENDING · IN_PROCESS · APPROVED · REJECTED · CANCELLED
REFUNDED · PARTIALLY_REFUNDED · CHARGED_BACK
```

### 10.2 Estados de Mercado Pago 🔵 — **advertencia importante**

Esta investigación **NO obtuvo de una página oficial la lista literal de estados
del recurso `/v1/payments`** que usa Checkout Pro.

Lo que sí quedó confirmado 🔴 es que Mercado Pago tiene **dos taxonomías
distintas** y que Offside usa la primera:

| Topic de webhook | Usado por                                     | Taxonomía                                                                                                                    |
| ---------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **`payment`**    | Checkout **Pro**, Bricks, Checkout API legacy | estados clásicos de `/v1/payments`                                                                                           |
| `orders`         | Checkout API (Orders), Point, QR              | `created` / `processed` / `processing` / `action_required` / `charged_back` / `expired` / `refunded` / `failed` / `canceled` |

Confundirlas produciría un mapeo silenciosamente equivocado. **Por eso el mapeo
fino MP → Offside queda 🔵** y se completa contra la documentación del recurso
`payment` antes de escribir código, tal como ya exige `payments-and-commissions.md`
§6.1.b. **No se inventa acá.**

Lo que sí está decidido y no depende de esa verificación: la **estructura**
(estado normalizado + estado crudo + función de mapeo explícita), y que
`payments.mp_status` / `mp_status_detail` / `raw` conservan lo que MP dijo
(DEC-035 ✅).

### 10.3 Efecto sobre la orden (ya decidido)

| Payment                                            | Order                                                    |
| -------------------------------------------------- | -------------------------------------------------------- |
| `PENDING` / `IN_PROCESS`                           | sigue `PENDING_PAYMENT`                                  |
| `APPROVED`                                         | pasa a `PAID`, se descuenta stock                        |
| `REJECTED`                                         | **sigue `PENDING_PAYMENT`** — no se cancela (DEC-033 ✅) |
| `CANCELLED`                                        | no avanza a `PAID`                                       |
| `REFUNDED` / `PARTIALLY_REFUNDED` / `CHARGED_BACK` | no son estados de Order (DEC-034 ✅)                     |

---

## 11. Webhooks

### 11.1 Lo confirmado 🔴

- Topic **`payment`** para Checkout Pro. Otros topics relevantes a futuro:
  `topic_merchant_order_wh`, `topic_chargebacks_wh`,
  `topic_claims_integration_wh`, y **`mp-connect`**, que ya pertenece a
  `sellers`.
- Cuerpo: `id`, `live_mode`, `type`, `date_created`, `user_id`, `api_version`,
  `action` (ej. `payment.created`), `data.id`.
- Firma: header `x-signature` con formato `ts=…,v1=…`, más `x-request-id` y el
  `data.id`, validados contra el secreto de la aplicación.
- **Responder 200 o 201 dentro de 22 segundos.**
- Reintentos cada **15 minutos**; tras tres intentos los intervalos se extienden
  pero los reintentos continúan.

### 11.2 La plantilla de la firma ✅ CERRADO el 2026-08-26

**La plantilla exacta del string que se firma** (el orden y separadores de `id`,
`request-id` y `ts`) **no aparece literal en la documentación de Mercado Pago**;
MP recomienda usar sus SDK oficiales, que la implementan internamente.

Se implementó la plantilla de uso corriente, aislada en `buildManifest()`, y se
verificó contra una notificación real:

```
id:<data.id>;request-id:<x-request-id>;ts:<ts>;
```

Pago `175705424980`, notificación `payment.created`, `signature_valid = true` a
la primera. **No hizo falta ajustarla**, y el `data.id` firmado es el del QUERY
STRING, como dice la documentación.

⚠️ Nótese que la spec de OAuth §11 asume el mismo mecanismo para `mp-connect`:
lo que se verifique acá sirve para los dos, y **el validador de firma debe ser
uno solo, compartido**, no uno por módulo (🟡).

### 11.3 Procesamiento 🟡

```
1. Recibir  → validar firma  → 401 si es inválida
2. INSERT en payment_webhook_events   (UNIQUE ⇒ duplicado = no-op)
3. Responder 200 INMEDIATAMENTE                        ← < 22 s
4. Encolar el procesamiento en BullMQ
5. En el job: RECONSULTAR el pago a la API de MP        ← PC-041
6. Mapear, persistir crudo + normalizado, aplicar efectos
7. Auditar
```

**Se reconsulta siempre**; el payload del webhook sólo trae un id. No confiar en
el cuerpo es política explícita de PC-041 ✅.

Un webhook **no autenticado no se procesa ni se registra como válido**, pero sí
se cuenta: un pico de firmas inválidas es una señal de ataque.

---

## 12. Reembolsos

### 12.1 Lo confirmado 🔴

```
POST https://api.mercadopago.com/v1/payments/{id}/refunds
Authorization: Bearer <access_token>
X-Idempotency-Key: <clave>

{ "amount": 100 }     ← opcional: sin `amount` es reembolso TOTAL
```

- Se admiten **varios reembolsos parciales** sobre el mismo pago mientras la
  suma no supere el total.
- Respuesta: `id`, `payment_id`, `amount`, `status`, `date_created`, `source`.
- Errores documentados: `2024` (pago demasiado antiguo para reembolsar), `4041`
  (monto no numérico), `4296` (cargo ya reembolsado).

El error **2024 es material para el negocio**: existe una ventana temporal más
allá de la cual MP no permite reembolsar. Su duración exacta es 🔵.

### 12.2 Cómo reparte Mercado Pago un reembolso 🔴

Confirmado en la documentación oficial (versión pt de la guía de integración del
split):

> _"o valor devido ao cliente final será dividido e subtraído da conta do
> vendedor e da conta do Marketplace, sendo proporcional para as partes
> envolvidas"_

Es decir: **MP debita el reembolso de las dos cuentas, en proporción a lo que
cada una recibió.** Offside devuelve su parte del 6%; el vendedor, la suya.

Esto es coherente con **DEC-018** ✅ (la comisión correspondiente al importe
reembolsado la absorbe Offside) y **cierra** el 🔵 que había sobre si el
`marketplace_fee` se revierte.

🔵 Si Mercado Pago reintegra **su propia** comisión al reembolsar sigue sin estar
documentado. **Ya no es un problema de Offside**: ese costo está del lado del
vendedor, no del margen de Offside (§8.3).

### 12.3 Lo que Offside todavía no puede implementar ⚠️

`orders-and-refunds.md` deja abierta la pregunta que gobierna un refund real, y
esta spec **no la cierra**: si Offside **adelanta** el refund al comprador cuando
no puede recuperar la parte del vendedor (§5.5, 🟡 configurable, sin default).

Esta fase deja modelada la **estructura** (`refunds`, `seller_liabilities` ya
existen) y **no** el motor de decisión.

### 12.4 Chargebacks 🔵

El comportamiento del contracargo dentro de Split 1:1 —de qué cuenta se debita,
si se revierte el `marketplace_fee`— **no está documentado en las fuentes
consultadas y no se infiere del caso de reembolso**. `orders-and-refunds.md` §6
ya deja 🟡/🔵 quién absorbe el chargeback. Las tablas `chargebacks` y
`seller_liabilities` existen; el motor no se define acá.

---

## 13. Cancelaciones

| Caso                              | Comportamiento                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| Preferencia vencida sin pagar     | La orden sigue `PENDING_PAYMENT` hasta que venza `payment_deadline` (DEC-033 ✅)                |
| Vencimiento de la ventana de pago | Job de expiración (§21) cancela la orden. **Cancelar una orden no es cancelar un pago**         |
| Pago rechazado                    | **No cancela la orden.** Se admite reintento dentro de la ventana (DEC-033 ✅)                  |
| Cancelar un pago ya aprobado      | 🔵 no investigado en esta fase. Un pago aprobado se revierte por **refund**, no por cancelación |

🟡 Un reintento de pago **crea una preferencia nueva** sobre la misma orden. Por
lo tanto **una orden puede tener varios registros en `payments`**, y como máximo
uno aprobado. El ERD ya lo permite: `payments.order_id` no es único.

El `marketplace_fee` de un reintento es **el mismo** que el del intento
anterior: sale del snapshot de la orden, que es inmutable (§8.2).

---

## 14. Errores

| Situación                         | Tratamiento 🟡                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| Timeout al crear la preferencia   | La fila local queda `PENDING` con su `idempotency_key`; se reintenta con la **misma** clave |
| 4xx de MP                         | No se reintenta: es un error de la request. Se audita el estado HTTP, **nunca el cuerpo**   |
| 5xx de MP                         | Reintento con backoff exponencial                                                           |
| Vendedor sin conexión `connected` | Se rechaza **antes** de llamar a MP                                                         |
| Token expirado o revocado         | `sellers` lo detecta y lo informa; `payments` responde "vendedor no operativo" (§19)        |
| Cuenta no habilitada para split   | 🔵 no se conoce el código de error exacto. **No se inventa** (PC-021)                       |
| Discrepancia local ↔ MP           | **MP es la fuente de verdad** (PC-062 ✅); se concilia                                      |

Los códigos de error específicos de Mercado Pago siguen 🔵, igual que en la spec
de OAuth: se clasifican por lo observable (hubo respuesta o no, 2xx o no, el
cuerpo trae lo necesario o no), no por una taxonomía que todavía no se verificó.

---

## 15. Seguridad

| Amenaza                                                    | Mitigación                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Fuga del `access_token` del vendedor                       | Nunca sale de `sellers/infrastructure/`; `payments` usa `requestAsSeller` (§4.1)      |
| Webhook falsificado                                        | Validación de `x-signature` + `x-request-id` 🔴                                       |
| Webhook repetido                                           | `UNIQUE(idempotency_key)` en `payment_webhook_events`                                 |
| Cobro duplicado                                            | `X-Idempotency-Key` 🔴 + `UNIQUE` parcial en `payments.idempotency_key`               |
| Pago atribuido a la orden equivocada                       | `external_reference = orders.id` + verificación de `collector_id` contra `mp_user_id` |
| Manipulación del importe o de la comisión desde el cliente | Ambos salen **siempre** del snapshot de la orden, jamás del request                   |
| Confirmar un pago desde el frontend                        | Prohibido: sólo el webhook + reconsulta cambian estado (PC-040 ✅)                    |
| Credenciales en logs                                       | Prohibido: ni tokens, ni `client_secret`, ni payload crudo con credenciales           |

⚠️ **`payments.raw` guarda el payload crudo de MP (DEC-035).** Antes de
implementar hay que confirmar que ese payload **no contiene credenciales ni
datos de tarjeta**; si los contuviera, habría que filtrarlos antes de persistir.
🔵.

---

## 16. Auditoría

En `audit_log` (`entity_type='payment'`, `entity_id=payments.id`), usando el
módulo `audit` ya implementado, que **rechaza campos que sean credenciales**.

| Evento                                  | Actor                         | Metadata permitida                              |
| --------------------------------------- | ----------------------------- | ----------------------------------------------- |
| `PAYMENT_PREFERENCE_CREATED`            | `user`                        | orderId, preferenceId, amount, marketplaceFee   |
| `PAYMENT_APPROVED`                      | `system`                      | mpPaymentId, amount, mpStatus                   |
| `PAYMENT_REJECTED`                      | `system`                      | mpPaymentId, mpStatus, mpStatusDetail           |
| `PAYMENT_STATUS_CHANGED`                | `system`                      | before, after, origen (webhook / reconsulta)    |
| `PAYMENT_SPLIT_RECORDED`                | `system`                      | sellerAmount, marketplaceFeeAmount, mpFeeAmount |
| `REFUND_REQUESTED` / `REFUND_COMPLETED` | `user` \| `admin` \| `system` | montos, motivo                                  |
| `WEBHOOK_SIGNATURE_INVALID`             | `system`                      | ip, tipo de evento                              |

Prohibido: `access_token` · `refresh_token` · `client_secret` · datos de tarjeta
· payload crudo completo. **Ni truncados.**

---

## 17. Persistencia

### 17.1 Qué se conserva

| Dato                                 | Dónde                                                | Por qué                                                            |
| ------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------ |
| `mp_payment_id`                      | `payments`                                           | identidad del pago en MP                                           |
| `mp_preference_id`                   | `payments` (⚠️ §27)                                  | único identificador entre crear la preferencia y el primer webhook |
| estado normalizado + crudo + detalle | `payments.status` / `mp_status` / `mp_status_detail` | DEC-035                                                            |
| payload crudo                        | `payments.raw`                                       | auditoría e investigación (DEC-035)                                |
| clave de idempotencia                | `payments.idempotency_key`                           | evitar cobros duplicados                                           |
| reparto real informado por MP        | `payment_splits`                                     | ERD §26.2: la conciliación contra el snapshot comercial            |
| snapshot financiero                  | `orders`                                             | inmutable, DEC-030                                                 |
| cada webhook recibido                | `payment_webhook_events`                             | idempotencia y trazabilidad                                        |

**Con la decisión de §8, esto alcanza.** El `marketplace_fee` enviado **es**
`orders.commission_amount`: no hay un segundo número que guardar. El costo de MP
llega informado por MP y se registra, cuando está disponible, en
`payment_splits.mp_fee_amount` — que **ya existe**.

### 17.2 Qué NO se conserva

| Dato                                           | Motivo                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Datos de tarjeta** (PAN, CVV, vencimiento)   | Nunca llegan a Offside: el checkout es hospedado por MP. Es la razón de superficie PCI de DEC-027 |
| `access_token` / `refresh_token` en `payments` | Viven cifrados en `mercadopago_accounts`, y nada más                                              |
| `client_secret`                                | Sólo variable de entorno                                                                          |
| **Estimaciones del costo de MP**               | No existen (§8.4)                                                                                 |
| Comisión recalculada                           | El snapshot es la verdad; recalcular está prohibido (DEC-030)                                     |
| Estado derivado `can_sell`, saldo del vendedor | Derivados, no columnas                                                                            |

---

## 18. Relación Order → Payment → Seller → MP Account

```
users(buyer) ──< orders >── seller_profiles ──1:1── mercadopago_accounts
                   │  1                                   │
                   │                                       └─ mp_user_id  ≡  collector_id 🔴
                   ▼  N
                payments ──1:N── payment_splits
                   │              (reparto real informado por MP)
                   ├──1:N── refunds
                   └──1:N── chargebacks
```

- **1 orden = 1 vendedor** (DEC-026 ✅) ⇒ **1 orden = 1 split**, que es
  exactamente el modelo 1:1 de MP. No hace falta repartir entre N vendedores.
- **1 orden = N pagos**, como máximo uno aprobado (reintentos, §13).
- `orders` es la **fuente comercial**; `payment_splits` es **lo que MP repartió
  de verdad**. Nunca se sobrescribe una con la otra (ERD §26.2).

---

## 19. Frontera con Sellers / OAuth

|                   |                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| **`sellers` SÍ**  | conecta, refresca y revoca OAuth · guarda y descifra tokens · conoce `client_secret` · expone `requestAsSeller` |
| **`payments` NO** | implementa OAuth · refresca tokens · cambia estados de conexión · ve un token                                   |
| **`payments` SÍ** | pide una llamada autorizada · interpreta la respuesta en términos de pago                                       |

### 19.1 Qué pasa si el vendedor desconecta Mercado Pago

| Momento                              | Efecto                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Antes de crear la preferencia        | Se rechaza: `can_sell` es falso. La orden queda `PENDING_PAYMENT`                                        |
| Con una preferencia activa sin pagar | 🔵 **no verificado**: si MP invalida una preferencia creada con un token luego revocado. **No se asume** |
| Con un pago ya aprobado              | El dinero ya se repartió. Desconectar **no revierte** un pago (🟡, coherente con spec de OAuth §12)      |

⚠️ El caso intermedio importa: si MP **no** invalida la preferencia, un comprador
podría pagarle a un vendedor que Offside ya considera no operativo. Queda como
pregunta 🔵 de §26.

### 19.2 Qué pasa si el access token expira

- El token dura **180 días** 🔴 y se renueva con `offline_access` 🔴.
- **El refresh todavía no está implementado** (spec de OAuth §10, fuera de
  alcance de aquella fase). Sin refresh, a los 180 días la conexión muere y el
  vendedor no puede cobrar.
- ⇒ **El refresh de tokens es prerrequisito operativo de Payments**, no un
  extra. Ver §28.

---

## 20. Frontera con futuras liquidaciones

### 20.1 Lo que Split 1:1 ya resuelve

**El dinero no pasa por Offside.** MP acredita al vendedor en su cuenta y a
Offside su `marketplace_fee`. No hay una liquidación "de Offside al vendedor"
que construir: eso es justamente lo que evita el requisito de negocio de no
manejar manualmente el dinero del vendedor.

Con la decisión de §8, esto se cumple **sin ninguna corrección posterior**: cada
parte cobra lo suyo en el momento del pago y no queda nada pendiente entre
Offside y el vendedor.

### 20.2 Lo que NO resuelve

`orders-and-refunds.md` §4.b (DEC-019) decide que el dinero del vendedor **no se
considera liberado hasta que el comprador confirme conformidad**, y marca OR-007
como _"probablemente la investigación más importante del proyecto"_.

**Resultado de esta investigación:**

- 🔴 MP expone **`money_release_date`** en la respuesta del pago: la fecha en que
  el dinero queda disponible. Es **informativa**.
- 🔴 Sobre configurar la fecha de liberación, la documentación oficial dice que
  para _"configuraciones respecto a la fecha de liberación de la comisión
  (marketplace fee o application fee)"_ hay que **contactar a un ejecutivo
  comercial asignado**.
- 🔵 **No se encontró documentación de una retención programática del dinero del
  vendedor** —un "hold" liberado por Offside tras la conformidad del comprador—
  como parámetro de API de Split 1:1.

⚠️ **La mitigación que el negocio asumió para RISK-F1 no está confirmada como
funcionalidad autoservicio de Split 1:1.** Puede requerir un acuerdo comercial
con Mercado Pago, o un modelo distinto. **No se inventa un mecanismo de
retención.** Es la decisión ⚠️ nº 3 de §24.2 y **es independiente** de la
decisión de comisión de §8.

### 20.3 Lo que esta fase deja preparado

`payment_splits` (reparto real), `reconciliation_records` (conciliación
periódica) y `seller_liabilities` (deuda del vendedor) ya existen migradas. La
liquidación futura se construye sobre ellas sin tocar `payments`.

---

## 21. Jobs necesarios

| Job                         | Frecuencia   | Qué hace                                                                                                          |
| --------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `payment-webhook-processor` | por evento   | Procesa el webhook encolado: reconsulta a MP, mapea, aplica efectos. Idempotente                                  |
| `payment-status-reconciler` | 🟡 periódico | Reconsulta pagos que llevan demasiado tiempo `PENDING`/`IN_PROCESS`. **Red de seguridad ante un webhook perdido** |
| `order-payment-expirer`     | 🟡 periódico | Cancela órdenes cuyo `payment_deadline` venció (DEC-033). Usa `INDEX(status, payment_deadline)`, ya migrado       |
| `mercadopago-token-refresh` | cada 6 h     | **Ya especificado** en la spec de OAuth §18. Prerrequisito, no parte de esta fase                                 |

**No hay job de conciliación de fees.** El que existía en la versión anterior de
esta spec servía a la absorción (§8.4) y se retira. El reporte de ventas de MP
sigue disponible para finanzas, fuera del alcance del MVP.

Todos deben ser **idempotentes por su cuenta**: el reintento con backoff de
BullMQ no sustituye la idempotencia (`architecture-implementation.md`).

---

## 22. Matriz de estados

### 22.1 Payment × Order

| Payment        | Order antes        | Order después     | Efectos                                             |
| -------------- | ------------------ | ----------------- | --------------------------------------------------- |
| `PENDING`      | `PENDING_PAYMENT`  | `PENDING_PAYMENT` | ninguno                                             |
| `IN_PROCESS`   | `PENDING_PAYMENT`  | `PENDING_PAYMENT` | ninguno                                             |
| `APPROVED`     | `PENDING_PAYMENT`  | **`PAID`**        | `paid_at`, split, stock, auditoría                  |
| `APPROVED`     | `PAID`             | `PAID`            | **no-op** (webhook duplicado)                       |
| `REJECTED`     | `PENDING_PAYMENT`  | `PENDING_PAYMENT` | se habilita reintento (DEC-033)                     |
| `CANCELLED`    | `PENDING_PAYMENT`  | `PENDING_PAYMENT` | ninguno                                             |
| `REFUNDED`     | `PAID` o posterior | **sin cambio**    | refund no es estado de Order (DEC-034)              |
| `CHARGED_BACK` | cualquiera         | **sin cambio**    | genera `chargebacks` y posible `seller_liabilities` |

### 22.2 Conexión MP × capacidad de cobrar

| `mercadopago_accounts.status`                           | ¿Se puede crear preferencia?                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| _sin fila_ / `disconnected` / `expired` / `revoked`     | ❌                                                                  |
| `connected` + vendedor `approved`                       | ✅                                                                  |
| `connected` + vendedor `pending`/`suspended`/`expelled` | ❌ (`can_sell` ya lo resuelve)                                      |
| `connected` + vendedor `limited`                        | ⚠️ **PENDIENTE** — `limited` sigue sin definirse (spec de OAuth §3) |

---

## 23. Decisiones de arquitectura (🟡)

| ID             | Decisión                                                                                       | Motivo                                                          |
| -------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **MP-PAY-001** | `payments` consume la conexión vía `requestAsSeller`, nunca recibe el token                    | Preserva la frontera de secretos existente sin duplicar OAuth   |
| **MP-PAY-002** | La comisión se **lee** del snapshot de `orders`; `payments` no la calcula                      | DEC-030: el snapshot es la verdad de esa operación              |
| **MP-PAY-003** | `external_reference = orders.id`                                                               | Reconciliar webhook ↔ orden sin depender del `preference_id`    |
| **MP-PAY-004** | La fila local `payments` se crea **antes** de llamar a MP                                      | Un timeout no puede dejar un cobro sin registro local           |
| **MP-PAY-005** | El webhook responde 200 y procesa asíncrono en BullMQ                                          | Límite de 22 s 🔴                                               |
| **MP-PAY-006** | Siempre se reconsulta el pago a MP; nunca se confía en el payload                              | PC-041                                                          |
| **MP-PAY-007** | La conversión centavos ↔ decimal ocurre sólo en infraestructura                                | El dominio trabaja en `bigint` centavos (ERD §1)                |
| **MP-PAY-008** | Un reintento crea una preferencia nueva; N pagos por orden, máximo uno aprobado                | El ERD ya lo admite                                             |
| **MP-PAY-009** | El validador de firma de webhooks es **uno solo**, compartido con `mp-connect`                 | No duplicar lógica entre módulos                                |
| **MP-PAY-010** | `collector_id` de la respuesta se verifica contra `mp_user_id`                                 | Detecta que se esté cobrando a la cuenta equivocada             |
| **MP-PAY-011** | Errores de MP en categorías gruesas, como en OAuth                                             | Los códigos exactos siguen 🔵                                   |
| **MP-PAY-012** | **`marketplace_fee = orders.commission_amount`, sin ajustes**                                  | Decisión de negocio de §8: comisión simple y predecible         |
| **MP-PAY-013** | El 6% vive en el **Config Store** y se snapshotea por orden; **nunca** una constante en código | DEC-013/DEC-030/DEC-038                                         |
| **MP-PAY-014** | Se registra el reparto real que informa MP en `payment_splits`                                 | Lo exige el ERD §26.2. **No** alimenta ninguna lógica de ajuste |

---

## 24. Decisiones de negocio (⚠️)

### 24.1 Cerradas

| Decisión                                                                              | Estado                                                                                                                           |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Comisión de Offside** (DEC-007)                                                     | ✅ **CERRADA 2026-08-24: 6% del total de la venta.** Simple, sin mínimos, máximos ni ajustes. Se carga en el Config Store (§8.1) |
| **Quién absorbe el costo de Mercado Pago**                                            | ✅ **CERRADA 2026-08-24: nadie lo absorbe explícitamente.** MP cobra sus costos de forma nativa, del lado del vendedor (§8.3)    |
| **Estimación y conciliación de fees, restricción de medios/cuotas, cuenta corriente** | ✅ **FUERA DE ALCANCE** del MVP (§8.4)                                                                                           |

⚠️ **Estas decisiones reemplazan a PC-050.b / DEC-014** en
`docs/03-operations/payments-and-commissions.md` §7 y en `docs/DECISIONS.md`.
Esos documentos **todavía dicen que Offside absorbe la comisión de MP** y deben
actualizarse; esta especificación no puede editarlos (CLAUDE.md §3).

### 24.2 Abiertas

| #     | Decisión                                                                                               | Impacto si no se decide                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **1** | **Cómo se le comunica al vendedor** que su neto es `total − costo MP − 6%`, y que el costo de MP varía | Riesgo de expectativa: el vendedor puede creer que recibe `total − 6%`. **No bloquea el código**, sí la comunicación comercial |
| **2** | **Qué significa `limited`** para un vendedor                                                           | Ya bloqueaba OAuth; ahora también el cobro                                                                                     |
| **3** | **Retención/liberación de fondos** (DEC-019 / OR-007) a la luz de §20.2                                | Es la mitigación de RISK-F1. Puede exigir acuerdo comercial. **Independiente de la comisión**                                  |
| **4** | **Si Offside adelanta el refund** al comprador (§5.5)                                                  | Bloquea el motor de refunds, no el cobro                                                                                       |
| **5** | **Sandbox vs producción** para el MVP                                                                  | Define credenciales y pruebas                                                                                                  |
| **6** | **Modelo fiscal de la comisión** (DEC-011 🔴)                                                          | No bloquea el MVP en sandbox; **sí** el lanzamiento comercial                                                                  |

> **Ninguna de estas bloquea la implementación de Payments.** La nº 5 hay que
> resolverla antes de probar contra MP; el resto puede avanzar en paralelo.

---

## 25. Riesgos

| Riesgo                                                | Severidad         | Nota                                                                                                            |
| ----------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| **La retención de fondos no es autoservicio** (§20.2) | **Alta**          | RISK-F1 sin mitigación confirmada. **No depende de la comisión**                                                |
| Webhook perdido o firma mal validada                  | Alta              | Órdenes pagadas que Offside no registra. Mitiga el reconciliador                                                |
| **Expectativa del vendedor sobre su neto**            | Media             | Su neto varía con el costo de MP, que Offside no controla (§8.3). Es riesgo de comunicación, no técnico         |
| Cobrar sin refresh de tokens                          | Media             | A los 180 días el vendedor deja de poder cobrar                                                                 |
| Mapeo de estados equivocado                           | Media             | Dos taxonomías distintas en MP (§10.2)                                                                          |
| Redondeo centavos ↔ decimal                           | Media             | Diferencias de un centavo se acumulan en conciliación                                                           |
| Preferencia viva de un vendedor desconectado          | Media             | 🔵 sin verificar                                                                                                |
| Dependencia total de MP                               | Alta              | Ya registrado en `RISKS.md`                                                                                     |
| Costo de MP más alto de lo previsto                   | Baja para Offside | Con la decisión de §8 **no afecta el margen de Offside**; afecta el atractivo de la plataforma para el vendedor |

---

## 26. Preguntas bloqueantes

**Ninguna pregunta económica bloquea ya esta fase.** El costo de Mercado Pago
dejó de ser un bloqueo con la decisión de §8.

**Para el owner (⚠️):** ver §24.2. La única que hay que resolver antes de probar
contra Mercado Pago es **sandbox vs producción**.

**Para sandbox / primera integración (🔵) — bloquean la implementación:**

1. Lista literal de estados de `/v1/payments` y sus `status_detail` (§10.2).
   **Es la única 🔵 que bloquea escribir el mapeo de estados.**
2. Plantilla exacta del string firmado en `x-signature` (§11.2).

**Para sandbox / primera integración (🔵) — no bloquean:**

3. Si hay que enviar `sponsor_id` / `marketplace` cuando la preferencia se crea
   con el token del vendedor (§7.2).
4. Qué pasa con una preferencia creada antes de que el vendedor revoque (§19.1).
5. Comportamiento del **chargeback** dentro del split (§12.4).
6. Ventana temporal del error `2024` (pago demasiado antiguo para reembolsar).
7. Código de error de "cuenta no habilitada para split" (PC-021).
8. Requisitos de habilitación de la cuenta del vendedor para Split 1:1 (la spec
   de OAuth ya menciona **KYC nivel 6** 🔴).

**Conversación comercial con Mercado Pago — fuera del MVP (§8.4):** tarifario
preferencial, condiciones de acreditación, si existe un esquema donde el
marketplace asuma la tarifa, y configuración de la fecha de liberación (§20.2).
**No bloquea nada de esta especificación.**

---

## 27. Qué requiere cambio de ERD/schema

> **No implementado. Sólo documentado, como se pidió.**
>
> Con la decisión de §8, **la lista volvió a ser mínima**: los campos que
> existían para sostener la absorción del fee de MP se retiraron.

### `SCHEMA CHANGE REQUIRED` — necesario

| #     | Cambio                                                  | Por qué                                                                                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **`payments.mp_preference_id text`** + `UNIQUE` parcial | Con Checkout Pro la preferencia existe **antes** que el pago: es el único identificador que Offside tiene entre el paso 10 y el primer webhook. Hoy **no hay dónde guardarlo**. Sin esto no se puede reintentar de forma idempotente ni reconciliar un checkout abandonado |

**Es el único cambio imprescindible de toda esta fase.**

### `SCHEMA CHANGE REQUIRED` — recomendado, no imprescindible

| #   | Cambio                                    | Por qué                                                  | Alternativa                                |
| --- | ----------------------------------------- | -------------------------------------------------------- | ------------------------------------------ |
| 2   | `payments.money_release_date timestamptz` | 🔴 MP la informa; insumo de la liquidación futura (§20)  | Vive en `raw`, no consultable ni indexable |
| 3   | `payments.mp_merchant_order_id text`      | MP agrupa pagos de una preferencia en una merchant order | Derivable por reconsulta                   |

### Retirados por la decisión de §8

| Campo                                     | Por qué se retira                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| ~~`payments.marketplace_fee_amount`~~     | Existía porque el fee enviado difería de la comisión nominal. **Ahora son el mismo número**: `orders.commission_amount` |
| ~~`payments.estimated_mp_fee_amount`~~    | No hay estimación del costo de MP (§8.4)                                                                                |
| ~~`payment_splits.financing_fee_amount`~~ | Servía a la conciliación de fees, que no se implementa                                                                  |
| ~~`payment_splits.net_received_amount`~~  | Ídem. `payment_splits.raw` conserva lo que MP informe                                                                   |
| ~~Cuenta corriente por vendedor~~         | No hay diferencias de estimación que compensar                                                                          |

### Lo que NO hace falta cambiar

`orders` cubre el snapshot financiero completo (incluidos `commission_amount`,
`commission_rate_at_transaction`, `discount_amount`, `offside_amount`,
`seller_tier_code_at_transaction`); `payment_splits` ya tiene `seller_amount`,
`marketplace_fee_amount` y `mp_fee_amount`; `payment_webhook_events`, `refunds`,
`chargebacks`, `seller_liabilities` y `reconciliation_records` cubren el resto.
**El ERD aguanta la fase con un solo agregado.**

⚠️ Cualquiera de estos cambios es **ARQUITECTÓNICO** (CLAUDE.md §5) y requiere
autorización explícita antes de tocar el schema.

---

## 28. Plan de implementación posterior

**Payments no es la próxima tarea implementable.** Le faltan insumos que no
dependen de Mercado Pago:

```
0. Config Store operativo          app_settings + lectura tipada + comisión 6% cargada
1. listings / catálogo             no se puede vender lo que no existe
2. cart                            (o compra directa, si se decide saltearlo)
3. orders                          creación, snapshot financiero, ventana de pago
4. refresh de tokens MP            spec de OAuth §10 y §18
5. ► PAYMENTS  ◄                   esta especificación
6. refunds / disputas / liquidación
```

Dentro del paso 5, el orden sugerido:

1. `requestAsSeller` en `sellers` (§4.1) + validador de firma compartido.
2. `modules/payments`: repositorios sobre las tablas ya migradas.
3. Creación de preferencia + idempotencia + `init_point`.
4. Endpoint de webhook + registro idempotente + respuesta rápida.
5. Job de procesamiento con reconsulta + mapeo de estados (tras cerrar 🔵 nº 1
   de §26).
6. Transición de la orden a `PAID` + `payment_splits` + auditoría.
7. Reconciliador de pagos huérfanos.
8. Refunds, **sólo** después de cerrar ⚠️ §24.2 nº 4.

**Qué hace falta para empezar:**

|                                         |                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| ✅ Ya resuelto                          | Comisión: **6%**. Costo de MP: **comportamiento nativo**. Sin estimadores ni conciliaciones |
| ⚠️ Falta cargar                         | El 6% como `commission_rate_default` en `app_settings` (parte del paso 0)                   |
| ⚠️ Autorizar                            | **Un** cambio de schema: `payments.mp_preference_id` (§27)                                  |
| 🔵 Verificar antes de escribir el mapeo | Estados de `/v1/payments` y plantilla de `x-signature`                                      |
| 📄 Actualizar `docs/`                   | PC-050.b / DEC-014 y DEC-007, que quedaron desalineados (§24.1)                             |

---

## 29. Relación con la documentación existente

| Documento                                                  | Relación                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `docs/03-operations/payments-and-commissions.md`           | **Fuente de verdad de negocio.** ⚠️ §7 (PC-050.b) quedó **desalineado** por la decisión de §8.3                       |
| `docs/03-operations/orders-and-refunds.md`                 | Refunds, chargebacks, liberación de fondos, conciliación                                                              |
| `docs/04-technical/database-design.md` §11–12              | Modelo de datos. Esta spec propone **un** cambio necesario (§27)                                                      |
| `docs/DECISIONS.md`                                        | DEC-004, **007 (cerrada acá: 6%)**, 011, **014 (desalineada)**, 016, 017, 018, 026, 027, 028, 030, 033, 034, 035, 038 |
| [mercadopago-oauth-spec.md](mercadopago-oauth-spec.md)     | **Paso anterior.** Payments consume la conexión; no la administra                                                     |
| [mercadopago-oauth-module.md](mercadopago-oauth-module.md) | Cómo quedó implementada esa conexión                                                                                  |
| `CLAUDE.md` §5, §11, §12                                   | Cambios arquitectónicos, integraciones aisladas, Config Store                                                         |

**Esta especificación es la fuente concreta de Payments con Split 1:1.** Los
documentos generales deberían referenciarla, no duplicarla.
