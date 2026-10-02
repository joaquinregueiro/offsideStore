import estilos from './marca.module.css';

/**
 * La marca: el lockup de imagen (`LogoLockup`) y la bandera suelta (`Isotipo`).
 *
 * ⚠️ EL LOCKUP DE TEXTO SE RETIRO EL 2026-09-15. Habia un componente `Logo`
 * —bandera + "Offside" escrito en Big Noodle— y su argumento era bueno: como
 * texto se seleccionaba, lo leia un lector de pantalla, escalaba con el zoom y
 * no pesaba un byte. El dueño entrego un lockup dibujado y decidio usarlo en
 * las cinco pantallas que tenian el otro, asi que `Logo` se quedo sin un solo
 * consumidor. Queda en el historial de git, no comentado acá.
 *
 * ⚠️ EL ISOTIPO SOBREVIVE PORQUE NO ES UN LOGOTIPO, ES UN ORNAMENTO: lo usa
 * `BanderaIzada` en el 404, donde la bandera se iza y es "el gesto literal del
 * fuera de juego". Ahi la palabra no reemplaza nada.
 *
 * ⚠️ EL ISOTIPO ES UNA IMAGEN, y se extrajo del archivo real de identidad
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
 * LOCKUP DE IMAGEN — la marca completa en un solo archivo blanco.
 *
 * ⚠️ ES LA MARCA EN LAS CINCO PANTALLAS QUE LA MUESTRAN: la barra (36), el pie
 * (34), el panel de auth (34), la barra fantasma de los esqueletos (36, que
 * TIENE que coincidir con la barra real o el logo salta al cargar) y las
 * pantallas de servicio (26).
 *
 * ⚠️ LA TINTA ES BLANCA Y NO HAY VARIANTE OSCURA: sobre una superficie clara es
 * INVISIBLE. Por eso vive en la barra, que es `.sup-cancha` en los dos temas
 * —`tokens.css` no redefine `--color-cancha` ni en claro ni en oscuro—. Antes
 * de ponerlo en otro lado hay que confirmar que ese lado sea oscuro.
 *
 * ⚠️ EL NOMBRE ACCESIBLE NO VIVE EN LA IMAGEN. Donde el lockup va adentro de un
 * enlace a la portada —la barra y las pantallas de servicio— el `<a>` ya
 * declara `aria-label="Offside Store — inicio"`, así que la imagen va con
 * `alt=""` para no decir el nombre dos veces. Donde NO es un enlace —el pie y
 * el panel de auth— el nombre de la marca ya está escrito en el texto que lo
 * rodea, y la barra fantasma entera es `aria-hidden`.
 *
 * ⚠️ ES SOLO LA PALABRA: ESTE LOCKUP NO TRAE LA BANDERA. Con el retiro de
 * `Logo`, el isotipo deja de aparecer en la barra, el pie, el panel de auth y
 * los esqueletos. La bandera queda SOLO en el 404, izada. Es consecuencia de
 * usar este archivo en todos lados, y lo decidió el dueño.
 *
 * ⚠️ LA RELACION ES 2.826 Y POR ESO ENTRA SIN TOCAR LA BARRA: a 36px de alto
 * mide 102px de ancho, y `.marca` sigue midiendo `--alto-control` (44) porque
 * lo declara como `min-height`. `--alto-barra` sigue siendo 84px = 16 + 44 +
 * 16 + 6. Con el lockup a 44 tambien entraba (124px); 36 es el "achicalo un
 * poco" que pidio el dueño el 2026-09-15.
 *
 * ⚠️ EL PNG NO ES EL ARCHIVO CRUDO, y el recorte no es una optimización
 * opcional: el original es un lienzo de 2600x2600 con la palabra en una banda
 * de 2016x713 al medio, así que pedirle 36px de ALTO al archivo entero dejaría
 * la palabra en 10px. Se recorta al contenido, se baja a 264px de alto —7x del
 * uso mas grande, que son los 36 de la barra— y se guarda con paleta: 82 KB →
 * 17 KB, sin diferencia visible a los tamaños a los que se usa.
 */

const LOCKUP_RELACION = 746 / 264;

export function LogoLockup({ alto = 36 }: { alto?: number }) {
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
