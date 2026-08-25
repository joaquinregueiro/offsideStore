# Módulo Mercado Pago OAuth — implementación

Cómo quedó implementada la **conexión** de la cuenta de Mercado Pago de un
vendedor. **Fecha: 2026-08-24.**

> Este documento describe el **código**. El contrato de diseño es
> [mercadopago-oauth-spec.md](mercadopago-oauth-spec.md), y la fuente de verdad
> del proyecto sigue siendo `docs/` (CLAUDE.md §13).

## Alcance de lo implementado

✅ State store en Redis · generación de `state` · PKCE S256 · `connect` ·
cliente OAuth aislado · `callback` · intercambio `authorization_code` → tokens ·
cifrado de credenciales · persistencia en `mercadopago_accounts` · resolución de
conflictos por `mp_user_id` · `status` · `disconnect` · `audit_log` · tests.

⏸ **No implementado, por decisión explícita:** refresh de tokens y su rotación
(spec §10), webhook `mp-connect` (§11), Payments, `marketplace_fee`, comisiones,
refunds, chargebacks, ARCA y frontend.

## Archivos

| Archivo                                                                     | Rol                                                                           |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/utils/src/crypto.ts`                                              | Primitiva AES-256-GCM **pura**: recibe la clave por parámetro, no lee entorno |
| `modules/sellers/infrastructure/mercadopago/token-cipher.ts`                | **Único** lugar que resuelve `TOKEN_ENCRYPTION_KEY` y ve un token en claro    |
| `modules/sellers/infrastructure/mercadopago/mercadopago-oauth.port.ts`      | Interfaz que conoce el dominio + tipos de error                               |
| `modules/sellers/infrastructure/mercadopago/mercadopago-oauth.client.ts`    | Adapter HTTP. **Único** lugar con URLs, credenciales y campos de MP           |
| `modules/sellers/infrastructure/mercadopago/oauth-state.store.ts`           | Contexto efímero en Redis (`SET NX EX 600` / `GETDEL`)                        |
| `modules/sellers/services/pkce.ts`                                          | `code_verifier`, `code_challenge` S256 y `state`. Funciones puras             |
| `modules/sellers/services/mercadopago-connection.service.ts`                | Dominio: decide. No sabe HTTP ni hablar con MP                                |
| `modules/sellers/repositories/mercadopago-account.repository.ts`            | Acceso a `mercadopago_accounts`. Persiste texto opaco                         |
| `modules/sellers/controllers/mercadopago.controller.ts`                     | Valida, aplica rate limit, traduce a HTTP                                     |
| `modules/audit/`                                                            | Escritor de `audit_log` (**módulo nuevo**, ver abajo)                         |
| `lib/frontend-routes.ts`                                                    | Ruta de retorno del callback, aislada                                         |
| `app/api/sellers/mercadopago/{connect,callback,status,disconnect}/route.ts` | Route Handlers: sólo delegan                                                  |

## La frontera de secretos

Es la decisión estructural del módulo:

```
Mercado Pago  ──►  infrastructure/mercadopago/  ──►  Service  ──►  Repository
                   ve tokens en claro               NUNCA ve       texto opaco
                   los CIFRA acá                    un token
```

`exchangeAuthorizationCode()` devuelve `encryptedAccessToken` y
`encryptedRefreshToken` **ya cifrados**. El Service recibe además `mpUserId`,
`expiresAt`, `scopes`, `publicKey` y `liveMode`, y nada más. El dominio no puede
filtrar un secreto que nunca recibe.

`public_key` **no** se cifra: es pública por diseño (spec §8).

El `authorization_code` no se persiste, no se audita y no se loguea. El
`code_verifier` vive sólo en Redis.

## URLs de Mercado Pago

Verificadas contra la documentación oficial vigente y fijadas como **constantes**
en `mercadopago-oauth.client.ts`, no como variables de entorno:

|              |                                              |
| ------------ | -------------------------------------------- |
| Autorización | `https://auth.mercadopago.com/authorization` |
| Token        | `https://api.mercadopago.com/oauth/token`    |

Son parte del contrato del proveedor e iguales para todos los países. Ponerlas en
el entorno sólo habilitaría apuntar la aplicación a un host arbitrario.

## Variables de entorno

| Variable                    | Obligatoria | Para qué                                 |
| --------------------------- | ----------- | ---------------------------------------- |
| `MERCADOPAGO_CLIENT_ID`     | al conectar | `client_id` de la aplicación             |
| `MERCADOPAGO_CLIENT_SECRET` | al conectar | intercambio del code. **Sólo entorno**   |
| `MERCADOPAGO_REDIRECT_URI`  | al conectar | **sin fallback a `APP_URL`** (ver abajo) |
| `TOKEN_ENCRYPTION_KEY`      | al conectar | AES-256-GCM, 32 bytes en base64          |
| `APP_URL`                   | ya existía  | base de la URL de retorno al frontend    |

Las cuatro primeras se exigen con `requireEnv()` **en el borde del módulo**, no
al arrancar la app: el resto del sistema tiene que poder arrancar y testearse sin
credenciales de terceros.

`MERCADOPAGO_REDIRECT_URI` no se deriva de `APP_URL` a propósito: Mercado Pago
exige coincidencia exacta con la URI registrada, y un fallback silencioso
convertiría un error de configuración local en un rechazo remoto opaco.

## Contratos

| Endpoint                                   | Auth                                   | Respuesta                                               |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------------------- |
| `POST /api/sellers/mercadopago/connect`    | sesión + email verificado + `approved` | `{ authorizationUrl }` — **no redirige**                |
| `GET /api/sellers/mercadopago/callback`    | sesión, validada contra `state.userId` | **302** al frontend                                     |
| `GET /api/sellers/mercadopago/status`      | sesión                                 | `{ status, connectedAt, expiresAt, mpUserId, canSell }` |
| `POST /api/sellers/mercadopago/disconnect` | sesión                                 | `{ status: 'disconnected', … }`                         |

Retornos del callback: `?status=connected` · `?status=cancelled` ·
`?status=error&reason=invalid_state|exchange_failed|account_conflict|unavailable|unexpected`.
El motivo es siempre **genérico**; el detalle técnico queda sólo en `audit_log`.

Errores nuevos en `lib/http.ts`: `MP_SELLER_NOT_APPROVED` 409 ·
`MP_ALREADY_CONNECTED` 409 · `MP_NOT_CONNECTED` 409 · `MP_INVALID_STATE` 400 ·
`MP_EXCHANGE_FAILED` 502 · `MP_ACCOUNT_CONFLICT` 409 ·
`MP_CONNECTION_UNAVAILABLE` 503.

Rate limiting: scopes `mp-connect` y `mp-callback` sobre el mecanismo existente.

## Decisiones de implementación

### `modules/audit/` es un módulo nuevo

`audit_log` es transversal por diseño (ERD §19.1) y obligatorio ante credenciales
de MP, dinero, sanciones y configuración. Meterlo dentro de `sellers` habría
obligado a duplicarlo en cada módulo futuro.

El servicio **rechaza en tiempo de ejecución** cualquier campo llamado
`access_token`, `refresh_token`, `code`, `code_verifier`, `client_secret`,
`state`, `token`, `password` o `secret`. Es una red de seguridad, no la defensa
principal: una fuga a `audit_log` sería silenciosa y permanente, porque la tabla
es append-only.

La persistencia de credenciales y su auditoría van en **la misma transacción**.

### `requireOwnSellerProfile` se movió a `seller.service`

Estaba duplicada como función privada en el servicio fiscal. Ahora hay una sola
implementación, usada por identidad fiscal y por Mercado Pago, para que las dos
autoricen igual.

### Errores de Mercado Pago deliberadamente gruesos

`exchange_rejected` · `unreachable` · `invalid_response`. Los códigos exactos de
MP están 🔵 pendientes (spec §11 y §20): mapearlos ahora sería inventarlos. **El
cuerpo de una respuesta de error ni siquiera se lee**, porque puede arrastrar
datos de la request.

### Ausencias de la respuesta que fallan en vez de suponer

Sin `access_token`, sin `user_id` o sin `expires_in`, el intercambio **falla**.
En particular, MP-OAUTH-007 prevé un fallback a "un endpoint autenticado de MP"
cuando falte `user_id`, pero **la spec no dice cuál** y no se inventa uno
(CLAUDE.md §16). Sin `mp_user_id` no hay forma de saber qué cuenta se conectó, y
todas las reglas de conflicto de la spec §9 dependen de ese dato.

### `disconnect` sobre una conexión inexistente falla

La spec §12 no contempla el caso. Se eligió `MP_NOT_CONNECTED` antes que
responder `disconnected` sobre algo que nunca existió.

### Las credenciales cifradas no se borran al desvincular

`disconnected` significa "Offside dejó de usar esta conexión". Borrarlas no
aportaría seguridad —están cifradas— y perdería la trazabilidad de qué cuenta
estuvo vinculada.

### La cancelación del vendedor no se audita

`error=access_denied` no es un fallo del sistema y la spec §16 no lo incluye
entre los eventos auditables. Sí se descarta el contexto pendiente en Redis.

## Estado del vendedor: el gate `approved`

`connect` exige `seller_profiles.status = 'approved'` (spec §4, paso 5).

⚠️ **Hoy ningún vendedor puede alcanzar ese estado.** No existe flujo de
aprobación porque depende de **TS-001 — "qué significa identidad verificada"**,
que sigue 🟡 PENDIENTE. En la práctica el flujo completo **no es ejercitable
end-to-end** hasta que TS-001 se cierre: todo vendedor real recibe
`MP_SELLER_NOT_APPROVED`.

Relajar el gate a `pending` habría sido inventar la decisión que TS-001 no tomó,
y contradice BR-003/SS-012. Los tests de integración ponen `status='approved'`
**escribiendo directo en la base**, sin fabricar un endpoint de aprobación.

## `can_sell`

```
can_sell = seller_profiles.status = 'approved'  AND  mercadopago_accounts.status = 'connected'
```

Predicado **derivado**, nunca persistido. `limited` **no** entra: el enum lo
incluye pero la documentación no define qué limita (🟡).

## Tests

|                                                               |                                                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/utils/src/crypto.test.ts`                           | 14 — reversibilidad, IV aleatorio, detección de alteración, sin fugas en errores                      |
| `services/pkce.test.ts`                                       | 10 — longitudes, alfabeto base64url, vector del RFC 7636                                              |
| `infrastructure/mercadopago/oauth-state.store.test.ts`        | 7 — clave, TTL 600, `NX`, `GETDEL` de un solo uso                                                     |
| `infrastructure/mercadopago/mercadopago-oauth.client.test.ts` | 23 — parámetros de la URL, cuerpo del intercambio, **tokens cifrados al cruzar**, categorías de error |
| `services/mercadopago-connection.service.test.ts`             | 11 — matriz `can_sell` de la spec §3                                                                  |
| `mercadopago-oauth.integration.test.ts`                       | 30 — PostgreSQL y Redis reales, puerto OAuth inyectado                                                |

La integración cubre: contexto en Redis con TTL, auditoría de cada evento,
rechazo de vendedor no aprobado, `state` de un solo uso, `state` de otro usuario,
intercambio fallido sin persistir nada, los casos **B, C y D** de la spec §9,
`can_sell` en escenarios degradados, desvinculación que **no toca**
`seller_profiles.status`, y un **barrido que verifica que ningún registro de
`audit_log` contenga un token**.

**No sale a internet**: el puerto OAuth se inyecta, y el test no define
credenciales de MP justamente para que quitar la inyección lo haga fallar en vez
de salir a la red.

## Puesta en marcha contra Mercado Pago real

Verificado end-to-end el **2026-08-25** contra un VPS con Coolify y una cuenta
de prueba de vendedor. La conexión quedó `connected`, con `expiresAt` a 180 días
y `canSell: true`.

Lo que sigue es lo que **costó vueltas y no estaba documentado en ningún lado**.

### En el panel de Mercado Pago

| Requisito                                                                 | Por qué                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La aplicación debe crearse con el modelo **Marketplace / Split de pagos** | Una app de "Checkout Pro" a secas no puede pedir autorización a terceros: OAuth no se habilita                                                                                                                                         |
| **Activar las credenciales de producción**                                | Mientras no se activen, MP rechaza el flujo con _"La aplicación no está preparada para conectarse"_. Además, el **Client Secret sólo aparece ahí**: la pantalla de credenciales de prueba muestra únicamente Public Key y Access Token |
| Registrar la **Redirect URI** exacta                                      | `https://<dominio>/api/sellers/mercadopago/callback`                                                                                                                                                                                   |
| Habilitar **PKCE**                                                        | No alcanza con que Offside envíe los parámetros                                                                                                                                                                                        |

⚠️ **`client_id` es el "N.º de la aplicación", NO el "User ID".** MP muestra los
dos números juntos y se confunden con facilidad. El User ID es la cuenta dueña de
la aplicación; ponerlo como `client_id` hace que MP rechace la autorización.

⚠️ El `client_id` y el `client_secret` **son los mismos para prueba y para
producción**: identifican a la aplicación, no al ambiente. Lo que define si una
operación es de prueba es **con qué cuenta autoriza el vendedor**.

### En el entorno

| Variable                   | Detalle que rompe si se ignora                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MERCADOPAGO_REDIRECT_URI` | Debe coincidir **carácter por carácter** con la registrada, y apuntar a la ruta que existe: `/api/sellers/mercadopago/callback`                                                                                                   |
| `TOKEN_ENCRYPTION_KEY`     | **base64 de 32 bytes** (`openssl rand -base64 32`, 44 caracteres terminados en `=`). Una clave hex de 64 caracteres decodifica a 48 bytes y el cifrado falla **recién en el callback**, porque es el primer momento en que se usa |
| `APP_URL`                  | Es la base del redirect final al frontend. Si queda en `localhost`, el flujo funciona pero el navegador termina en una URL inexistente y no se ve el resultado                                                                    |

### El callback exige sesión activa en el MISMO navegador

El `state` se valida contra el usuario logueado (spec §4 paso 18). Si se autoriza
en una ventana donde no hay sesión de Offside —por ejemplo, una de incógnito
abierta sólo para Mercado Pago—, el callback devuelve
`?status=error&reason=invalid_state` aunque todo lo demás esté bien.

La cookie es `SameSite=lax`, que **sí** viaja en el redirect de vuelta desde
Mercado Pago: el problema no es la cookie, es que no exista.

⚠️ Hoy **no hay pantalla de login**, así que para probar hay que crear la sesión
a mano desde la consola del navegador:

```js
await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: '...', password: '...' }),
}).then((r) => r.json());
```

### Cómo se diagnostica un fallo

`audit_log` distingue los dos mundos, y esa distinción se agregó justamente
porque en la primera prueba real no existía:

| `metadata`                                                                    | Significa                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `{"reason":"exchange_failed","failure":"exchange_rejected","httpStatus":400}` | Mercado Pago rechazó — típicamente `client_secret` que no corresponde al `client_id` |
| `{"reason":"exchange_failed","errorName":"Error"}`                            | Reventó código propio; el mensaje textual va al log del servidor                     |
| `{"reason":"state_invalid"}`                                                  | `state` vencido, reusado, o **sin sesión en el navegador**                           |

## Lo que falta antes de usar esto de verdad

1. ~~Registrar la aplicación en Mercado Pago~~ ✅ hecho y verificado (ver
   arriba).
2. ~~Validar si `user_id` viene en el flujo `authorization_code`~~ ✅ **sí
   viene**; el fallback previsto en MP-OAUTH-007 no hizo falta.
3. **Cerrar TS-001**, o el gate `approved` deja el flujo inalcanzable para
   cualquier vendedor real. Hoy se aprueba escribiendo en la base.
4. **Refresh de tokens** (spec §10 y §18): sin él, una conexión muere a los 180
   días. La primera conexión real vence el **2027-02-21**.
5. **Webhook `mp-connect`** (§11): sin él, Offside no se entera si el vendedor
   revoca la autorización desde Mercado Pago.
6. Siguen 🔵: códigos de error exactos del intercambio y del refresh, scopes
   adicionales, y si el `refresh_token` anterior se invalida al rotar.
