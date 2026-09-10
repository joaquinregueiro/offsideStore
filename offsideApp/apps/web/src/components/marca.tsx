import estilos from './marca.module.css';

/**
 * La marca: bandera de linea + wordmark.
 *
 * ⚠️ EL WORDMARK ES TEXTO, NO UNA IMAGEN, y eso es fiel a la identidad, no un
 * atajo. El §01 dice "misma tipografia en todas las aplicaciones": el logotipo
 * ES Big Noodle Titling en mayusculas, y esa fuente ya la carga la app. Como
 * texto se selecciona, se lee en un lector de pantalla, escala con el zoom del
 * navegador y no pesa un byte extra.
 *
 * ⚠️ EL ISOTIPO SI ES UNA IMAGEN, y se extrajo del archivo real de identidad
 * (`design/assets/logos/offside-isotipo-bandera.png`) recortando la bandera y
 * volviendo transparente el fondo verde de la lamina. NO se redibujo a mano:
 * el damero en diagonal tiene una geometria precisa y una version "parecida"
 * dibujada de memoria seria una marca distinta.
 *
 * 🟡 PENDIENTE: la version vectorial. Un PNG a 4x resuelve pantallas HiDPI pero
 * no escala a un titular ni a un favicon grande. Sale del archivo fuente de
 * diseño, que es solo lectura (CLAUDE.md §3), asi que lo pide el owner.
 *
 * ⚠️ LA LUZ DEL ISOTIPO NO SE PONE ACA. `marca.module.css` le da a la bandera
 * un halo estatico del color de `--luz-marca` —que cada superficie remapea— y
 * la barra le agrega la respiracion. Este componente no sabe donde esta: por
 * eso no lleva ninguna clase de movimiento y su unico enganche es `data-marca`.
 */

const RELACION = 108 / 112;

export function Isotipo({ alto = 26 }: { alto?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/marca/isotipo-bandera.png"
      // Decorativo: el wordmark que va al lado ya dice "Offside".
      alt=""
      width={Math.round(alto * RELACION)}
      height={alto}
      className={estilos.isotipo}
      /*
        ⚠️ ES EL ENGANCHE PARA QUE UN CONTENEDOR ANIME LA MARCA (hoy: la barra
        levanta la bandera en el hover). Va como `data-` y no como selector de
        tag porque el isotipo tiene pendiente su version vectorial: el dia que
        sea un `<svg>`, un selector `img` deja de aplicar sin avisar.
      */
      data-marca="isotipo"
    />
  );
}

/**
 * Lockup completo. `invertido` es para fondos oscuros —la barra verde y el pie
 * en tinta—, donde el wordmark va en papel en vez del verde de marca.
 */
export function Logo({ invertido = false, alto = 26 }: { invertido?: boolean; alto?: number }) {
  return (
    <span className={`${estilos.logo} ${invertido ? estilos.invertido : ''}`.trim()}>
      <Isotipo alto={alto} />
      <span
        className={estilos.wordmark}
        data-marca="wordmark"
        style={{ fontSize: `${Math.round(alto * 1.35)}px` }}
      >
        Offside
      </span>
    </span>
  );
}
