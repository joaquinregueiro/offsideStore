# Autorización y permisos (DEC-023)

Cómo está implementado el control de acceso. **Fecha: 2026-08-27.**

Fuente de verdad: `docs/DECISIONS.md` DEC-023 y `docs/04-technical/architecture.md`
AR-004.

## Los cuatro guards

Todo vive en `apps/web/src/lib/auth-guard.ts`, en niveles de exigencia
creciente:

| Guard                 | Exige                           | Falla con                  |
| --------------------- | ------------------------------- | -------------------------- |
| `requireUser`         | sesión válida                   | `NOT_AUTHENTICATED` (401)  |
| `requireVerifiedUser` | + email verificado (BR-001)     | `EMAIL_NOT_VERIFIED` (403) |
| `requireSeller`       | + tiene perfil de vendedor      | `FORBIDDEN` (403)          |
| `requireCapability`   | + su rol habilita una capacidad | `FORBIDDEN` (403)          |

**No hay middleware global de Next, a propósito.** Cada Route Handler declara
explícitamente qué exige, así no hay rutas protegidas por accidente ni
desprotegidas por un patrón mal escrito.

### 401 vs 403, y por qué importa

- **Sin sesión → 401.** "No sé quién sos."
- **Con sesión pero sin permiso → 403.** "Sé quién sos y no podés."

Devolver 401 en el segundo caso invitaría a reintentar con otra credencial;
devolver 403 en el primero le confirmaría a un anónimo que el recurso existe.

## Autorización por capacidad, no por rol

El mapa vive en `apps/web/src/lib/permissions.ts` y es **la única fuente de la
política**.

Antes, cada endpoint declaraba su propia lista de roles en la llamada al guard.
Funcionaba, pero dejaba la política dispersa: para saber quién podía reembolsar
había que leer el controller de `payments`. Ahora el endpoint declara **la
capacidad** y el mapa decide:

```ts
const admin = await requireCapability(request, CAPABILITIES.PAYMENTS_REFUND);
```

| Capacidad              | Roles                             |
| ---------------------- | --------------------------------- |
| `payments:refund`      | `SUPER_ADMIN`, `ADMIN`, `FINANCE` |
| `system_config:manage` | `SUPER_ADMIN`, `ADMIN`            |

### Por qué el mapa es tan corto

⚠️ **Sólo se mapean capacidades que existen hoy o son inminentes.** AR-006 lista
nueve capacidades del back-office —usuarios y suspensiones, vendedores y
aprobaciones, moderación, órdenes, pagos, refunds, disputas, bloqueos, audit
logs— pero la mayoría pertenece a módulos que todavía no se construyeron.

**`MODERATOR` y `SUPPORT` quedan declarados sin capacidades.** El rol se puede
asignar y no habilita nada. Es deliberado, no un olvido, y hay un test que lo
fija: si alguien les agrega permisos sin decidirlo, el test se rompe.

### Sin herencia ni comodines

`SUPER_ADMIN` figura **explícitamente** en cada capacidad. Es más verboso, y es
a propósito: un rol que "puede todo" por defecto convertiría cualquier capacidad
futura en un permiso concedido sin que nadie lo haya decidido.

### Falla cerrado

No conceden permiso: un rol `null` (usuario común), `undefined`, o un valor que
no esté en el mapa. Una **capacidad** desconocida lanza con un mensaje explícito
en vez de dejar que `undefined.includes` tire un `TypeError` opaco: es un bug de
programación, no una decisión de permisos.

## Los ejes son independientes

Ser administrador **no** vuelve vendedor a nadie, y ser vendedor **no** acerca a
ser administrador. Hay un test para cada dirección.

`actorRole(user, isSeller)` existe para **mostrar o registrar** el rol efectivo
—admin gana sobre seller, seller sobre user— pero **no autoriza**: reducir a un
solo rol perdería el detalle (un ADMIN también puede ser vendedor) y decidir
permisos sobre esa reducción sería un bug esperando.

## `requireSeller` verifica el perfil, no la aprobación

Es el guard del **borde**: separa "esto es de vendedores" de "esto es de
cualquiera". Si una acción además exige estar aprobado o tener Mercado Pago
conectado, eso lo decide el Service, que es quien conoce la regla (TS-010,
`canSell`). Duplicar la regla en el guard la pondría en dos lugares que se
desincronizan.

## Asignar un rol: sólo por SQL

Decisión del owner del 2026-08-27. **No hay endpoint ni variable de entorno que
promueva a nadie**, así que la aplicación no expone ninguna vía de escalada de
privilegios.

```bash
psql -U postgres -d postgres -c "UPDATE users SET admin_role = 'ADMIN' WHERE email = 'vos@ejemplo.com';"
```

Roles válidos: `SUPER_ADMIN`, `ADMIN`, `MODERATOR`, `SUPPORT`, `FINANCE`.
Para quitarlo, `admin_role = NULL`.

Se revisa cuando exista un equipo de administración real.

## Auditoría

No se agregaron eventos nuevos. Las acciones administrativas que ya existen
—los refunds— siguen auditándose en `audit_log` como antes; el cambio de guard
no altera qué se registra.

Registrar cada **denegación** habría sido tentador, pero un endpoint público
recibe intentos no autorizados de forma rutinaria y llenar `audit_log` con eso
lo vuelve inútil. Cuando exista observabilidad (Bloque 17) es una métrica, no
una fila de auditoría.

## Tests

**24 nuevos**: 12 unitarios sobre el mapa y 12 de integración sobre el borde
HTTP.

### Por qué los de integración existen

Los tests de rol que ya había verificaban el **dominio**: que `adminRole` se
resolviera bien al iniciar sesión. Eso **no prueba lo que importa**, que es que
un `Request` armado a mano —sin pasar por ningún frontend— no pueda saltear el
guard. La seguridad vive en el borde y ahí hay que probarla.

Cada caso construye un `Request` real con su cookie de sesión y lo pasa por el
guard, igual que haría el Route Handler.

Lo que cubren, más allá de permitido/denegado:

- **Usuario común y vendedor llamando directo a la API** → 403.
- **`MODERATOR` es admin pero no tiene la capacidad** → 403. Tener rol
  administrativo no alcanza.
- **`FINANCE` reembolsa pero no configura.**
- **Quitar el rol con la sesión viva deja de autorizar en el acto**: el guard
  resuelve el usuario en cada request, no confía en lo que se guardó al
  loguearse.
- **Un token de sesión inventado** → 401.
- **Un `ADMIN` sin perfil de vendedor no pasa `requireSeller`.**
- **Un rol inválido y una capacidad desconocida** no conceden nada.

### Nota sobre la falla intermitente

Se volvió a tocar el test de firma del webhook, que seguía fallando ~1 de cada
15 corridas completas pese al arreglo anterior.

La causa es real y está identificada: `process.env` es del **proceso** y lo
comparten los archivos de test del mismo worker; `loadRootEnv()` usa
`process.loadEnvFile()`, que lo pisa con el `.env` antes de restaurar lo previo.
El test firmaba con una constante local y el controller validaba con lo que
hubiera en el entorno en ese instante.

**Arreglo definitivo:** el test lee el secreto de **la misma fuente que el
controller**. El sujeto de ese test es la lógica de firma —la plantilla del
manifest, de dónde sale el `data.id`, que falle cerrado—, no el cableado del
entorno, así que todas sus aserciones siguen valiendo y el acoplamiento
desaparece.

⚠️ **Honestidad sobre esto:** el arreglo anterior también parecía funcionar y la
falla reapareció. Éste ataca el mecanismo en vez de la sintomatología, pero es un
heisenbug entre procesos y no puedo probar su ausencia.

## Qué desbloquea

El Config Store ya tiene su capacidad definida (`system_config:manage`) y su
guard. Construir el endpoint administrativo de configuración es ahora escribir
el controller: la autorización está resuelta.
