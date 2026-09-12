/**
 * Fija los DOS bloques del modo oscuro para que no se separen nunca.
 *
 * ⚠️ POR QUE ESTAN DUPLICADOS. El tema oscuro se aplica en dos situaciones que
 * no se pueden escribir juntas: seguir al sistema operativo
 * (`@media (prefers-color-scheme: dark)`) y una eleccion explicita de la
 * persona (`:root[data-tema='oscuro']`). CSS no tiene forma de compartir un
 * cuerpo entre un `@media` y un selector —no hay `@extend` ni mixins, y la
 * alternativa con "space toggles" es ilegible—, asi que el cuerpo se repite.
 *
 * ⚠️ EL RIESGO QUE ESTO CUBRE ES SILENCIOSO Y CARO. Si alguien agrega un token
 * al bloque del atributo y se olvida del `@media`, el modo oscuro anda perfecto
 * para quien lo eligio a mano y queda ROTO para quien tiene el sistema en
 * oscuro —que son la mayoria—. No falla ningun build, no lo ve el typecheck y
 * en pantalla es un color de mas o de menos: exactamente el tipo de defecto que
 * este proyecto ya se comio dos veces.
 *
 * Compara el CONJUNTO de tokens declarados y tambien sus VALORES: un alias que
 * apunta a distinto lado en cada bloque es el mismo problema.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOKENS = fileURLToPath(new URL('../apps/web/src/app/tokens.css', import.meta.url));
const css = readFileSync(TOKENS, 'utf8');

/** Las declaraciones de un bloque, como mapa token → valor, sin comentarios. */
function declaraciones(cuerpo) {
  const limpio = cuerpo.replace(/\/\*[\s\S]*?\*\//g, '');
  const mapa = new Map();

  for (const linea of limpio.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) {
    mapa.set(linea[1], linea[2].trim().replace(/\s+/g, ' '));
  }

  return mapa;
}

/**
 * El cuerpo de una regla, contando llaves.
 *
 * ⚠️ NO SIRVE UN `[^{}]*`: el bloque del `@media` esta ANIDADO, asi que su
 * regla interior tiene llaves adentro y una expresion simple corta donde no va.
 */
function cuerpoDe(desde) {
  const abre = css.indexOf('{', desde);
  if (abre === -1) return null;

  let nivel = 0;
  for (let i = abre; i < css.length; i += 1) {
    if (css[i] === '{') nivel += 1;
    else if (css[i] === '}') {
      nivel -= 1;
      if (nivel === 0) return css.slice(abre + 1, i);
    }
  }

  return null;
}

const problemas = [];

const inicioMedia = css.indexOf('@media (prefers-color-scheme: dark)');
const inicioAtributo = css.indexOf(":root[data-tema='oscuro']");

if (inicioMedia === -1) problemas.push('falta el bloque `@media (prefers-color-scheme: dark)`');
if (inicioAtributo === -1) problemas.push("falta el bloque `:root[data-tema='oscuro']`");

if (problemas.length === 0) {
  const porSistema = declaraciones(cuerpoDe(inicioMedia) ?? '');
  const porEleccion = declaraciones(cuerpoDe(inicioAtributo) ?? '');

  for (const [token, valor] of porSistema) {
    if (!porEleccion.has(token)) {
      problemas.push(`\`${token}\` esta en el @media del sistema y falta en la eleccion explicita`);
    } else if (porEleccion.get(token) !== valor) {
      problemas.push(
        `\`${token}\` vale distinto en cada bloque:\n` +
          `      sistema:  ${valor}\n` +
          `      eleccion: ${porEleccion.get(token)}`,
      );
    }
  }

  for (const token of porEleccion.keys()) {
    if (!porSistema.has(token)) {
      problemas.push(`\`${token}\` esta en la eleccion explicita y falta en el @media del sistema`);
    }
  }

  if (porSistema.size === 0) problemas.push('el bloque del sistema no declara ningun token');
}

if (problemas.length === 0) {
  const n = declaraciones(cuerpoDe(inicioMedia) ?? '').size;
  console.log(`tema ok — los dos bloques del modo oscuro declaran los mismos ${n} tokens`);
  process.exit(0);
}

console.error(`tema: ${problemas.length} problema(s)\n`);
for (const problema of problemas) console.error(`  · ${problema}`);
console.error('');
process.exit(1);
