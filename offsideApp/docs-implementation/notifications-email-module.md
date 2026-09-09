# Notificaciones por email

Cómo está implementado el envío de emails. **Fecha: 2026-08-26.**

Fuente de verdad: `docs/02-product/notifications-and-engagement.md` §2.

## Qué resuelve

Hasta ahora **nadie podía completar un alta**: el token de verificación se
generaba pero no se entregaba, y BR-001 exige email verificado para operar. La
única salida era un `UPDATE` a mano en la base.

## Alcance

**Dos emails**, no los nueve del documento:

| Email                  | Disparador                       |
| ---------------------- | -------------------------------- |
| Verificación de cuenta | `auth.register()`                |
| Verificación (reenvío) | `auth.resendEmailVerification()` |
| Reset de contraseña    | `auth.requestPasswordReset()`    |

Los otros siete eventos que lista §2.1 —venta, compra, pago, envío, entrega,
refund, reclamo, disputa— dependen de módulos o estados que todavía no existen.
Se agregan cuando exista su disparador, no antes.

**No** se implementaron preferencias de opt-in/opt-out. Siguen 🟡, y además la
verificación no es opcional: BR-001 la exige para operar.

## El reenvío (2026-09-02)

**Sin esto, una cuenta cuyo email no llegaba quedaba MUERTA.** No podía
ingresar —BR-001 exige el email verificado— y no había ningún camino para
emitir un token nuevo: la única salida era un `UPDATE` a mano en la base. Un
email se pierde por motivos triviales y frecuentes: spam, un corte de SES, el
job agotando sus cinco intentos.

Peor aún: la pantalla `/verificar-email` decía textualmente _"Ingresá y te
mandamos otro"_, y **eso no existía**. La interfaz prometía algo que el sistema
no hacía, y además mandaba a `/ingresar`, que está bloqueado sin verificar.

`POST /api/auth/verify-email/resend` + el formulario de `/revisa-tu-email`.

Reglas, todas heredadas de `requestPasswordReset` a propósito:

- **No revela nada.** Devuelve `null` —y el Controller responde lo mismo— si el
  email no existe, si la cuenta **ya está verificada**, o si no está `active`.
  Distinguir cualquiera de los tres casos convertiría el endpoint en un
  enumerador de cuentas, y el segundo además delataría cuáles están sin
  verificar.
- **Rate limit propio** (`verify-resend`), con su contador separado: emite un
  token y encola un job, así que no puede quedar abierto a repetición
  ilimitada.
- **No invalida los tokens anteriores**, igual que el reset. Quien pide otro
  porque "no llegó" puede encontrar el primero después y usarlo. Todos son de un
  solo uso y vencen solos. Hay un test que lo fija.

### El límite por cuenta, y por qué el de IP no alcanzaba

Cada llamada **exitosa** manda un email real a una persona real. Eso invierte la
lógica habitual del rate limiting: en el login lo que hay que frenar son los
intentos FALLIDOS —por eso `checkAccountLimit` no consume cupo, para que un
usuario legítimo no se bloquee solo—. Acá **el intento exitoso ES el daño**.

Sin un límite por cuenta, repetir el POST desde IPs distintas inunda la casilla
de un tercero y, con SES en producción, **quema la reputación de envío del
dominio**: las quejas por spam las cobra AWS.

Por eso se agregó `consumeAccountLimit(scope, email)`, que cuenta **todos** los
intentos y usa una clave con el scope adentro, para no compartir contador con el
login —compartirlo permitiría dejar a alguien sin poder ingresar a fuerza de
pedirle reenvíos—. Tres tests lo fijan.

### ⚠️ Hallazgo: las Server Actions NO pasan por el rate limit

Al revisar esto apareció un agujero **preexistente y más amplio que el email**:
las Server Actions de `auth` llaman al Service **directamente**, salteando el
Controller —que es donde vive `consumeIpLimit`—. Es decir: el límite protege la
API, y **la pantalla, que es el camino que usa todo el mundo, no estaba
protegida**.

Alcanza a `crearCuenta`, `ingresar`, `pedirResetDePassword` y `reenviarVerificacion`.

Se cerró **sólo lo que manda emails** —reset y reenvío, con el límite por
cuenta—, porque es lo que se activa al encender SES y es la abuso más inmediato.

⚠️ **`ingresar` y `crearCuenta` siguen sin límite por la vía de la pantalla.**
Eso deja la fuerza bruta de login abierta desde el navegador, que es peor que el
email bombing y merece su propia pasada: hace falta un helper que lea la IP con
`headers()` desde una Server Action, y en el caso del login además replicar
`registerFailedAttempt`. Arreglarlo a medias daría una falsa sensación de
cobertura.

### Lo que NO se iguala: el tiempo

La respuesta es siempre la misma, pero **el tiempo no**: una cuenta válida hace
un INSERT y encola un job; una inexistente corta en el SELECT. Con suficientes
muestras la diferencia es medible, y permite enumerar cuentas. Es la misma
exposición que ya tenía `requestPasswordReset` y se acota por el mismo lado —el
rate limit—, no con trabajo ficticio equivalente como hace `login` con su hash
de descarte. Queda registrado, no disimulado.

## Decisión: Amazon SES

⚠️ **El proveedor de email sigue 🟡 en `docs/`** (`notifications-and-engagement.md`
§2.1 lo lista entre lo pendiente, junto con plantillas y disparadores). SES es
una **decisión de implementación tomada por el owner el 2026-08-26**, no una
decisión documentada en `docs/`, y **no está en DEC-012**.

Por eso el proveedor vive detrás de un puerto desde el primer día:

```
services/email.service.ts          ← dominio: no sabe qué es SES
        ↓
infrastructure/email/index.ts      ← elige el adaptador
        ↓
  ses-email.sender.ts   |   log-email.sender.ts
```

Cambiar de proveedor es escribir otro adaptador. `auth` no se entera.

Dependencia agregada: `@aws-sdk/client-sesv2` (~6,8 MB). Es el camino
mantenido para hablar con SES; firmar SigV4 a mano sería código de criptografía
propio para ahorrar una dependencia.

## Elección del adaptador

| Situación                            | Adaptador                     |
| ------------------------------------ | ----------------------------- |
| Las cuatro variables de SES cargadas | **SES**, en cualquier entorno |
| Faltan y `APP_ENV != production`     | **log**                       |
| Faltan y `APP_ENV == production`     | ⚠️ **se rompe a propósito**   |

El último caso es de seguridad, no de comodidad. Caer al adaptador de log en
producción escribiría **tokens de verificación y de reset en el log del
servidor** —valen tanto como una contraseña— y además el usuario nunca recibiría
nada mientras el sistema informa éxito. Es preferible que el envío falle
ruidosamente y el job se reintente. Hay un test que lo fija.

El adaptador de log imprime el cuerpo completo, token incluido: en desarrollo
**el log es la casilla de correo**.

## Por qué va por cola

`notifications-and-engagement.md` §2.2 lo decide: _"el envío se procesa por
BullMQ"_. Y es lo correcto: un registro no puede fallar porque SES esté caído,
ni tardar lo que tarde un tercero en responder.

```
register()  →  commit  →  enqueueEmail()  →  Redis
                                              ↓
                        worker (BullMQ, 5 intentos, backoff exponencial)
                                              ↓
                                     createEmailSender().send()
```

Dos detalles que importan:

- **Se encola DESPUÉS de commitear**, nunca dentro de la transacción: encolar
  adentro mandaría el email de un registro que todavía puede revertirse.
- **`enqueueEmail` no lanza.** Si Redis no responde, el error se registra y el
  registro sigue adelante. Que la cola falle no puede abortar un alta que ya se
  escribió; un alta sin email se resuelve reenviando, no revirtiendo.

⚠️ El job **lleva el token en su payload**, que vive en Redis hasta procesarse.
Es la misma exposición que ya tiene el `code_verifier` de OAuth, y se acota
igual: `removeOnComplete` lo borra al terminar y los tokens vencen solos. El
payload no se loguea en ningún punto.

## El worker corre dentro del proceso web

Se registra en `apps/web/src/instrumentation.ts`, el hook que Next ejecuta una
vez por instancia antes del primer request.

`tech-stack.md` §5 lo habilita explícitamente: _"el worker puede correr en el
mismo proceso que la web al principio y separarse después (futuro
`apps/worker`)"_. Además resuelve un problema de dependencias: el procesador de
emails vive en `modules/notifications`, y `packages/jobs` no puede importar de
`apps/web` sin invertir la dirección del monorepo.

**Consecuencia operativa: no hace falta un segundo servicio en Coolify.** El día
que el volumen lo justifique, se mueve el registro a
`packages/jobs/src/workers/main.ts` —que ya existe y ya sabe apagarse
ordenadamente— y se corre `npm run worker:start` aparte. Nada más cambia.

## Variables de entorno

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
EMAIL_FROM_ADDRESS=hola@tudominio.com
EMAIL_FROM_NAME=Offside Store        # opcional
```

Se exigen con `requireEnv()` en el borde del adaptador, no en el arranque: sin
ellas el resto del sistema tiene que poder levantar igual.

## Puesta en marcha de SES

**✅ FUNCIONANDO EN PRODUCCIÓN (2026-09-02).** Dominio `offside.com.ar`, SES
configurada, y **emails entregados de verdad**. Con esto cae el último bloqueo
del alta: hasta hoy nadie podía completar un registro sin un `UPDATE` a mano.
Ninguna credencial pasó por el repositorio.

`APP_URL` apunta al dominio nuevo —verificado contra producción—, lo que importa
porque **los enlaces de los emails se construyen con ella**: si hubiera quedado
en `sslip.io`, cada verificación habría llegado apuntando al host viejo.

### El error que hubo, y por qué se diagnosticó rápido

El primer intento falló con `AccessDeniedException`, cinco veces por job con
backoff. **No era el dominio, ni DKIM, ni el sandbox**: era IAM —el usuario no
tenía `ses:SendEmail`—. Crear el usuario y sus access keys no otorga nada por
sí solo.

Se resolvió adjuntando una política mínima y **reiniciando el contenedor**: el
cliente de SES se construye una sola vez y se cachea, así que no toma
credenciales nuevas en caliente.

⚠️ Vale la pena registrar por qué se diagnosticó en un paso: el adaptador
propaga el **nombre** del error de AWS y nunca el cuerpo del mensaje. Ese nombre
solo alcanzó, sin filtrar un solo token al log.

⚠️ `AccessDeniedException` es un fallo **permanente**: reintentarlo cinco veces
no podía cambiar nada. Hoy la cola trata igual a un fallo transitorio —SES
caído— que a uno de configuración. Distinguirlos es una mejora pendiente.

### Verificado contra producción

- El adaptador elegido es **SES**, no el de log.
- El **límite por cuenta** del reenvío: cinco llamadas pasan, la sexta devuelve
  `429`. Se comprobó con una dirección inexistente, así que no se le mandó un
  solo email a nadie.
- Las respuestas **no traen `devToken`**: en producción una cuenta existente y
  una inexistente responden idéntico, que es lo que impide enumerar cuentas.

Los pasos de abajo quedan como referencia de lo que se hizo y de lo que hay que
rehacer si alguna vez se cambia de dominio o de cuenta.

Dos cosas que conviene entender antes, porque explican por qué no alcanza con
crear la cuenta:

- **SES no envía desde un remitente que no verificaste.** Hay que probar la
  propiedad del dominio con registros DNS.
- **Una cuenta nueva arranca en SANDBOX**, y ahí sólo se puede enviar a
  direcciones verificadas una por una. Es decir: **en sandbox, un usuario real
  no puede registrarse**. Salir es un pedido a AWS que suele tardar entre unas
  horas y un día hábil.

### Pasos

1. **Verificar el dominio** en SES → _Identities_ → _Create identity_ →
   _Domain_. Habilitar **DKIM** (Easy DKIM). SES da tres registros `CNAME` que
   hay que cargar en el DNS del dominio. El estado pasa a _Verified_ cuando
   propagan.
2. **Publicar SPF y DMARC** en el DNS. No son opcionales en la práctica: sin
   ellos Gmail y Outlook mandan los emails a spam o los rechazan.
   - SPF: un `TXT` en el dominio con `v=spf1 include:amazonses.com ~all`.
   - DMARC: un `TXT` en `_dmarc.<dominio>` con `v=DMARC1; p=none;` para
     empezar. `p=none` sólo observa; endurecerlo después, con datos.
3. **Pedir la salida del sandbox** en SES → _Account dashboard_ → _Request
   production access_. Explicar el caso real: emails transaccionales de
   verificación de cuenta y recuperación de contraseña de un marketplace, sin
   envíos masivos ni listas compradas.
4. **Crear un usuario IAM** con una política mínima: sólo `ses:SendEmail` y
   `ses:SendRawEmail`. **No usar la cuenta raíz ni un usuario con permisos
   amplios**: si esa credencial se filtra, lo único que habilita es mandar
   emails.
5. **Cargar las cinco variables en Coolify** (`AWS_REGION`,
   `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EMAIL_FROM_ADDRESS`, y
   opcionalmente `EMAIL_FROM_NAME`) y redesplegar. No hay que tocar código.

### Cómo saber que funcionó

Registrar una cuenta con una dirección real y ver que llega. En el log del
contenedor tiene que aparecer `via ses` —no `via log`—. Si aparece `via log` en
producción hay un bug, porque el adaptador de log **no** debería ser alcanzable
ahí: falta alguna de las cuatro variables y el envío debería haber fallado
ruidosamente.

### ⚠️ Lo que TODAVÍA no está, y con SES importa

**Los rebotes y las quejas SÍ se procesan** desde el 2026-09-08, y con ellos cayó
la parte que este documento daba por pendiente. Ver la sección siguiente.

**Un fallo definitivo no deja rastro.** Agotados los cinco intentos, el job
desaparece de Redis y nadie se entera. La tabla `notifications` del ERD existe y
está vacía: registrar ahí cada envío y su resultado es el camino natural, y
además es lo que pide `notifications-and-engagement.md` §2.2.

## Rebotes y quejas (2026-09-08)

`POST /api/webhooks/ses/notifications` recibe por SNS los rebotes y las quejas que
publica SES, y las direcciones afectadas dejan de recibir email.

### ⚠️ Por qué hace falta si SES ya tiene su propia lista de supresión

Porque resuelven cosas distintas, y descubrirlo cambió el alcance del trabajo.

**La lista de SES ya nos protegía sin que lo supiéramos.** La cuenta se creó en
2026, y AWS documenta que toda cuenta posterior al 25/11/2019 usa la
_account-level suppression list_ **por defecto, para rebotes y quejas**: SES deja
de entregar a las direcciones que rebotaron duro y esos envíos **no cuentan** para
`Reputation.BounceRate`. O sea que el miedo original —que AWS suspenda la cuenta—
estaba mayormente cubierto de fábrica. Se verifica con
`aws sesv2 get-account --query SuppressionAttributes`.

**Lo que SES no hace es avisarnos.** Acepta el mensaje: nuestro job termina bien,
el log dice `enviado`, y nadie se entera de que no llegó nunca. El resultado es una
**cuenta muerta en silencio** —quien se registró con un typo no puede ingresar
(BR-001), pide reenvío, el reenvío "sale bien" y no llega—. Es el mismo agujero que
cerró el reenvío de verificación, un escalón más abajo. Esa es la mitad que
faltaba, y es la que se construyó.

### ⚠️ La tabla no estaba en el ERD

`database-design.md` §24 lista 51 tablas y ninguna cubría esto: `notifications`
(§18) es la campanita in-app y no tiene dirección, ni estado de entrega, ni
proveedor. El ERD **sí** modela los webhooks del otro proveedor
(`payment_webhook_events`); el equivalente de email nunca se modeló.

`email_suppressions` **la autorizó el owner** el 2026-09-08 tras plantearle el
bloqueo (CLAUDE.md §4/§5). ⚠️ **Falta reflejarla en `docs/`**, que es sólo lectura:
hasta entonces el ERD dice 51 tablas y el schema tiene 52.

### Las dos puertas del webhook

El endpoint es **público y no tiene sesión** —SNS no manda credenciales—, así que se
autentica por firma, igual que el webhook de Mercado Pago. Sin eso, **cualquiera
que descubra la URL puede postear un rebote falso con la dirección de otra
persona** y dejar esa cuenta sin recibir email nunca más: no hace falta robar nada,
sólo saber un email ajeno.

1. **`TopicArn` esperado** (`SES_SNS_TOPIC_ARN`). Va **primero a propósito**:
   verificar la firma puede obligar a descargar el certificado, y esa descarga la
   dispara un desconocido. Sin este filtro, repetir el POST con URLs de
   certificado distintas convierte al endpoint en un generador de tráfico saliente.
2. **Firma criptográfica** (`lib/sns-signature.ts`), con el mecanismo que AWS
   documenta: texto canónico de pares clave/valor separados por saltos de línea en
   orden alfabético, RSA contra el certificado de `SigningCertURL`, SHA1 para
   `SignatureVersion` 1 y SHA256 para la 2.

⚠️ **La URL del certificado se valida ANTES del fetch** —HTTPS, path `.pem` y host
`sns.<region>.amazonaws.com`—. Ese orden evita dos cosas a la vez: que se descargue
un certificado desde el servidor del atacante (que entonces podría firmar sus
propios mensajes) y que el endpoint sirva de SSRF.

⚠️ **Falla cerrado**, al revés que el rate limiter, y las dos cosas son correctas:
allá fallar cerrado dejaba a todos afuera del sitio; acá dejar pasar un mensaje sin
verificar **es** el ataque.

⚠️ Se aceptan las dos versiones de firma. SHA1 está roto para colisiones, pero SNS
firma con la versión 1 salvo que se pida la 2 en el topic, y rechazarla dejaría de
procesar rebotes sin avisar. **La mitigación es de configuración: conviene
habilitar SignatureVersion 2 en el topic.**

### A quién NO se suprime

Es lo que más se cuidó, porque suprimir de más deja a una persona real sin su
cuenta y **eso no lo ve nadie** hasta que se queja.

| Caso                                        | ¿Suprime? | Por qué                                                                                  |
| ------------------------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `Permanent` (rebote duro)                   | **sí**    | AWS: es improbable que puedas volver a enviarle                                          |
| `Transient` (casilla llena, servidor caído) | **no**    | es temporal y SES ya reintenta solo                                                      |
| `Undetermined`                              | **no**    | adivinar cuesta una persona afuera; no actuar, un rebote                                 |
| Queja por spam                              | **sí**    |                                                                                          |
| Queja `not-spam`                            | **no**    | el único valor de IANA que significa lo contrario: quien reporta **defiende** el mensaje |
| `Delivery`, `Send`, `Open`…                 | **no**    | no son fallos                                                                            |

Una notificación puede traer **varios destinatarios** —AWS lo dice y no garantiza
orden ni agrupamiento—, así que se recorren todos.

### Idempotencia

SNS reintenta y entrega desordenado. `email_suppressions` tiene `UNIQUE(email)` y
la escritura es un **upsert**: con un `INSERT` a secas la segunda entrega
reventaría contra el índice, el endpoint devolvería un error y SNS reintentaría
durante días. Un rebote nuevo sobre una dirección liberada **vuelve a suprimirla**;
si no, liberar una casilla que sigue rota la dejaría recibiendo rebotes
indefinidamente.

`email` es `citext` como `users.email`: SES devuelve la dirección tal como venía en
el mensaje original, y comparando sensible al caso la supresión no encontraría
nunca al usuario.

### Dónde se consulta

En `processEmailJob`, el último punto antes del proveedor. Podría mirarse al
encolar y ahorrarse el job, pero entonces habría **dos** lugares donde se decide si
una dirección recibe, y alcanzaría con que un disparador futuro se olvidara de uno.
No lanza: descarta el job, porque reintentar cinco veces algo que por definición no
se puede mandar no ayuda a nadie.

Falla **abierto** si la consulta a la base falla —mismo criterio que el rate
limiter—, y acá además el costo es barato: SES no lo va a entregar igual.

### Verificado

Los cuatro ataques, contra el endpoint corriendo, con un rebote real adentro: topic
ajeno → **403**; firma inventada → **403**; certificado en un host del atacante →
**403**; cuerpo basura → **400**. `email_suppressions` quedó en **0 filas**: ninguno
logró suprimir nada. El camino feliz se cubre con tests que firman de verdad con un
par de claves RSA generado en el test.

### ⚠️ Lo que falta

- **No hay pantalla para liberar una dirección.** El Service tiene `release()` y la
  columna `released_by` existe, pero hoy se hace por SQL, igual que los roles de
  admin. Darle pantalla exige decidir **qué capacidad** la gobierna, y el mapa de
  DEC-023 no tiene ninguna que aplique: es 🟡.
- **La persona afectada no se entera.** Se registra y se loguea, pero la pantalla de
  reenvío sigue diciendo lo mismo de siempre. Mostrar "esa dirección rebota" sólo
  cuando está suprimida convertiría la pantalla en un oráculo para saber qué
  direcciones están en el sistema. Qué decirle, y si conviene dejar cambiar el
  email, es **decisión de producto** y sigue 🟡.
- **No hay alerta por volumen de rebotes.** Parte del hueco de observabilidad.

## Plantillas

Viven en `templates/auth.templates.ts`. Texto plano **y** HTML: el texto plano
es el fallback universal y los filtros puntúan peor un email sin él.

⚠️ El contenido sigue 🟡 en la documentación: texto, tono y diseño no están
definidos. Lo implementado es funcional y sobrio a propósito. Cuando exista la
definición de marca se reemplaza **sólo ese archivo**.

Las URLs apuntan a `/verificar-email` y `/restablecer-password`, **rutas del
frontend que todavía no existen**. El backend igual las construye: el día que el
frontend exista, funcionan.

## `exposeTokenInDev` sigue vigente

Los endpoints de registro y de recuperación siguen devolviendo el token en la
respuesta HTTP cuando `APP_ENV=development`. Decisión del owner: sirve para
tests e integración local y ya está limitado a desarrollo. Con el email andando
deja de ser el camino principal, pero no estorba.

## Tests

**13 nuevos.** Los que más valen:

- En producción sin configurar, `createEmailSender()` **lanza** en vez de caer
  al log.
- El token de verificación y el de reset **no se cruzan** entre plantillas.
- El token encolado es **el mismo** que verifica la cuenta (contra Redis real).
- Pedir recuperación para un email inexistente **no encola nada**: encolar
  dejaría rastro de que la cuenta se consultó, que es justo lo que
  `requestPasswordReset` evita al no revelar si existe.

**5 más por el reenvío** (2026-09-02), contra PostgreSQL y Redis reales: emite un
token **distinto** y lo encola, ese token verifica la cuenta, el token original
**sigue sirviendo**, no reenvía a una cuenta ya verificada, y no encola nada
para un email que no existe.
