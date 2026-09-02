# Rate limiting

Cómo está implementado el límite de intentos. **Fecha: 2026-09-02.**

Fuente de verdad: `docs/04-technical/security-observability-analytics.md`.

## El agujero que esto cerró

El limitador vivía **sólo en los Controllers**, y las Server Actions llaman al
Service **directo**. Resultado:

| Camino                              | ¿Limitado antes? |
| ----------------------------------- | ---------------- |
| `POST /api/auth/login`              | ✅ Sí            |
| El formulario de `/ingresar`        | ❌ **No**        |
| `POST /api/auth/register`           | ✅ Sí            |
| El formulario de `/crear-cuenta`    | ❌ **No**        |
| El formulario de `/olvide-password` | ❌ **No**        |

**La puerta protegida era la que casi nadie usa.** La pantalla —el camino de
todo el mundo, atacantes incluidos— estaba abierta, y además es la más fácil de
encontrar.

Dos consecuencias, y la segunda es peor:

1. **Credential stuffing.** Probar listas de credenciales filtradas de otros
   sitios sin techo de intentos. Casi nunca se adivinan contraseñas al azar; lo
   que funciona es reusar las que la gente repite. No hace falta adivinar: hace
   falta poder intentar muchas veces.
2. **Agotamiento de recursos.** Las passwords se hashean con **argon2id**, que
   es lento y usa ~19 MB por intento **a propósito** —eso es lo correcto contra
   quien robe la base—. Sin techo se vuelve en contra: cada intento fallido
   cuesta memoria y CPU del servidor. Un atacante **no necesita acertar una sola
   password** para voltear el sitio.

## Cómo quedó

`lib/rate-limit.ts` tiene el mecanismo; `lib/rate-limit-actions.ts` lo expone a
las Server Actions.

| Acción                 | Por IP            | Por cuenta                       |
| ---------------------- | ----------------- | -------------------------------- |
| `ingresar`             | `login`           | sí — **sólo cuentan los fallos** |
| `crearCuenta`          | `register`        | no (no hay cuenta todavía)       |
| `pedirResetDePassword` | `password-forgot` | sí — **cuentan todos**           |
| `reenviarVerificacion` | `verify-resend`   | sí — **cuentan todos**           |
| `restablecerPassword`  | `password-reset`  | no                               |

Valores en entorno: 20 por IP, 5 por cuenta, ventana de 15 minutos.

### ⚠️ La misma clave que la API, y por qué es lo único que hace que valga

Un Route Handler resuelve la IP desde `Request`; una Server Action desde
`headers()`. Son **dos formas de averiguar la misma IP**, y el conteo cae en la
**misma clave de Redis**. Si cada camino contara en su propia clave, un atacante
bloqueado por la API seguiría libre por la pantalla —y al revés—, que es
exactamente el agujero que esto vino a cerrar.

Por eso `consumeIpLimit(request, …)` delega en `consumeIpLimitFor(ip, …)`: hay
**un solo** lugar que arma la clave. Dos tests lo fijan, y se comprobó en
ejecución: dos llamadas por `curl` a la API más dieciocho envíos desde el
formulario sumaron 20, y el intento 21 se bloqueó.

### Dos criterios opuestos, los dos correctos

- **Login** — el cupo por cuenta lo consumen **sólo los intentos fallidos**
  (`registerFailedAttempt`). Si lo consumiera cualquier intento, mandar cinco
  con el email de otra persona la dejaría afuera de su propia cuenta: la
  protección sería el ataque.
- **Envío de emails** — cuentan **todos** los intentos
  (`consumeAccountLimit`), porque ahí el intento **exitoso es el daño**: manda
  un email real a una persona real. Sin eso, repetir el POST desde IPs distintas
  inunda la casilla de un tercero y quema la reputación de envío del dominio,
  que con SES la cobra AWS.

La clave lleva el scope adentro, así que los contadores **no se comparten entre
acciones**: pedir reenvíos no puede dejar a nadie sin poder iniciar sesión.

## ⚠️ Lo que este diseño acepta como costo

**Un atacante puede bloquear la cuenta de otro.** Cinco intentos fallidos con el
email de una persona la dejan sin poder ingresar durante la ventana. Es el
precio inherente de cualquier límite por cuenta, y estaba desde antes en la API;
esto lo extiende a la pantalla.

Se acepta porque la alternativa —no limitar por cuenta— deja pasar la fuerza
bruta **distribuida**, donde cada IP prueba pocas veces contra la misma cuenta y
el límite por IP nunca la ve. Un bloqueo temporal es peor que nada y mejor que
una cuenta robada.

Si algún día molesta, la salida no es subir el número: es exigir prueba de
humanidad tras los primeros fallos, no bloquear.

## ⚠️ Lo que sigue sin estar

- **`x-forwarded-for` es falsificable si Next queda expuesto directo a
  internet.** En Coolify el reverse proxy lo reescribe, así que hoy es
  confiable. Publicar el puerto de Next sin proxy volvería el límite por IP un
  adorno.
- **Falla abierto.** Si Redis no responde, se deja pasar y se registra. Es
  deliberado: con Redis caído, fallar cerrado dejaría a **todos** sin poder
  entrar, que es un incidente peor.
- **No hay alerta ante un pico de bloqueos.** Hoy nadie se entera de que están
  atacando el login. Es parte del hueco de observabilidad general.
- **El resto de las Server Actions no tiene límite**: publicar, comprar,
  iniciar checkout. La API sí lo tiene (`listing-create`, `order-create`,
  `checkout`), así que el mismo desbalance existe ahí. Es menos grave —todas
  exigen sesión verificada, así que no son anónimas— pero es el mismo patrón y
  conviene cerrarlo.
