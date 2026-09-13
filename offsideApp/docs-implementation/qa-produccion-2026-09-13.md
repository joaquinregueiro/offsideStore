# QA contra un entorno real — 2026-09-13

> Registro de la primera verificación del sitio con **PostgreSQL y Redis de
> verdad, sobre un build de producción**. Hasta esta sesión eso nunca se había
> hecho: las tres sesiones de frontend anteriores (09-09, 09-10 y 09-11) dejaron
> anotado el mismo pendiente —"no hay Docker en la máquina donde se trabajó"— y
> los tests de integración no se corrían fuera de CI.
>
> Ámbito: **sólo verificación**. Los dos arreglos que salieron de acá están al
> final; no se tocó ninguna decisión de negocio ni el ERD.

---

## 1. Qué se levantó

| Pieza      | Cómo                                                        |
| ---------- | ----------------------------------------------------------- |
| PostgreSQL | 16 nativo (el registro de Docker estaba bloqueado por red)  |
| Redis      | 7 nativo                                                    |
| Base       | `offside_test` para los tests · `offside_dev` para la app   |
| Datos      | `npm run db:seed:dev`                                       |
| App        | `npm run build` + `npm run start` (**build de producción**) |

⚠️ **PostgreSQL 16 y no 17 como CI.** Las migraciones aplican igual y `db:check`
da limpio; las extensiones que exige el ERD §1.b (`citext`, `unaccent`,
`pg_trgm`) existen en las dos. No se detectó ninguna diferencia de
comportamiento, pero conviene saberlo al leer estos resultados.

⚠️ **La app se configura por `.env`, no por variables del shell.** `turbo run
start` **filtra** el entorno: pasa lo que declara (`DATABASE_URL`, `REDIS_URL`) y
**descarta el resto**. Con `AUTH_SESSION_SECRET` exportada en la shell, el
proceso no la veía: `getSessionUser()` fallaba en silencio —está blindado para
no voltear la barra—, así que **todas las pantallas se renderizaban como si no
hubiera sesión** y `POST /api/auth/login` devolvía 500. No es un bug del
producto: es cómo funciona el filtrado de Turbo. Con un `.env` de verdad, que
`@offside/config` carga dentro del proceso, anda todo.

---

## 2. Resultado de las suites

Todo en verde, contra servicios reales:

| Gate                                                         | Resultado    |
| ------------------------------------------------------------ | ------------ |
| `format:check` · `check:css` · `check:inline` · `check:tema` | ✅           |
| `lint` · `typecheck`                                         | ✅           |
| Tests unitarios                                              | ✅ **586**   |
| Tests de integración (PostgreSQL + Redis)                    | ✅ **360**   |
| `npm run build` (producción)                                 | ✅ 22 rutas  |
| `db:check` + migraciones sobre base vacía                    | ✅ sin drift |

**946 tests en total.** Los 360 de integración son los que nunca se habían
corrido durante el desarrollo.

---

## 3. Recorrido por HTTP

Sobre el build de producción, con la base sembrada.

**Públicas** — todas 200 y con contenido real: vitrina, `/buscar`, `/buscar?q=`,
`/como-funciona`, `/ingresar`, `/crear-cuenta`, `/olvide-password`, `/carrito`,
`/p/[id]` y `/tienda/[sellerId]`. La ficha rinde título, precio, "Ficha
técnica", "Preguntas" y "Compartir por WhatsApp".

**Con sesión** — `POST /api/auth/login` devuelve 200 y deja la cookie de sesión
(HttpOnly). Con ella, `/cuenta`, `/cuenta/compras`, `/cuenta/favoritos` y
`/vendedor` rinden **datos privados reales**: la bandeja de compras muestra los
números de orden de ese comprador.

**Sin sesión** — las guardas funcionan: `/cuenta`, `/vendedor`, `/admin` y
`/admin/pagos` redirigen a `/ingresar?next=…`.

⚠️ **Se verificó explícitamente que NO hay fuga de datos.** En el HTML que recibe
un anónimo en `/admin` y `/admin/pagos` no aparece ni un email sembrado, ni un
número de orden, ni un id de pago de Mercado Pago. Lo único que se alcanza a
transmitir antes del redirect son rótulos de navegación.

---

## 4. ⚠️ Hueco abierto: el soft-404

**Una publicación inexistente responde `200`, no `404`.** Igual con las rutas
guardadas: redirigen bien en el navegador, pero el status es `200` con un
`<meta http-equiv="refresh">`, no un `3xx`.

**Dónde importa y dónde no.** En las rutas privadas es casi indistinto: no se
indexan y no hay fuga. En `/p/[id]` **sí importa**: el enlace de una camiseta
circula por WhatsApp y sobrevive a la venta, así que un buscador indexa como viva
una publicación que ya no existe.

**Por qué no se arregló acá.** Se probaron **tres** caminos contra el build de
producción, y los tres siguen dando 200:

1. `notFound()` en `generateMetadata`
2. `notFound()` sólo en la pantalla (lo que ya había)
3. sacando el `loading.tsx` de la ruta

La hipótesis intuitiva —que `generateMetadata` corre antes del primer byte— **es
falsa en Next 16: la metadata también se transmite**. Y con el sitio entero en
`force-dynamic`, el shell ya salió para cuando cualquiera de las dos funciones
resuelve. Un `notFound()` posterior al primer byte no puede cambiar el status.

⚠️ El `loading.tsx` de la ficha **se restauró**: sacarlo no arregla el status y
además es deliberado (evita que el esqueleto de la vitrina salte a una ficha de
una columna). El intento quedó **escrito como comentario en `generateMetadata`**
para que nadie repita el atajo.

**Opciones para cuando se decida** (ninguna es un retoque local):

| Opción                                                                      | Costo          | Qué resuelve             |
| --------------------------------------------------------------------------- | -------------- | ------------------------ |
| `noindex` en la pantalla de "no encontrada"                                 | bajo           | sólo el SEO              |
| Resolver la ficha antes de transmitir (sacarle `force-dynamic` a `/p/[id]`) | ARQUITECTÓNICO | el 404 de verdad         |
| Middleware para las rutas guardadas                                         | ARQUITECTÓNICO | el `3xx` de las privadas |

---

## 5. Lo que se arregló

Los dos hallazgos que **sí** eran corregibles sin tocar arquitectura.

### 5.1 Un id mal formado ya no llega a la base

Las PK del ERD son `uuid` (CLAUDE.md §6) y PostgreSQL **rechaza** la comparación
contra texto mal formado: `invalid input syntax for type uuid`. O sea que
`/p/<basura>` no devolvía "no encontrada", tiraba una excepción de base.

⚠️ **Pasaba dos veces, y la segunda estaba tapada.** La ficha pide la publicación
y sus preguntas **en paralelo**, así que el id malo llegaba a las dos consultas.
La de preguntas la absorbía el `.catch()` de la pantalla —el blindaje que evita
que un bloque accesorio voltee la ficha—, así que no rompía nada y por eso nadie
lo vio: sólo ensuciaba el log en cada visita a una URL con basura.

Se agregó `esUuid` a `@offside/utils` (transversal, sin lógica de negocio) y la
guarda en `findPublicListing` y en `listPublicQuestions`. **Medido después: cero
errores de base.**

### 5.2 La ficha consultaba la misma fila dos veces

`generateMetadata` y la pantalla pedían la **misma** publicación —con su join y
sus imágenes— en cada visita. Con `cache()` de React, que dedupe por argumento y
dura lo que dura el pedido: **de 2 consultas a 1**, medido en el log. Es la
pantalla más visitada y más compartida del sitio.

---

## 6. Lo que sigue sin verificarse

- **Refunds y refresh de tokens contra Mercado Pago real.** Sin credenciales no
  se puede. `seller_liabilities` sigue vacía (RISK-F1) y el manejo correcto
  depende de un 🔵: qué hace MP exactamente ante saldo insuficiente.
- **Recorrido visual pantalla por pantalla.** Acá se verificó por HTTP —status,
  contenido, sesión, guardas—, no mirando las 22 pantallas con ojos en un
  navegador.
- **Términos y Condiciones / Privacidad**: 🔴, requiere asesoramiento
  profesional. Sigue siendo el bloqueo duro del lanzamiento comercial.
