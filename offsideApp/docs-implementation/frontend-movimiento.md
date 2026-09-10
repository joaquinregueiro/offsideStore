# Sistema de movimiento

> Documentación de **implementación** (CLAUDE.md §13). Fecha: 2026-09-10.
> Archivos: `apps/web/src/app/movimiento.css`, `apps/web/src/components/movimiento.tsx`,
> y los tokens de duración y curva en `apps/web/src/app/tokens.css`.

---

## 0. La regla que gobierna todo lo demás

**La marca es angulosa y editorial, así que el movimiento es direccional y
seco.** Nada rebota, nada tiene resorte, nada oscila. Un rebote elástico le
queda bien a una app de juegos; acá le sacaría seriedad a una pantalla donde
alguien está por transferirle plata a un desconocido.

Y la segunda regla, que es la que más se nota cuando falta:

### Lo que NO se anima

| Qué                        | Por qué                                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **El precio y el total**   | Un número que se mueve se lee como un número que todavía no está decidido. El importe de una compra tiene que aparecer quieto.                       |
| **Los avisos de error**    | Ya interrumpen con `role="alert"`. Sumarles movimiento los vuelve un susto.                                                                          |
| **El estado de una orden** | "Pagada" no es una celebración: es un hecho.                                                                                                         |
| **La consola de pagos**    | Es una herramienta de operaciones. Cada milisegundo de animación ahí es un milisegundo esperando para leer un dato.                                  |
| **El conteo de una cifra** | Un número que sube desde cero es un efecto de dashboard. En un panel donde ese número son ventas reales, tarda más en poder leerse y no aporta nada. |

Cada excepción futura se escribe **en esta tabla**, no en el módulo donde se
implementa.

---

## 1. Duraciones y curvas

No es una escala de números lindos: cada valor tiene un rol.

| Token                 | Valor | Rol                                                                                                                  |
| --------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `--transicion-rapida` | 120ms | Feedback directo: color, borde, foco. Tiene que sentirse instantáneo.                                                |
| `--transicion`        | 180ms | Movimiento corto: una tarjeta que se levanta, un chip que aparece.                                                   |
| `--transicion-lenta`  | 420ms | **Recorrido**: algo que cruza el espacio. Abajo de ~350ms se lee como un parpadeo; arriba de ~500ms se siente lento. |

| Curva               | Rol                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `--curva-entrada`   | Arranca rápido y frena. Lo que **aparece** llega y se acomoda.                            |
| `--curva-salida`    | Arranca lento y acelera. Lo que **se va** se retira sin pedir atención.                   |
| `--curva-recorrido` | Frena fuerte al final. Para lo que se **desplaza** y tiene que dejar claro dónde terminó. |

---

## 2. Entradas: dos mecanismos, dos momentos

### `.entra` — al primer pintado

```css
.entra {
  animation: surgir var(--transicion-lenta) var(--curva-entrada) both;
}
```

⚠️ **Es una animación, no una transición con `@starting-style`.** Las dos
funcionan, pero una animación con `both` termina **siempre** en el estado final
aunque el navegador la interrumpa; una transición que no llega a dispararse deja
el elemento en el estado inicial. Con contenido servido desde el servidor, esa
es la diferencia entre "no se animó" y "no se ve".

### `.revela` / `.revela-grilla` — al entrar en pantalla

```css
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    .revela-grilla > * {
      animation: surgir-corto auto linear both;
      animation-timeline: view();
      animation-range: entry 0% cover 18%;
    }
  }
}
```

Animación dirigida por scroll, en CSS puro: **sin IntersectionObserver, sin
listener, sin hidratación**. Es el tipo de cosa que este proyecto viene
resolviendo con HTML y CSS en vez de con un bundle.

⚠️ **Las dos guardas son obligatorias y por motivos distintos:**

- **`@supports`** — sin soporte (Firefox al día de hoy) la regla no aplica y el
  contenido se ve normal. Afuera de la guarda, el `opacity: 0` del keyframe se
  quedaría puesto **para siempre**.
- **`@media`** — `prefers-reduced-motion` **no puede** apagar esto bajándole la
  duración, porque el progreso lo da el scroll y no el reloj. Sin la guarda,
  quien pidió menos movimiento se queda mirando contenido invisible.

⚠️ **El escalonado sale de la geometría, no de un contador.** Cada ficha de una
grilla tiene su propio rango de scroll, así que se revelan en el orden en que
entran a la pantalla. No hay un `animation-delay` escrito por ítem.

⚠️ **No poner `.revela` dentro de un elemento `position: sticky`**: el timeline
mide mal y el contenido puede quedar invisible.

---

## 3. Transiciones entre pantallas

React 19 + Next 16, **sin configuración**: `import { ViewTransition } from 'react'`.
Next resuelve `react` a su canary vendorizado, que la exporta; los tipos salen
de `"types": ["node", "react/canary"]` en `apps/web/tsconfig.json`.

⚠️ **Sin soporte del navegador no pasa nada malo**: la navegación funciona igual
y no se anima. Es una API aditiva.

`components/movimiento.tsx` expone cuatro envoltorios:

| Componente                           | Qué hace                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Pantalla`                           | Entrada y salida con dirección. **Va en el `page.tsx`, nunca en el `layout.tsx`**: un layout persiste entre navegaciones de su grupo, así que ahí el enter y el exit no se disparan nunca. |
| `FotoCompartida`                     | Identidad compartida de la foto de una publicación entre la grilla y la ficha.                                                                                                             |
| `LlegaContenido` / `SeVaElEsqueleto` | El relevo esqueleto → contenido.                                                                                                                                                           |

### El morph de la foto

Es la transición que más comunica de todo el sitio: **la misma camiseta que se
tocó en la vitrina se agranda hasta ocupar la ficha**, en vez de desaparecer y
ser reemplazada por otra imagen.

⚠️ **Sólo la portada comparte identidad.** Es la única que tiene par del otro
lado; nombrarlas todas haría que se animen entre sí en cualquier transición de
la página.

⚠️ **Sin foto no se comparte nada.** El patrón de rombos es un marcador, no la
prenda: verlo viajar de una pantalla a otra sería mentir sobre qué es.

⚠️ **`default="none"` no es opcional** — y con él hay que dejar el `share`
explícito, o el par deja de hacer morph en silencio.

### La dirección

`<Link transitionTypes={['avanza']}>` marca entrar a un detalle;
`['retrocede']`, volver. **No es automático a propósito**: el framework no puede
saber qué es "adentro" en la jerarquía de este sitio.

El corrimiento es de **60px**: alcanza para leer la dirección sin obligar a
seguir un objeto que cruza el viewport.

### El ancla

La barra superior y el pie declaran `viewTransitionName` y `movimiento.css` les
apaga la animación. **Son el ancla espacial**: si la barra también se desliza, no
queda ningún punto fijo y la sensación no es "cambió el contenido" sino "se fue
todo".

---

## 4. `prefers-reduced-motion`

Dos capas, porque una sola no alcanza:

1. La regla global de `tokens.css` aplasta `animation-duration` y
   `transition-duration` con el selector `*`.
2. ⚠️ **Ese selector no alcanza a los pseudo-elementos del árbol de
   transición.** `movimiento.css` apaga a mano
   `::view-transition-group/old/new/image-pair`: sin eso, quien pidió menos
   movimiento igual vería la página deslizarse.

**Lo que sobrevive sin movimiento:** el girador de un botón queda como un anillo
incompleto —sigue comunicando "esto está trabajando"—, y el desplazamiento de
una tarjeta al pasar por encima aparece sin animar, así que el estado sigue
siendo visible.

---

## 5. Verificado en el navegador

El CSS se comprobó contra un banco de pruebas armado con los `*.module.css`
reales, a 1280, 760 y 375px. Lo que encontró:

- **La grilla de cifras dejaba un bloque gris muerto** cuando la última fila no
  se completaba (el truco de `gap: 1px` sobre un contenedor con fondo). Se pasó
  a recuadros sueltos.
- ⚠️ **Una regresión de la sesión anterior**: `body { display: flex }` para
  pegar el pie abajo, combinado con el `margin: 0 auto` que llevan casi todos
  los `<main>`, hacía que **el margen automático cancelara el `stretch`** y el
  `<main>` se encogiera al ancho de su contenido. Con un viewport de 760px, un
  `<main>` que declara `max-width: 760px` medía **394**. Se arregló con
  `width: 100%` en `body > main`.
- Cero desborde horizontal a 375px y a 320px; cero elementos atrapados en
  `opacity: 0`.
