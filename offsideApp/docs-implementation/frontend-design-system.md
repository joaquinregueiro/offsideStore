# Sistema visual y de componentes del frontend

> Documentación de **implementación** (CLAUDE.md §13). Describe cómo está
> construido el código; **no reemplaza a `docs/` ni la contradice**.
> Fecha: 2026-09-09. Alcance: `offsideApp/apps/web/src/`.

---

## 0. Qué es esto y qué NO es

Este documento registra el trabajo de **fundaciones visuales, navegación y
pantallas públicas** hecho el 2026-09-09, y sirve como referencia del sistema de
componentes para quien siga.

**No es una decisión de diseño.** La fuente de verdad del sistema visual es
`design/` (solo lectura, CLAUDE.md §3) y su transcripción operativa es
`apps/web/src/app/tokens.css`. Todo lo de acá o transcribe eso, o resuelve un
problema de accesibilidad que la identidad no cubre —y cuando es lo segundo,
está dicho explícitamente en el comentario del código.

⚠️ **Hay un bloqueo documental abierto sobre la identidad.** Ver §9.

**Verificación:** `format:check`, `eslint` y `typecheck` en verde; **281 tests
unitarios pasando**. Los **257 de integración no se corrieron**: necesitan
PostgreSQL y Redis, y en la máquina donde se hizo este trabajo no hay Docker.
El CSS se verificó en un navegador real contra un banco de pruebas armado con
los `*.module.css` del proyecto (§8).

---

## 1. Tokens (`app/tokens.css`)

### 1.1 Contraste — tres correcciones que arreglan texto ilegible

Los tres valores de abajo se midieron con la fórmula de luminancia relativa de
WCAG 2.1. Los neutros **no vienen de la identidad** —el archivo los llama
"neutros derivados"—, así que ajustarlos no contradice el sistema visual.

| Token                  | Antes                       | Ratio      | Ahora                            | Ratio      | Dónde se veía                                                                                                            |
| ---------------------- | --------------------------- | ---------- | -------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `--color-neutro-tenue` | `#8a9186`                   | **3.10:1** | `#6b736a`                        | **4.69:1** | Los 8 usos son texto de 12–13px: ayudas de formulario, notas al pie, nombre del vendedor en la ficha, conteos de facetas |
| _(texto de alerta)_    | `--color-naranja` `#ff902d` | **2.16:1** | `--color-alerta` `#b85400`       | **4.66:1** | "Última unidad", "Cancelada", "Sin conectar", botón destructivo                                                          |
| _(bajada de portada)_  | `--color-neutro-borde`      | **4.29:1** | `--color-sobre-cancha` `#e4f0e6` | **4.60:1** | Bajada de 18px sobre Verde Cancha                                                                                        |

⚠️ **`--color-naranja` NO se tocó.** Sigue siendo el hex de la identidad y sigue
usándose para **bordes y rellenos**, donde el color es forma. La regla nueva es:
_naranja para forma, `--color-alerta` para texto_. Un color de marca no se
corrige por contraste; se corrige el uso.

⚠️ `--color-neutro-apagado` (`#9aa396`, 2.49:1 sobre papel) **estaba definido y
no se usaba en ningún lado**. Ahora tiene un rol declarado —separadores, trazos
decorativos, el icono gris de un estado vacío— y está prohibido para texto sobre
papel. Sobre Tinta sí sirve (6.3:1) y ahí lo usa el pie.

### 1.2 Foco visible sobre superficies oscuras

El anillo de foco global era `--color-cancha` fijo. La barra superior **es de
ese mismo verde**: quien navega con teclado perdía el foco justo al entrar al
sitio, en las 21 pantallas.

Ahora el color es la variable `--color-foco`, con el verde por defecto, y cada
superficie oscura la redefine para sí misma: la barra y el pie usan Amarillo
Cambio (4.59:1 sobre verde).

### 1.3 Tokens nuevos

- **Elevación** — `--sombra-1`, `--sombra-2`. Teñidas con Tinta y **cortas**: una
  sombra negra difusa sobre papel cálido se ve gris sucia y empuja el sistema
  hacia lo redondeado, que es lo contrario de esta marca.
- **Movimiento** — `--transicion-rapida` (120ms), `--transicion` (180ms),
  `--curva`. Antes `120ms ease` estaba escrito a mano en tres módulos.
- **Capas** — `--z-barra`, `--z-menu`, `--z-superpuesto`, numerados con huecos.
- **Controles** — `--alto-control` (44px, WCAG 2.5.5) y `--alto-control-chico`.
- **Anchos** — `--ancho-medio` (860), `--ancho-angosto` (760),
  `--ancho-formulario` (420). Estaban escritos a mano **siete veces**.
- **Patrón** — `--patron-rombos` + `--patron-color`. El rombo de la bandera
  (identidad §05) estaba copiado con sus cuatro gradientes en dos módulos.
- **Breakpoints** — documentados como comentario. ⚠️ No pueden ser variables
  CSS: `@media (max-width: var(--x))` no funciona en ningún navegador.

### 1.4 Reglas base nuevas

- `body` en columna flex con `min-height: 100dvh` y `body > main { flex: 1 0 auto }`
  → **el pie queda pegado abajo**. Sin esto, en un login o un estado vacío el pie
  flotaba a media pantalla.
- `img, svg, video { max-width: 100% }` → ninguna foto desborda su contenedor.
- `text-wrap: balance` en `h1..h4` → con interlineado 0.95 y mayúsculas, una
  palabra viuda se nota muchísimo.
- `.solo-lectores` → utilidad global de "oculto a la vista, presente para
  lectores de pantalla". Es la única clase global de utilidad del sistema y
  existe porque la necesitan el enlace de saltar al contenido, las etiquetas de
  botones sólo-icono y las descripciones de las pastillas de filtro.

---

## 2. Primitivas (`components/ui.tsx` + `ui.module.css`)

### 2.1 `Boton` / `BotonEnlace`

|                 | Antes                    | Ahora                                                |
| --------------- | ------------------------ | ---------------------------------------------------- |
| Variantes       | `primario`, `secundario` | + `fantasma`, `peligro`                              |
| Tamaños         | uno solo                 | `chico` (36px), `medio` (44px), `grande` (52px)      |
| Estado apretado | no existía               | `translateY(1px)` en `:active`                       |
| Carga           | `disabled` a secas       | `cargando` → girador + `aria-busy`                   |
| Icono           | no                       | prop `icono`                                         |
| Navegación      | `<a href>`               | `next/link` para rutas internas, `<a>` para externas |

⚠️ **`peligro` es de contorno en reposo y se rellena al pasar por encima.** Un
botón macizo de alerta compite con el primario y además presiona: una acción
destructiva tiene que estar disponible, no invitar.

⚠️ **Los colores del botón salen de variables con valor por defecto.** No es
abstracción gratuita: **sobre la portada, que es Verde Cancha, el botón primario
—también Verde Cancha— era invisible**, y el secundario, blanco macizo, gritaba
más que él; la jerarquía quedaba dada vuelta. En vez de agregar dos variantes
"claras", la portada redefine `--boton-primario-fondo` y compañía para sí misma.
Es el mismo mecanismo de `--color-foco`. **Verificado en el navegador.**

⚠️ **`BotonEnlace` NO acepta `...props` de `<a>`.** Reenviar todos los atributos
obliga a que `Link` los acepte con `undefined` incluido, y con
`exactOptionalPropertyTypes` —que este repo tiene encendido— eso no compila. La
superficie chica además evita que a un enlace interno le pasen `target="_blank"`.

### 2.2 `Etiqueta` y `Aviso` — de booleano a tono semántico

`Etiqueta` pasó de `aviso?: boolean` a `tono: 'neutro' | 'marca' | 'alerta' |
'exito'`, y `Aviso` de `error?: boolean` a `tono: 'neutro' | 'error' | 'exito'`.
**Los 24 puntos de uso están migrados.**

- `neutro` — dato del producto: talle, condición, tipo de camiseta.
- `marca` — algo que Offside afirma: publicación activa, cuenta habilitada.
- `alerta` — algo en riesgo o por terminarse: última unidad, pausada, cancelada.
- `exito` — algo que se completó: pagada, entregada.

⚠️ **El color nunca va solo**: las cuatro variantes cambian también borde y
fondo, y el texto de la etiqueta ya dice el estado. `exito` se distingue de
`marca` **por el relleno**, no por el tono de verde: sin eso serían la misma
etiqueta con dos significados.

⚠️ **`Aviso` con `tono="exito"` usa `role="status"`, no `role="alert"`.**
`alert` interrumpe lo que el lector de pantalla esté diciendo: para un error es
exactamente lo que hace falta, para una confirmación es una grosería.

### 2.3 Primitivas nuevas

- **`Contenedor`** — `max-width` + `margin: 0 auto` + padding, con cuatro anchos.
  Ese bloque estaba copiado en seis módulos, cada uno con su ancho a mano.
- **`Tarjeta`** — la superficie con borde que cada módulo redefinía.
- **`FilaDeAcciones`** — dentro de un estado vacío (columna centrada), dos
  botones apilados se leen como dos pasos de un proceso, no como alternativas.
- **`Esqueleto`** — bloque de carga con brillo. Un gris quieto se lee como un
  hueco del diseño; el brillo es lo que dice "cargando".
- **`EstadoVacio`** ahora acepta `icono` y `como={'h1'|'h2'|'p'}` (§4.3).

### 2.4 `components/iconos.tsx` — nuevo

Los **seis iconos del §04 de la identidad** (balón, camiseta, etiqueta,
intercambio, favorito, autenticado) más cinco de interfaz (menú, cerrar, buscar,
flecha, filtro), como SVG inline con trazo de 1.5px y sin relleno, que es la
regla que la lámina fija.

⚠️ **No se usan los PNG de `design/assets/icons/`.** Son láminas de
presentación: traen fondo, el nombre del icono debajo y el verde quemado en el
píxel. Un icono de interfaz tiene que heredar el color de su contexto —el mismo
icono va sobre papel y sobre la barra verde— y eso sólo lo da `currentColor`.

Hasta este cambio, **ninguno de los seis iconos de la identidad aparecía en
ninguna pantalla del sitio.**

### 2.5 `components/marca.tsx` — nuevo

- **El wordmark es texto, y eso es fiel a la identidad, no un atajo**: el §01
  dice "misma tipografía en todas las aplicaciones", o sea que el logotipo _es_
  Big Noodle Titling en mayúsculas, fuente que la app ya carga. Como texto se
  selecciona, lo lee un lector de pantalla y escala con el zoom.
- **El isotipo sí es una imagen**, y se extrajo del archivo real de identidad
  (`offside-isotipo-bandera.png`) recortando la bandera y volviendo transparente
  el fondo verde de la lámina. **No se redibujó a mano**: el damero en diagonal
  tiene una geometría precisa y una versión "parecida" sería otra marca.
- De ahí salen también `app/icon.png` y `app/apple-icon.png`: antes el sitio no
  tenía favicon.

🟡 Falta la versión vectorial del isotipo. Sale del archivo fuente de diseño,
que es solo lectura: **lo pide el owner**.

---

## 3. Navegación y chrome

### 3.1 Barra superior (`components/header.*`) — el arreglo más grande

**Antes no tenía ni una sola `@media`.** Marca (36px, no encoge) + buscador +
hasta cinco enlaces con `white-space: nowrap`, todo en un `flex` sin `wrap`: a
375px de ancho el ancho mínimo de la fila era de unos 560px sin sesión y 670px
con sesión de admin. **Entre 185 y 290px de desborde horizontal, en las 21
pantallas del sitio.** Sin `overflow-x` en ninguna parte, toda la página se
corría de costado.

Ahora, con el corte en **900px** que el propio registro de breakpoints ya
prescribía:

- El buscador pasa a su propia fila a lo ancho —en un marketplace es el control
  más usado; esconderlo dentro del menú sería enterrarlo—.
- Los enlaces se pliegan en un menú.

⚠️ **El menú NO usa JavaScript.** Es un `<details>`: el navegador ya sabe abrirlo
y cerrarlo, responde a Enter y a Espacio, y expone el estado abierto/cerrado a
los lectores de pantalla sin una línea de `aria`. Un `useState` habría convertido
la barra en Client Component y mandado la sesión entera al bundle para
reimplementar peor algo que el HTML ya hace.

⚠️ **Los enlaces se renderizan dos veces** —una lista para escritorio y otra
dentro del menú— y es deliberado: un solo marcado obligaría a pelearle a la hoja
de estilos del navegador para mostrar el contenido de un `<details>` cerrado, y
eso se rompe distinto en cada navegador. El que no corresponde está en
`display: none`, así que tampoco llega al árbol de accesibilidad.

También: **enlace de saltar al contenido** (WCAG 2.4.1), botón de lupa con área
táctil de 44px, foco dibujado sobre el conjunto campo+botón, barra `sticky`, y
"Crear cuenta" destacado con marco —de los tres enlaces sin sesión es el único
que le sirve al sitio y a la persona a la vez—.

**Verificado en navegador a 375px y a 320px: cero desborde horizontal**
(`scrollWidth === innerWidth`), panel del menú a ancho completo, enlaces de 44px.

### 3.2 Pie (`components/footer.*`) — nuevo

**No existía en ninguna pantalla**: `grep '<footer'` daba cero. El documento
terminaba donde terminaba el contenido.

Lleva la cinta de sección del §05 de la identidad —la tercera escala del patrón,
que hasta ahora no se usaba—, el logo invertido, tres columnas de enlaces y una
línea legal.

⚠️ **No hay un solo enlace a una pantalla que no exista.** Es la tentación obvia
de un pie: llenarlo de "Ayuda", "Sobre nosotros", "Cómo funciona". Cada uno sería
un 404 con aspecto de promesa.

⚠️ **Faltan Términos y Política de Privacidad, y no es un olvido**: ver §9,
BLOQUEO 2.

### 3.3 Metadatos (`app/layout.tsx`, `app/p/[id]/page.tsx`)

- **`metadataBase`** — sin él, Next arma las URLs de Open Graph relativas y
  ningún mensajero las resuelve. **La ficha de una camiseta compartida por
  WhatsApp llegaba como un enlace pelado**, sin título, sin bajada y sin foto.
- **`title.template`** — cada pantalla pone lo suyo y hereda `— Offside Store`.
  Se sacó ese sufijo de las 24 páginas que lo repetían a mano.
- **Open Graph en la ficha**, con **la portada real de la publicación** como
  imagen y el precio en la bajada (en el título lo cortaría cualquier
  previsualización).
- **`viewport` con `themeColor`** — pinta la barra del navegador en Android.
  ⚠️ Va aparte de `metadata` en esta versión de Next; declararlo adentro no hace
  nada y no avisa.
- `robots: { noarchive: true }` — que Google indexe la vitrina, pero que no
  guarde en caché una publicación ya vendida.

### 3.4 Estados de carga — `loading.tsx` × 5

**No existía ninguno.** Todas las pantallas son `force-dynamic`, así que hasta
que el servidor responde el navegador se queda en la página anterior sin ninguna
señal: la persona aprieta una camiseta, no pasa nada, y aprieta de nuevo.

Hay uno en la raíz (grilla de la vitrina) y uno por grupo de rutas. ⚠️ Los cuatro
de grupo existen **para no heredar el de la raíz**: sin ellos, alguien entrando a
"Ingresar" vería por un instante el esqueleto de una grilla de camisetas.

⚠️ Las medidas del esqueleto imitan al contenido real —misma relación 4/5 de la
foto, misma altura de título y precio—. Un esqueleto con proporciones inventadas
produce un salto al llegar el contenido, que es peor que no poner nada.

---

## 4. Pantallas

### 4.1 Vitrina (`app/page.tsx`)

- **Portada con dos llamadas a la acción.** Antes era un título y una bajada, sin
  una sola cosa para apretar: no le ofrecía nada ni a quien viene a mirar ni a
  quien viene a vender.
- **Patrón de la bandera en escala de bloque**, desvanecido con una máscara. Es
  la única superficie del sitio donde corresponde el patrón grande: en la grilla
  de productos convertiría la vitrina en un tablero de ajedrez.
- **Tira de "cómo funciona"** con tres iconos de la identidad. Es la única parte
  del sitio que explica cómo funciona Offside sin tener que registrarse.
  ⚠️ **Ninguna de las tres dice un número.** La comisión es ⚙️ CONFIGURABLE
  (CLAUDE.md §12): escribir "6%" en la portada la volvería a clavar en el código.
  ⚠️ **Tampoco dicen "vendedor verificado" ni nada que suene a sello de
  confianza** (BR-003 / SS-012): describen el requisito, que es comprobable, no
  una reputación que el sistema todavía no mide.
- **Encabezado de sección con conteo** y aviso honesto: el repositorio corta en
  60 y **no hay paginación**, así que al llegar al tope dice "más recientes" en
  vez de mentir un total.
- **Grilla que baja a `minmax(150px, 1fr)` en teléfono.** Con 220px fijos, una
  pantalla de 320px daba **una** columna: ver diez camisetas eran diez
  pantallazos.

### 4.2 Ficha de producto (`app/p/[id]/`)

- **Tres áreas de grilla y el orden lo decide el CSS.** En escritorio: fotos a la
  izquierda, encabezado y compra a la derecha. En teléfono: **encabezado → fotos
  → compra**. Antes eran dos columnas que en teléfono se apilaban fotos-primero:
  alguien podía recorrer **hasta ocho fotos a ancho completo sin haber visto
  todavía el nombre de la camiseta ni el precio**.
- **El bloque de compra acompaña el scroll en escritorio** (`sticky`). En
  teléfono no: ahí es lo último de la página y taparía contenido.
- **Migas de pan** en lugar de "← Volver al catálogo", que prometía deshacer un
  paso y mandaba a la home aunque la persona hubiera llegado desde una búsqueda.
  ⚠️ El separador es `::before`, no un "/" en el marcado: escrito en el HTML el
  lector de pantalla lo lee ("Catálogo barra Buscar barra…").
- **`aspect-ratio` en las fotos de la galería.** El `<img>` no lleva
  `width`/`height` —el Service no expone las dimensiones y la tabla no las
  guarda—, así que hasta que cargaba, el hueco medía cero: **con ocho fotos, ocho
  saltos de página**, y el botón de comprar moviéndose bajo el dedo. Se usa
  `object-fit: contain` y no `cover`: el comprador vino a mirar la etiqueta, el
  dorso y los defectos.
  🟡 El arreglo de fondo —guardar ancho y alto al procesar— toca el ERD.
- **"Home" y "Away" pasaron a "Titular" y "Suplente".** `kitType` se pasaba por
  `condicion()`, que sólo capitaliza el valor crudo del enum: en una pantalla
  enteramente en castellano aparecían dos palabras en inglés. Se agregó también
  el largo de manga, que estaba en los datos y no se mostraba.
- ⚠️ **NO se muestra `authenticity`**, aunque esté en los datos: ver §9, BLOQUEO 3.

### 4.3 Búsqueda (`app/buscar/`)

- **Pastillas de filtro activo con "Limpiar todo".** Es lo que más faltaba: con
  diez grupos de facetas y la barra plegada en el teléfono, la única señal de un
  filtro puesto era una opción en negrita perdida en una lista larga. **Alguien
  filtraba por talle S, no encontraba nada y concluía que Offside está vacío.**
- **Los filtros se pliegan en teléfono** (`<details>`, abierto por CSS en
  escritorio). A ≤900px la columna pasaba **arriba** de los resultados: diez
  grupos de facetas empujaban la primera camiseta fuera de la pantalla.
- **Cambiar el orden ya no borra los filtros.** El formulario de orden ahora
  arrastra los filtros activos como campos ocultos.
- **Los diez grupos son datos, no diez llamadas sueltas en el JSX**, y las claves
  de faceta están tipadas contra `SearchResponse['facetas']`: un typo no compila.
- Opciones de faceta con 36px de alto: eran unas 26 y en un teléfono dos opciones
  consecutivas quedaban a menos de un dedo de distancia.

### 4.4 Error y 404

Los dos usaban **estilos inline** (`style={{ maxWidth: 720, padding: '80px 24px' }}`)
y el botón "Reintentar" estaba dibujado a mano con ocho propiedades CSS copiadas
del botón secundario: sin foco visible, sin área táctil de 44px, sin estado
apretado. Ahora usan los componentes del sistema, el 404 tiene `metadata`
propia, y los dos tienen `h1` de verdad (§4.5).

⚠️ `error.tsx` **no lleva `Header` a propósito**: la barra lee la sesión en el
servidor y, si lo que falló fue justamente esa lectura, renderizarla ahí volvería
a fallar y el usuario vería el error del error.

### 4.5 Encabezados

`EstadoVacio` renderizaba un `<p>` con estilos de titular. En **cinco pantallas**
—`verificar-email` en sus tres ramas, `revisa-tu-email`, `restablecer-password`,
404 y error— ese estado vacío es _todo_ el contenido, así que esas pantallas **no
tenían ningún encabezado**: con lector de pantalla no había forma de saber en qué
página se estaba parado. Ahora acepta `como="h1"` y esas cinco lo usan.

⚠️ El default sigue siendo `<p>`: un estado vacío dentro de una pantalla que ya
tiene su `h1` no debe agregar otro, o el índice de encabezados se llena de
títulos falsos.

Además, las 28 páginas tienen ahora `<main id="contenido">`, que es el destino
del enlace de saltar al contenido.

---

## 5. Dos bugs que rompían funcionalidad

Aparecieron en la auditoría (§7) y se arreglaron porque son chicos y peligrosos.
**No son estética.**

### 5.1 Editar una publicación borraba los catálogos en silencio

`app/(vendedor)/acciones.ts`

El formulario de editar **no tiene** los selectores de club, selección, marca,
temporada ni competencia —sólo los tiene el de publicar—, así que esas cinco
claves llegaban siempre como `undefined`. La acción mandaba `clubId: input.clubId
?? null` y el repositorio hace `.set({ ...values })`, que escribe el `null`:
**corregir un typo en el título borraba el club, la marca y la temporada.**

El efecto no se veía en ningún lado. La camiseta desaparecía de todas las facetas
de `/buscar` y perdía el peso `A` de los alias —"CARP" o "Millonario" dejaban de
encontrarla (PS-024)—. Ni la pantalla lo avisaba ni quedaba registro: los
catálogos no se auditan.

**Arreglo:** `catalogoAEscribir()` pregunta por `formData.has(clave)`, no por el
valor. `texto()` colapsa la cadena vacía a `undefined`, así que con el valor solo
es imposible distinguir "el vendedor vació el campo" de "el campo no existía".
Con `has()`, el día que el formulario incorpore los selectores, vaciar uno va a
limpiarlo de verdad sin tocar esa función.

⚠️ **Falta el test.** Es integración (necesita base) y no se pudo correr acá.
⚠️ **Falta lo otro**: agregar los cinco selectores al formulario de editar.

### 5.2 Los Server Actions se tragaban `redirect()` y `notFound()`

Los cuatro `acciones.ts`

En Next, `redirect()` y `notFound()` funcionan **lanzando** una excepción de
control (`NEXT_REDIRECT`). Los guards de sesión se llaman **dentro** del `try` de
cada acción, así que ese `throw` caía en el `catch` y se convertía en _"Tuvimos
un problema. Probá de nuevo en un momento."_

El síntoma: se vence la sesión con el formulario de publicar abierto, la persona
aprieta Guardar y en vez de ir al login —conservando a dónde quería volver—
recibe un error genérico; reintenta y recibe el mismo error, **sin ninguna
salida**. Lo mismo al confirmar una compra y al emitir un reembolso.

**Arreglo:** `unstable_rethrow(error)` como primera línea de `mensajeDeError()`.
Los cuatro archivos comparten esa función, así que **cuatro ediciones cubren los
22 bloques `catch`**.

---

## 6. Duplicación eliminada

| Qué estaba duplicado                            | Dónde                                       | Ahora                                              |
| ----------------------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| Clase `.etiqueta` completa                      | `ui.module.css` y `listing-card.module.css` | La ficha usa el componente `Etiqueta`              |
| Patrón de rombos (4 gradientes)                 | `listing-card` y `p/[id]`                   | Token `--patron-rombos`                            |
| `max-width` + `margin: 0 auto` + padding        | 6 módulos, 7 anchos a mano                  | `Contenedor` + tokens de ancho                     |
| Mapas de `kitType` y `sleeve`                   | `buscar/page.tsx`, y faltaban en la ficha   | `tipoDeCamiseta()` y `manga()` en `lib/formato.ts` |
| Ternario `status === 'X' ? 'alerta' : 'neutro'` | 7 pantallas, con **criterios distintos**    | `tonoDeOrden/Publicacion/Vendedor()`               |
| `120ms ease`                                    | 3 módulos                                   | `--transicion-rapida` + `--curva`                  |
| `font-weight: 600`                              | 3 módulos                                   | `--peso-semi`                                      |

⚠️ El caso del ternario era el peor: `checkout` marcaba en alerta sólo
`CANCELLED`, `publicaciones` marcaba todo lo que no fuera `active`, y
`mis-compras` **no pasaba tono ninguno** —ahí "Pagada" y "Cancelada" eran el
mismo chip gris—. Un estado no puede verse distinto según en qué pantalla lo
mires.

---

## 7. Cambios de API de componentes (rompen llamadas)

Quien tenga trabajo en paralelo sobre estos archivos va a ver conflicto:

| Componente    | Antes                               | Ahora                                    |
| ------------- | ----------------------------------- | ---------------------------------------- |
| `Etiqueta`    | `aviso?: boolean`                   | `tono?: TonoEtiqueta`                    |
| `Aviso`       | `error?: boolean`                   | `tono?: TonoAviso`                       |
| `Formulario`  | botón fijo `primario/grande/bloque` | props `variante`, `tamanio`, `bloque`    |
| `Campo`       | lista de props cerrada              | extiende `InputHTMLAttributes`           |
| `BotonEnlace` | `...props` de `<a>`                 | superficie acotada + `etiquetaAccesible` |
| `EstadoVacio` | `titulo`, `children`                | + `icono`, `como`                        |

⚠️ `Formulario` tenía el botón clavado en `primario / grande / bloque`. **Veinte
de las veintidós acciones del sitio pasan por ahí**, incluidas Eliminar
publicación, Borrar foto y Emitir reembolso: las tres salían con el mismo verde
macizo que "Publicar", y en el inventario del vendedor "Pausar" y "Borrar" eran
barras de ancho completo y 52px de alto dentro de una fila de lista.

---

## 8. Cómo se verificó el CSS sin poder levantar la app

No hay Docker en la máquina, así que no hay PostgreSQL ni Redis y `npm run dev`
no llega a renderizar una pantalla con datos.

Se armó un **banco de pruebas**: un HTML que carga `tokens.css` y los diez
`*.module.css` reales, con los nombres de clase prefijados por módulo para emular
lo que hace CSS Modules, más las dos fuentes propias embebidas. Se sirvió por
HTTP y se miró en un navegador de verdad a **1280px, 375px y 320px**.

Lo que encontró y se corrigió ahí: **el botón primario invisible sobre la portada
verde** (§2.1). Lo que confirmó: cero desborde horizontal a 320px, panel de menú
correcto, áreas táctiles de 44px, las cuatro variantes de botón distinguibles,
los cuatro tonos de etiqueta distinguibles.

⚠️ **El banco NO reemplaza probar la app.** Verifica CSS, no el HTML que
realmente emiten los componentes ni el comportamiento del servidor. **Falta pasar
las pantallas por un navegador con la app corriendo.**

---

## 9. Bloqueos (formato CLAUDE.md §4)

Están detallados en `auditoria-frontend-2026-09-09.md` §5. En una línea cada uno:

1. **El archivo de identidad que el código cita como fuente de verdad no
   existe.** `tokens.css` apunta a `design/Offside Identidad.dc.html`; en el repo
   sólo está `Offside Identidad Visual.html`, que es la versión vieja (Big
   Shoulders Display y terracota `#C4562E`). **Regla operativa mientras tanto: se
   cambian USOS de tokens, nunca las definiciones de color de identidad.**
2. **Se hace aceptar términos y privacidad que no existen**, y el consentimiento
   se guarda. El andamiaje (rutas + pie + enlaces) se puede construir ya; el
   contenido es 🔴.
3. **Autenticidad declarada**: TS-032 exige comunicarla y no aparece en ninguna
   pantalla, pero DEC-025 sigue 🟡 y el enum incluye `SOSPECHOSA` y
   `FALSIFICACION`, que son moderación interna. **No se implementó nada.**
4. **La descripción es obligatoria en `product-specification.md` y opcional en
   BR-011.** No se cambió la validación.
5. **El total de la compra no menciona el envío** y quién lo paga es 🟡.
6. **El copy dice "camisetas" pero hay seis categorías** cargadas.
