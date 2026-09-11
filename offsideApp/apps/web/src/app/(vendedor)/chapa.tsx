import type { ReactNode } from 'react';

import estilos from './vendedor.module.css';

/** El tono del chip de estado. Es el mismo vocabulario que `TonoEtiqueta`. */
export type TonoChapa = 'neutro' | 'marca' | 'alerta' | 'exito';

/**
 * Chapa de seccion: el masthead del panel del vendedor.
 *
 * ⚠️ EXISTE PARA QUE LAS NUEVE PANTALLAS SE LEAN COMO UNA SECCION. Antes cada una
 * empezaba con un `<h1>` negro a 36px sobre papel, igual que cualquier otra
 * pantalla del sitio: nada decía "esto es tu tienda".
 *
 * ⚠️ `sup-cancha` Y `patron-vivo` NO PUEDEN IR EN EL MISMO ELEMENTO. Las dos
 * pintan `::before` —una el filo de luz que le da canto al bloque, la otra el
 * patrón de rombos en deriva— y la segunda mata a la primera sin dar ningún
 * error. Por eso el patrón vive en su propio `<span>` decorativo.
 *
 * ⚠️ EL PATRON VA EN ESCALA DE BLOQUE (88px), NO DE CINTA (28px), Y ESO
 * ARREGLA UN TITILEO REAL. El mosaico de cinta se corre 28px en 26 segundos:
 * poco mas de un pixel por segundo. A esa velocidad cada cuadro cae en una
 * fraccion de pixel distinta, el navegador vuelve a rasterizar rombos de 28px
 * y en una pantalla de alta densidad eso se ve como un parpadeo del fondo.
 * Con el mosaico de 88px —el mismo que usa la portada, que nunca titilo— el
 * paso por segundo es tres veces mayor y el borde de cada rombo cae siempre en
 * el mismo lugar relativo. La escala de cinta se queda donde corresponde: en
 * la tira de 6px del pie y de la barra.
 *
 * ⚠️ NO LLEVA `overflow: hidden`. El anillo de foco no lo recorta el propio
 * elemento, pero SÍ lo recorta un ANCESTRO con overflow oculto — y la chapa lleva
 * un botón adentro. Lo que hay que recortar se recorta solo: el patrón con su
 * propio `overflow`, la máscara del titular con `overflow: clip`.
 *
 * ⚠️ EL TÍTULO VA EN DOS `<span>` ANIDADOS y no es capricho: `translateY(100%)`
 * sin una máscara no es un revelado, es texto que se superpone al de abajo. El
 * externo recorta, el interno se mueve.
 */
export function Chapa({
  rotulo,
  titulo,
  detalle,
  estado,
  accion,
  chica = false,
}: {
  /** De qué sección es esta pantalla. Va arriba, en versalitas. */
  rotulo: string;
  titulo: string;
  /** Una línea corta debajo del título: antigüedad, nombre de la publicación. */
  detalle?: ReactNode;
  /**
   * El estado de la cuenta o de la conexión.
   *
   * ⚠️ NO ACEPTA UNA `<Etiqueta>`, Y ES UN ARREGLO, NO UNA LIMITACIÓN. La
   * primitiva compartida pinta su fondo con `--superficie-1` —que `.sup-cancha`
   * NO remapea— y su texto con `--color-alerta` —que SÍ remapea, a Amarillo
   * Cambio—: un `<Etiqueta tono="alerta">` adentro de un bloque de marca sale
   * amarillo sobre blanco, ~1.2:1, sin ningún error. Acá el chip es propio de
   * esta superficie y el tono viaja en el rombo, que es forma.
   */
  estado?: { texto: string; tono: TonoChapa };
  /** La acción que la pantalla vino a ofrecer. */
  accion?: ReactNode;
  /**
   * Versión de las pantallas internas: la misma marca con menos volumen.
   *
   * ⚠️ EL TÍTULO CHICO TAMBIÉN CRECE EN TELÉFONO. Ver la nota de
   * `.chapaChica .chapaTitulo`: el atajo obvio —`max(--texto-3xl, --display-3)`—
   * entrega exactamente los 36px de hoy a 320px, o sea que el trabajo de escala
   * editorial se cobraba sólo en escritorio.
   */
  chica?: boolean;
}) {
  return (
    <header
      className={[
        estilos.chapa,
        chica ? estilos.chapaChica : '',
        // Las tres globales traen el fondo de marca, el grano y la entrada al
        // primer pintado. El color de la superficie NO se escribe en el módulo.
        'sup-cancha',
        'con-grano',
        'entra-acerca',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={`${estilos.chapaPatron} patron-vivo`} aria-hidden="true" />

      <div>
        <p className={estilos.chapaRotulo}>{rotulo}</p>
        <h1 className={estilos.chapaTitulo}>
          <span>
            <span>{titulo}</span>
          </span>
        </h1>
        {detalle}
      </div>

      {(estado !== undefined || accion !== undefined) && (
        <div className={estilos.chapaAccion}>
          {estado !== undefined && (
            <span className={estilos.chapaChip} data-tono={estado.tono}>
              {estado.texto}
            </span>
          )}
          {accion}
        </div>
      )}
    </header>
  );
}
