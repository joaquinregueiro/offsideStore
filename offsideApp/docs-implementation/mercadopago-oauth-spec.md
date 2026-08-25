# Mercado Pago OAuth — Especificación arquitectónica

Especificación de la vinculación de una cuenta de Mercado Pago por parte de un
vendedor. **Fecha: 2026-08-22.**

> **Estado: especificación. Nada de esto está implementado.** Este documento es
> el contrato de la implementación futura: define las decisiones de diseño para
> no tener que volver a tomarlas al escribir el código.
>
> No modifica el ERD. `mercadopago_accounts` **ya existe** en el ERD v1.0 §7.3 y
> cubre todo lo que esta especificación necesita.

## 1. Alcance

### Incluye

Conexión de la cuenta MP · flujo OAuth Authorization Code · PKCE · `state`
anti-CSRF · persistencia segura de credenciales · renovación de tokens ·
revocación y desautorización · webhook `mp-connect` · desconexión manual ·
estados de la conexión · concurrencia e idempotencia · auditoría · contratos de
API · jobs.

### No incluye

Checkout · `marketplace_fee` · cálculo de comisión · refunds · chargebacks ·
liquidaciones · percepciones · ARCA · aprobación fiscal.

**Payments consumirá esta conexión más adelante.** Esta especificación deja la
conexión disponible; no define qué se hace con ella.

### Separación que esta especificación preserva

```
AUTH OFFSIDE  ≠  IDENTIDAD FISCAL  ≠  MERCADO PAGO  ≠  PAYMENTS
```

- **Mercado Pago NO es el sistema de autenticación de Offside.** El vendedor
  inicia sesión en Offside con email y contraseña; eso es independiente
  (`tech-stack.md` §3.4, BR-003).
- **Conectar Mercado Pago NO aprueba al vendedor** ni le da confianza
  (BR-003 / SS-012). Es un requisito, no un sello.
- La conexión es **una condición necesaria** para vender, no suficiente.

---

## 2. Arquitectura

```
apps/web
    │
    ▼
Route Handler                app/api/sellers/mercadopago/*
    │                        (sólo delega, una línea)
    ▼
Controller                   modules/sellers/controllers/
    │                        (valida input, traduce a HTTP)
    ▼
Connection Service           modules/sellers/services/
    │                        DOMINIO: decide. No sabe HTTP ni hablar con MP
    ├──────────────► Repository ──────► PostgreSQL
    │                modules/sellers/repositories/
    │                                    mercadopago_accounts
    ├──────────────► Redis
    │                state · code_verifier · locks
    │
    └──────────────► infrastructure/mercadopago/
                     ÚNICO lugar que habla con Mercado Pago
                              │
                              ▼
                     api.mercadopago.com
```

### Qué conoce cada capa

`infrastructure/mercadopago/` es el **único** lugar que conoce:

- URLs de Mercado Pago;
- `client_id` y `client_secret`;
- formatos específicos de MP (nombres de campos, códigos de error);
- `access_token` y `refresh_token` **en claro**;
- requests HTTP contra MP.

El dominio no conoce nada de eso. Recibe y devuelve tipos propios.

**El desencriptado de tokens ocurre exclusivamente dentro de
`infrastructure/mercadopago/`.** El Service maneja identificadores y estados;
nunca ve un token en claro.

Esto es la regla de `architecture.md` §3.1: las integraciones externas viven
detrás de una interfaz agnóstica y no se filtran al dominio.

### Payments

Payments **consumirá** una abstracción de la conexión. **No podrá** crear,
renovar ni administrar conexiones MP. Ver §17.

---

## 3. Modelo de estados

Existen **dos máquinas de estado independientes**, ambas ya en el ERD.

```
seller_profiles.status          (ERD §7.2)
  pending ──► approved ──► limited ──► suspended ──► expelled
     ▲            │
     └────────────┘  revocación por riesgo (TS-011)

mercadopago_accounts.status     (ERD §7.3)
  disconnected ──► connected ──► expired    (token vencido sin renovar)
                       │      └─► revoked   (el vendedor desautorizó en MP)
                       └──────────► disconnected  (desvinculación desde Offside)
```

Son **independientes**: una no implica ni condiciona a la otra. Mercado Pago
puede revocar por su cuenta sin que Offside intervenga, y Offside puede
suspender a un vendedor sin tocar su conexión MP.

### `can_sell` es un predicado derivado

```
can_sell = seller_profiles.status = 'approved'
       AND mercadopago_accounts.status = 'connected'
```

**No se persiste.** No se agrega un tercer estado.

**Por qué:** un `can_sell` almacenado sería una tercera fuente de verdad que hay
que mantener sincronizada con las otras dos. MP puede revocar la autorización en
cualquier momento y Offside se entera después (por webhook o al fallar una
llamada); durante esa ventana el campo almacenado estaría mintiendo. Un
predicado calculado no puede desincronizarse.

### Matriz `seller_status × mp_status`

| seller_status | mp_status      | can_sell         | Interpretación                | Mensaje esperado                          |
| ------------- | -------------- | ---------------- | ----------------------------- | ----------------------------------------- |
| `pending`     | _sin fila_     | ❌               | Onboarding incompleto         | "Completá tu validación fiscal"           |
| `pending`     | `connected`    | ❌               | MP listo, falta aprobación    | "Tu cuenta está en revisión"              |
| `approved`    | _sin fila_     | ❌               | Falta el último paso          | "Conectá Mercado Pago para recibir pagos" |
| `approved`    | `connected`    | ✅               | Operativo                     | "Ya podés vender en Offside"              |
| `approved`    | `expired`      | ❌               | Token venció sin renovar      | "Reconectá tu cuenta de Mercado Pago"     |
| `approved`    | `revoked`      | ❌               | El vendedor desautorizó en MP | "Revocaste el acceso. Volvé a conectar"   |
| `approved`    | `disconnected` | ❌               | Desvinculó desde Offside      | "Conectá Mercado Pago"                    |
| `limited`     | `connected`    | ⚠️ **PENDIENTE** | Ver abajo                     | —                                         |
| `suspended`   | `connected`    | ❌               | Suspensión de Offside         | "Tu cuenta está suspendida"               |
| `suspended`   | cualquiera     | ❌               | Ídem                          | Ídem                                      |
| `expelled`    | cualquiera     | ❌               | Expulsado                     | Sin acceso a vender                       |

> ⚠️ **`limited` — decisión de negocio pendiente.** El enum `seller_status`
> incluye `limited`, pero **la documentación no define qué limita**. Esta
> especificación **no asume** qué capacidades conserva. Hasta que se defina,
> `limited` no se incorpora al predicado `can_sell`.

`pending + connected` es alcanzable y **no es un error**: el flujo pide
aprobación antes de conectar, pero la aprobación puede revocarse después
(TS-011). El predicado lo resuelve solo.

---

## 4. Flujo OAuth

```
 1. Usuario autenticado solicita conectar Mercado Pago
 2. Verificar sesión                          → 401 si no hay
 3. Verificar email verificado (BR-001)       → 403 si no
 4. Resolver seller_profile POR user.id       → 403 si no existe
 5. Verificar seller.status = 'approved'      → 409 si no
 6. Verificar que no exista conexión activa incompatible → 409
 7. Generar state
 8. Generar code_verifier
 9. Calcular code_challenge = BASE64URL(SHA256(code_verifier))
10. Guardar contexto temporal en Redis (TTL 600s)
11. Auditar MP_CONNECTION_STARTED
12. Generar authorization URL
13. El FRONTEND navega hacia Mercado Pago
──────────────────────────────────────────────────────────────
14. El usuario se autentica DIRECTAMENTE EN MERCADO PAGO
15. El usuario autoriza la aplicación
──────────────────────────────────────────────────────────────
16. Mercado Pago vuelve al callback
17. Recuperar el state con GETDEL (atómico)
18. Validar que el state corresponda al usuario de la sesión actual
19. Intercambiar authorization_code por tokens (+ code_verifier)
20. Obtener y validar mp_user_id
21. Cifrar los tokens
22. Persistir las credenciales
23. Marcar status = 'connected'
24. Auditar MP_CONNECTION_SUCCEEDED
25. Redirigir al frontend
```

> **El backend NO pide nunca la contraseña de Mercado Pago.**
> El usuario se autentica directamente en Mercado Pago (paso 14). Offside nunca
> ve esas credenciales. Esto es lo que hace que MP-OAUTH-001 sea una decisión de
> seguridad y no sólo de conveniencia.

### Parámetros de la authorization URL

`client_id` · `response_type=code` · `platform_id=mp` · `redirect_uri` ·
`state` · `code_challenge` · `code_challenge_method=S256` ·
`scope=offline_access`

---

## 5. PKCE

**Decisión oficial: PKCE es obligatorio para Offside**, aunque Mercado Pago lo
documente como opcional.

| Parámetro        | Valor                                                       |
| ---------------- | ----------------------------------------------------------- |
| Método           | **S256**                                                    |
| `code_verifier`  | 43–128 caracteres (rango de MP)                             |
| Longitud elegida | **86 caracteres**, derivados de `randomBytes(64).base64url` |
| `code_challenge` | `BASE64URL(SHA256(code_verifier))`                          |

**Por qué 86:** `randomBytes(64)` da 512 bits de entropía y su codificación
base64url produce exactamente 86 caracteres, dentro del rango permitido. Es una
decisión técnica de Offside, no un requisito de MP.

**Dónde vive el `code_verifier`:**

|             |                |
| ----------- | -------------- |
| Redis       | ✅ único lugar |
| PostgreSQL  | ❌ nunca       |
| Frontend    | ❌ nunca       |
| Logs        | ❌ nunca       |
| `audit_log` | ❌ nunca       |

**Qué aporta PKCE aquí:** si alguien intercepta el `authorization_code` —por un
`redirect_uri` mal configurado, un log de proxy, o el historial del browser— no
puede canjearlo sin el `code_verifier`, que nunca salió del servidor de Offside.
Sin PKCE, el `code` solo alcanzaría para robar la conexión.

⚠️ **PKCE debe habilitarse previamente en la configuración de la aplicación de
Mercado Pago.** No alcanza con enviar los parámetros.

---

## 6. `state`

**Decisión oficial: `state` aleatorio, opaco y de alta entropía.**

| Propiedad   | Definición                                              |
| ----------- | ------------------------------------------------------- |
| Generación  | Server-side, `randomBytes(32)` → 256 bits               |
| Contenido   | **Ninguno.** Es opaco: no lleva información del usuario |
| Asociación  | A `userId` y `sellerId`, **del lado del servidor**      |
| TTL         | **600 segundos**                                        |
| Uso         | **Una sola vez**                                        |
| Eliminación | **`GETDEL`** — atómico                                  |
| PostgreSQL  | ❌ nunca se persiste                                    |

### Redis

```
Clave:  mp:oauth:state:{state}
Valor:  { userId, sellerId, codeVerifier, createdAt }
Escritura: SET ... NX EX 600
Lectura:   GETDEL   (lee y borra en una operación)
```

**Por qué opaco y no un JWT con datos:** meter `userId` dentro del `state` lo
vuelve legible por terceros y obliga a firmarlo. Un valor aleatorio con el
contexto del lado del servidor no filtra nada y es más simple.

**Por qué un solo `SET` con todo:** dos claves separadas (`state` y
`code_verifier`) podrían desincronizarse si una expira antes que la otra.

### Amenazas que cubre

- **CSRF**: un atacante que induzca a la víctima a visitar el callback con _su_
  propio `code` no tiene un `state` válido asociado a la sesión de la víctima.
- **Callback forzado**: la validación de que `state.userId` coincide con la
  sesión actual impide vincular una cuenta MP ajena.
- **Replay**: `GETDEL` hace que el segundo intento no encuentre nada.

---

## 7. Persistencia

### Redis (efímero)

`state` (clave) · `code_verifier` · `userId` · `sellerId` · `createdAt`
· locks de refresh.

### PostgreSQL — `mercadopago_accounts` (ERD §7.3, ya existe)

`mp_user_id` · `access_token_encrypted` · `refresh_token_encrypted` ·
`public_key` · `token_expires_at` · `scopes` · `status` · `connected_at` ·
`last_refreshed_at`.

### Nunca se guarda

| Dato                          | Motivo                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `authorization_code`          | Un solo uso, vive 10 minutos. Persistirlo no aporta nada y es una credencial |
| `client_secret`               | **Sólo** variable de entorno / gestor de secretos                            |
| `state` en PostgreSQL         | Efímero por naturaleza                                                       |
| `code_verifier` en PostgreSQL | Ídem                                                                         |

> **No se requiere ningún cambio al ERD.** `mercadopago_accounts` ya contiene
> todas las columnas necesarias, incluidos `scopes` y `last_refreshed_at`.

---

## 8. Cifrado de credenciales

| Dato            | Tratamiento                                                    |
| --------------- | -------------------------------------------------------------- |
| `access_token`  | **Cifrado** con `TOKEN_ENCRYPTION_KEY`                         |
| `refresh_token` | **Cifrado** con `TOKEN_ENCRYPTION_KEY`                         |
| `public_key`    | **Sin cifrar** — es pública por diseño, es la clave de cliente |

**El desencriptado ocurre exclusivamente dentro de
`infrastructure/mercadopago/`**, en el momento de construir la llamada a MP.

### Prohibido

Tokens en: logs · `audit_log` · respuestas HTTP · mensajes de error · Redis ·
frontend. **Ni siquiera truncados.**

Esto es la regla de CLAUDE.md §10 y `tech-stack.md` §3.5: los tokens OAuth de
vendedores son datos sensibles, cifrados en reposo.

> ⚠️ El ERD §7.3 dice _"nunca exponer por API"_ refiriéndose a la tabla entera.
> Esta especificación precisa que la regla aplica a **los tokens**; `public_key`
> puede exponerse, es su función.

---

## 9. Conexiones y reconexiones

El `mp_user_id` identifica a qué cuenta de MP pertenece el token.

| Caso  | Situación                                            | Comportamiento                                                                  |
| ----- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| **A** | Vendedor sin conexión previa                         | **Crear** conexión, `status='connected'`                                        |
| **B** | Misma cuenta MP (`user_id` == `mp_user_id` guardado) | **Actualizar** credenciales, `status='connected'`. Es el camino de reconexión   |
| **C** | Otra cuenta MP del mismo vendedor                    | **Permitir** el reemplazo. Auditar `MP_ACCOUNT_CONFLICT` con ambos `mp_user_id` |
| **D** | Cuenta MP ya vinculada a **otro** vendedor           | **Rechazar**                                                                    |

### Constraints que lo garantizan

```
UNIQUE(seller_id)     una sola conexión por vendedor
UNIQUE(mp_user_id)    una cuenta MP no puede servir a dos vendedores
```

El caso D lo garantiza la base. El Service debe detectarlo **antes** para
devolver un error limpio en vez de un `23505`.

> ⚠️ **No existe historial estructural de múltiples cuentas MP por vendedor.**
> `UNIQUE(seller_id)` implica una sola fila; al cambiar de cuenta (caso C) la
> anterior se sobrescribe. **El cambio se conserva únicamente en `audit_log`.**
> Si se necesitara historial consultable, requeriría un cambio de ERD que esta
> especificación **no** propone.

---

## 10. Refresh de tokens

### Comportamiento de Mercado Pago

- El `access_token` del flujo authorization_code dura **180 días**. 🔴
- El refresh requiere que la aplicación haya solicitado **`scope=offline_access`**.
  Sin eso **no se puede refrescar**. 🔴
- **Cada renovación devuelve un `refresh_token` nuevo** — MP lo rota. 🔴
- Si el `refresh_token` anterior queda invalidado: **no documentado**. 🔵

### Algoritmo

```
seleccionar conexiones a renovar
        ↓
por cada una:
  adquirir lock  mp:refresh:lock:{sellerId}   (SET NX EX)
        ↓
  volver a consultar estado          ← puede haber cambiado
  volver a comprobar token_expires_at
        ↓
  desencriptar refresh_token          (dentro de infrastructure/)
        ↓
  POST /oauth/token  grant_type=refresh_token
        ↓
  si éxito:
      persistir el NUEVO refresh_token
      actualizar access_token
      actualizar token_expires_at
      actualizar last_refreshed_at
      auditar MP_TOKEN_REFRESHED
  si falla:
      determinar tipo de error
      actualizar status
      auditar MP_TOKEN_REFRESH_FAILED
        ↓
  liberar lock
```

### Reglas de concurrencia

- **Nunca dos refresh simultáneos para el mismo vendedor.** Como el
  `refresh_token` rota, dos refresh concurrentes pueden invalidar el token
  bueno. El lock de Redis es obligatorio, no una optimización.
- **Reconexión durante un refresh**: prevalecen las **credenciales más nuevas**.
  Comparar contra `last_refreshed_at` / `connected_at` antes de escribir.
- **Desconexión durante un refresh**: el resultado del refresh **no debe
  reactivar** una conexión desconectada. Re-verificar el estado dentro del lock
  antes de persistir.

---

## 11. Revocación y webhook

### Mecanismos de revocación documentados

Expiración · cambio de contraseña del vendedor · revocación de la autorización ·
lavado por fraude · limpieza de sesión · eliminación de la aplicación. Revocar
una autorización **elimina todos los tokens asociados**. 🔴

### Webhook `mp-connect`

Mercado Pago expone el topic **`mp-connect`**: _"vinculación y desvinculación de
cuentas conectadas a través de OAuth"_. 🔴

```
POST /api/webhooks/mercadopago/connect
```

**Validación obligatoria:**

- `x-signature` — formato `ts=…,v1=…`, verificación HMAC según el mecanismo que
  indica Mercado Pago; 🔴
- `x-request-id`. 🔴

**Debe responder 200 o 201.** MP reintenta cada 15 minutos si no lo recibe, así
que **el webhook debe ser idempotente**: procesar el mismo evento dos veces no
puede producir un estado distinto. 🔴

**Ante desautorización:**

```
mercadopago_accounts.status = 'revoked'
seller_profiles.status       ← NO SE TOCA
can_sell                     ← deja de cumplirse solo
```

Auditar `MP_DEAUTHORIZED_BY_SELLER`.

### No confiar exclusivamente en el webhook

Un webhook puede perderse. Si una llamada contra MP devuelve credenciales
inválidas, la conexión debe poder pasar a un estado incompatible con la venta.

> 🔵 **Los códigos de error exactos que devuelve MP ante una autorización
> revocada no están documentados.** Quedan pendientes de validación en la
> primera integración. Esta especificación **no los inventa**.

---

## 12. Desconexión manual

```
POST /api/sellers/mercadopago/disconnect
```

Debe: requerir sesión · resolver el vendedor desde `user.id` · marcar
`status='disconnected'` · auditar `MP_DISCONNECTED` · **nunca tocar
`seller_profiles.status`**.

> 🔵 **No está documentado ningún endpoint de revocación remota** que la
> aplicación pueda llamar. Por eso `disconnect` **sólo marca el estado local**.
>
> Semántica: _"Offside dejó de usar esta conexión"_. Si el vendedor quiere
> además revocar la autorización del lado de Mercado Pago, debe hacerlo en su
> cuenta de MP.

---

## 13. Contratos de API

### `POST /api/sellers/mercadopago/connect`

|         |                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------- |
| Auth    | sesión + email verificado + `seller.status='approved'`                                         |
| Input   | —                                                                                              |
| Output  | `{ authorizationUrl }`                                                                         |
| Efectos | crea `state` en Redis (TTL 600s), audita `MP_CONNECTION_STARTED`                               |
| Errores | 401 sin sesión · 403 email sin verificar · 403 sin perfil · 409 no aprobado · 409 ya conectado |

> **NO hace redirect.** Devuelve la URL y el frontend navega. Un `fetch()` no
> puede seguir un redirect cross-origin hacia una pantalla de login de un
> tercero; el browser debe navegar de verdad.

### `GET /api/sellers/mercadopago/callback`

|         |                                                                              |
| ------- | ---------------------------------------------------------------------------- |
| Auth    | sesión (se valida contra `state.userId`)                                     |
| Input   | query: `code` + `state`, o `error` + `error_description` + `state`           |
| Output  | **302** al frontend                                                          |
| Efectos | consume `state`, intercambia el code, persiste credenciales cifradas, audita |

**Sí hace redirect**, porque es una navegación iniciada por el browser.

| Caso                                                    | Respuesta                                     |
| ------------------------------------------------------- | --------------------------------------------- |
| Éxito                                                   | 302 → `?status=connected`                     |
| Cancelación (`error=access_denied`)                     | 302 → `?status=cancelled`                     |
| `state` inválido / expirado / reusado / de otro usuario | 302 → `?status=error&reason=invalid_state`    |
| Intercambio rechazado (code expirado, PKCE incorrecto)  | 302 → `?status=error&reason=exchange_failed`  |
| Cuenta MP de otro vendedor                              | 302 → `?status=error&reason=account_conflict` |

### `GET /api/sellers/mercadopago/status`

|         |                                                         |
| ------- | ------------------------------------------------------- |
| Auth    | sesión                                                  |
| Output  | `{ status, connectedAt, expiresAt, mpUserId, canSell }` |
| Efectos | ninguno                                                 |

**Nunca** devuelve tokens.

### `POST /api/sellers/mercadopago/disconnect`

|         |                                                   |
| ------- | ------------------------------------------------- |
| Auth    | sesión                                            |
| Output  | `{ status: 'disconnected' }`                      |
| Efectos | `status='disconnected'`, audita `MP_DISCONNECTED` |

### `POST /api/webhooks/mercadopago/connect`

|         |                                                      |
| ------- | ---------------------------------------------------- |
| Auth    | **firma**, no sesión                                 |
| Input   | payload del topic `mp-connect`                       |
| Output  | **200 / 201**                                        |
| Efectos | ante desautorización, `status='revoked'` + auditoría |
| Errores | 401 firma inválida                                   |

### Rate limiting

El proyecto ya tiene `lib/rate-limit.ts` con scopes tipados. `connect` y
`callback` deberían sumar sus propios scopes al tipo `RateLimitScope` cuando se
implementen. El webhook **no** se limita por IP: viene de Mercado Pago.

---

## 14. Comportamiento del callback ante errores

**Nunca filtrar información sensible.** En particular, ante un conflicto de
cuenta **jamás** indicar _"esa cuenta MP pertenece a otro vendedor"_: eso
permitiría descubrir qué cuentas de MP están registradas en Offside.

El backend registra el detalle técnico en `audit_log`; el frontend recibe
**motivos genéricos**.

---

## 15. Modelo de amenazas

| Amenaza                                         | Mitigación                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| **CSRF**                                        | `state` aleatorio de 256 bits, un solo uso, validado contra la sesión       |
| **Replay** del callback                         | `GETDEL` atómico: el segundo intento no encuentra el `state`                |
| **Interceptación del authorization code**       | **PKCE**: sin el `code_verifier` el code es inútil                          |
| **Robo de tokens**                              | Cifrados con `TOKEN_ENCRYPTION_KEY`; desencriptado sólo en infraestructura  |
| **Fuga de credenciales**                        | Prohibidos en logs, errores, `audit_log`, respuestas y frontend             |
| **Webhook falsificado**                         | Validación de `x-signature` (HMAC) y `x-request-id`                         |
| **Account takeover** (vincular cuenta MP ajena) | Validación `state.userId` == sesión + `UNIQUE(mp_user_id)`                  |
| **Refresh concurrente**                         | Lock en Redis por vendedor; la rotación del `refresh_token` lo hace crítico |
| **Callbacks duplicados**                        | `GETDEL`: sólo el primero tiene efecto                                      |
| **Conexiones duplicadas**                       | `UNIQUE(seller_id)`                                                         |

---

## 16. Auditoría

Todos en `audit_log` (`entity_type='mercadopago_account'`,
`entity_id=seller_id`).

| Evento                      | Actor             | Metadata permitida                                         |
| --------------------------- | ----------------- | ---------------------------------------------------------- |
| `MP_CONNECTION_STARTED`     | `user`            | sellerId                                                   |
| `MP_CONNECTION_SUCCEEDED`   | `user`            | mp_user_id, scopes, expires_at, live_mode                  |
| `MP_CONNECTION_FAILED`      | `user`            | motivo (`state_invalid`, `exchange_failed`, `pkce_failed`) |
| `MP_ACCOUNT_CONFLICT`       | `user`            | mp_user_id involucrado                                     |
| `MP_DISCONNECTED`           | `user` \| `admin` | quién y por qué                                            |
| `MP_TOKEN_REFRESHED`        | `system`          | nuevo expires_at                                           |
| `MP_TOKEN_REFRESH_FAILED`   | `system`          | tipo de error, número de intento                           |
| `MP_DEAUTHORIZED_BY_SELLER` | `system`          | origen: webhook `mp-connect`                               |

### Prohibido en `audit_log`

`access_token` · `refresh_token` · `authorization_code` · `code_verifier` ·
`client_secret` · `state`. **Ni siquiera truncados.**

---

## 17. Frontera con Payments

```
sellers  ──►  conexión MP        (crea, renueva, administra)

payments ──►  CONSUME la conexión
```

**Payments NO:** implementa OAuth · refresca tokens · cambia estados de
conexión · conoce `client_secret` · desencripta credenciales.

**Payments SÍ:** consume una abstracción que le permite operar sobre la cuenta
MP conectada; las operaciones de pago se delegan a
`infrastructure/mercadopago/`.

La interfaz conceptual sería algo del orden de `getConnectedAccount(sellerId)`,
pero **el contrato definitivo de Payments no se diseña acá**. Este documento
sólo fija que la dependencia va en una dirección.

---

## 18. Jobs

### `mercadopago-token-refresh`

|              |                                                                        |
| ------------ | ---------------------------------------------------------------------- |
| Frecuencia   | cada **6 horas**                                                       |
| Ventana      | tokens que expiran en **≤ 15 días**                                    |
| Selección    | `WHERE status='connected' AND token_expires_at <= now() + 15 días`     |
| Índice       | usa `INDEX(token_expires_at)` (ERD §7.3). **Nunca full scan**          |
| Concurrencia | 5                                                                      |
| Retry        | 3 intentos, backoff exponencial, primer retry ≈ 1 minuto               |
| Lock         | `mp:refresh:lock:{sellerId}` (`SET NX EX`)                             |
| Se saltea    | vendedores `suspended`/`expelled`; conexiones que no estén `connected` |

Con tokens de 180 días, una ventana de 15 días da margen amplio de reintentos
antes de que la conexión muera. **No implementar todavía.**

---

## 19. Decisiones de arquitectura

| ID               | Decisión                                                                                                                    | Motivo                                                         | Consecuencia                                                         | Fuente                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **MP-OAUTH-001** | Sólo Authorization Code. Nunca se pide la contraseña de MP                                                                  | El vendedor se autentica en MP; Offside no ve sus credenciales | Flujo con redirect obligatorio                                       | 🔴 Documentación oficial                                                     |
| **MP-OAUTH-002** | PKCE obligatorio para Offside (S256)                                                                                        | Protege el `code` si se intercepta                             | Hay que **habilitar PKCE en la aplicación MP antes**                 | 🟡 MP lo documenta como opcional; **obligarlo es decisión de Offside**       |
| **MP-OAUTH-003** | `state` de 256 bits, opaco, un solo uso                                                                                     | Anti-CSRF y anti-replay                                        | `GETDEL` atómico                                                     | 🟡 Decisión de arquitectura; MP documenta el parámetro                       |
| **MP-OAUTH-004** | `state` + `code_verifier` sólo en Redis, TTL 600s                                                                           | Efímeros; el `code` vive 10 min                                | Redis pasa a ser dependencia del onboarding de vendedor              | 🟡 TTL elegido por Offside                                                   |
| **MP-OAUTH-005** | Tokens cifrados en PostgreSQL con `TOKEN_ENCRYPTION_KEY`                                                                    | Credenciales de un tercero                                     | Ya previsto en ERD §7.3                                              | 🔴 Proyecto (CLAUDE.md §10)                                                  |
| **MP-OAUTH-006** | Solicitar `scope=offline_access`                                                                                            | **Sin él no se puede refrescar**                               | Si falta, la conexión muere a los 180 días y exige reconexión manual | 🔴 Documentación oficial                                                     |
| **MP-OAUTH-007** | `mp_user_id` se toma del campo `user_id` de la respuesta del token; si no viniera, fallback a un endpoint autenticado de MP | Evita una llamada extra                                        | —                                                                    | 🟡 Confirmado para el flujo de refresh; **inferido** para authorization_code |
| **MP-OAUTH-008** | Persistir **siempre** el nuevo `refresh_token` que devuelve el refresh                                                      | MP lo rota en cada renovación                                  | Perderlo obliga a reconexión manual                                  | 🔴 Documentación oficial                                                     |
| **MP-OAUTH-009** | Refresh serializado con lock en Redis por vendedor                                                                          | La rotación hace peligroso el refresh concurrente              | Todo refresh pasa por el lock                                        | 🟡 Decisión de arquitectura                                                  |
| **MP-OAUTH-010** | La desautorización se detecta por webhook `mp-connect`                                                                      | Es el mecanismo documentado                                    | Hace falta endpoint de webhook                                       | 🔴 Documentación oficial                                                     |
| **MP-OAUTH-011** | Webhook con firma validada e idempotente                                                                                    | MP reintenta cada 15 min                                       | Procesar dos veces no puede cambiar el resultado                     | 🔴 Documentación oficial                                                     |
| **MP-OAUTH-012** | Separar `expired` / `revoked` / `disconnected`                                                                              | Distinguir causas permite mensajes correctos y diagnóstico     | Sin estados nuevos: el enum ya los tiene                             | 🟡 Decisión de arquitectura sobre el enum del ERD                            |
| **MP-OAUTH-013** | Una cuenta MP por vendedor y un vendedor por cuenta MP                                                                      | Antifraude e integridad                                        | Caso D rechazado; sin historial de cuentas                           | 🔴 ERD §7.3                                                                  |
| **MP-OAUTH-014** | `connect` devuelve la URL; el frontend navega                                                                               | `fetch` no sigue redirects cross-origin a un login             | Contrato explícito con el frontend                                   | 🟡 Decisión de arquitectura                                                  |
| **MP-OAUTH-015** | Desencriptado únicamente en `infrastructure/mercadopago/`                                                                   | El dominio no debe tocar credenciales de terceros              | El Service maneja estados, no tokens                                 | 🔴 Proyecto (`architecture.md` §3.1)                                         |

---

## 20. Estado de cada afirmación

### 🔴 Confirmado por documentación oficial de Mercado Pago

- `authorization_code` válido **10 minutos**.
- `access_token` del flujo authorization_code válido **180 días**.
- PKCE disponible: `code_verifier` 43–128 caracteres, `code_challenge` S256 o
  Plain; **debe habilitarse en la configuración de la aplicación**.
- `state` identifica el origen del pedido y evita atribución incorrecta.
- Campos de la respuesta del token: `access_token`, `token_type`, `expires_in`,
  `scope`, `user_id`, `refresh_token`, `public_key`, `live_mode`.
- El refresh requiere `scope=offline_access`.
- **Cada renovación emite un `refresh_token` nuevo.**
- Mecanismos de revocación; revocar elimina todos los tokens asociados.
- Topic de webhook **`mp-connect`** para vinculación y desvinculación.
- Webhook: `x-signature` (`ts=…,v1=…`, HMAC) + `x-request-id`; responder
  200/201; reintentos cada 15 minutos.
- La cuenta del vendedor requiere **KYC nivel 6** para Split de Pagos.

### 🟡 Decidido por arquitectura de Offside

- PKCE obligatorio (MP lo documenta como opcional).
- `code_verifier` de 86 caracteres.
- `state` de 256 bits, TTL 600s, estructura de la clave de Redis.
- Lock de refresh por vendedor.
- Job cada 6 horas con ventana de 15 días.
- Mapeo de causas a `expired` / `revoked` / `disconnected`.
- `connect` devuelve URL en vez de redirigir.
- Nombres de los eventos de auditoría.

### 🔵 Pendiente de validar en sandbox / primera integración

- **Si el `refresh_token` anterior queda invalidado** al rotar.
- **Códigos de error exactos** del intercambio, del refresh y ante autorización
  revocada.
- **Scopes adicionales** más allá de `offline_access`.
- **Si `user_id` viene en la respuesta del flujo authorization_code** (está
  documentado para refresh).
- Si existe algún **endpoint de revocación** invocable por la aplicación.
- Estructura exacta del payload del webhook `mp-connect`.

### ⚠️ Pendiente de decisión de negocio

- **Qué significa `seller_status = 'limited'`** y si puede vender.
- **KYC 6**: si se comunica antes de intentar conectar, y cómo.
- **Registro real de la aplicación en Mercado Pago** y habilitación de PKCE en
  su panel (acción operativa del owner).

> Ninguno de estos pendientes se resuelve inventando un valor. Los 🔵 se cierran
> probando contra el ambiente de Mercado Pago; los ⚠️ requieren decisión del
> owner.

---

## 21. Relación con la documentación existente

| Documento                                    | Relación                                                     |
| -------------------------------------------- | ------------------------------------------------------------ |
| `docs/04-technical/database-design.md` §7.3  | Define `mercadopago_accounts`. **Esta spec no lo modifica**  |
| `docs/04-technical/architecture.md` §3.1, §5 | Integraciones externas aisladas tras una interfaz            |
| `docs/04-technical/tech-stack.md` §3.4       | _"Auth propia ≠ Mercado Pago"_                               |
| `docs/DECISIONS.md`                          | DEC-005 (OAuth de vendedores), BR-003 (MP ≠ confianza)       |
| `CLAUDE.md` §10, §11                         | Secretos y aislamiento de integraciones                      |
| `seller-tax-identity.md`                     | Paso **anterior** del onboarding. Independiente de esta spec |
| `auth-module.md`                             | Auth de Offside. **Sistema distinto**                        |

**Esta especificación es la fuente concreta de OAuth de Mercado Pago.** Los
documentos generales sólo deberían referenciarla, no duplicarla.
