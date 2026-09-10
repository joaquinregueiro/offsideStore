/**
 * Invariantes del CSS del proyecto.
 *
 * Existe porque las tres cosas que chequea fallan EN SILENCIO: no rompen el
 * build, no tiran un warning y no las ve el lint. Se ven en produccion, o no se
 * ven nunca.
 *
 *   1. `var(--x)` sin fallback y sin definicion. Una variable que no existe no
 *      es un error: la propiedad entera se descarta y el elemento se pinta con
 *      lo que hubiera heredado. Un fondo que no aparece, una sombra que no
 *      esta.
 *   2. Un `@keyframes` usado desde un archivo GLOBAL que no esta definido en un
 *      global. La animacion no corre y el elemento se queda en su estado
 *      inicial — que en este sistema suele ser `opacity: 0`.
 *   3. El mismo nombre de `@keyframes` declarado en un global Y en un
 *      `*.module.css`. En un CSS Module los nombres son LOCALES: el modulo
 *      resuelve a la suya y la global queda muerta. Es la trampa mas cara de
 *      las tres porque el codigo se lee bien.
 *   4. Un `estilos.X` que el `*.module.css` importado no define. TypeScript NO
 *      lo ve —los tipos de un CSS Module son un diccionario abierto—, asi que
 *      `className={estilos.noExiste}` compila, pasa el lint y llega a
 *      produccion como un elemento SIN ESTILO. Es lo que pasa cuando se
 *      reescribe una hoja y queda una pantalla vieja usandola.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SRC = new URL('../apps/web/src/', import.meta.url).pathname;
const GLOBALES = new Set(['app/tokens.css', 'app/movimiento.css']);

/** `next/font` las inyecta en el `<html>` en tiempo de ejecucion: no viven en ningun .css. */
const EXTERNAS = new Set(['--font-titulo', '--font-texto']);

/** Palabras clave de la propiedad `animation`, que no son nombres de keyframes. */
const PALABRAS = new Set([
  'none',
  'both',
  'forwards',
  'backwards',
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
  'infinite',
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'running',
  'paused',
  'auto',
  'initial',
  'inherit',
  'unset',
  'revert',
  'step-start',
  'step-end',
  'view',
  'scroll',
  'var',
  'calc',
  'cubic-bezier',
  'steps',
  'entry',
  'exit',
  'cover',
  'contain',
]);

function archivosPor(dir, extensiones) {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosPor(ruta, extensiones);
    return extensiones.some((e) => ruta.endsWith(e)) ? [ruta] : [];
  });
}

const archivosCss = (dir) => archivosPor(dir, ['.css']);

const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * ⚠️ HAY QUE SACAR LOS COMENTARIOS DEL TSX TAMBIEN, y no es una comodidad: este
 * proyecto documenta los tipos de los CSS Modules EN PROSA —"`estilos.loQueSea`
 * es `string | undefined`"— asi que un chequeo ingenuo denuncia justo los
 * comentarios que explican por que el chequeo hace falta.
 *
 * El `//` solo cuenta como comentario si no viene pegado a `:`, para no comerse
 * la mitad de una URL adentro de un string.
 */
const sinComentariosJs = (codigo) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const definidas = new Set();
const usadas = new Map();
const kfGlobales = new Map();
const kfModulos = new Map();
const kfUsados = new Map();

const anota = (mapa, clave, archivo) => {
  const previos = mapa.get(clave) ?? new Set();
  previos.add(archivo);
  mapa.set(clave, previos);
};

const archivos = archivosCss(SRC).sort();
for (const ruta of archivos) {
  const rel = relative(SRC, ruta);
  const css = sinComentarios(readFileSync(ruta, 'utf8'));
  const esGlobal = GLOBALES.has(rel);

  for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) definidas.add(m[1]);
  // Solo `var(--x)` PELADA: con fallback, que no exista es una decision valida.
  for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) anota(usadas, m[1], rel);
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) {
    anota(esGlobal ? kfGlobales : kfModulos, m[1], rel);
  }
  if (!esGlobal) continue;
  for (const m of css.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
    for (const bruto of m[1].split(/[,\s]+/)) {
      const tok = bruto.trim();
      if (/^[a-zA-Z][\w-]*$/.test(tok) && !PALABRAS.has(tok)) anota(kfUsados, tok, rel);
    }
  }
}

const lista = (conjunto) => [...conjunto].sort().join(', ');
let fallos = 0;

const faltan = [...usadas].filter(([v]) => !definidas.has(v) && !EXTERNAS.has(v));
if (faltan.length > 0) {
  fallos += faltan.length;
  console.error(`\n${faltan.length} var() sin definicion ni fallback:`);
  for (const [v, donde] of faltan.sort()) console.error(`  ${v} — usada en ${lista(donde)}`);
}

const huerfanos = [...kfUsados].filter(([k]) => !kfGlobales.has(k));
if (huerfanos.length > 0) {
  fallos += huerfanos.length;
  console.error(`\n${huerfanos.length} @keyframes usados desde un global y no definidos ahi:`);
  for (const [k, donde] of huerfanos.sort()) console.error(`  ${k} — en ${lista(donde)}`);
}

const pisados = [...kfModulos].filter(([k]) => kfGlobales.has(k));
if (pisados.length > 0) {
  fallos += pisados.length;
  console.error(`\n${pisados.length} @keyframes declarados a la vez en un global y en un modulo:`);
  for (const [k, donde] of pisados.sort()) {
    console.error(`  ${k} — global: ${lista(kfGlobales.get(k) ?? [])} · modulo: ${lista(donde)}`);
  }
}

/**
 * `estilos.X` contra las clases que el modulo importado declara de verdad.
 *
 * ⚠️ SE MIRA EL IMPORT, NO EL NOMBRE DE LA VARIABLE. Hay pantallas que importan
 * la hoja de OTRA carpeta (`../../vendedor.module.css`), asi que resolver por
 * convencion de nombres daria falsos negativos justo donde mas importa.
 */
const fuentes = archivosPor(SRC, ['.tsx', '.ts']).sort();
const clasesDe = new Map();
for (const ruta of archivos) {
  const css = sinComentarios(readFileSync(ruta, 'utf8'));
  const clases = new Set();
  for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) clases.add(m[1]);
  clasesDe.set(ruta, clases);
}

const rotas = [];
for (const ruta of fuentes) {
  const codigo = sinComentariosJs(readFileSync(ruta, 'utf8'));
  for (const imp of codigo.matchAll(/import\s+(\w+)\s+from\s+'([^']+\.module\.css)'/g)) {
    const [, alias, especificador] = imp;
    const hoja = resolve(dirname(ruta), especificador);
    const clases = clasesDe.get(hoja);
    if (clases === undefined) continue;
    for (const uso of codigo.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z_]\\w*)`, 'g'))) {
      if (!clases.has(uso[1])) {
        rotas.push(
          `${relative(SRC, ruta)} usa ${alias}.${uso[1]}, que ${relative(SRC, hoja)} no define`,
        );
      }
    }
  }
}

if (rotas.length > 0) {
  fallos += rotas.length;
  console.error(`\n${rotas.length} referencias a clases que el modulo no define:`);
  for (const r of [...new Set(rotas)].sort()) console.error(`  ${r}`);
}

if (fallos > 0) {
  console.error(`\n${fallos} problemas de CSS.\n`);
  process.exit(1);
}

console.log(
  `css ok — ${archivos.length} hojas, ${definidas.size} variables definidas, ` +
    `${usadas.size} referenciadas, ${kfGlobales.size} keyframes globales, ` +
    `${fuentes.length} fuentes con sus clases verificadas`,
);
