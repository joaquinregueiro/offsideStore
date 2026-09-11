# Verificación con la app corriendo — 2026-09-10 (noche)

> Cierra el pendiente que arrastraban tres sesiones: **«falta pasar las
> pantallas por un navegador con la app corriendo»** y **«los 257 tests de
> integración no se corrieron»**. Las dos cosas se hicieron, sin Docker.

## Antes que nada: el merge que no compilaba

El commit `6654aed` («Fusionar historial remoto priorizando cambios locales»)
había dejado **315 hunks de conflicto en 70 archivos commiteados tal cual**
—`<<<<<<< HEAD` / `>>>>>>> origin/main` adentro de `tokens.css`, `ui.tsx`,
`form.tsx`, los services de `listings` y `orders`, dos tests de integración y
el propio `CLAUDE.md`—. El árbol no compilaba.

Se resolvió **mecánicamente con la política que el propio commit declara**:
en cada hunk se conservó el lado local (HEAD). Lo descartado del lado remoto
quedó guardado en un informe por archivo y por hunk para que el otro
desarrollador lo revise. Verificado después: los tres hunks remotos de los
tests eran versiones anteriores de lo local (manejo de SQLSTATE `23001` en
PostgreSQL 18, `ORDER BY` en `audit_log`), y el bloque de envíos de
`CLAUDE.md` —que sí era nuevo y no conflictuaba en espíritu— se reincorporó a
mano.

Resultado: `format`, `check:css`, `lint`, `typecheck` y **299 unitarios** en
verde (el remoto trajo 18 tests más).

## Infraestructura sin Docker

En la máquina no hay Docker, Postgres, Redis ni Homebrew. Sí hay Xcode CLT
(clang, make) y red.

| Servicio   | Cómo                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------- |
| PostgreSQL | binarios `embedded-postgres` (zonky) vía npm, **18.4**, con `citext`, `unaccent` y `pg_trgm` |
| Redis      | **8.10.1** compilado desde `redis-stable.tar.gz` con `make MALLOC=libc`                      |

⚠️ **Dos trampas que costaron un arranque cada una**: el socket Unix de
Postgres no puede vivir en el scratchpad —la ruta supera los **103 bytes** que
permite `sockaddr_un`— así que va en `/tmp`; y el paquete de binarios **no trae
`psql`**: las bases se crean con el cliente `postgres` del propio monorepo.

⚠️ **Producción y CI usan PostgreSQL 17; acá corrió 18.** Las migraciones y
los 257 tests pasaron igual, pero es una diferencia real y ya apareció una vez:
PG 18 reporta la violación de `ON DELETE RESTRICT` como `23001` y 17 como
`23503`. El test de auth ya contempla las dos.

## Los 257 tests de integración

Receta idéntica a `ci.yml`: base `offside_test` con `--locale=C
--encoding=UTF8`, `db:check`, `db:migrate`, `vitest --project integration`.

**257/257 en verde.** Antes de eso fallaban tres, y los tres en el mismo grupo
(reenvío de verificación), todos con `expected [ Job ] to have a length of +0
but got 1`. ⚠️ **No era código: eran jobs viejos de BullMQ en Redis.** La
suite asume una cola `notifications-send` vacía al arrancar —en CI lo garantiza
el contenedor nuevo— y acá Redis venía de una corrida anterior. Con `FLUSHALL`
pasó 42/42 el archivo y 257/257 la suite. Queda anotado como fragilidad de la
suite, no de la app: un `obliterate` en `beforeAll` la cerraría.

## Seed real de la base de desarrollo

`npm run db:seed:dev` (`apps/web/src/dev/seed.ts`). Puebla `offside_dev` **a
través de los Services** —registro, alta de vendedor, identidad fiscal con
CUIT válido, publicaciones con **fotos reales pasando por `sharp` y el
procesador de imágenes**, órdenes— y escribe directo con Drizzle sólo lo que
ningún Service puede crear desde afuera: roles de admin (se asignan sólo por
SQL a propósito), la conexión de Mercado Pago (tokens cifrados con el helper
real; el OAuth exige un `code` que sólo entrega MP desde el navegador) y el
pago aprobado (replica la transacción del webhook, porque el Service reconsulta
el pago a la API de MP y sin MP no hay qué reconsultar).

Idempotente (marca `@seed.offside.local`, borra en orden de FKs, verificado
corriendo dos veces) y **se niega a correr en producción** o contra una base
que no sea `offside_dev`. Deja 7 usuarios (admin, finanzas, tres vendedores en
los tres estados de MP, dos compradores), 24 publicaciones con 45 fotos y 4
órdenes en los estados que existen. Las credenciales son de desarrollo y las
imprime al final.

## Las 22 pantallas, con la app corriendo

### HTTP — 108 peticiones

27 rutas × 4 sesiones (anónimo, comprador, vendedor, admin), sesiones obtenidas
por `POST /api/auth/login`. **108/108 con el efecto esperado**: 200 donde
corresponde, redirección a `/ingresar` sin sesión, **404 y no 403** para admin
sin capacidad, redirección al onboarding para quien no es vendedor, home para
quien ya está logueado y entra a `/ingresar`.

⚠️ **El harness tuvo que aprender cómo streamea Next.** `loading.tsx` flushea
el shell con **200** y el `redirect()`/`notFound()` llega después como marcador
`NEXT_REDIRECT` / `NEXT_HTTP_ERROR_FALLBACK;404` en el flight. Un `fetch` con
`redirect: 'manual'` ve 200 y dos `<main>` (el del esqueleto y el real) en
**toda** pantalla protegida. La primera pasada dio 104/108 «rotas»; ninguna lo
estaba. El harness lee los marcadores del cuerpo y el conteo de `<main>` se
hace en el DOM real, no en el HTML crudo.

### DOM — navegador real

Login por el **formulario real** (no por la API) con las tres cuentas; en cada
pantalla: exactamente **un `<main>`**, **cero desborde horizontal**, **cero
controles por debajo de 24px**, **cero errores de consola**, formularios por
POST. Escritorio y 375px. Vendedor: panel, publicaciones, nueva, editar (los
cinco selectores de catálogo precargados), fotos (`multipart/form-data`),
ventas, Mercado Pago, fiscal. Comprador: mis compras, confirmar compra,
checkout pendiente, checkout pagado. Admin: índice, comisión, consola de pagos.

### Escritura de punta a punta, desde la UI

- **Publicar**: el formulario real creó la publicación en `draft` y avisó con
  el texto correcto que sin foto no sale a la venta (PS-010).
- **Comprar**: el formulario de dirección creó la orden `OFF-0E96381B69`
  (`PENDING_PAYMENT`, dirección guardada) y aterrizó en el checkout con el
  botón de pago. El pago en sí no se probó: exige credenciales de MP.

## Lo que la pasada encontró y se arregló

1. ⚠️ **`<title>` mentiroso en el checkout.** Una orden ya `PAID` a la que se
   vuelve con `?status=success` —el enlace que queda en el historial— decía
   «Confirmando tu pago» mientras el cuerpo decía «Pagada». El título salía del
   query y no del estado. Ahora `generateMetadata` lee la orden: «Orden pagada».
2. ⚠️ **Error de consola de React 19 en TODA pantalla con formulario, incluido
   el checkout**: `Formulario` declaraba `encType="multipart/form-data"` en un
   `<form>` con Server Action, y React los pisa y avisa. Verificado en el HTML
   servido que React emite solo `method="POST"` y
   `encType="multipart/form-data"`, así que los archivos siguen viajando
   enteros sin JavaScript. Se quitó el atributo.

## Lo que sigue sin verificar

- El pago real contra Mercado Pago y el retorno del webhook (sin credenciales).
- La subida de fotos **desde el navegador** (el panel no adjunta archivos; la
  subida sí está cubierta por el seed, que pasa por el mismo Service).
- Las View Transitions entre pantallas y el morph de la foto: necesitan
  observación humana, no se miden con `getComputedStyle`.
