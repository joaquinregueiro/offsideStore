# Home que nunca queda vacía, buscador y primitivas del panel — 2026-09-11

> El dueño mandó dos capturas de producción (`offside.com.ar` ya sirve el
> rediseño v2 del 2026-09-10): la pantalla de crear cuenta con una franja
> vacía antes del pie, y la home "toda vacía, fea, con el buscador nativo".
> Esta entrada documenta qué estaba pasando y qué se cambió.

## Por qué la home se veía vacía en producción y llena en desarrollo

Todas las secciones de la home debajo de la portada se armaban con las
**facetas de la búsqueda**, que se calculan sobre lo PUBLICADO: la banda de
clubes exigía cuatro clubes con camisetas en venta, la de marcas otras cuatro,
y los atajos ("Buscá por lo que te importa") desaparecían sin facetas. En
desarrollo el seed deja 24 publicaciones y todo aparece; en producción, después
de que el dueño eliminó las publicaciones sin foto, había una o ninguna, y la
home quedaba en **portada → garantías → estado vacío → cierre**. Justo cuando
un marketplace nuevo más tiene que convencer, mostraba menos.

⚠️ **La regla nueva es que ninguna sección de la home depende de que haya
inventario.** El catálogo controlado (38 clubes, 18 marcas, 135 temporadas, 6
categorías; migraciones `0004` y `0007`) existe siempre, y es lo que se usa
como respaldo. Nada inventado: son las tablas sembradas.

## Qué cambió en `app/page.tsx`

- **Portada**: tres cartas flotantes con fotos reales de la vitrina (o la
  camiseta de la identidad si no hay fotos) y tres cifras del catálogo. En
  escritorio flota a la derecha del titular; **abajo de 1200px ya no se
  esconde: baja en flujo debajo del texto**, más chica. Antes la portada de
  una tablet o un teléfono era tipografía sobre un damero.
  ⚠️ `paralaje-portada` anima `transform`, así que va en el hijo `.escenario`
  y no en el contenedor que se centra con `translateY(-50%)`: en el mismo
  elemento la animación pisa el centrado y la escena aparece cortada.
- **Bandas de clubes y marcas: siempre.** Con facetas reales muestran el
  conteo; con menos de cuatro corren sobre el catálogo, sin conteo. **No se
  mezclan**: una banda con ocho clubes con número y cuatro sin número se lee
  como "de estos cuatro hay cero".
- **Categorías (sección nueva)**: las seis prendas del enum `garment_category`
  como fichas con insignia, ordinal y flecha, cada una a `/buscar?categoria=`.
  Iconos nuevos para short, buzo, campera y conjunto (misma regla de trazo que
  el §04 de la identidad; pendientes de validación con el diseño).
- **Garantías como fichas** (blanco sobre la superficie cálida, ordinal en la
  esquina, marco del icono en degradado de marca que se enciende al pasar).
  El texto no cambió: sigue sin decir un número ni prometer un sello.
- **Atajos como pastillas con monograma**: "RP" para River Plate, "BJ" para
  Boca Juniors, dos letras sobre el degradado de la marca; las marcas en
  noche, las temporadas en Amarillo Cambio. Con facetas dicen "3 camisetas";
  desde el catálogo dicen "Ver camisetas".
- **Rotación diaria del catálogo** (`tramoDelDia`): con 38 clubes y lugar para
  doce, el orden alfabético mostraría siempre Aldosivi, Argentinos, Arsenal…
  y nunca River ni Boca; al azar, dos personas verían dos homes distintas. Con
  el día del año como corrimiento la ventana avanza un lugar por día y todo el
  catálogo pasa por la portada en poco más de un mes.
- Plural corregido: "1 camiseta en venta ahora" (decía "1 camisetas").

`resumenDelCatalogo()` se reemplazó por `catalogoDeLaVitrina()` en
`listing.service.ts`, que devuelve las listas completas (id, nombre, slug) y
las categorías. La home es su único consumidor.

## Buscador del header

Era un `<input type="search">` con borde gris y un botón cuadrado: "nativo".
Ahora es una píldora de 52px con luz superior, hairline y sombra larga, y el
botón es un círculo de 44px con `--sombra-marca` que gana `--glow-marca` y
escala al pasar. Mismo formulario GET, sin JavaScript.

## Crear cuenta

El marco de las pantallas de auth tenía un mínimo de `74svh` y con el pie
quedaba una franja de papel vacía antes del `<footer>`. Ahora el mínimo es
`max(clamp(520px, 74svh, 880px), 100svh − barra − 48px)`: el marco llena el
viewport y el pie queda debajo del pliegue.

## Primitivas nuevas en `components/ui.tsx`

Para el panel del comprador, el del vendedor y el back-office que siguen:

| Primitiva              | Qué es                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `Cronologia`           | `<ol>` de hitos con estado hecho / actual / futuro / cancelado; el riel se dibuja una vez, sin bucle    |
| `Estrellas`            | lectura: cinco estrellas con relleno proporcional por `clip`, número y cantidad                         |
| `EstrellasEntrada`     | entrada: radios 1..5 en un `<fieldset>`, sin JavaScript, coloreado con `:checked ~`                     |
| `InsigniaDeNivel`      | tier del vendedor: nombre + tasa ya formateada (viene del Config Store)                                 |
| `InsigniaDeReputacion` | etiqueta + métricas crudas ("12 ventas · responde en ~3 h"), nunca un veredicto (DEC-036)               |
| `Contador`             | icono con globo numérico (campanita, carrito); "99+" arriba de 99; texto accesible con la cantidad      |
| `Paginacion`           | anterior / números cercanos / siguiente, por enlaces; la pantalla arma el `href`                        |
| `Definiciones`         | `<dl>` en grilla para pares término / valor                                                             |
| `Distintivo`           | "Promocionada": Amarillo Cambio macizo con texto Tinta (12,6:1), la única etiqueta que brilla en Cambio |

⚠️ `NavDeSeccion` ya era el sistema de pestañas (enlaces con `aria-current`,
indicador animado, scroll horizontal): no se duplicó.

`lib/formato.ts` suma `porcentajeDeComision` (basis points → "6 %"),
`multiplicador`, `fechaYHora`, `fechaRelativa`, `horas`, `estadoDeDisputa`,
`tonoDeDisputa`, `resolucionDeDisputa`, `motivoDeReclamo`, `estadoDeEnvio`,
`modoDeEnvio`, `modoDeEnvioCorto`, `nivelDeUsuario`, `tipoDeSancion` y
`cantidad`. Todos los mapas usan los valores REALES de los enums del ERD
(`dispute_reason` en minúsculas, `user_level` con DESTACADO y COLECCIONISTA).

⚠️ `modoDeEnvio` **no dice "gratis" en ningún caso**: con `included` el costo
está adentro del precio, y prometer envío gratis sería la primera queja.

`lib/rate-limit.ts` declara las familias nuevas de rate limit por usuario
(despachar, cancelar, confirmar, reclamar, responder, calificar, favorito,
promocionar, reportar, preguntar, direcciones, notificaciones, carrito,
perfil, vacaciones y las administrativas), cada una con contador propio.

## Verificado

En el navegador con la app corriendo (`next dev`, seed):

- Home a 1440×900: escena centrada y sin recorte, bandas con 17 enlaces
  navegables, seis categorías, garantías, grilla, atajos con monograma, cierre.
  Cero errores de consola, cero desborde.
- Home a 375×812: cero desborde, escena visible debajo del texto (230px),
  categorías y atajos como filas que se deslizan, cero controles chicos.
- Crear cuenta a 1440 y 375: el marco llena el viewport, sin franja vacía.
- `check:css`, `tsc`, `eslint` y `prettier` en verde sobre los archivos tocados.
