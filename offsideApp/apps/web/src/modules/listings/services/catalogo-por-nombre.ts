import type { CatalogRow } from '../repositories/catalog.repository';

/**
 * RESOLVER UN ITEM DE CATALOGO A PARTIR DE LO QUE LA PERSONA ESCRIBIO.
 *
 * ⚠️ POR QUE EXISTE. El formulario pasaba de `<select>` a campo escribible
 * porque "no estan ni todos los clubes ni marcas del mundo" (owner, 2026-11-10).
 * El comentario de la primitiva `Seleccion` ya explicaba el obstaculo: un
 * `<datalist>` manda al servidor el TEXTO VISIBLE, y el formulario exigia un
 * uuid. La salida no es poner el uuid a la vista: es que el servidor acepte el
 * NOMBRE y lo resuelva. Esto es ese resolvedor.
 *
 * ⚠️ ES UNA FUNCION PURA SOBRE EL CATALOGO YA CARGADO, no una consulta. El
 * catalogo entero son 38 clubes, 25 selecciones, 18 marcas y 68 años: la
 * pantalla YA los trae para dibujar el `<datalist>`. Resolver en memoria evita
 * una segunda ida a la base y, sobre todo, deja esto testeable sin PostgreSQL
 * —que es donde viven los casos que importan—.
 *
 * ⚠️ TRES RESULTADOS, NO DOS, y el del medio es el que evita el desastre:
 *
 *   - `encontrado`  el texto identifica a UNO sin ambiguedad.
 *   - `sugerencias` se parece a algo que existe. NO se elige por la persona:
 *                   se le devuelve "¿quisiste decir River Plate?". Adivinar
 *                   aca es peor que preguntar —una camiseta de Racing de
 *                   Santander no es una de Racing Club—.
 *   - `sin coincidencias` no se parece a nada. RECIEN AHI tiene sentido
 *                   proponer el alta al catalogo (DEC-041).
 *
 * Sin el estado del medio, cada typo crearia una solicitud de alta y el
 * catalogo terminaria con "Riber", "river plate" y "C.A.R.P." como tres clubes
 * distintos: exactamente los "datos sucios" que `product-specification.md` §11
 * marca como el riesgo que mata la busqueda facetada.
 */

/**
 * Texto comparable: sin mayusculas, sin tildes y sin nada que no sea letra o
 * digito.
 *
 * ⚠️ SACAR LOS ESPACIOS ES EL PUNTO, no un detalle. Es lo que hace que
 * "Newbalance" encuentre "New Balance" —el caso que pidio el owner— y que
 * "C.A.R.P." encuentre el alias "CARP". Un `<datalist>` nativo no puede: el
 * navegador compara contra el texto visible tal cual.
 *
 * ⚠️ LA EÑE SOBREVIVE. `NFD` separa la tilde de la `n` y el filtro de abajo se
 * la lleva, asi que "Niño" y "Nino" colapsan —que es lo que se quiere—, pero
 * `ñ` NO se convierte en otra letra: sigue siendo `n`, igual que en castellano
 * se busca. No se usa `NFKD`, que ademas rompe ligaduras y superindices.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Todas las formas por las que un item se puede nombrar: su nombre y sus alias. */
function formasDe(fila: CatalogRow): string[] {
  return [fila.name, ...(fila.aliases ?? [])].map(normalizar).filter((f) => f !== '');
}

export type ResolucionDeCatalogo =
  | { tipo: 'vacio' }
  | { tipo: 'encontrado'; fila: CatalogRow }
  | { tipo: 'sugerencias'; opciones: CatalogRow[] }
  | { tipo: 'sin-coincidencias'; texto: string };

/** Cuantas sugerencias se devuelven. Mas de tres ya no es una pregunta, es otra lista. */
const MAXIMO_DE_SUGERENCIAS = 3;

/**
 * Distancia de edicion acotada: cuantas letras hay que cambiar para pasar de
 * `a` a `b`, y se abandona apenas supera `techo`.
 *
 * ⚠️ ACOTADA A PROPOSITO. Sin techo, "river" estaria a 14 ediciones de
 * "manchester united" y habria que calcularlas todas para despues descartarlo.
 * Con el corte, el caso comun —no se parece en nada— sale enseguida.
 */
function distancia(a: string, b: string, techo: number): number {
  if (Math.abs(a.length - b.length) > techo) return techo + 1;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const actual = [i];
    let mejorDeLaFila = i;

    for (let j = 1; j <= b.length; j += 1) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      const valor = Math.min(actual[j - 1]! + 1, anterior[j]! + 1, anterior[j - 1]! + costo);
      actual.push(valor);
      mejorDeLaFila = Math.min(mejorDeLaFila, valor);
    }

    // Toda la fila ya supera el techo: ninguna continuacion puede bajar de ahi.
    if (mejorDeLaFila > techo) return techo + 1;
    anterior = actual;
  }

  return anterior[b.length]!;
}

/**
 * Cuantas ediciones se toleran segun el largo de lo escrito.
 *
 * ⚠️ NO ES UN NUMERO FIJO. Con 1 sola edicion sobre textos cortos, "oca" y
 * "boca" serian la misma cosa; con 3 sobre textos largos, no se perdona un dedo
 * de mas en "independiente". Escala con el largo y arranca en cero: hasta cuatro
 * letras se exige coincidencia por prefijo, no por parecido.
 */
function toleranciaPara(texto: string): number {
  if (texto.length <= 4) return 0;
  if (texto.length <= 8) return 1;

  return 2;
}

/**
 * Qué item del catalogo nombra este texto.
 *
 * El orden de las pasadas es el orden de la confianza, y la primera que da UNA
 * sola fila gana.
 */
export function resolverPorNombre(texto: string, catalogo: CatalogRow[]): ResolucionDeCatalogo {
  const buscado = normalizar(texto);
  if (buscado === '') return { tipo: 'vacio' };

  /*
   * 1. IDENTICO al nombre o a un alias. Es lo que manda el `<datalist>` cuando
   *    la persona eligio de la lista, asi que es el camino normal y tiene que
   *    ser el mas barato.
   */
  const exactas = catalogo.filter((fila) => formasDe(fila).includes(buscado));
  if (exactas.length === 1) return { tipo: 'encontrado', fila: exactas[0]! };
  /*
   * ⚠️ DOS EXACTAS NO SE DESEMPATAN SOLAS. Pasa si un alias de uno es el nombre
   * de otro ("Nacional" hay varios). Se pregunta.
   */
  if (exactas.length > 1) return { tipo: 'sugerencias', opciones: exactas };

  /*
   * 2. EMPIEZA CON lo escrito: "river" → "River Plate", "boca" → "Boca
   *    Juniors". Es el caso que pidio el owner y el que mas se usa.
   */
  const porPrefijo = catalogo.filter((fila) => formasDe(fila).some((f) => f.startsWith(buscado)));
  if (porPrefijo.length === 1) return { tipo: 'encontrado', fila: porPrefijo[0]! };
  if (porPrefijo.length > 1) {
    return { tipo: 'sugerencias', opciones: porPrefijo.slice(0, MAXIMO_DE_SUGERENCIAS) };
  }

  /*
   * 3. CONTIENE lo escrito: "united" → "Manchester United". Nunca resuelve
   *    solo, ni siquiera con una sola coincidencia: que "united" aparezca en un
   *    unico club hoy no significa que la persona quisiera ESE —manana se
   *    siembra otro y la misma publicacion habria elegido distinto—.
   */
  const porDentro = catalogo.filter((fila) => formasDe(fila).some((f) => f.includes(buscado)));
  if (porDentro.length > 0) {
    return { tipo: 'sugerencias', opciones: porDentro.slice(0, MAXIMO_DE_SUGERENCIAS) };
  }

  /*
   * 4. SE ESCRIBIO MAL: "indepediente" → "Independiente". Tampoco resuelve
   *    solo. Un typo que elige por vos termina en una camiseta mal catalogada
   *    que nadie vuelve a revisar.
   */
  const techo = toleranciaPara(buscado);
  if (techo > 0) {
    const parecidas = catalogo
      .map((fila) => ({
        fila,
        d: Math.min(...formasDe(fila).map((f) => distancia(buscado, f, techo))),
      }))
      .filter((c) => c.d <= techo)
      .sort((a, b) => a.d - b.d);

    if (parecidas.length > 0) {
      return {
        tipo: 'sugerencias',
        opciones: parecidas.slice(0, MAXIMO_DE_SUGERENCIAS).map((c) => c.fila),
      };
    }
  }

  return { tipo: 'sin-coincidencias', texto: texto.trim() };
}
