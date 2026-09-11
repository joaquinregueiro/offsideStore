/**
 * DETECCION DE DATOS DE CONTACTO EN PREGUNTAS Y RESPUESTAS.
 *
 * ⚠️ POR QUE EXISTE, Y NO ES MOJIGATERIA. Una pregunta pública es el único
 * canal donde comprador y vendedor se hablan antes de la venta, y es el lugar
 * obvio para escribir "pasame tu WhatsApp y te lo vendo sin comisión". Eso no
 * es solo perder la comisión: saca la operación de Mercado Pago, o sea que la
 * persona paga por transferencia a un desconocido, sin pago retenido, sin
 * reclamo, sin reembolso y sin nada que Offside pueda hacer después. Cuando
 * sale mal —y sale mal— el reclamo llega igual, y la respuesta es que no hay
 * registro de nada.
 *
 * ⚠️ Y ADEMAS ES PUBLICO. Las preguntas se ven en la ficha: un teléfono escrito
 * ahí queda expuesto a cualquiera que entre, incluido el que lo escribió sin
 * pensar.
 *
 * ⚠️ ESTO NO ES MODERACION NI CENSURA: ES UN FRENO EN EL BORDE. No hay lista
 * de palabras prohibidas, no se juzga la intención y no se guarda nada del
 * texto rechazado. Se detectan FORMAS de dato de contacto —una secuencia que
 * parece un teléfono, un CBU, un alias, un arroba, un email, una URL— y se le
 * pide a la persona que lo saque, explicando por qué. Quien insista va a poder
 * igual con suficiente creatividad: el objetivo es que nadie lo haga por no
 * saber que no corresponde, no atrapar al que quiere evadir.
 *
 * ⚠️ LOS FALSOS POSITIVOS SE ELIGIERON CON CUIDADO. Un número de camiseta, un
 * año y un talle NO pueden dispararlo: por eso el umbral de dígitos es alto y
 * se ignoran los separadores típicos de una medida ("56 cm", "1996", "talle
 * 42"). Bloquear una pregunta legítima es peor que dejar pasar una que no lo
 * es: la primera rompe una venta honesta, la segunda la revisa una persona.
 */

/** Qué se detectó. Es lo que se le nombra a la persona, sin repetir su texto. */
export type DatoDeContacto = 'teléfono' | 'CBU o CVU' | 'alias' | 'email' | 'red social' | 'enlace';

export interface DeteccionDeContacto {
  hay: boolean;
  /** En orden de aparición, sin repetidos. */
  tipos: DatoDeContacto[];
}

/**
 * Cuántos dígitos seguidos (ignorando espacios, puntos y guiones) hacen que
 * algo parezca un teléfono.
 *
 * ⚠️ ES 8 Y NO 6. Un año son 4, un precio "150000" son 6 y un talle son 2. Los
 * teléfonos argentinos sin característica ya son 8, y con característica 10.
 * Bajarlo a 6 haría que "cuesta 150000" fuera un teléfono.
 */
const DIGITOS_DE_TELEFONO = 8;

/** El CBU argentino tiene 22 dígitos; el CVU también. */
const DIGITOS_DE_CBU = 22;

/**
 * Secuencias de dígitos con los separadores que la gente usa al escribir un
 * teléfono. NO incluye la coma ni la palabra "cm": una medida no es un contacto.
 */
const SECUENCIA_DE_DIGITOS = /\d[\d\s.\-()+]{5,}\d/g;

/**
 * Un email. Deliberadamente laxo: lo que importa es la FORMA `algo@algo.algo`,
 * no que sea válido.
 */
const EMAIL = /[a-z0-9._%+-]+\s?(?:@|\(arroba\)|\[at\]|\sarroba\s)\s?[a-z0-9.-]+\.[a-z]{2,}/i;

/**
 * Un `@usuario` de red social. Exige al menos tres caracteres después del
 * arroba para no confundirse con un email ya cubierto arriba.
 */
const ARROBA = /(?:^|[\s(])@[a-z0-9._]{3,}/i;

/** Menciones explícitas de un canal por fuera del sitio. */
const REDES =
  /\b(whats\s?app|wsp|wpp|telegram|instagram|insta\b|ig\b|facebook|messenger|tiktok|twitter|discord)\b/i;

/** Una URL o un dominio suelto. Se excluye el propio sitio. */
const ENLACE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|com\.ar|ar|net|org|me|ly)\b/i;

/** "CBU", "CVU", "alias" y sus variantes escritas con espacios o puntos. */
const PALABRA_CBU = /\b(c\s?\.?\s?b\s?\.?\s?u|c\s?\.?\s?v\s?\.?\s?u)\b/i;
const PALABRA_ALIAS = /\balias\b/i;

/**
 * Un alias de transferencia: tres palabras pegadas por puntos, como
 * `mi.alias.banco` o `juan.perez.mp`.
 *
 * ⚠️ LA ULTIMA PARTE ADMITE DOS LETRAS y las dos primeras exigen tres. Los
 * alias reales terminan casi siempre en la sigla del banco —`.mp`, `.bna`,
 * `.uala`—, asi que pedir tres en las tres partes dejaba pasar justo los mas
 * comunes. Pedir dos en las TRES, en cambio, empezaria a morder texto normal.
 */
const ALIAS_CON_PUNTOS = /\b[a-z]{3,}\.[a-z]{3,}\.[a-z]{2,}\b/i;

/** Dígitos sueltos de una secuencia, para contarlos sin los separadores. */
function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, '');
}

/**
 * Qué datos de contacto parece llevar el texto.
 *
 * ⚠️ NO DEVUELVE EL TEXTO DETECTADO, sólo el TIPO. Repetirle a la persona el
 * número que escribió para decirle que no lo escriba sería absurdo, y ese
 * mensaje termina en un log.
 */
export function detectarContacto(texto: string): DeteccionDeContacto {
  const tipos = new Set<DatoDeContacto>();
  const normalizado = texto.normalize('NFKC');

  for (const match of normalizado.matchAll(SECUENCIA_DE_DIGITOS)) {
    const digitos = soloDigitos(match[0]).length;

    if (digitos >= DIGITOS_DE_CBU) tipos.add('CBU o CVU');
    else if (digitos >= DIGITOS_DE_TELEFONO) tipos.add('teléfono');
  }

  if (PALABRA_CBU.test(normalizado)) tipos.add('CBU o CVU');
  if (PALABRA_ALIAS.test(normalizado) || ALIAS_CON_PUNTOS.test(normalizado)) tipos.add('alias');
  if (EMAIL.test(normalizado)) tipos.add('email');
  if (ARROBA.test(normalizado) || REDES.test(normalizado)) tipos.add('red social');
  if (ENLACE.test(normalizado) && !EMAIL.test(normalizado)) tipos.add('enlace');

  return { hay: tipos.size > 0, tipos: [...tipos] };
}

/**
 * El mensaje que se le muestra a la persona.
 *
 * ⚠️ EXPLICA EL MOTIVO, NO SOLO LA REGLA. "No se permite" hace que la gente
 * busque cómo esquivarlo; "si la compra pasa por fuera de Offside no hay
 * reclamo posible" hace que entienda qué está perdiendo. Y dice qué hacer en
 * vez de sólo qué no hacer.
 */
/**
 * El artículo de cada tipo.
 *
 * ⚠️ EXISTE PORQUE "un red social" ES UN ERROR QUE SE LEE. El mensaje se
 * arma con el nombre del tipo y un `un` fijo daba mal el género en dos de los
 * seis casos. Es un mensaje que la gente ve cuando algo le salió mal: que
 * además esté mal escrito no ayuda.
 */
const ARTICULO: Record<DatoDeContacto, string> = {
  teléfono: 'un teléfono',
  'CBU o CVU': 'un CBU o CVU',
  alias: 'un alias',
  email: 'un email',
  'red social': 'una red social',
  enlace: 'un enlace',
};

export function mensajeDeContacto(deteccion: DeteccionDeContacto): string {
  const que =
    deteccion.tipos.length === 1
      ? ARTICULO[deteccion.tipos[0]!]
      : `datos de contacto (${deteccion.tipos.join(', ')})`;

  return (
    `Parece que escribiste ${que}. Las preguntas son públicas y la compra tiene que ` +
    'pasar por Offside: si se arregla por fuera, el pago no queda registrado y no hay ' +
    'reclamo ni reembolso posible. Preguntá lo que necesites saber de la prenda y ' +
    'coordiná el envío después de comprar.'
  );
}
