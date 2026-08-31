# Identidad y aprobación del vendedor (TS-001 / TS-010)

Cómo está implementada la habilitación de vendedores. **Fecha: 2026-08-27.**

Fuente de verdad: `docs/01-business/trust-and-safety.md` §4 y
`docs/02-product/seller-system.md` §5.

## Qué desbloquea

Hasta hoy **ningún vendedor podía aprobarse**. `seller_profiles.status` nacía en
`pending` y se quedaba ahí para siempre, porque TS-001 —"qué significa identidad
verificada"— nunca se había definido. La única salida era un `UPDATE` a mano.

Era el bloqueo más caro del proyecto: sin vendedor aprobado no hay publicación,
no hay orden y no hay venta.

## ⚠️ El gate de Mercado Pago estaba invertido

Antes de TS-001 había un problema más simple y más grave.

`startConnection` exigía `seller.status === 'approved'` para conectar Mercado
Pago. Pero el onboarding documentado en UC-SS-1 (`seller-system.md` §5) es:

> pide ser vendedor → **verifica identidad** → **conecta MP** → acepta términos
> → **queda aprobado**

Y TS-010 confirma que la aprobación **exige** Mercado Pago conectado.

Eso es un **punto muerto**: no se podía conectar sin estar aprobado, ni
aprobarse sin haber conectado. Por eso todo vendedor real recibía
`MP_SELLER_NOT_APPROVED`.

El gate invertido venía de `mercadopago-oauth-spec.md` §4 paso 5, un documento
de **implementación**. Por CLAUDE.md §2, `docs/` manda sobre
`docs-implementation/`: era un error nuestro, no una decisión de negocio.

**Corregido**: conectar exige tener perfil de vendedor y **no** estar
`suspended` ni `expelled`. La aprobación sigue siendo un paso aparte.

## TS-001 — la definición

**Decidida por el owner el 2026-08-27:**

> **identidad verificada = email verificado + identificador fiscal declarado y
> válido + Mercado Pago conectado**

Las tres **juntas**. La documentación dice que las señales son _"mecanismos que
suman, no equivalen entre sí"_, así que ninguna reemplaza a otra.

### Por qué esas tres

- Las tres existen hoy, sin terceros nuevos ni costo por operación.
- **Mercado Pago hace KYC real** (documento, datos fiscales) antes de habilitar
  a alguien a cobrar. Que una cuenta pueda recibir dinero es la señal de
  identidad más fuerte disponible, y es gratis.
- **El teléfono quedó afuera**: las columnas existen (`phone`,
  `phone_verified_at`) pero no hay flujo, y agregarlo exige elegir proveedor de
  SMS — otra decisión de stack sin documentar, con costo por mensaje.

### No contradice BR-003

BR-003 dice que conectar Mercado Pago **no otorga confianza automática**, y
habla de reputación y distintivos. **Identidad no es confianza.** Un vendedor
aprobado por esta vía arranca igual con reputación cero, sin badges y sujeto a
las reglas de riesgo. Aprobado significa "puede operar", no "es confiable".

### ⚠️ Límite conocido: el CUIT no se verifica contra ARCA

El identificador fiscal se valida por **sintaxis y dígito verificador**. No hay
integración con ARCA (`verifyTaxIdentity` existe y siempre falla, a propósito).

Eso prueba que el número está **bien formado**, no que **pertenezca a esa
persona**. Es una debilidad real de esta definición y conviene tenerla presente.

Cuando exista el adapter fiscal, la regla debería exigir
`verification_status = VERIFIED` en vez de la mera declaración. Es un cambio de
**una condición** en `isVerified()`, que está aislada justamente para eso.

## TS-010 — cuándo se aprueba

Las cuatro condiciones, todas juntas:

| #   | Condición                | Cómo se comprueba                           |
| --- | ------------------------ | ------------------------------------------- |
| 1   | Identidad verificada     | TS-001, arriba                              |
| 2   | Mercado Pago conectado   | `mercadopago_accounts.status = 'connected'` |
| 3   | Términos aceptados       | ver abajo                                   |
| 4   | Sin riesgo que lo impida | `users.risk_level`                          |

### Los términos

`acceptedSellerTerms` se validaba (`z.literal(true)`) pero **no se persistía en
ningún lado**. Como el schema lo exige para crear el perfil, **la existencia del
perfil ya implica la aceptación**; lo que faltaba era rastro de _cuándo_.

Ahora se registra `SELLER_TERMS_ACCEPTED` en `audit_log` al crear el perfil.

⚠️ Su lugar natural sería `user_history_events` (DEC-036, hechos objetivos),
pero `history_event_type` es un **enum** y no tiene un valor para esto. Agregarlo
es un cambio de ERD y necesita autorización (CLAUDE.md §5). **Queda señalado.**

### El riesgo

`SUSPENDIDO` y `RESTRINGIDO` bloquean. `RIESGO` **no**: es una señal de
atención, no una sanción, y tratarla como sanción sería inventar la política que
DEC-021 todavía no define. Los umbrales que llevan a cada nivel siguen 🟡.

## Cuándo corre la evaluación

Automática en los **dos** puntos donde puede cambiar una señal:

- al completar la conexión con Mercado Pago;
- al declarar la identidad fiscal.

Los dos, porque **el orden no está fijado**: un vendedor puede conectar MP antes
o después de cargar el CUIT. Evaluar en ambos cubre las dos secuencias, y hay un
test para cada una.

En los dos casos la evaluación corre **fuera de la transacción** y **no propaga
su fallo**: el dato principal (el token, el CUIT) ya quedó guardado, y que la
evaluación falle no puede revertirlo. Si falla, el vendedor reintenta con
`POST /api/sellers/approval`.

### No degrada

Si un vendedor aprobado pierde una señal —desconecta Mercado Pago—, la
evaluación **no lo baja** a `pending`. Revocar una aprobación es **TS-011** y
depende de las reglas de riesgo, que siguen 🟡.

No queda agujero operativo: el predicado `canSell` ya exige `approved` **y**
Mercado Pago conectado, así que un vendedor desconectado no puede vender aunque
su perfil siga en `approved`.

## Endpoints

| Método | Ruta                    | Qué hace                           |
| ------ | ----------------------- | ---------------------------------- |
| `GET`  | `/api/sellers/approval` | estado y qué falta. **No escribe** |
| `POST` | `/api/sellers/approval` | reevalúa y aprueba si corresponde  |

El `GET` es sólo lectura a propósito: refrescar una pantalla no debería dejar
una fila de verificación por vez.

## Rastro

Cada evaluación inserta una fila en `identity_verifications` (ERD §6.2),
**apruebe o no**: hay que poder reconstruir por qué un vendedor _no_ fue
aprobado.

- `method` = `offside_v1_email_fiscal_mp` — versiona la regla, para poder
  auditar con cuál se aprobó a cada uno.
- `data` guarda **sólo los booleanos** de las señales y qué faltaba. Nunca el
  CUIT, el email ni ningún dato personal: para eso ya están sus tablas. Hay un
  test que lo verifica.
- `reviewed_by` queda en `null`: esta verificación es automática. Cuando exista
  revisión manual, ese campo las distingue.

La aprobación en sí queda en `audit_log` como `SELLER_APPROVED`, con las señales
que la justificaron.

`approve()` transiciona **sólo desde `pending`**, con la condición en el `WHERE`
del `UPDATE`: dos evaluaciones simultáneas —conectar MP y cargar el CUIT casi a
la vez— no pueden aprobar dos veces ni pisar un `approved_at` ya escrito.

## La decisión está en `docs/`

Registrada el **2026-08-27** con autorización explícita del owner:

- `docs/DECISIONS.md` → **DEC-044**, que cierra TS-001.
- `docs/01-business/trust-and-safety.md` §4.1 → TS-001 pasa de 🟡 a ✅ con la
  regla completa y la aclaración sobre ARCA; §4.2 aclara que la aprobación es el
  **último** paso del onboarding.

**`docs/` es la fuente de verdad; este archivo describe la implementación.** Si
alguna vez difieren, manda `docs/` (CLAUDE.md §2).

## Tests

**11 nuevos**, integración contra PostgreSQL real. Los que más valen:

- Las tres señales se exigen **juntas**: quitar cualquiera da `false`.
- Con las tres, el vendedor **se aprueba solo** — el desbloqueo.
- **Idempotente**: reevaluar no re-aprueba ni duplica el evento de auditoría.
- Un usuario `RESTRINGIDO` **no** se aprueba aunque tenga las tres señales.
- Declarar el CUIT **después** de conectar MP también dispara la aprobación.
- `identity_verifications.data` **no contiene el CUIT**.
- `getStatus` **no escribe** verificaciones.

### De paso: se arregló la falla intermitente

La suite tenía un test que fallaba ~1 de cada 10 corridas completas y que
veníamos arrastrando sin diagnosticar. La causa: **`process.env` es del proceso
y lo comparten todos los archivos de test que corren en el mismo worker**.
Vitest paraleliza entre workers pero corre los archivos secuencialmente dentro
de cada uno, así que un archivo que ensucia el entorno rompe al siguiente.

La causa raíz estaba un nivel más abajo de lo que parecía. `loadRootEnv()` usa
`process.loadEnvFile()`, que **pisa** `process.env` con el contenido del `.env`
y recién después restaura lo que ya estaba. Los tests de integración lo llaman;
si un test unitario fijaba su secreto **después** de esa carga, terminaba
firmando el webhook con un valor y validándolo con el del `.env`.

Arreglado en tres lugares:

1. El proyecto `unit` de Vitest define su entorno en `vitest.config.mts`, así
   las variables están presentes **antes** de que cargue cualquier archivo de
   test y la restauración de `loadRootEnv` las conserva.
2. El archivo que muta el entorno lo restaura entero en `afterAll`.
3. El que depende de una variable la reafirma en `beforeEach` en vez de una sola
   vez en `beforeAll`.

Seis corridas completas y tres `npm run verify` seguidos en verde.
