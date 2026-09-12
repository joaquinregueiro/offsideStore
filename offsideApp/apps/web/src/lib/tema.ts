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

/** Las tres opciones. `auto` es no tener preferencia: manda el sistema. */
export type Tema = 'auto' | 'claro' | 'oscuro';

export const TEMAS: readonly Tema[] = ['auto', 'claro', 'oscuro'];

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
 * Qué tema pidió esta persona.
 *
 * ⚠️ UN VALOR DESCONOCIDO ES `auto`, NO UN ERROR. La cookie la puede editar
 * cualquiera desde su propio navegador, así que su contenido es entrada de
 * borde como cualquier otra: se valida contra la lista y lo que no está en la
 * lista se descarta en silencio. No hay nada que reportarle a nadie —es su
 * navegador— y romper la página entera por una cookie mal escrita sería
 * convertir un capricho en una caída.
 */
export async function temaElegido(): Promise<Tema> {
  const valor = (await cookies()).get(COOKIE_DE_TEMA)?.value;

  return esTema(valor) ? valor : 'auto';
}

/**
 * El atributo que va en el `<html>`.
 *
 * ⚠️ `auto` NO ESCRIBE ATRIBUTO, y eso es justamente lo que lo hace `auto`: sin
 * `data-tema`, la única regla que decide es el `@media (prefers-color-scheme)`
 * de `tokens.css`. Escribir `data-tema="auto"` no rompería nada hoy, pero
 * invita a que mañana alguien escriba un selector para ese valor y duplique la
 * lógica del sistema operativo a mano.
 */
export async function atributoDeTema(): Promise<{ 'data-tema'?: Tema }> {
  const tema = await temaElegido();

  return tema === 'auto' ? {} : { 'data-tema': tema };
}

/** Guarda la preferencia. La usa la Server Action del pie. */
export async function guardarTema(tema: Tema): Promise<void> {
  const almacen = await cookies();

  if (tema === 'auto') {
    // Sin preferencia no hay nada que guardar: se borra y vuelve a mandar el sistema.
    almacen.delete(COOKIE_DE_TEMA);

    return;
  }

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
