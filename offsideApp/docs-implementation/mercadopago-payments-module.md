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

✅ **La plantilla del string firmado quedó VERIFICADA el 2026-08-26.** Mercado
Pago documenta el mecanismo (`x-signature` `ts=…,v1=…` + `x-request-id` +
`data.id` + secreto) pero no publica la plantilla literal; recomienda sus SDK.
Se implementó la de uso corriente, aislada en `buildManifest()`, y la primera
notificación real validó a la primera. Sigue aislada por si MP la cambia.

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

## Stock: anti-overselling

El stock **se descuenta al aprobarse el pago**, nunca antes (MF-022 / BR-022).
Agregar al carrito no reserva, y reservar al crear la orden exigiria una
politica de expiracion de reservas que sigue PENDIENTE (marketplace-flow.md
§4.2).

Hay dos lineas de defensa, y hacen falta las dos:

**1. Revalidacion en el checkout** (UC-MF-3). Antes de crear la preferencia se
verifica que haya stock. Si no lo hay, **no se cobra**: `LISTING_OUT_OF_STOCK`,
y Mercado Pago ni se entera. Es una lectura, no una reserva.

**2. Descuento atomico al aprobarse** (`listingRepo.decrementStock`). Corre
dentro de la misma transaccion que el paso de la orden a `PAID`.

```sql
UPDATE listings SET stock = stock - $q
 WHERE id = $1 AND stock >= $q
RETURNING stock
```

La condicion va **adentro del `WHERE`, no en un `if` previo**. Leer y despues
escribir deja una ventana entre las dos operaciones: dos pagos simultaneos de la
ultima unidad leerian `stock = 1` y ambos escribirian `stock = 0`, vendiendo dos
veces lo mismo. Con la condicion en el UPDATE, PostgreSQL bloquea la fila y
reevalua el `WHERE` contra la version ya actualizada, asi que el segundo no
encuentra fila y no descuenta. Hay un test que lo ejercita con dos descuentos
concurrentes reales.

El `CHECK (stock >= 0)` de la tabla es la ultima red, no el control.

La idempotencia sale gratis: el descuento va despues de `markAsPaid`, que solo
transiciona una vez, asi que un webhook repetido no vuelve a descontar.

### El caso residual sigue sin decidir

Entre la revalidacion del checkout y la aprobacion del pago hay una ventana
—minutos, mientras el comprador tipea la tarjeta— en la que alguien puede
llevarse la ultima unidad. Ahi **el dinero ya se cobro**.

La documentacion cubre el caso en el checkout (UC-MF-3: revalidar y no cobrar)
pero **no dice que hacer con un pago ya aprobado sin stock**. Reembolsar por
cuenta propia seria inventar una politica de negocio.

Lo implementado es deliberadamente neutral: la orden queda `PAID` y se registra
`ORDER_PAID_WITHOUT_STOCK` en `audit_log` con las publicaciones que faltaron.
**No decide, pero no esconde.** Cuando exista la decision, el enganche ya esta.

⚠️ Tampoco esta definido si el stock **vuelve** al reembolsarse una orden, ni si
una publicacion con `stock = 0` debe pasar a `sold_out`. Ninguna de las dos se
implemento: el enum tiene el valor, pero la transicion inversa —y que pasa con
un refund— no esta documentada. Con `stock = 0` la publicacion ya **no es
comprable** (ERD §9.1), asi que no hay agujero funcional.

## Prueba real de punta a punta (2026-08-26)

Flujo completo contra Mercado Pago real, sin tocar SQL en el medio salvo para
lo que todavía no tiene endpoint (aprobar al vendedor y crear la categoría).

| Paso                         | Resultado                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Vendedor conectado por OAuth | `mp_user_id 3520857096`, token cifrado                                       |
| Listing publicado por la API | `201`                                                                        |
| Orden                        | `OFF-4EF36D2340`, total `100000`                                             |
| Comisión snapshot            | `6000` = **6% exacto** (DEC-043)                                             |
| Preferencia                  | `pref_id` con prefijo `3520857096` → creada **sobre la cuenta del vendedor** |
| `marketplace_fee` enviado    | `6000`, idéntico a `orders.commission_amount`                                |
| Pago                         | `175705424980`, aprobado, $1.000 con dinero en cuenta                        |
| Webhook                      | `payment.created`, `signature_valid = true`, `processed = true`, sin error   |
| Orden                        | `PENDING_PAYMENT` → **`PAID`** sin intervención                              |

### El reparto real confirma DEC-043

```
amount                  100000
marketplace_fee_amount    6000   ← Offside, 6%
mp_fee_amount             4100   ← costo de Mercado Pago
seller_amount            89900   ← 100000 - 6000 - 4100
```

⚠️ **`payment_splits.seller_amount` (89900) NO coincide con
`orders.seller_amount` (94000), y está bien.** Son dos cosas distintas, tal como
las separa el ERD §26.2: `orders` es la fuente comercial —lo que Offside promete
descontando sólo su 6%— y `payment_splits` es lo que Mercado Pago efectivamente
repartió.

La diferencia de `4100` es el costo de MP, y **lo descuenta del lado del
vendedor**. Es exactamente lo que decidió DEC-043 al revocar la idea de
absorberlo: Offside cobra un 6% limpio y predecible, y el costo de MP es
independiente. Primera confirmación empírica de esa decisión.

`mp_fee_amount` **sí queda registrado**, así que el costo real es auditable.

### Barrido de secretos

`audit_log`, `payments.raw` y `payment_webhook_events.payload` buscando
`APP_USR`, `access_token`, `refresh_token`, `client_secret`, `code_verifier`,
`password` y `cookie`: **0 coincidencias en las tres**.

### ⚠️ Split exige TRES cuentas de prueba, no dos

El hallazgo que más tiempo costó, y que no está en la documentación de MP de
forma evidente.

En Split hay **tres** partes y Mercado Pago exige que las tres pertenezcan al
mismo mundo. Si una es real y las otras de prueba, el checkout falla con
_"Una de las partes con la que intentás hacer el pago es de prueba"_, sin
aclarar cuál.

| Rol                          | Qué es                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Marketplace / integrador** | Offside. La cuenta **dueña de la aplicación**, la que aporta `client_id`/`client_secret` y cobra el `marketplace_fee` |
| **Vendedor**                 | quien conecta por OAuth                                                                                               |
| **Comprador**                | quien paga                                                                                                            |

El panel de cuentas de prueba tiene un tipo dedicado: **Marketplace** —
_"para simular a los intermediarios en pruebas con Split de Pagos"_.

Consecuencia práctica: **la aplicación de pruebas debe crearse desde una cuenta
de prueba de tipo Marketplace**, no desde la cuenta real. Una cuenta de prueba
puede iniciar sesión en el panel de developers y crear aplicaciones con
normalidad.

Al crearla hay que completar **la categoría del negocio** y poner **PKCE en
`Sí`**: con el perfil incompleto, la autorización falla con _"La aplicación no
está preparada para conectarse a Mercado Pago"_.

⚠️ Y la cuenta que autoriza no puede ser la Marketplace: una aplicación no
puede conectarse a sí misma, y MP responde `400` sin explicar.

## Lo que falta para usarlo de verdad

1. ~~Publicar listings desde la app~~ ✅ implementado y usado en esta prueba.
2. ~~Registrar la app en Mercado Pago y cargar `MERCADOPAGO_WEBHOOK_SECRET`~~ ✅.
3. ~~Verificar los dos 🔵~~ ✅ los dos cerrados: plantilla de la firma y lista
   literal de estados de `/v1/payments`.
4. **Config Store**: el 6% sigue siendo una constante y tiene que salir de
   `app_settings` (§12 de CLAUDE.md).
5. **Refresh de tokens de MP**: sin él, la conexión muere a los 180 días.
6. ~~El stock no se descuenta al aprobarse el pago~~ ✅ implementado, con
   revalidación en el checkout y descuento atómico al aprobarse.
7. **Qué hacer con un pago aprobado sin stock** 🟡: hoy se audita y queda para
   resolución manual (ver arriba).
8. **Refunds sin probar contra MP real**: el código está, la prueba no.
