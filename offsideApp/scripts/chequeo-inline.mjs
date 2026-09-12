/**
 * Busca la clase de defecto que NINGUNA herramienta del proyecto ve.
 *
 * ⚠️ EL CASO QUE LO ORIGINA. `.atajoDato` pedía `margin-top` y salía pegado al
 * título: el elemento era un `<span>`, o sea EN LINEA, y en un elemento en
 * linea el margen vertical no hace nada. La clase existe, se aplica, el
 * selector es correcto. TypeScript no lo ve —los tipos de un CSS Module son un
 * diccionario abierto—, eslint no mira CSS, `chequeo-css` verifica que la clase
 * exista, y Prettier la formatea perfecto. Se ve mirando la pantalla, y el
 * dueño la vio antes que nosotros: "Mis compras0 compras".
 *
 * QUE BUSCA: una clase que se aplica a un elemento EN LINEA (`<span>`, `<a>`,
 * `<label>`…) y que declara una propiedad que un elemento en linea IGNORA —los
 * margenes verticales, el alto y el ancho—, sin que nada la saque de ese modo.
 *
 * ⚠️ TRES COSAS SACAN A UN ELEMENTO DEL MODO EN LINEA, y hay que reconocer las
 * tres o el reporte es inservible: un `display` propio, un `position` absoluto
 * o fijo —el CSS "blockifica" lo posicionado—, y ser hijo de un contenedor flex
 * o grid, que blockifica a todos sus hijos. Lo tercero no se puede leer de la
 * hoja, pero sí se delata: `flex`, `align-self`, `grid-area` y compañía SOLO
 * valen en un hijo de flex o de grid, así que declararlas es la prueba.
 * Reconociendo las tres, el reporte pasó de 48 casos a los que de verdad
 * importan.
 *
 * ⚠️ ES UNA LISTA PARA MIRAR, NO UNA PRUEBA. Queda el caso que no se puede
 * decidir sin resolver el DOM: un `<span>` sin nada de eso adentro de un padre
 * flex. Por eso cada hallazgo se revisa a ojo una vez y, si está bien, se le
 * pone el `display` explícito —que no cambia el dibujo y documenta la
 * intención— en vez de bajarle el estándar al chequeo.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../apps/web/src/', import.meta.url));

/** Etiquetas cuyo `display` por defecto es `inline`. */
const EN_LINEA = new Set(['span', 'a', 'em', 'strong', 'small', 'b', 'i', 'label', 'code']);

/** Propiedades que un elemento `display: inline` ignora. */
const IGNORADAS = [
  'margin-top',
  'margin-bottom',
  'margin-block',
  'margin-block-start',
  'margin-block-end',
  'height',
  'min-height',
  'block-size',
  'width',
  'min-width',
  'inline-size',
];

/** Lo que prueba que el elemento NO se comporta como en linea. */
const NO_ES_EN_LINEA = [
  /(^|[\s;])display\s*:/,
  // Lo posicionado se blockifica; `static` y `relative` no posicionan.
  /(^|[\s;])position\s*:\s*(absolute|fixed|sticky)/,
  // Solo un hijo de flex o de grid puede declararlas, y ese hijo esta blockificado.
  /(^|[\s;])(flex|flex-grow|flex-shrink|flex-basis|align-self|justify-self|grid-area|grid-column|grid-row|order)\s*:/,
];

function archivos(dir, filtro, salida = []) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, filtro, salida);
    else if (filtro.test(nombre)) salida.push(ruta);
  }

  return salida;
}

/** Sin comentarios: `margin-top` nombrado en una explicacion no es una regla. */
function sinComentarios(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Cada bloque de la hoja, como `{ selector, cuerpo }`. */
function bloques(css) {
  return [...sinComentarios(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((bloque) => ({
    selector: bloque[1].trim(),
    cuerpo: bloque[2],
  }));
}

function clasesDe(selector) {
  return [...selector.matchAll(/\.([A-Za-z][\w-]*)/g)].map((coincidencia) => coincidencia[1]);
}

/**
 * Las clases de la hoja que en ALGUN lado dejan de comportarse como en linea.
 *
 * ⚠️ SE JUNTA DE TODA LA HOJA, NO BLOQUE POR BLOQUE. Una clase se declara
 * muchas veces —la regla base, la variante, la media query— y basta que UNA la
 * saque del modo en linea para que las medidas valgan en todas. Mirando bloque
 * por bloque, un `width` dentro de una media query figuraba como defecto aunque
 * la regla base ya pusiera `display: inline-flex`.
 */
function clasesConDisplay(css) {
  const conDisplay = new Set();

  for (const { selector, cuerpo } of bloques(css)) {
    if (!NO_ES_EN_LINEA.some((patron) => patron.test(cuerpo))) continue;
    for (const clase of clasesDe(selector)) conDisplay.add(clase);
  }

  return conDisplay;
}

/**
 * Las clases que son CONTENEDOR flex o grid.
 *
 * ⚠️ IMPORTA POR LOS HIJOS, no por ellas: un contenedor flex o grid blockifica
 * a todos sus hijos, asi que un `<span>` adentro acepta alto, ancho y margenes
 * verticales aunque su propia clase no diga nada. Es de lejos el caso mas
 * comun del sitio —los 13 ultimos falsos positivos eran todos esto— y sin
 * resolverlo el reporte es una lista de cosas que estan bien.
 */
function clasesContenedoras(css) {
  const contenedoras = new Set();

  for (const { selector, cuerpo } of bloques(css)) {
    if (!/(^|[\s;])display\s*:\s*(inline-)?(flex|grid)/.test(cuerpo)) continue;
    for (const clase of clasesDe(selector)) contenedoras.add(clase);
  }

  return contenedoras;
}

/** Las clases que piden medidas que un elemento en linea ignora. */
function clasesSospechosas(css) {
  const conDisplay = clasesConDisplay(css);
  const sospechosas = new Map();

  for (const { selector, cuerpo } of bloques(css)) {
    const ofensivas = IGNORADAS.filter((prop) => new RegExp(`(^|[\\s;])${prop}\\s*:`).test(cuerpo));
    if (ofensivas.length === 0) continue;

    for (const clase of clasesDe(selector)) {
      if (conDisplay.has(clase)) continue;

      const previas = sospechosas.get(clase) ?? new Set();
      for (const ofensiva of ofensivas) previas.add(ofensiva);
      sospechosas.set(clase, previas);
    }
  }

  return sospechosas;
}

/**
 * Cada etiqueta en linea del `.tsx`, con TODAS sus clases juntas.
 *
 * ⚠️ JUNTAS Y NO SUELTAS: casi todos los esqueletos se escriben
 * `${estilos.esqueletoOscuro} ${estilos.esqueletoTitulo}` —una clase pone el
 * `display: block` y la otra la medida—. Separadas, la segunda parece rota.
 */
function usosEnLinea(tsx) {
  const usos = [];
  const pila = [];

  for (const nodo of tsx.matchAll(/<(\/?)([A-Za-z][\w.]*)([^>]*?)(\/?)>/gs)) {
    const [, cierre, nombre, atributos, solo] = nodo;

    if (cierre === '/') {
      pila.pop();
      continue;
    }

    const clases = [...atributos.matchAll(/estilos\.([A-Za-z][\w]*)/g)].map(
      (coincidencia) => coincidencia[1],
    );

    if (EN_LINEA.has(nombre) && clases.length > 0) {
      usos.push({ etiqueta: nombre, clases, padre: pila.at(-1) ?? [] });
    }

    // Una etiqueta que se cierra sola no tiene hijos: no entra a la pila.
    if (solo !== '/') pila.push(clases);
  }

  return usos;
}

const hojas = archivos(SRC, /\.module\.css$/);
const hallazgos = [];
const vistos = new Set();

for (const hoja of hojas) {
  const css = readFileSync(hoja, 'utf8');
  const sospechosas = clasesSospechosas(css);
  if (sospechosas.size === 0) continue;

  const conDisplay = clasesConDisplay(css);
  const contenedoras = clasesContenedoras(css);

  /*
   * Los .tsx que IMPORTAN esta hoja.
   *
   * ⚠️ SE MIRA EL `import`, NO SI EL NOMBRE APARECE EN EL ARCHIVO. `ui.tsx`
   * nombra a `form.module.css` en un comentario —explica que un padding estaba
   * copiado en seis hojas— y con eso quedaba emparejado con una hoja que no
   * importa, asi que su `.etiqueta` se comparaba contra la `.etiqueta` de otro
   * modulo. Era el unico hallazgo que quedaba, y era ese error.
   */
  /*
   * ⚠️ `dirname`/`basename`, NO cortar por '/'. `hoja` viene de `join()`, que
   * en Windows separa con backslash: `lastIndexOf('/')` daba -1 y `nombre`
   * terminaba siendo la RUTA ABSOLUTA ENTERA. Como ademas se interpola en una
   * RegExp, el primer modulo con parentesis en la ruta
   * —`app/(admin)/admin.module.css`— armaba una expresion con un parentesis sin
   * cerrar y el script moria con "Unmatched ')'". En Linux no pasa: alli el
   * separador ya es '/'.
   */
  const carpeta = dirname(hoja);
  const nombre = basename(hoja);
  /*
   * ⚠️ SE ESCAPA EL NOMBRE ENTERO. `.replace('.', ...)` sin bandera global
   * solo escapa el PRIMER punto, y cualquier metacaracter del nombre entraba
   * crudo a la expresion. Un nombre de archivo no es una expresion regular.
   */
  const escapado = nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importa = new RegExp(`import\\s+estilos\\s+from\\s+'[^']*${escapado}'`);
  const vecinos = archivos(carpeta, /\.tsx$/).filter((archivo) =>
    importa.test(readFileSync(archivo, 'utf8')),
  );

  for (const vecino of vecinos) {
    for (const { etiqueta, clases, padre } of usosEnLinea(readFileSync(vecino, 'utf8'))) {
      // Una hermana en el mismo atributo ya lo sacó del modo en linea.
      if (clases.some((clase) => conDisplay.has(clase))) continue;

      // El padre es flex o grid: el navegador blockifica al hijo.
      if (padre.some((clase) => contenedoras.has(clase))) continue;

      for (const clase of clases) {
        const props = sospechosas.get(clase);
        if (props === undefined) continue;

        // Una clase repetida en la misma pantalla es UN hallazgo: `.etiqueta`
        // aparece en seis campos del mismo formulario y se arregla una vez.
        const huella = `${hoja}|${vecino}|${clase}`;
        if (vistos.has(huella)) continue;
        vistos.add(huella);

        hallazgos.push({
          hoja: relative(SRC, hoja),
          tsx: relative(SRC, vecino),
          clase,
          etiqueta,
          props: [...props].join(', '),
        });
      }
    }
  }
}

if (hallazgos.length === 0) {
  console.log(`inline ok — ${hojas.length} hojas, ninguna medida perdida en un elemento en linea`);
  process.exit(0);
}

console.error(`inline: ${hallazgos.length} clase(s) para mirar\n`);
for (const hallazgo of hallazgos) {
  console.error(`  .${hallazgo.clase}  (<${hallazgo.etiqueta}> en ${hallazgo.tsx})`);
  console.error(
    `    ${hallazgo.hoja} declara ${hallazgo.props}, que un elemento en linea ignora\n`,
  );
}
process.exit(1);
