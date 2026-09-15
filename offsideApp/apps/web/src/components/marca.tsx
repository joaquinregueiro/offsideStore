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

/**
 * LOCKUP DE IMAGEN — la marca completa en un solo archivo blanco.
 *
 * ⚠️ NO REEMPLAZA A `Logo`, CONVIVE CON EL. `Logo` sigue siendo bandera +
 * wordmark de TEXTO y lo usan el pie, el panel de auth, los esqueletos y las
 * pantallas de servicio. Esto es el lockup que el dueño entregó el 2026-09-15
 * y que hoy usa SOLO la barra.
 *
 * ⚠️ LA TINTA ES BLANCA Y NO HAY VARIANTE OSCURA: sobre una superficie clara es
 * INVISIBLE. Por eso vive en la barra, que es `.sup-cancha` en los dos temas
 * —`tokens.css` no redefine `--color-cancha` ni en claro ni en oscuro—. Antes
 * de ponerlo en otro lado hay que confirmar que ese lado sea oscuro.
 *
 * ⚠️ EL WORDMARK DEJA DE SER TEXTO, y arriba está escrito por qué eso era
 * mejor: se seleccionaba, lo leía un lector de pantalla y escalaba con el zoom.
 * Lo decidió el dueño. Lo que se conserva es el nombre accesible: el `<a>` de la
 * barra ya declara `aria-label`, así que la imagen va con `alt=""` y no repite.
 *
 * ⚠️ ES SOLO LA PALABRA: ESTE LOCKUP NO TRAE LA BANDERA. O sea que la barra
 * dejó de mostrar el isotipo, que era la única forma de marca que tenía. Fue
 * decisión del dueño (reemplazó al lockup apilado del 2026-09-15, que a la
 * altura de la barra dejaba la palabra en 45px de ancho). La bandera sigue
 * viva en el pie, el panel de auth, los esqueletos y las pantallas de
 * servicio, que usan `Logo`.
 *
 * ⚠️ LA RELACION ES 2.826 Y POR ESO ENTRA SIN TOCAR LA BARRA: a 44px de alto
 * mide 124px de ancho, casi lo mismo que ocupaba `Logo` (bandera 26 + hueco 12
 * + wordmark ~90). `--alto-barra` sigue siendo 84px = 16 + 44 + 16 + 6.
 *
 * ⚠️ EL PNG NO ES EL ARCHIVO CRUDO, y el recorte no es una optimización
 * opcional: el original es un lienzo de 2600x2600 con la palabra en una banda
 * de 2016x713 al medio, así que pedirle 44px de ALTO al archivo entero dejaría
 * la palabra en 12px. Se recorta al contenido, se baja a 264px de alto (6x de
 * los 44 a los que se muestra) y se guarda con paleta: 220 KB → 26 KB, sin
 * diferencia visible al tamaño al que se usa.
 */

const LOCKUP_RELACION = 746 / 264;

export function LogoLockup({ alto = 44 }: { alto?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/marca/logo-offside.png"
      // El `<a>` que lo envuelve ya declara `aria-label`: repetirlo lo duplica.
      alt=""
      width={Math.round(alto * LOCKUP_RELACION)}
      height={alto}
      className={estilos.lockup}
      /* Enganche propio: NO es `isotipo`. Ver `header.module.css`. */
      data-marca="lockup"
    />
  );
}
