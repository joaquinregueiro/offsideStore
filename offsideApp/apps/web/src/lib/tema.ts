import { cookies } from 'next/headers';

/**
 * LA PREFERENCIA DE TEMA, RESUELTA EN EL SERVIDOR.
 *
 * ⚠️ SE LEE EN EL SERVIDOR Y SE PINTA EN EL `<html>`, NO SE APLICA CON
 * JAVASCRIPT, y es la decisión que evita el defecto clásico de todo modo
 * oscuro: el FOGONAZO. Si el tema se aplicara desde el cliente, el navegador
 * pintaría primero la página clara y recién después la daría vuelta — un
 * flash blanco en cada carga, justo para quien eligió oscuro porque la luz le
 * molesta. Con el atributo ya puesto en el HTML que sale del servidor, la
 * primera pintura ya es la correcta.
 *
 * ⚠️ Y ADEMÁS ES LA ÚNICA FORMA QUE FUNCIONA ACÁ. Este sitio anda sin
 * JavaScript por contrato —los formularios hacen POST nativo, las solapas son
 * enlaces, las confirmaciones son `<details>`—, así que un interruptor de tema
 * que dependa de JS sería la primera pieza que no cumple esa regla.
 */

/** Las tres opciones. `auto` delega en el sistema operativo. */
export type Tema = 'auto' | 'claro' | 'oscuro';

export const TEMAS: readonly Tema[] = ['auto', 'claro', 'oscuro'];

/**
 * EL TEMA DE QUIEN TODAVIA NO ELIGIO NADA.
 *
 * ⚠️ ES OSCURO POR DECISION DEL DUEÑO, NO `auto`, Y LA DIFERENCIA SE VE EN LA
 * PRIMERA VISITA. Con `auto`, quien llega con el sistema en claro —que es la
 * mayoria de los escritorios— veria el sitio claro y no se enteraria nunca de
 * que hay un modo oscuro. Con este default, el sitio se presenta oscuro y el
 * interruptor de la barra ofrece el otro.
 *
 * ⚠️ `auto` SIGUE EXISTIENDO Y AHORA ES UNA ELECCION, no la ausencia de una.
 * Por eso pasa a guardarse en la cookie: antes "sin preferencia" y "seguir al
 * sistema" eran lo mismo y alcanzaba con borrar; ahora son cosas distintas y
 * hay que poder decir "quiero seguir al sistema" y que se recuerde.
 */
const TEMA_POR_DEFECTO: Tema = 'oscuro';

/** Cómo se llama la preferencia en el navegador de quien visita. */
export const COOKIE_DE_TEMA = 'offside_tema';

/**
 * ⚠️ UN AÑO, Y NO UNA COOKIE DE SESIÓN. Volver a preguntar el tema en cada
 * visita sería no haberlo guardado.
 */
const UN_ANIO_EN_SEGUNDOS = 60 * 60 * 24 * 365;

function esTema(valor: string | undefined): valor is Tema {
  return valor !== undefined && (TEMAS as readonly string[]).includes(valor);
}

/**
 * Qué tema corresponde: el elegido, o el default si todavía no eligió.
 *
 * ⚠️ UN VALOR DESCONOCIDO CAE EN EL DEFAULT, NO ES UN ERROR. La cookie la puede
 * editar cualquiera desde su propio navegador, así que su contenido es entrada
 * de borde como cualquier otra: se valida contra la lista y lo que no está en
 * la lista se descarta en silencio. No hay nada que reportarle a nadie —es su
 * navegador— y romper la página entera por una cookie mal escrita sería
 * convertir un capricho en una caída.
 */
export async function temaElegido(): Promise<Tema> {
  const valor = (await cookies()).get(COOKIE_DE_TEMA)?.value;

  return esTema(valor) ? valor : TEMA_POR_DEFECTO;
}

/**
 * El atributo que va en el `<html>`.
 *
 * ⚠️ SOLO `auto` NO ESCRIBE ATRIBUTO, y eso es justamente lo que lo hace `auto`:
 * sin `data-tema`, la única regla que decide es el `@media
 * (prefers-color-scheme)` de `tokens.css`. Escribir `data-tema="auto"` no
 * rompería nada hoy, pero invita a que mañana alguien escriba un selector para
 * ese valor y duplique la lógica del sistema operativo a mano.
 *
 * ⚠️ EL DEFAULT SÍ ESCRIBE ATRIBUTO, y es lo que hace que el default sea el
 * default. Quien no eligió nada recibe `data-tema="oscuro"`, así que ve oscuro
 * aunque su sistema esté en claro. Dejarlo sin atributo sería volver a `auto`.
 */
export async function atributoDeTema(): Promise<{ 'data-tema'?: Tema }> {
  const tema = await temaElegido();

  return tema === 'auto' ? {} : { 'data-tema': tema };
}

/**
 * Guarda la preferencia. La usan el interruptor de la barra y el del pie.
 *
 * ⚠️ LAS TRES SE GUARDAN, INCLUSO `auto`. Antes `auto` borraba la cookie,
 * porque "sin preferencia" y "seguir al sistema" eran lo mismo. Con el default
 * en oscuro dejaron de serlo: sin cookie el sitio es oscuro, así que borrar
 * sería lo contrario de lo que pidió quien eligió automático.
 */
export async function guardarTema(tema: Tema): Promise<void> {
  const almacen = await cookies();

  almacen.set(COOKIE_DE_TEMA, tema, {
    path: '/',
    maxAge: UN_ANIO_EN_SEGUNDOS,
    sameSite: 'lax',
    /*
     * ⚠️ NO LLEVA `httpOnly` A PROPÓSITO, Y NO ES UN DESCUIDO. `httpOnly`
     * protege un secreto de un script hostil; acá no hay secreto —es "esta
     * persona prefiere el tema oscuro"— y dejarla legible permite que, el día
     * que exista un interruptor con JavaScript, el cliente pueda leer el estado
     * sin pedirle nada al servidor. `secure` tampoco: en desarrollo el sitio es
     * HTTP y una cookie `secure` ahí no se guarda nunca.
     */
    httpOnly: false,
  });
}
