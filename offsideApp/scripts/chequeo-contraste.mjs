/**
 * Fija los contrastes de la fundacion en LOS DOS TEMAS.
 *
 * ⚠️ POR QUE EXISTE. El sistema visual resuelve el contraste POR SUPERFICIE
 * —`.sup-noche`, `.sup-cancha`…— y eso no cubre el TEMA. Un texto apoyado
 * directo en la pagina, sin ninguna clase de superficie, se queda con el valor
 * pensado para el otro tema y nadie se entera: no falla el build, no lo ve el
 * typecheck, no lo ve `chequeo-css` —la variable existe y resuelve— y en
 * pantalla es un texto que casi no se lee.
 *
 * Ese agujero se cobro CINCO tokens el 2026-09-14/15, todos medidos con el
 * sitio corriendo en un navegador:
 *
 *     --degradado-titular              1.10:1  (todos los titulares del sitio)
 *     --campo-texto                    1.25:1  (todo input y textarea)
 *     --boton-fantasma-texto           2.44:1  (61 botones en 22 pantallas)
 *     --alerta-texto sobre cancha      1.08:1  ("Esperando pago" de una orden)
 *     --alerta-texto sobre su lavado   3.95:1  ("Última unidad" en la vitrina)
 *
 * ⚠️ ESTE CHEQUEO NO REEMPLAZA AL BARRIDO EN NAVEGADOR y no pretende hacerlo.
 * Mide PARES DE TOKENS de `tokens.css`, que es donde vivio cada uno de esos
 * cinco defectos; lo que un modulo componga encima —una malla, una foto, un
 * vidrio— solo se puede medir pintando. Lo que este archivo garantiza es que
 * ninguno de los pares de abajo vuelva a caer sin que falle `verify`.
 *
 * ⚠️ LOS MINIMOS SON DE WCAG 2.1 AA: 4.5:1 para texto normal y 3:1 para texto
 * grande (>=24px, que es lo que habilita `--display-*`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOKENS = fileURLToPath(new URL('../apps/web/src/app/tokens.css', import.meta.url));
const css = readFileSync(TOKENS, 'utf8');

/* --------------------------------------------------------------- color --- */

const lineal = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const luminancia = ({ r, g, b }) => 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);

const contraste = (a, b) => {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** Composicion source-over. El alfa de salida se CALCULA, nunca se fuerza. */
function sobre(frente, atras) {
  const a = frente.a + atras.a * (1 - frente.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mezcla = (f, d) => (f * frente.a + d * atras.a * (1 - frente.a)) / a;
  return {
    r: mezcla(frente.r, atras.r),
    g: mezcla(frente.g, atras.g),
    b: mezcla(frente.b, atras.b),
    a,
  };
}

/* --------------------------------------------------------------- parseo --- */

/**
 * Declaraciones de un bloque, contando llaves.
 *
 * ⚠️ NO SIRVE UN `[^{}]*`: el bloque del `@media` esta ANIDADO, igual que en
 * `chequeo-tema.mjs`.
 */
function cuerpoDesde(indice) {
  const abre = css.indexOf('{', indice);
  if (abre === -1) return '';
  let nivel = 0;
  for (let i = abre; i < css.length; i += 1) {
    if (css[i] === '{') nivel += 1;
    else if (css[i] === '}') {
      nivel -= 1;
      if (nivel === 0) return css.slice(abre + 1, i);
    }
  }
  return '';
}

function declaraciones(cuerpo) {
  const limpio = cuerpo.replace(/\/\*[\s\S]*?\*\//g, '');
  const mapa = new Map();
  for (const m of limpio.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    mapa.set(m[1], m[2].trim().replace(/\s+/g, ' '));
  }
  return mapa;
}

/** Todos los bloques cuyo selector coincide, fusionados en orden de aparicion. */
function bloques(regex) {
  const mapa = new Map();
  for (const m of css.matchAll(regex)) {
    for (const [k, v] of declaraciones(cuerpoDesde(m.index))) mapa.set(k, v);
  }
  return mapa;
}

const BASE = bloques(/^:root\s*\{/gm);
const OSCURO = bloques(/:root:not\(\[data-tema='claro'\]\)\s*\{/g);
const CANCHA = bloques(/^\.sup-cancha\s*\{/gm);
const NOCHE = bloques(/^\.sup-noche\s*\{/gm);

/* ------------------------------------------------------------ resolucion --- */

function aColor(texto) {
  const t = texto.trim();

  const hex = t.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }

  // rgb(r g b / a) y rgb(r, g, b, a) — las dos sintaxis conviven en la hoja.
  const rgb = t.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const partes = rgb[1].split('/');
    const canales = partes[0]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const alfa = partes[1] !== undefined ? Number(partes[1]) : (canales[3] ?? 1);
    return { r: canales[0], g: canales[1], b: canales[2], a: alfa };
  }

  return null;
}

/**
 * Resuelve un token a color concreto en un tema.
 *
 * `capas` son mapas de mayor a menor prioridad (superficie → tema → base), que
 * es el mismo orden en el que el navegador resuelve la herencia.
 */
function resolver(token, capas, visto = new Set()) {
  if (visto.has(token)) throw new Error(`ciclo de var() en ${token}`);
  visto.add(token);

  let valor;
  for (const capa of capas) {
    if (capa.has(token)) {
      valor = capa.get(token);
      break;
    }
  }
  if (valor === undefined) throw new Error(`token no declarado: ${token}`);

  const ref = valor.match(/^var\((--[\w-]+)\)$/);
  if (ref) return resolver(ref[1], capas, visto);

  const color = aColor(valor);
  if (color === null) throw new Error(`no es un color: ${token} = ${valor}`);
  return color;
}

/** Los stops de color de un gradiente, ya resueltos. */
function stops(token, capas) {
  let valor;
  for (const capa of capas) {
    if (capa.has(token)) {
      valor = capa.get(token);
      break;
    }
  }
  if (valor === undefined) throw new Error(`token no declarado: ${token}`);

  const ref = valor.match(/^var\((--[\w-]+)\)$/);
  if (ref) return stops(ref[1], capas);

  const encontrados = [...valor.matchAll(/var\((--[\w-]+)\)/g)].map((m) => resolver(m[1], capas));
  if (encontrados.length === 0) throw new Error(`sin stops legibles: ${token}`);
  return encontrados;
}

/** Apila fondos: el primero arriba de todo, el ultimo es el plano opaco. */
function fondo(tokens, capas) {
  return tokens.map((t) => resolver(t, capas)).reduceRight((atras, frente) => sobre(frente, atras));
}

/* ------------------------------------------------------------- contrato --- */

const CLARO = [BASE];
const OSC = [OSCURO, BASE];

/**
 * ⚠️ CADA FILA ES UN DEFECTO QUE YA PASO O UN PAR QUE LO SOSTIENE. No es una
 * lista de deseos: los cinco marcados con su numero se midieron rotos en el
 * navegador, con el sitio corriendo y datos reales.
 */
const PARES = [
  // --- los cinco que se rompieron ---
  {
    tema: 'oscuro',
    capas: OSC,
    texto: '--campo-texto',
    sobre: ['--superficie-1'],
    min: 4.5,
    nota: 'input y textarea — daba 1.25',
  },
  {
    tema: 'oscuro',
    capas: OSC,
    texto: '--boton-fantasma-texto',
    sobre: ['--superficie-1'],
    min: 4.5,
    nota: 'boton fantasma en ficha — daba 2.44',
  },
  {
    tema: 'oscuro',
    capas: OSC,
    texto: '--boton-fantasma-texto',
    sobre: ['--fondo-pagina'],
    min: 4.5,
    nota: 'boton fantasma en la pagina — daba 3.34',
  },
  {
    tema: 'oscuro',
    capas: OSC,
    texto: '--alerta-texto',
    sobre: ['--alerta-lavado', '--superficie-2', '--superficie-1'],
    min: 4.5,
    nota: 'etiqueta "Última unidad" — daba 3.95',
  },
  {
    tema: 'oscuro',
    capas: [CANCHA, OSCURO, BASE],
    texto: '--alerta-sobre-cancha',
    sobre: ['--alerta-lavado', '--color-cancha'],
    min: 4.5,
    nota: 'etiqueta "Esperando pago" — daba 1.08',
  },

  // --- los titulares con gradiente: vale el PEOR stop ---
  {
    tema: 'oscuro',
    capas: OSC,
    gradiente: '--degradado-titular',
    sobre: ['--fondo-pagina'],
    min: 3,
    nota: 'titulares — daban 1.10',
  },
  {
    tema: 'oscuro',
    capas: OSC,
    gradiente: '--degradado-titular-vivo',
    sobre: ['--fondo-pagina'],
    min: 3,
  },
  {
    tema: 'claro',
    capas: CLARO,
    gradiente: '--degradado-titular',
    sobre: ['--fondo-pagina'],
    min: 3,
  },
  {
    tema: 'claro',
    capas: CLARO,
    gradiente: '--degradado-titular-vivo',
    sobre: ['--fondo-pagina'],
    min: 3,
  },
  {
    tema: 'oscuro',
    capas: [NOCHE, OSCURO, BASE],
    gradiente: '--degradado-titular-claro',
    sobre: ['--sup-noche'],
    min: 4.5,
  },

  // --- el resto del texto que se apoya en la pagina y en las fichas ---
  ...[
    '--texto',
    '--color-neutro-texto',
    '--color-neutro-tenue',
    '--enlace',
    '--marca-texto',
  ].flatMap((texto) => [
    { tema: 'oscuro', capas: OSC, texto, sobre: ['--fondo-pagina'], min: 4.5 },
    { tema: 'oscuro', capas: OSC, texto, sobre: ['--superficie-1'], min: 4.5 },
    // La oscura MAS CLARA que existe: una tarjeta `.sup-2` dentro de una
    // ficha. Es donde `--color-neutro-tenue` se quedaba en 4.42.
    { tema: 'oscuro', capas: OSC, texto, sobre: ['--superficie-2', '--superficie-1'], min: 4.5 },
    { tema: 'claro', capas: CLARO, texto, sobre: ['--fondo-pagina'], min: 4.5 },
    { tema: 'claro', capas: CLARO, texto, sobre: ['--superficie-1'], min: 4.5 },
  ]),
];

/**
 * ⚠️ HAY TOKENS QUE SOLO EXISTEN EN UN TEMA, Y NO SE INVENTAN.
 * `--campo-texto`, `--boton-fantasma-texto`, `--alerta-texto` y `--marca-texto`
 * NO estan declarados en `:root`: en modo claro viven como valor de respaldo
 * dentro del `var(--token, respaldo)` de cada modulo, que es CSS que este
 * archivo no lee. Medirlos igual seria adivinar.
 *
 * Se OMITEN y se DICE cuales, en vez de dejar que pasen en silencio: un
 * chequeo que calla lo que no pudo medir es peor que no tenerlo. Esa mitad la
 * cubre el barrido en navegador, que mide lo pintado.
 */
function declarado(token, capas) {
  return capas.some((capa) => capa.has(token));
}

/* ------------------------------------------------------------------ run --- */

const fallos = [];
const omitidos = [];
let verificados = 0;

for (const par of PARES) {
  const token = par.gradiente ?? par.texto;
  if (!declarado(token, par.capas)) {
    omitidos.push(`${token} en ${par.tema}`);
    continue;
  }

  const atras = fondo(par.sobre, par.capas);
  const colores = par.gradiente
    ? stops(par.gradiente, par.capas)
    : [resolver(par.texto, par.capas)];

  const peor = Math.min(...colores.map((c) => contraste(sobre(c, atras), atras)));
  verificados += 1;

  if (peor < par.min) {
    fallos.push(
      `  ${par.tema.padEnd(6)} ${(par.gradiente ?? par.texto).padEnd(32)} sobre ${par.sobre.join(' → ')}\n` +
        `         ${peor.toFixed(2)}:1  (minimo ${par.min})${par.nota ? '  — ' + par.nota : ''}`,
    );
  }
}

if (fallos.length > 0) {
  console.error(`✗ contraste: ${fallos.length} de ${verificados} pares por debajo de AA\n`);
  console.error(fallos.join('\n'));
  console.error(
    '\nNo subas el minimo para que pase. Los pares de arriba son defectos que ya\n' +
      'ocurrieron: si uno vuelve a caer, lo que hay que cambiar es el token.',
  );
  process.exit(1);
}

const sinRepetir = [...new Set(omitidos)];
console.log(`contraste ok — ${verificados} pares de tokens verificados en los dos temas`);
if (sinRepetir.length > 0) {
  console.log(
    `  (${sinRepetir.length} omitidos por no estar declarados en tokens.css: ${sinRepetir.join(', ')})`,
  );
}
