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

## Operaciones autenticadas (2026-09-08)

El pendiente que este mismo documento listaba —"el resto de las Server Actions
no tiene límite"— quedó cerrado. Publicar, editar, subir fotos, comprar, pagar,
conectar Mercado Pago y el back-office consumen ahora su propio cupo.

| Acción del vendedor / comprador / admin                   | Scope                          |
| --------------------------------------------------------- | ------------------------------ |
| `habilitarVendedor`                                       | `seller-create`                |
| `declararIdentidadFiscal`                                 | `tax-identity`                 |
| `conectarMercadoPago` / `desconectarMercadoPago`          | `mp-connect` / `mp-disconnect` |
| `publicar`                                                | `listing-create`               |
| `agregarFotos`                                            | `listing-image`                |
| `editar`, `pausar`, `reactivar`, `eliminar`, `borrarFoto` | `listing-update`               |
| `comprar`                                                 | `order-create`                 |
| `pagar`                                                   | `checkout`                     |
| `reembolsar`                                              | `refund`                       |
| `cambiarComision`                                         | `system-config`                |

### ⚠️ Acá se cuenta por USUARIO, no por IP

Es la diferencia de fondo con auth, y no es una preferencia de estilo: en auth
la IP es lo **único** que hay, porque quien intenta entrar todavía no es nadie.
Acá ya hay sesión verificada, y entonces la IP es la peor de las dos claves
disponibles.

1. **Castiga a quien no hizo nada.** Detrás de un NAT —una oficina, un
   locutorio, la red móvil de una operadora— muchísima gente comparte una sola
   IP. Contar por IP hace que la actividad de un desconocido consuma el cupo del
   resto. Con el techo de auth (20 por ventana), un solo vendedor subiendo dos
   tandas de ocho fotos ya dejaría a los demás afuera.
2. **No frena a quien sí.** Una IP se rota gratis. El `user_id` no: para tener
   otro hay que registrar una cuenta y verificar un email real, y ese camino ya
   tiene su propio límite por IP.

Los límites por IP que ya existían en la API **no se tocaron**: siguen ahí, y
ahora el límite por usuario corre además en los dos caminos.

### ⚠️ Presupuesto aparte del de auth

`ACTIONS_RATE_LIMIT_MAX_PER_USER` (60) y `ACTIONS_RATE_LIMIT_WINDOW_MINUTES`
(15) son variables **nuevas**, no las de auth. Aquellas están calibradas contra
adivinar una password —5 por cuenta, 20 por IP— y son bajas a propósito, porque
nadie escribe mal su clave veinte veces. Heredarlas para publicar bloquearía a
un vendedor que sube su catálogo un domingo a la tarde. Son dos amenazas
distintas, y por eso son dos números distintos. Valores 🟡 pendientes de
confirmación (`configuration-registry.md` §3).

### ⚠️ Esto NO es un cupo de negocio

"Cuántas publicaciones puede tener un vendedor" es ⚙️ CONFIGURABLE y vive en el
Config Store (CLAUDE.md §12); el throttling gradual por estado de riesgo es
TS-042 y sus umbrales siguen 🟡. Lo de acá es un techo de seguridad: alto para
una persona, bajo para un script. No se inventó ninguna regla de negocio.

### Por qué cada familia cuenta aparte

Si `publicar`, `editar` y `agregarFotos` compartieran contador, ordenar el
catálogo un domingo dejaría al vendedor sin poder publicar, que no tiene nada
que ver con lo otro. La clave lleva el scope adentro, igual que en auth.

### Dónde va la llamada

Después de resolver la sesión —no se puede contar por usuario sin saber quién
es— y **antes** de parsear el formulario, decodificar imágenes o llamar a
Mercado Pago. Es la única excepción a "el límite primero", y el orden sigue
siendo el más barato posible: resolver la sesión es una lectura indexada.

### Lo que más justifica el trabajo

`publicar` y `agregarFotos` son **las operaciones más caras del sistema**: cada
foto se decodifica y se reescribe en tres tamaños con sharp, hasta ocho por
envío. Sin techo, un bucle desde una sola cuenta agota la memoria del VPS sin
necesidad de explotar nada — el mismo razonamiento que argon2id en el login,
pero con un costo por intento bastante mayor.

Los administrativos se limitan aunque exijan capacidad: tener la capacidad no
vuelve inofensiva la repetición. Cada cambio de comisión inserta una fila nueva
en `app_settings`, que es versionada, y cada reembolso llama a Mercado Pago con
plata real. Es además el techo que queda si una sesión de admin se filtra.

### Verificado en ejecución

Con `ACTIONS_RATE_LIMIT_MAX_PER_USER=2` en local: la clave real
`rl:tax-identity:user:<uuid>` apareció en Redis y llegó a 2, y el tercer envío
del formulario se rechazó en pantalla con "Demasiados intentos", sin salir de la
página. Los datos de prueba se borraron y el `.env` quedó como estaba.

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
- **No hay límite por IP en las operaciones autenticadas.** Es deliberado (ver
  arriba), pero tiene un costo: alguien con varias cuentas verificadas suma el
  cupo de todas desde una sola máquina. Crear cada cuenta cuesta un email real
  y pasa por `register` y `verify-resend`, que sí se limitan por IP, así que el
  camino existe pero no es barato.
- **El límite es un techo, no una política.** Que alguien publique 59 camisetas
  por hora sin que nadie se entere sigue siendo posible: cuántas _debe_ poder
  publicar un vendedor es ⚙️ CONFIGURABLE (Config Store) y el throttling por
  estado de riesgo es TS-042, con umbrales 🟡. Esto no reemplaza ni a uno ni al
  otro.
