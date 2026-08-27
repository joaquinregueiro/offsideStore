# Notificaciones por email

Cómo está implementado el envío de emails. **Fecha: 2026-08-26.**

Fuente de verdad: `docs/02-product/notifications-and-engagement.md` §2.

## Qué resuelve

Hasta ahora **nadie podía completar un alta**: el token de verificación se
generaba pero no se entregaba, y BR-001 exige email verificado para operar. La
única salida era un `UPDATE` a mano en la base.

## Alcance

**Dos emails**, no los nueve del documento:

| Email                  | Disparador                    |
| ---------------------- | ----------------------------- |
| Verificación de cuenta | `auth.register()`             |
| Reset de contraseña    | `auth.requestPasswordReset()` |

Los otros siete eventos que lista §2.1 —venta, compra, pago, envío, entrega,
refund, reclamo, disputa— dependen de módulos o estados que todavía no existen.
Se agregan cuando exista su disparador, no antes.

**No** se implementaron preferencias de opt-in/opt-out. Siguen 🟡, y además la
verificación no es opcional: BR-001 la exige para operar.

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

## ⚠️ Bloqueo real: hace falta un dominio

**SES no envía a direcciones ajenas sin un dominio verificado**, y una cuenta
nueva de SES arranca en **sandbox**, donde sólo se puede enviar a direcciones
verificadas una por una. Salir del sandbox es un trámite ante AWS.

Hoy el deploy vive en `sslip.io`, sin dominio propio. Entonces:

- El flujo completo **está implementado y probado** de punta a punta.
- El alta de un usuario real **sigue bloqueada** hasta que haya dominio.

El bloqueo dejó de ser código y pasó a ser una compra más un trámite. Cuando
existan, se cargan las cuatro variables y funciona sin tocar nada.

Pasos, para cuando toque: verificar el dominio en SES (registros DNS), pedir la
salida del sandbox, crear un usuario IAM con permiso `ses:SendEmail`, y cargar
las variables en Coolify.

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
