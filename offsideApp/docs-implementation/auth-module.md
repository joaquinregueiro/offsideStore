# Módulo AUTH + USERS + SELLERS

Implementación de autenticación, gestión básica de usuarios y alta de perfil de
vendedor. **Fecha: 2026-08-21.**

> Sobre ERD v1.1 y PostgreSQL real ya migrado. No se tocó el ERD, el schema de
> Drizzle ni la migration inicial.

## Qué está implementado

| Requisito                                 | Fuente                                   | Estado                    |
| ----------------------------------------- | ---------------------------------------- | ------------------------- |
| Registro email + password                 | BS-001                                   | ✅                        |
| Aceptación de términos en el alta         | BS-002                                   | ✅ (ver limitación abajo) |
| Verificación de email obligatoria         | BR-001                                   | ✅                        |
| Login con credenciales                    | BS-010                                   | ✅                        |
| Recuperación de contraseña                | BS-011                                   | ✅                        |
| Logout                                    | —                                        | ✅                        |
| Sesión segura                             | `security-observability-analytics.md` §1 | ✅                        |
| Hash de passwords argon2                  | ERD §5.1, security §1                    | ✅ argon2id               |
| Guard de autenticación / usuario actual   | `architecture.md` §4                     | ✅                        |
| Autorización por rol administrativo       | DEC-023                                  | ✅ sólo por rol           |
| Un usuario puede ser comprador y vendedor | BS-021                                   | ✅                        |
| Alta de perfil de vendedor                | SS-001, SS-002                           | ✅ nace en `pending`      |

## Endpoints

| Método | Ruta                        | Auth                      | Descripción             |
| ------ | --------------------------- | ------------------------- | ----------------------- |
| POST   | `/api/auth/register`        | —                         | BS-001/BS-002. 201      |
| POST   | `/api/auth/verify-email`    | —                         | BR-001                  |
| POST   | `/api/auth/login`           | —                         | BS-010. Setea cookie    |
| POST   | `/api/auth/logout`          | —                         | Idempotente             |
| GET    | `/api/auth/me`              | sesión                    | Usuario actual          |
| POST   | `/api/auth/password/forgot` | —                         | BS-011                  |
| POST   | `/api/auth/password/reset`  | —                         | BS-011                  |
| POST   | `/api/sellers`              | sesión + email verificado | SS-001/SS-002. 201      |
| GET    | `/api/sellers`              | sesión                    | Perfil propio, o `null` |

Códigos: 401 sin sesión · 403 email sin verificar o cuenta no activa ·
409 duplicado · 422 validación.

## Arquitectura

Respeta el layering de `tech-stack.md` §2:

```
Route Handler  →  Controller  →  Service  →  Repository  →  PostgreSQL
(sólo delega)     (valida,      (reglas)     (sólo datos)
                   traduce HTTP)
```

Los Route Handlers son una línea. Los Services **no conocen HTTP**: lanzan
errores de dominio (`AuthError`) que el Controller traduce a códigos de estado
con un mapa explícito.

`modules/users/` expone un Service de historial que `auth` consume — un módulo
nunca toca el repository de otro.

## Decisiones técnicas tomadas

### 1. Sesión opaca en base, no JWT

**Derivado del ERD, no elegido.** El ERD §5.2 define `sessions.token_hash` y
`expires_at`: eso describe un token opaco guardado del lado del servidor. Un JWT
no necesitaría esa tabla.

Ventaja concreta: la sesión se **revoca** borrando la fila. Un JWT no se puede
revocar sin una lista negra que el ERD no modela. Lo usamos en el reset de
contraseña, que cierra todas las sesiones abiertas.

**No hay refresh tokens**: el ERD no los modela para la auth propia. Los
`refresh_token_encrypted` que existen son de Mercado Pago, otra cosa (BR-003).

### 2. Hash del token con pepper

El token es 32 bytes aleatorios; en la base se guarda `HMAC-SHA256(token,
AUTH_SESSION_SECRET)`. Frente a un SHA-256 pelado, el pepper impide que alguien
con escritura en la base fabrique un `token_hash` válido.

`AUTH_SESSION_SECRET` se exige con `requireEnv()` en el borde del módulo, no en
el esquema global: el resto del sistema arranca sin él.

### 3. argon2id

`security-observability-analytics.md` §1 y el ERD §5.1 dicen "argon2/bcrypt". Se
elige **argon2id** (recomendación OWASP). Se usa `@node-rs/argon2` por sus
binarios precompilados — evita necesitar toolchain de compilación en Windows.

El algoritmo se pasa **explícito** (`2`) aunque sea el default de la librería,
para que un cambio aguas arriba no altere en silencio cómo se hashean las
contraseñas.

### 4. Cookie de sesión

`httpOnly` (un XSS no roba la sesión), `sameSite=lax` (mitiga CSRF),
`secure` fuera de desarrollo, `path=/`. Se acepta además
`Authorization: Bearer` para clientes sin cookies (tests, CLI).

### 5. No se filtra si un email existe

- Login: mismo error `INVALID_CREDENTIALS` para password incorrecta y para email
  inexistente, y se hashea igual cuando el usuario no existe para que el tiempo
  de respuesta no lo delate.
- `password/forgot`: responde siempre lo mismo, exista o no el email.

### 6. Parámetros operables por entorno

`AUTH_SESSION_TTL_HOURS` (168), `AUTH_PASSWORD_MIN_LENGTH` (12),
`AUTH_EMAIL_TOKEN_TTL_HOURS` (24), `AUTH_PASSWORD_RESET_TTL_HOURS` (1).

⚠️ Son **parámetros de seguridad**, que `configuration-registry.md` §3 agrupa
como "parámetros de seguridad operables". **No** son reglas de negocio del
marketplace: la comisión, las ventanas de pago/cancelación/refund y los límites
siguen 🟡 y **no se tocaron**. Si se decide gobernarlos desde Admin, se mueven a
`app_settings` sin cambiar los Services.

**Estos cuatro valores necesitan confirmación del owner.** No están en la
documentación.

## Limitaciones conocidas

### 1. La aceptación de términos no tiene columna en el ERD

BS-002 y SS-002 exigen registrar la aceptación de términos, y TS-010 la lista
como requisito para aprobar un vendedor. **El ERD §5.1 no tiene ninguna columna
para eso.**

Solución adoptada **sin tocar el ERD**: se exige `acceptedTerms: true` en el
borde, y el hecho se registra en `user_history_events` con
`event_type = USER_REGISTERED` y `data.acceptedTermsAt`. Es coherente con ERD
§6.3 (`data` = "payload del hecho") y con DEC-036 (el historial es la fuente de
verdad de los hechos).

**Queda abierto:** si se decide que la aceptación necesita columna propia
—p. ej. para consultarla eficientemente al aprobar vendedores— hay que
actualizar el ERD. La aceptación de **términos de vendedor** (SS-002) hoy se
valida pero **no se persiste**: no hay dónde.

### 2. No se envían emails

No existe módulo de notificaciones ni proveedor de correo configurado (no hay
variables SMTP en `.env.example`). El token de verificación se **genera y
funciona**, pero:

- en desarrollo se devuelve en la respuesta como `devToken` para poder completar
  el flujo;
- en producción **no se expone** y quedaría sin enviar.

Antes de producción hace falta el módulo de notificaciones y decidir el
proveedor de email.

### 3. Aprobación de vendedor no implementada

El perfil nace en `pending` y **se queda ahí**. Aprobarlo requiere TS-010, que
depende de **TS-001 — "qué significa identidad verificada" — que está 🟡 sin
definir**. Implementarlo sería inventar la regla.

`seller_tier_id` queda `NULL`: DEC-037 sin valores.

### 4. Autorización sólo por rol

`requireAdminRole()` autoriza contra el set cerrado de DEC-023
(`SUPER_ADMIN | ADMIN | MODERATOR | SUPPORT | FINANCE`). **No hay mapa de
permisos granulares**: DEC-023 los deja 🟡. Cada endpoint administrativo declara
qué roles acepta.

### 5. Sin rate limiting

`security-observability-analytics.md` §1 lo pide, pero sus valores están 🟡
(`configuration-registry.md` §3). No se implementó para no inventar umbrales.
**Es un riesgo real en login y en `password/forgot`** (fuerza bruta).

### 6. BR-004 no implementado

"Un usuario suspendido no puede crear una cuenta nueva para evadir la sanción" —
el mecanismo de detección está 🟡. Hoy un suspendido puede registrarse con otro
email.

## Tests

**65 en total: 31 unitarios + 34 de integración.**

Unitarios (sin base): hashing argon2id, salt distinta por llamada, rechazo de
hash corrupto sin lanzar, y todos los schemas de validación.

Integración (**PostgreSQL real**): registro y defaults del ERD, historial de
alta, email duplicado, duplicado con distinto case (citext), verificación de
email y no reutilización del token, login válido/inválido, hash del token en
base, bloqueo por email sin verificar y por cuenta suspendida, resolución de
sesión, sesión expirada, suspensión con sesión abierta, logout e idempotencia,
reset de contraseña con cierre de todas las sesiones, alta de vendedor,
duplicado, BR-001, BS-021, FK inválida (23503), UNIQUE (23505), CASCADE de
sesiones y RESTRICT del historial.

```bash
npm test -- --project=unit
npm test -- --project=integration   # requiere docker compose up -d
```

Los tests de integración usan el sufijo `@itest.offside` y **limpian todo** al
terminar. Verificado: 0 filas residuales.

## Verificación ejecutada

```
npm run verify → format ✅  lint ✅  typecheck 6/6 ✅  tests 65/65 ✅
npm run build  → ✅ 8 rutas de API compiladas
```

End-to-end contra el servidor real (`next dev`) y PostgreSQL/Redis reales:

```
GET  /api/health            200  database: up, redis: up
POST /api/auth/register     201  + devToken
POST (sin aceptar terminos) 422
POST /api/auth/login        403  EMAIL_NOT_VERIFIED (BR-001)
POST /api/auth/verify-email 200  emailVerified=true
POST /api/auth/login        200  cookie httpOnly
POST (password incorrecta)  401
GET  /api/auth/me (sin/con) 401 / 200
POST /api/sellers           201  status=pending, tier=null
POST /api/sellers duplicado 409
POST /api/sellers sin sesion 401
POST /api/auth/logout       200
GET  /api/auth/me           401
```

Datos de prueba eliminados al terminar.
