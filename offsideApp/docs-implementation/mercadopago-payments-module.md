# Módulo Mercado Pago Payments — implementación

Cómo quedó implementado el cobro de una orden con **Checkout Pro + Split 1:1**.
**Fecha: 2026-08-25.**

> Este documento describe el **código**. El contrato de diseño es
> [mercadopago-payments-spec.md](mercadopago-payments-spec.md), y la fuente de
> verdad del proyecto sigue siendo `docs/` (CLAUDE.md §13).

## Alcance de lo implementado

✅ Checkout (preferencia sobre la cuenta del vendedor) · `marketplace_fee` = 6% ·
`mp_preference_id` persistido · `external_reference` · idempotencia ·
`init_point` · webhook con validación de firma · reconsulta del pago a MP ·
mapeo de estados · transición de la orden a `PAID` · `payment_splits` · refunds
total y parcial · `audit_log` · rate limiting · tests.

⏸ **Fuera del MVP:** estimación del costo de MP · conciliación estimado-vs-real ·
restricción de medios de pago/cuotas · cuenta corriente por vendedor ·
chargebacks · disputas · liquidación · job de conciliación · refresh de tokens
(pertenece a OAuth) · frontend.

## Decisiones de negocio que rigen el código

|                           |                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Comisión de Offside**   | **6% del total** (DEC-043, cierra DEC-007)                                                                   |
| **`marketplace_fee`**     | `orders.commission_amount`, **íntegro y sin ajustes**                                                        |
| **Costo de Mercado Pago** | **Independiente.** Offside no lo absorbe; MP lo descuenta del lado del vendedor, como es nativo en Split 1:1 |
| **Neto del vendedor**     | `total − costo MP − 6%`                                                                                      |

Con una venta de $100.000 y un costo de MP de $5.000: el vendedor recibe
$89.000 y Offside cobra $6.000 completos.

## Archivos

| Archivo                                                                                                                                    | Rol                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `modules/payments/infrastructure/mercadopago/mercadopago-payments.client.ts`                                                               | **Único** lugar con endpoints y campos de pagos de MP. Convierte centavos ↔ decimal |
| `modules/payments/infrastructure/mercadopago/payment-status.mapper.ts`                                                                     | Mapeo estado MP → estado Offside, **aislado en un archivo**                         |
| `modules/payments/repositories/payment.repository.ts`                                                                                      | `payments` + `payment_splits`                                                       |
| `modules/payments/repositories/payment-webhook.repository.ts`                                                                              | `payment_webhook_events`, con la detección de duplicado                             |
| `modules/payments/repositories/refund.repository.ts`                                                                                       | `refunds`                                                                           |
| `modules/payments/services/payment.service.ts`                                                                                             | Checkout: valida, crea el pago local, pide la preferencia                           |
| `modules/payments/services/payment-webhook.service.ts`                                                                                     | Registro idempotente + reconsulta + sincronización de estado                        |
| `modules/payments/services/refund.service.ts`                                                                                              | Reembolso total y parcial                                                           |
| `modules/payments/controllers/payment.controller.ts`                                                                                       | Valida, aplica rate limit, traduce a HTTP                                           |
| `modules/payments/payments.errors.ts`                                                                                                      | Errores de dominio                                                                  |
| `modules/orders/`                                                                                                                          | **Rebanada mínima** (ver abajo)                                                     |
| `lib/mercadopago-webhook-signature.ts`                                                                                                     | Validador de firma **compartido** con `mp-connect`                                  |
| `modules/sellers/infrastructure/mercadopago/mercadopago-api.client.ts`                                                                     | Ejecutor de llamadas autenticadas como el vendedor                                  |
| `app/api/checkout/[orderId]/route.ts` · `app/api/payments/[paymentId]/refunds/route.ts` · `app/api/webhooks/mercadopago/payments/route.ts` | Route Handlers: sólo delegan                                                        |

## Arquitectura

```
Route Handler → Controller → Service → Repository
                                    └→ payments/infrastructure/mercadopago/
                                              │  (qué pedir)
                                              ▼
                                       sellers.requestAsSeller
                                              │  (con qué identidad)
                                              ▼
                                       api.mercadopago.com
```

### La frontera de secretos se mantiene intacta

`payments` **nunca ve un token**. Pide la llamada; `sellers` la ejecuta:

```ts
// sellers/services/mercadopago-connection.service.ts
export async function requestAsSeller(sellerId, request): Promise<AuthorizedResponse>;
```

El token se descifra dentro de `sellers/infrastructure/mercadopago/mercadopago-api.client.ts`,
se usa y se descarta. `payments` no conoce `TOKEN_ENCRYPTION_KEY`, no
reimplementa OAuth y no tiene una segunda abstracción de credenciales.

Si la conexión no está `connected`, `requestAsSeller` **falla antes de salir a
la red**.

### `modules/orders` es una rebanada mínima, no el módulo

Sólo tiene lo que `payments` necesita: leer una orden con sus ítems, marcarla
`PAID` y registrar la transición. Existe porque **un módulo no puede importar el
repository de otro** (`modules/README.md`); crear una lectura de `orders` dentro
de `payments` habría roto esa regla.

Incluye `calculateCommission()` —el 6%— porque es donde va a vivir cuando exista
el módulo completo. `payments` **no la usa**: lee el snapshot ya congelado.

⚠️ `COMMISSION_RATE_BASIS_POINTS` es provisional en código. Su lugar definitivo
es `app_settings.commission_rate_default` (DEC-013/DEC-038), que no existe
todavía. Está en **una** constante para que migrarla sea un cambio de una línea.

## Endpoints

| Endpoint                                  | Auth                                        | Respuesta                                                          |
| ----------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| `POST /api/checkout/{orderId}`            | sesión + email verificado + orden propia    | `{ paymentId, initPoint, marketplaceFeeAmount }` — **no redirige** |
| `POST /api/webhooks/mercadopago/payments` | **firma**, no sesión                        | `200 { outcome }` · `401` si la firma es inválida                  |
| `POST /api/payments/{paymentId}/refunds`  | **admin** (`SUPER_ADMIN`/`ADMIN`/`FINANCE`) | `201 { id, type, status, amount, … }`                              |

Errores nuevos en `lib/http.ts`: `ORDER_NOT_FOUND` 404 · `ORDER_NOT_PAYABLE` 409
· `PAYMENT_DEADLINE_EXPIRED` 409 · `PAYMENT_NOT_FOUND` 404 ·
`PAYMENT_NOT_REFUNDABLE` 409 · `PAYMENT_PROVIDER_ERROR` 502 ·
`REFUND_AMOUNT_INVALID` 422.

Rate limiting: scopes `checkout` y `refund` sobre el mecanismo existente.

### Por qué el refund es sólo admin

La política de reembolsos —quién puede pedirlo, con qué plazos, si Offside
adelanta el dinero cuando no puede recuperar la parte del vendedor— sigue 🟡 sin
decidir (`orders-and-refunds.md` §5.5). Exponerlo al comprador o al vendedor
implicaría inventarla. El endpoint implementa la **mecánica**, no la política.

## Idempotencia

| Punto                     | Mecanismo                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Doble clic en el checkout | Se reutiliza el pago `PENDING` con preferencia: devuelve el **mismo** `initPoint`                                |
| Crear preferencia         | `X-Idempotency-Key` = `payments.idempotency_key` (UUID de la fila local)                                         |
| Webhook repetido          | `UNIQUE(payment_webhook_events.idempotency_key)`: se inserta primero y la violación **es** la señal de duplicado |
| Reprocesar el mismo pago  | El sync aplica el estado que MP informa **ahora**, no un delta                                                   |
| Orden ya pagada           | `markAsPaid` transiciona sólo desde `PENDING_PAYMENT`: el segundo webhook no duplica el split                    |
| Reembolso                 | `X-Idempotency-Key` = `refunds.id`                                                                               |

**La fila local siempre se crea antes de llamar a Mercado Pago.** Si la llamada
se cae, queda un `PENDING` reconciliable en vez de un cobro sin registro.

⚠️ Drizzle **envuelve** el error de PostgreSQL: el código `23505` viaja en
`cause`. La detección de duplicado recorre la cadena de causas; mirar sólo el
primer nivel rompía la idempotencia del webhook (lo encontró el test).

## Webhooks

```
1. Validar firma        → 401 y no se procesa nada si falla
2. INSERT del evento    → duplicado = no-op
3. Responder 200        → 🔴 MP corta a los 22 s
4. RECONSULTAR el pago a la API de MP   ← nunca se confía en el payload
5. Mapear, persistir crudo + normalizado, aplicar efectos
6. Auditar
```

El vendedor con el que se consulta sale del `user_id` de la notificación,
resuelto contra `mercadopago_accounts`; si el pago ya está vinculado, del
vendedor de la orden. **No hay un tercer camino inventado**: sin ninguno de los
dos, el evento queda registrado sin efecto (`unknown_payment`).

⚠️ **La plantilla exacta del string firmado sigue 🔵.** Mercado Pago documenta el
mecanismo (`x-signature` `ts=…,v1=…` + `x-request-id` + `data.id` + secreto) pero
no publica la plantilla literal; recomienda sus SDK. Está **aislada en
`buildManifest()`**: si la verificación real falla, se corrige ahí y en ningún
otro lado.

## Estados

Mapeo implementado (`payment-status.mapper.ts`):

| Mercado Pago               | Offside                                  |
| -------------------------- | ---------------------------------------- |
| `pending`                  | `PENDING`                                |
| `in_process`, `authorized` | `IN_PROCESS`                             |
| `approved`                 | `APPROVED`                               |
| `rejected`                 | `REJECTED`                               |
| `cancelled`                | `CANCELLED`                              |
| `refunded`                 | `REFUNDED`                               |
| `charged_back`             | `CHARGED_BACK`                           |
| `in_mediation`             | **sin mapeo deliberado**                 |
| desconocido                | **sin transición** + warning + auditoría |

`in_mediation` no se mapea porque la disputa es un ciclo de vida separado
(DEC-034): forzarlo a `IN_PROCESS` mentiría sobre el pago y a `CHARGED_BACK`
daría por perdida una mediación abierta.

Un pago en estado terminal (`REJECTED`/`CANCELLED`/`CHARGED_BACK`) **no vuelve
atrás** por un webhook viejo que llegue tarde.

Efectos sobre la orden: `APPROVED` → `PAID`; **`REJECTED` no cancela la orden**
(DEC-033); refunds y chargebacks no son estados de Order (DEC-034).

## Refunds

- **Total**: se manda sin `amount` 🔴 → el pago queda `REFUNDED`.
- **Parcial**: se manda `amount` → el pago queda `PARTIALLY_REFUNDED`.
- Varios parciales mientras la suma no supere el total 🔴; el saldo disponible se
  calcula sobre los refunds no rechazados.
- Si MP rechaza, el refund local queda `REJECTED` y **el pago sigue `APPROVED`**:
  no se devolvió nada.

🔴 **Offside no calcula el reparto de la devolución**: MP debita
proporcionalmente de la cuenta del vendedor y de la del marketplace.

## Variables de entorno

Ninguna nueva. Usa las que ya existían:

| Variable                     | Para qué                               |
| ---------------------------- | -------------------------------------- |
| `MERCADOPAGO_WEBHOOK_SECRET` | validación de la firma del webhook     |
| `TOKEN_ENCRYPTION_KEY`       | lo usa `sellers` al descifrar el token |
| `APP_URL`                    | `notification_url` y `back_urls`       |

## Cambio de schema

**Uno solo**, `0002_payments_mp_preference_id.sql`:

```sql
ALTER TABLE "payments" ADD COLUMN "mp_preference_id" text;
CREATE UNIQUE INDEX "payments_mp_preference_id_key" ON "payments" ("mp_preference_id")
  WHERE "mp_preference_id" IS NOT NULL;
```

Con Checkout Pro la preferencia existe **antes** que el pago: es el único
identificador entre crear el checkout y el primer webhook.

**No se agregaron** `marketplace_fee_amount` ni `estimated_mp_fee_amount` en
`payments`, ni campos de conciliación, ni cuenta corriente: la decisión del 6%
los hizo innecesarios (spec §27).

## Tests

|                                                                                   |                                                                                               |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `modules/orders/services/order.service.test.ts`                                   | 7 — el 6%, redondeo, nunca supera el total                                                    |
| `modules/payments/infrastructure/mercadopago/payment-status.mapper.test.ts`       | 16 — mapeo, `in_mediation`, desconocidos                                                      |
| `modules/payments/infrastructure/mercadopago/mercadopago-payments.client.test.ts` | 17 — `marketplace_fee`, `external_reference`, conversión de importes, refund total vs parcial |
| `lib/mercadopago-webhook-signature.test.ts`                                       | 13 — firma válida, alterada, faltante, formato inválido                                       |
| `modules/payments/payments.integration.test.ts`                                   | **29** — PostgreSQL y Redis reales                                                            |

La integración cubre: comisión del 6% enviada a MP, vendedor correcto, fila local
creada antes de la llamada, **ownership** (orden de otro comprador), orden no
pagable, ventana vencida, vendedor sin MP, doble checkout idempotente, webhook
aprobado → orden `PAID`, `payment_splits` con el costo real de MP, **webhook
duplicado**, reprocesamiento, reconsulta que ignora un payload mentiroso, pago
rechazado que no cancela la orden, `in_mediation`, topics ignorados, cuenta
desconocida, refund total, parcial, suma que excede, refund duplicado, refund
rechazado por MP, auditoría y un **barrido que verifica que ningún registro de
`audit_log` contenga un token**.

**No sale a internet**: `requestAsSeller` está mockeado.

## Gaps conocidos del flujo

- **El stock no se descuenta al aprobar el pago.** La spec §22.1 lo menciona
  (MF-022 anti-overselling) y **no está implementado**: `listings` no tiene
  módulo que lo gobierne. Un pago aprobado deja el stock intacto.
- **No hay job de expiración** de la ventana de pago: las órdenes se crean con
  `payment_deadline` NULL porque el plazo sigue 🟡 (DEC-033).
- **`chargebacks`, `seller_liabilities` y `reconciliation_records`** están
  migradas y vacías.

## Lo que falta para usarlo de verdad

1. **Publicar listings desde la app**: hoy una publicación sólo existe si se
   inserta en la base. Es el último eslabón para probar el flujo sin SQL.
2. **Config Store**: el 6% tiene que salir de `app_settings`, no de una constante.
3. **Refresh de tokens de MP**: sin él, la conexión muere a los 180 días.
4. **Registrar la app en Mercado Pago** y cargar `MERCADOPAGO_WEBHOOK_SECRET`.
5. **Verificar en sandbox** los dos 🔵: plantilla de la firma y lista literal de
   estados de `/v1/payments`.
