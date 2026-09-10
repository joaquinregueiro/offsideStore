# Rediseño visual del frontend — 2026-09-10 (segunda parte del día)

> Complementa `frontend-2026-09-10.md`, que documenta la primera parte del día
> (errores por campo, `?status=pending`, los `ORDER BY` que faltaban). Esto es
> lo que vino después: el rediseño visual completo.

## Por qué

El dueño miró el sitio y dijo, textual:

> «todo el diseño de la página, todo todo el front en el CSS, las animaciones,
> la página es horrible, es superestática, cero animaciones, cero dinamismo,
> cero estética. Tenés que reformularla toda para que sea una página
> supermoderna, nueva, con dinamismo, con animaciones, todo.»

⚠️ **Estaba mirando el build del 2026-09-02.** Verificado en el navegador contra
`offside.com.ar`: `document.body` sin `display: flex`, `<footer>` inexistente,
cero botones en la portada, sin la tira de garantías. O sea que **no había visto
nada del 09 ni del 10**, y en particular no había visto la capa de movimiento —
por eso «cero animaciones» era literal para ese build.

Eso explica parte del diagnóstico, no lo invalida: el diseño que sí existía era
correcto y austero, y austero era exactamente el problema.

## Cómo se decidió

Tres propuestas de fundación visual escritas en paralelo desde ángulos distintos
(editorial, materia/profundidad, kinético/deportivo), tres jueces
independientes, y una síntesis que tomó la ganadora como base e injertó lo mejor
de las otras dos. Después, doce superficies, cada una con un diseñador y **dos
críticos adversariales** (uno técnico, uno de diseño). Puntajes: kinético 87,
profundidad 82, editorial 78.

Los críticos hicieron su trabajo: descartaron cambios que ya existían en el
código, marcaron los tímidos y encontraron reglas que rompían cosas.

## La fundación: un eje y cuatro planos

`app/tokens.css` pasó de 432 a ~1400 líneas y `app/movimiento.css` de 296 a
~1800. Dos ideas sostienen todo:

**UN EJE — 112 grados.** El ángulo del brazo del juez de línea con la bandera
levantada. Todo gradiente lineal, raya, destello, barrido y telón del sistema
usa ese ángulo. Es lo que hace que veinte efectos se lean como un sistema y no
como una pila de trucos. La **luz** es el otro mecanismo y es radial, desde
arriba a la derecha: no se pelean porque son cosas distintas.

**CUATRO PLANOS** — fosa, papel, ficha, flotante — con elevación de seis niveles
teñida en Tinta, grano de papel y mallas de color. Antes había **dos**
superficies (papel y blanco separadas por un borde gris de 1px) y por eso nada
estaba delante ni detrás de nada.

⚠️ **LA LUZ SE RESTA, NUNCA SE SUMA. Es la regla que sostiene todos los
contrastes del sitio.** Papel sobre Verde Cancha da 5.16:1 contra un mínimo AA
de 4.5: hay **0.66 de aire**. Está medido que aclarar ese verde apenas un **7%**
con blanco, un 8% con Amarillo Cambio o un 16.5% con `--verde-400` ya rompe AA
— y las tres propuestas originales aclaraban entre 10% y 26%. Por eso el punto
más claro de cualquier malla de marca **es el color de marca plano**, y la
dirección se consigue oscureciendo hacia el borde opuesto. Con esa regla, todos
los contrastes verificados siguen valiendo **por construcción**, en cualquier
viewport, sin volver a medir.

### Superficies como contrato

`.sup-noche .sup-fosa .sup-cancha .sup-2 .sup-marca .sup-calida .sup-ficha
.sup-flotante .sup-hundida .sup-vidrio .con-grano`

⚠️ **Ningún módulo escribe un fondo oscuro, un vidrio, una malla o un grano a
mano.** Cada clase trae su filo de luz, su `--color-foco`, su `--destello` y la
familia de neutros que corresponde. La causa medida de que todo se viera plano:
había **35 declaraciones de `background: var(--color-blanco)` en 11 archivos**,
así que nadie podía subir el nivel en un lugar sin subirlo a mano en los otros
diez.

⚠️ **Ninguna superficie oscura redefine `--color-tinta` ni `--color-blanco`.**
Parece el atajo obvio y es una mina verificada: hay tres bloques con
`background: var(--color-tinta)` que quedarían papel sobre papel, y
`--color-blanco` se usa como color de TEXTO en tres lugares, donde darlo vuelta
deja texto oscuro sobre naranja en 3.67:1. Se remapean los tokens **secundarios**
y el `color` se pone directo.

### El vidrio

⚠️ **Se tiñe con `--verde-750`, nunca con `--color-cancha`.** Un vidrio con alfa
se compone con lo que tiene detrás: teñido con el verde de marca al 94%, sobre
una zona blanca de la página el compuesto deja el Amarillo Cambio de «Crear
cuenta» —y el anillo de foco de toda la barra— en **4.09:1**, debajo de AA, y
nadie se entera. Con `--verde-750` al 92% el peor caso da papel 5.54:1: el
vidrio **mejora** la barra en vez de degradarla. Siempre detrás de `@supports`
con `--vidrio-solido` de fallback, o se lee el catálogo a través de la barra.

### Movimiento

De 6 keyframes a un vocabulario completo, **todo en CSS puro, sin una línea de
JavaScript**: marquesinas, paralaje por capas con `animation-timeline: scroll()`,
destello diagonal, subrayado que se dibuja, revelado tipográfico línea por
línea, rombos en deriva, shimmer de esqueleto, barra que se despega al scrollear.

⚠️ **Las dos guardas son obligatorias y por motivos distintos.**
`@supports (animation-timeline: view())` por afuera —sin soporte, el
`opacity: 0` del keyframe deja la página **VACÍA**, no «sin animar»— y
`@media (prefers-reduced-motion: no-preference)` por adentro, porque una
animación cuyo progreso da el scroll **no se apaga bajándole la duración**.

⚠️ **Toda animación infinita vive dentro de la media query, nunca afuera
confiando en la regla global.** La regla global aplasta la DURACIÓN y deja la
animación clavada en el ÚLTIMO cuadro: la marquesina quedaría corrida a mitad de
camino, no quieta al principio.

⚠️ **En una animación dirigida por scroll, `animation-delay` no hace nada.** El
escalonado se consigue corriendo `animation-range` por elemento, o dejando que
lo haga la geometría. Un delay ahí es un bug silencioso que se ve como «no se
escalonó». Y **revelado usa rango `entry`, paralaje usa rango `cover`**.

⚠️ **Un importe puede ENTRAR, nunca puede estar en movimiento.** Precio, total,
comisión, saldo y monto de reembolso pueden animarse una vez, mostrando el valor
final desde el primer cuadro. Prohibido contar hacia arriba, latir o brillar en
bucle: un número en movimiento se lee como un número que todavía no está
decidido, y esto es un sitio donde se transfiere plata a un desconocido.

⚠️ **El movimiento nunca es la información.** El pulso de «Última unidad» es
legítimo sólo porque la etiqueta ya lo dice con texto y color, y dura **tres
vueltas, no `infinite`** (WCAG 2.2.2). La marquesina se frena con `:hover` y con
`:focus-within` —sin la pausa por foco, quien navega con teclado persigue un
enlace en movimiento— y su segunda copia lleva `aria-hidden="true"`, o un lector
de pantalla lee los clubes dos veces.

⚠️ **Nada de `box-shadow` en una línea de tiempo de scroll.** Es una propiedad
de PINTURA y la barra adherida es el escenario más caliente del sitio: se anima
la opacidad de una capa que ya trae la sombra pintada. Y **la barra no cambia de
alto al scrollear**: es `position: sticky`, o sea que está en flujo, y animarle
el alto reflowea el documento mientras la persona scrollea.

## Defectos que el rediseño encontró y arregló

Todos verificados —midiendo o leyendo el código—, no supuestos.

### Rotos del todo

⚠️ **El patrón de rombos de la marca nunca cambió de color, en todo el sitio.**
`--patron-rombos` estaba declarada dentro de `:root` y su receta contiene
`var(--patron-color)`. **El valor computado de una custom property lleva sus
`var()` ya sustituidos**, así que se resolvía ahí con el gris `#e4e6de` y los
descendientes heredaban ese valor resuelto: las redefiniciones de `.sup-noche` y
`.sup-cancha` no cambiaban una sola pieza. El comentario de `header.module.css`
prometía 7.06:1 para un damero que salía gris. Viene del 2026-09-09. Ahora la
receta se declara por elemento.

⚠️ **La barra de progreso de lectura no pintaba nunca.** `@keyframes barrer-x`
declaraba sólo `from { transform: scaleX(0) }` y `.barra-lectura` declara
`scaleX(0)` en su regla base: el `to` implícito toma el valor subyacente, o sea
que interpolaba **0 → 0**.

⚠️ **Los acentos de los titulares se rapaban.** El revelado por línea recorta con
`overflow: clip` y compensaba 0.06em. Medido en el navegador con la Canvas API
sobre la woff2 real de Big Noodle: la tinta de `á`/`é` se va **0.1029em** por
encima de la caja de contenido. O sea que **toda vocal acentuada perdía el
acento**, que en castellano es casi cualquier titular — se veía «TENES UNA
CAMISETA GUARDADA». Ahora la compensación es 0.12em, con la tabla de medidas
escrita al lado. De paso: la regla estaba **duplicada en cinco módulos** con el
valor viejo, y cuatro de esas copias eran redundantes.

### Contraste

⚠️ **El borde de todos los campos de formulario daba 1.26:1.** WCAG 1.4.11 exige
3:1 para el contorno de un control, y esto era el borde de todos los campos de
texto, áreas y selects del proyecto. Pasó a `--linea-control`.

⚠️ **`--malla-noche` aclaraba, contra la regla propia de la fundación**, tirando
`--color-sobre-oscuro-tenue` de 6.39:1 a **3.99:1** en el ángulo superior
derecho. La tabla de contrastes estaba calculada contra la superficie PLANA, que
no es donde vive el texto.

⚠️ **Sobre Verde Cancha no existe un naranja legible** —`--color-alerta` da
**1.11:1** y el naranja vivo 2.39:1—, y `.sup-cancha` era la única superficie que
no remapeaba ese token: un `<Aviso tono="error">` dentro de un bloque de marca
salía ilegible sin que fallara nada.

⚠️ **El botón secundario se volvía ilegible justo mientras el dedo lo aprieta.**
Papel al 16% compuesto sobre Verde Cancha da `#358e61`, y el texto papel encima
queda en **3.87:1**. Ahora se oscurece (`--verde-900` al 30%, 6.65:1), que además
se lee mejor: apretar algo lo hunde, no lo enciende.

⚠️ **Un desborde horizontal real a 320 y 375px**, en la vitrina. `.boton` declara
`white-space: nowrap` a propósito, y un elemento flex no puede encogerse por
debajo de su min-content: con `nowrap` el min-content **es** el ancho completo
del texto, así que la etiqueta no se recorta, **empuja el `<body>`**. Medido:
«Buscar por club, marca o temporada» ocupa ~377px contra 343px útiles a 375. Se
arregló dejando envolver la línea en teléfono, no acortando el texto — acortar
lo arregla hoy y lo rompe la próxima vez que alguien reescriba una etiqueta.

### Regresiones introducidas por el propio rediseño, y detectadas

⚠️ **El total del checkout quedaba desalineado ~7px.** El importe pasó a
envolverse en una clase que recorta con `overflow: clip`, y **CSS 2.1 §10.8.1**
dice que un `inline-block` cuyo `overflow` no es `visible` deja de exponer la
línea de base de su texto. Con `align-items: baseline`, el número de 36px en Big
Noodle flotaba por encima de la palabra «Total» — en la fila más mirada del
sitio. Se recorta con `clip-path: inset(0)`, que recorta igual sin tocar el
modelo de línea.

⚠️ **Un `<Pliego patron>` mataba las animaciones de todos sus hijos.**
`.patron-vivo` lleva `overflow: hidden` para esconder el mosaico sobrante, y un
overflow distinto de `visible` **es un contenedor de scroll**: se comía el
outline de foco, mataba cualquier `sticky` adentro y dejaba sin correr **toda**
animación con `animation-timeline: view()` de los descendientes, porque `view()`
resuelve contra el contenedor de scroll más cercano. El patrón pasó a una capa
hermana absoluta.

### Un hecho de negocio falso, en la pantalla más visitada

⚠️ La tira de garantías de la vitrina decía **«Offside no toca la plata»**.
Offside **sí** toca la plata: la preferencia se crea sobre la cuenta del vendedor
con `marketplace_fee` y la comisión sale de ese mismo pago (DEC-043 — la prueba
real del 2026-08-26 repartió 6000 de Offside sobre 100000). «No toca la plata» se
lee como «no cobra comisión», y eso es una promesa que el checkout desmiente.
Dice **«Offside no retiene los fondos»**, que es lo único que esa tarjeta puede
prometer y además es exactamente lo que DEC-019 cerró en negativo.

## `scripts/chequeo-css.mjs`

Chequeo nuevo, enganchado a `npm run verify`. Verifica cuatro invariantes que
**fallan en silencio** — no rompen el build, no tiran warning, no las ve el lint:

1. `var(--x)` sin fallback y sin definición: la propiedad entera se descarta.
2. Un `@keyframes` usado desde un global que no está definido en un global.
3. El mismo nombre de `@keyframes` en un global **y** en un `*.module.css`: en un
   CSS Module los nombres son locales, así que el módulo resuelve a la suya y la
   global queda muerta.
4. Un `estilos.X` que la hoja importada no define. **TypeScript no lo ve** —los
   tipos de un CSS Module son un diccionario abierto—, así que
   `className={estilos.noExiste}` compila, pasa el lint y llega a producción como
   un elemento sin estilo.

Se ganó el lugar en el acto: la sesión se cortó por límite de uso a mitad de una
ola, dejando `vendedor.module.css` reescrito entero y seis de sus nueve pantallas
sin migrar. El chequeo listó las nueve referencias rotas; el typecheck daba
verde.

## Verificación

`format`, `check:css`, `lint`, `typecheck` y los **281 tests unitarios** en
verde. **Los 257 de integración no se corrieron: no hay Docker en la máquina de
trabajo, o sea ni PostgreSQL ni Redis.**

Lo visual se verificó en un navegador de verdad, con un banco que **renderiza los
componentes reales** —`app/page.tsx` es un Server Component async y se lo llama
como función; los Services están reemplazados por stubs con datos falsos; los CSS
Modules se emulan como hace Next— y se sirve por HTTP. No es una transcripción a
mano: son los mismos nombres de clase, la misma estructura y el mismo CSS.

Medido ahí:

|                                    | 1280px | 375px | 320px |
| ---------------------------------- | ------ | ----- | ----- |
| desborde horizontal                | no     | no    | no    |
| controles < 24px                   | 0      | 0     | 0     |
| elementos trabados en `opacity: 0` | 0      | 0     | 0     |

Y las dos variantes que pueden dejar la página **vacía** en vez de sólo quieta,
simuladas dando vuelta las media queries y desactivando el `@supports`:

- **`prefers-reduced-motion: reduce`** → 0 elementos invisibles, **0 animaciones
  corriendo**, 0 desborde.
- **Sin `animation-timeline`** (Firefox hoy) → 0 elementos invisibles, documento
  completo, 0 desborde.

⚠️ **Lo que el banco NO cubre:** las View Transitions entre pantallas (necesitan
navegación real), el morph de la foto de la grilla a la ficha, y las 19 pantallas
que no se renderizaron ahí — home, primitivas y 404 sí. Esas se verificaron
leyendo el código y con los chequeos automáticos, no con los ojos.

## Lo que quedó anotado y sin hacer

- `--patron-color` de `.sup-noche` suma luz (papel al 4%): pasa AA por poco y
  cualquier retoque al patrón lo tira abajo.
- El `background-color` de fallback del botón de buscar es el gris del navegador,
  no un color de marca: sólo se ve si el gradiente no pinta.
- Las 35 declaraciones de `background: var(--color-blanco)` siguen ahí; se migran
  a `--superficie-1` módulo por módulo.
- `PasosBreves` y el resto de lo que los revisores dejaron en «nuevos».
