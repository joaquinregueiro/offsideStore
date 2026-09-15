# Barrido de modo oscuro — 2026-09-15

> Documentación de IMPLEMENTACIÓN (CLAUDE.md §13). Describe cómo quedó el
> código. No reemplaza a `docs/` ni puede contradecirla.

Se midió el contraste de **lo que se pinta** en las **54 rutas** del sitio, con
la app corriendo contra PostgreSQL y Redis reales y el seed cargado, en
`prefers-color-scheme: dark` y en `light`.

**Resultado: 75 hallazgos bajo AA en oscuro → 0. En claro, 0 antes y después.**

---

## 1. Una sola causa raíz

**El sistema visual resuelve el contraste por SUPERFICIE, y eso no cubre el
TEMA.**

`.sup-noche`, `.sup-cancha` y compañía declaran sus propios tokens de texto, y
funcionan. Pero **la mayoría del texto del sitio no vive dentro de ninguna
superficie**: se apoya directo en la página o en una ficha, y ahí el token cae
en su valor de respaldo — que está elegido para papel. En modo claro es
correcto; en oscuro es texto oscuro sobre fondo oscuro.

Los seis defectos son el mismo defecto seis veces:

| token                         | daba       | dónde se veía                                      |
| ----------------------------- | ---------- | -------------------------------------------------- |
| `--campo-texto`               | **1.25:1** | **todo `<input>` y `<textarea>` del sitio**        |
| `--alerta-texto` en cancha    | **1.08:1** | "Esperando pago" en la ficha de una orden          |
| `--boton-fantasma-texto`      | **2.44:1** | **61 botones** (Editar, Fotos, Pausar, Quitar…)    |
| `--boton-fantasma-texto`      | 3.34:1     | los mismos, apoyados en la página                  |
| `--alerta-texto` en su lavado | 3.95:1     | "Última unidad" en la vitrina                      |
| `--color-sobre-oscuro-tenue`  | 4.42:1     | fechas y metadatos en una `.sup-2` dentro de ficha |

Es la misma familia que el `--degradado-titular` de ayer (1.10:1). Siete en
total, todos invisibles para el build, el typecheck, el lint y `chequeo-css`:
**la variable existe y resuelve**; lo que está mal es el color que trae.

## 2. Qué se cambió

En los **dos** bloques del modo oscuro de `tokens.css` (el `@media` y el
`[data-tema='oscuro']`; `chequeo-tema.mjs` obliga a que no se separen):

```
--campo-texto:                 var(--color-sobre-oscuro)        papel      12.59:1
--boton-fantasma-texto:        var(--verde-400)                            5.49 / 7.51
--boton-fantasma-texto-activo: var(--color-cambio)                        11.18:1
--alerta-sobre-cancha:         var(--color-papel)                          4.79:1
--color-alerta / --alerta-texto: var(--naranja-claro)                      4.78:1
```

Y dos valores de la fundación:

- **`--naranja-claro: #ffab5e`** — token nuevo. ⚠️ **No reemplaza a
  `--color-naranja`**: el naranja de marca sigue intacto para rellenos y bordes.
  Este es su versión legible cuando el naranja tiene que ser _información_ sobre
  oscuro. Existe porque la tabla de contrastes de `tokens.css` mide el naranja
  contra los planos **pelados** (7.96 / 7.26 / 5.82), y una etiqueta de alerta no
  se apoya en el plano: se apoya en **su propio lavado al 16%**, que aclara el
  fondo y le come el contraste.
- **`--color-sobre-oscuro-tenue: #8fa79a → #95ada0`** — daba 4.42 sobre la
  superficie oscura más clara que existe (`--superficie-2` sobre
  `--superficie-1` = `#214034`, una tarjeta `.sup-2` dentro de una ficha: un
  anidado legítimo). Aclararlo sólo puede subir contraste: ese token únicamente
  se usa como texto sobre oscuro.

⚠️ **Los tokens nuevos NO pisan a las superficies.** `.sup-noche` y `.sup-cancha`
declaran los mismos tokens y están **más cerca del elemento en el árbol**, así
que siguen ganando dentro de un pliego. Lo nuevo sólo cubre el hueco de afuera.

⚠️ **El hex de la portada pasó a ser indirecto.** `ui.module.css` fijaba
`--alerta-texto: #ad4e00` dentro de `.sup-cancha`, elegido contra el lavado
naranja **claro** y contra `--superficie-1`, que "en `.sup-cancha` sigue siendo
blanco" — cierto en modo claro y **falso en oscuro**, donde las dos cosas
cambian. Ahora es `var(--alerta-sobre-cancha, #ad4e00)`: el respaldo mantiene el
modo claro exactamente igual y el tema da vuelta el token.

## 3. `scripts/chequeo-contraste.mjs`, enganchado a `verify`

Estático, sin navegador, en la familia de `chequeo-css` / `chequeo-tema` /
`chequeo-inline`. Resuelve los tokens de `tokens.css` —cadenas de `var()`,
`rgb(r g b / a)`, composición source-over— y verifica **33 pares** en los dos
temas.

⚠️ **Cada fila del contrato es un defecto que ya ocurrió**, con su número
medido al lado. No es una lista de deseos.

⚠️ **Se validó al revés, que es la única forma de saber si sirve.** Se revirtió
cada token a su valor roto, uno por uno, y el chequeo falló en los seis casos
reproduciendo **el número exacto** que había medido el navegador: 1.25, 2.44,
3.34, 1.10, 3.95, 4.42 y 1.08. Dos métodos independientes —cascada estática y
píxeles pintados— dando lo mismo.

⚠️ **Dice lo que NO pudo medir.** `--marca-texto` no está declarado en `:root`
(en modo claro vive como respaldo dentro del `var(--token, respaldo)` de cada
módulo, que es CSS que el chequeo no lee), así que lo **omite y lo informa**. Un
chequeo que calla lo que no midió es peor que no tenerlo.

⚠️ **No reemplaza al barrido en navegador y no lo pretende.** Mide pares de
tokens, que es donde vivieron los siete defectos; lo que un módulo componga
encima —una malla, una foto, un vidrio— sólo se puede medir pintando.

**No se agregó Playwright como dependencia del proyecto** (CLAUDE.md §9): el
barrido es un banco de una sesión, no parte del build. Lo que queda en el repo
es el chequeo estático.

## 4. ⚠️ El medidor tuvo CUATRO bugs propios, y es lo más importante de esta sesión

La primera corrida dio **79 hallazgos**. Nueve eran inventados. Salieron a la luz
al contrastar el medidor contra los píxeles reales de la captura, antes de tocar
una línea del sitio:

1. **`sobre()` forzaba el alfa de salida a 1.** Dos capas translúcidas apiladas
   —`rgba(250 250 247 / 0.05)` sobre otra igual— se leían como **papel opaco**, y
   entonces un texto claro sobre fondo oscuro aparecía como claro sobre claro.
   Nueve falsos positivos.
2. **No parseaba `color(srgb r g b / a)`.** Chromium devuelve ese formato para el
   vidrio de la barra, y ahí los canales van de 0 a 1: leerlos como 0-255
   convierte un verde en casi negro.
3. **Ignoraba que un hijo hereda `color: transparent`** de un padre con
   `background-clip: text`. El "6%" de `/como-funciona` se reportó como
   invisible (1.00:1) cuando en pantalla se lee perfecto.
4. **`backgroundClip` devuelve `border-box`** y el `text` está en
   `webkitBackgroundClip`; y con dos capas de fondo el valor es `'text, text'`,
   así que ni `||` encadenado ni `=== 'text'` lo reconocen. (Y la regex que lo
   iba a resolver estaba dentro de un _template literal_, donde `\b` se convierte
   en un **backspace**: nunca matcheó nada.)

La conclusión no es "el medidor era malo": es que **medir contraste de verdad es
más difícil de lo que parece**, y que un número sin una segunda fuente que lo
confirme no vale. Cada hallazgo de este documento está confirmado por las dos
vías: el estilo computado en el navegador y el histograma de píxeles de la
captura.

## 5. Verificación

- **54 rutas** (público, comprador, vendedor, admin), en `dark` y en `light`:
  **0 pares bajo AA, 0 casos sin medir**.
- Las capturas de las rutas tocadas se miraron con los ojos: los campos de
  formulario, los botones fantasma y las dos etiquetas de alerta se leen.
- `npm run verify` completo —`format`, `check:css`, `check:inline`,
  `check:tema`, **`check:contraste`**, `lint`, `typecheck`— y **974 tests** en
  verde.

⚠️ **Lo que este barrido NO cubre**: los estados que no se pintan solos —`:hover`,
`:focus-visible`, `:disabled`, un formulario con error— y las View Transitions
entre pantallas. `--boton-fantasma-texto-activo` se corrigió porque el respaldo
era un verde **aún más oscuro** que el de reposo (el foco era menos legible que
el reposo, justo cuando alguien está tabulando), pero eso salió de leer el CSS,
no de medirlo pintado.
