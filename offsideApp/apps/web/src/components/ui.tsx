import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import estilos from './ui.module.css';

/**
 * Primitivas de interfaz.
 *
 * ⚠️ Se escribieron CON la pantalla que las usa, no antes. Cada variante de
 * esta lista existe porque algo la pidio; inventar variantes por adelantado es
 * adivinar cuales hacen falta.
 *
 * Todas son SERVER COMPONENTS: no tienen estado ni manejadores de eventos. Un
 * boton dentro de un `<form>` que apunta a una Server Action funciona sin
 * JavaScript en el cliente, y por eso no necesita `'use client'`.
 *
 * ⚠️ EL MOVIMIENTO Y LA LUZ SE COMPONEN CON LAS CLASES GLOBALES DE
 * `movimiento.css` Y `tokens.css`, no se reimplementan aca. `entra-seco`,
 * `entra-acerca`, `entra-acerca-corto`, `cifra-entra`, `estado-entra`,
 * `pulso-atencion`, `eleva`, `tilt`, `destello`, `luz-filo`, `blobs`,
 * `escena-luz`, `aparece-escala`, `escalona`, `shimmer-titulo`,
 * `titular-degradado`, `subraya`, `esqueleto` y `desplegable` son parte de la
 * fundacion: una copia local queda fuera de la red de seguridad de
 * `prefers-reduced-motion` —que las lista por nombre— y diverge el dia que
 * alguien toque una de las dos.
 *
 * ⚠️ VERSION LUMINOSA (2026-09-10). El dueño rechazo la version angulosa
 * —"anticuada, sin animaciones, glow, dinamismo, muy cuadrado todo"— y esta
 * ronda la reemplaza: radios generosos, glow, vidrio, blobs que flotan detras
 * del estado vacio y del pliego, y hover rico. Las PROPS PUBLICAS no cambian;
 * `Pliego` suma dos opcionales (`luz`, `flotante`).
 */

/**
 * ⚠️ LOS BLOBS SON UNA CONSTANTE, NO UN COMPONENTE, y van con `aria-hidden`:
 * son luz, no informacion. Las clases son globales (`movimiento.css`): la
 * posicion sale del orden de los hijos y el color y la intensidad los decide la
 * SUPERFICIE que los contiene, con un presupuesto medido en `tokens.css` para
 * que no puedan romper AA por accidente. Son `<i>` vacios porque `.blob` es
 * `position: absolute` y un `<span>` en flujo no aporta nada.
 */
const BLOBS = (
  <span className="blobs" aria-hidden="true">
    <i className="blob blob-cancha" />
    <i className="blob blob-cambio blob-chico" />
    <i className="blob blob-cancha blob-chico" />
  </span>
);

/* ------------------------------------------------------------------ boton */

/**
 * ⚠️ CUATRO VARIANTES, NO MAS, Y CADA UNA CON UN ROL:
 *
 *   primario    la accion que la pantalla vino a ofrecer. Una por pantalla.
 *   secundario  la alternativa razonable —cancelar, volver, editar—.
 *   fantasma    accion terciaria dentro de una lista o una tarjeta, donde un
 *               borde por fila convierte la lista en una reja.
 *   peligro     destruye o mueve plata: eliminar, reembolsar.
 *
 * La variante `peligro` es de CONTORNO y recien se rellena al pasar por
 * encima. Un boton macizo de alerta en reposo grita en una pantalla donde
 * normalmente no es lo que se vino a hacer, y ademas compite con el primario.
 */
export type VarianteBoton = 'primario' | 'secundario' | 'fantasma' | 'peligro';

/**
 * ⚠️ EL TAMAÑO NO ES ESTETICA, ES AREA TACTIL. `medio` y `grande` respetan los
 * 44px que pide WCAG 2.1 (2.5.5). `chico` NO los alcanza a proposito y por eso
 * esta acotado: sirve para acciones dentro de una fila densa en escritorio
 * —una tabla del back-office—, nunca para la accion principal de una pantalla
 * que alguien va a usar desde el telefono.
 */
export type TamanioBoton = 'chico' | 'medio' | 'grande';

interface BaseBoton {
  variante?: VarianteBoton;
  tamanio?: TamanioBoton;
  bloque?: boolean;
  /** Icono a la izquierda del texto. Decorativo: el texto ya dice que hace. */
  icono?: ReactNode;
  /**
   * Galon al final, que se corre al pasar el mouse o al enfocar.
   *
   * ⚠️ SE ENCIENDE A MANO Y NO POR VARIANTE. Un boton primario dentro de un
   * `<form>` ENVIA; uno dentro de una tarjeta NAVEGA. La flecha significa lo
   * segundo, y el componente no tiene forma de saber cual de los dos es.
   */
  flecha?: boolean;
}

function claseDeVariante(variante: VarianteBoton) {
  if (variante === 'secundario') return estilos.botonSecundario;
  if (variante === 'fantasma') return estilos.botonFantasma;
  if (variante === 'peligro') return estilos.botonPeligro;

  return estilos.botonPrimario;
}

function claseDeTamanio(tamanio: TamanioBoton) {
  if (tamanio === 'chico') return estilos.botonChico;
  if (tamanio === 'grande') return estilos.botonGrande;

  return estilos.botonMedio;
}

/**
 * ⚠️ EL PRIMARIO COMPONE LA CLASE GLOBAL `luz-filo`: una banda de luz de 2px
 * corre por su borde superior al cargar y en cada hover. Es el barrido que
 * cumple AA por construccion —en el filo no hay texto— y vive en `::after`,
 * que el primario tiene libre (su relleno barre en `::before`). Las otras tres
 * variantes cambian el color del texto en hover y no llevan luz que se mueva.
 */
function clasesDeBoton(
  { variante = 'primario', tamanio = 'medio', bloque = false }: BaseBoton,
  extra?: string,
): string {
  return [
    estilos.boton,
    claseDeVariante(variante),
    claseDeTamanio(tamanio),
    variante === 'primario' ? 'luz-filo' : '',
    bloque ? estilos.botonBloque : '',
    extra ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * ⚠️ ES UNA CONSTANTE, NO UN COMPONENTE. Se usa identica en `Boton` y en
 * `BotonEnlace`; declararla dos veces es la forma en que dentro de seis meses
 * una queda con `strokeWidth` 2 y la otra con 1.5.
 */
const FLECHA = (
  <svg
    className={estilos.botonFlecha}
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 12h15m-6-7 7 7-7 7" />
  </svg>
);

export function Boton({
  variante = 'primario',
  tamanio = 'medio',
  bloque = false,
  cargando = false,
  icono,
  flecha = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  BaseBoton & {
    /**
     * ⚠️ NO ALCANZA CON DESHABILITAR. Un boton que se apaga y no dice nada mas
     * deja a quien no ve la pantalla sin saber si paso algo. `cargando` pone
     * ademas `aria-busy` y un girador, y bloquea el segundo clic —que sin esto
     * manda dos altas o dos pagos—.
     */
    cargando?: boolean;
  }) {
  return (
    <button
      /*
       * ⚠️ EL SPREAD VA PRIMERO Y `disabled` DESPUES, Y ES UN ARREGLO. Al reves
       * —como estaba— un `disabled={false}` explicito del llamador PISABA al
       * `cargando`, o sea que el boton seguia apretable mientras decia estar
       * trabajando: exactamente el doble pago que este componente existe para
       * evitar. `aria-busy` cae de vuelta en el del llamador para no borrarlo.
       */
      {...props}
      className={clasesDeBoton({ variante, tamanio, bloque }, className)}
      disabled={cargando || props.disabled === true}
      aria-busy={cargando ? true : props['aria-busy']}
    >
      {cargando ? <span className={estilos.girador} aria-hidden="true" /> : icono}
      {children}
      {flecha && !cargando ? FLECHA : null}
    </button>
  );
}

/**
 * Enlace con aspecto de boton. Es un enlace, no un boton: NAVEGA.
 *
 * ⚠️ USA `next/link` PARA RUTAS INTERNAS. Renderiza igual un `<a href>`, asi
 * que sin JavaScript el navegador navega como siempre; con JavaScript no
 * recarga la pagina entera —hoy cada clic en el sitio tira abajo el documento
 * y lo vuelve a construir—. Las URLs externas —Mercado Pago— siguen siendo un
 * `<a>` comun: `Link` no aporta nada ahi y ademas prefetchearia un dominio
 * ajeno.
 */
export function BotonEnlace({
  href,
  variante = 'primario',
  tamanio = 'medio',
  bloque = false,
  icono,
  flecha = false,
  className,
  etiquetaAccesible,
  children,
}: BaseBoton & {
  href: string;
  className?: string;
  /**
   * Texto para lectores de pantalla cuando el contenido visible no alcanza.
   *
   * ⚠️ NO SE ACEPTA `...props` DE `<a>` A PROPOSITO. Reenviar todos los
   * atributos de un ancla obliga a que `Link` los acepte con `undefined`
   * incluido, y con `exactOptionalPropertyTypes` —que este repo tiene
   * encendido— eso no compila. Ademas, una superficie chica y explicita evita
   * que alguien le pase `target="_blank"` a un enlace interno.
   */
  etiquetaAccesible?: string;
  children: ReactNode;
}) {
  const clases = clasesDeBoton({ variante, tamanio, bloque }, className);
  const contenido = (
    <>
      {icono}
      {children}
      {flecha ? FLECHA : null}
    </>
  );

  if (!href.startsWith('/')) {
    return (
      <a href={href} className={clases} rel="noreferrer" aria-label={etiquetaAccesible}>
        {contenido}
      </a>
    );
  }

  return (
    <Link href={href} className={clases} aria-label={etiquetaAccesible}>
      {contenido}
    </Link>
  );
}

/* -------------------------------------------------------------- etiquetas */

/**
 * ⚠️ EL TONO ES SEMANTICO, NO DECORATIVO. Cada uno dice algo distinto y por eso
 * hay cuatro y no una paleta suelta:
 *
 *   neutro   dato del producto: talle, condicion, tipo de camiseta
 *   marca    algo que Offside afirma: publicacion activa, cuenta habilitada
 *   alerta   algo en riesgo o por terminarse: ultima unidad, pausada, cancelada
 *   exito    algo que se completo: pagada, entregada
 *
 * ⚠️ EL COLOR NUNCA VA SOLO, Y AHORA TAMPOCO LA FORMA: los tres tonos de ESTADO
 * llevan un rombo adelante y el de dato no lleva ninguno. Quien no distingue
 * verde de naranja ve igual cuales son estados, y el texto ya lo dice.
 *
 * ⚠️ EL TEXTO DE `alerta` NO USA `--color-naranja`. Ese naranja sobre fondo
 * claro da 2.16:1 —ilegible—; se usa `--color-alerta`, el mismo matiz
 * oscurecido hasta 4.88:1. El naranja vivo queda para el rombo y el borde, que
 * son forma y no informacion.
 */
export type TonoEtiqueta = 'neutro' | 'marca' | 'alerta' | 'exito';

export function Etiqueta({
  tono = 'neutro',
  pulso = false,
  animada = false,
  children,
}: {
  tono?: TonoEtiqueta;
  /**
   * Un anillo que late tres veces al cargar y para solo.
   *
   * ⚠️ SOLO PARA LO QUE CADUCA —"Última unidad"—, NUNCA PARA UN ESTADO ESTABLE.
   * Si latieran "Activa" y "Pagada", la vitrina entera parpadearia y el pulso
   * dejaria de significar nada. Y no puede ser la unica forma de enterarse: el
   * texto y el color ya lo dicen, esto solo ayuda a ENCONTRARLA en una grilla
   * de veinte fichas. Para en 4.8s porque WCAG 2.2.2 exige poder detener
   * cualquier movimiento de mas de cinco segundos.
   */
  pulso?: boolean;
  /**
   * La etiqueta entra marcandose, una sola vez.
   *
   * ⚠️ ES PARA CUANDO LA ETIQUETA ACABA DE CAMBIAR por una accion de la
   * persona: pausar una publicacion, reactivarla, emitir un reembolso. En una
   * lista que se renderiza tal cual no se enciende, o todo se marca y marcarse
   * deja de querer decir algo.
   */
  animada?: boolean;
  children: ReactNode;
}) {
  const clase =
    tono === 'marca'
      ? estilos.etiquetaMarca
      : tono === 'alerta'
        ? estilos.etiquetaAlerta
        : tono === 'exito'
          ? estilos.etiquetaExito
          : estilos.etiquetaNeutra;

  return (
    <span
      className={[
        estilos.etiqueta,
        clase,
        pulso ? 'pulso-atencion' : '',
        animada ? 'estado-entra' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- avisos */

export type TonoAviso = 'neutro' | 'error' | 'exito';

/**
 * Aviso al usuario.
 *
 * ⚠️ `role="alert"` cuando es un error: hace que los lectores de pantalla lo
 * anuncien al aparecer. Sin eso, alguien que no ve la pantalla no se entera de
 * que su formulario fallo.
 *
 * ⚠️ EL EXITO NO USA `role="alert"`, USA `role="status"`. "alert" interrumpe lo
 * que el lector este diciendo: para un error es exactamente lo que hace falta,
 * para una confirmacion es una groseria.
 */
export function Aviso({ tono = 'neutro', children }: { tono?: TonoAviso; children: ReactNode }) {
  const clase =
    tono === 'error'
      ? estilos.avisoError
      : tono === 'exito'
        ? estilos.avisoExito
        : estilos.avisoNeutro;

  /**
   * ⚠️ EL ERROR ENTRA DISTINTO Y MAS CORTO QUE TODO LO DEMAS. `entra-seco` son
   * 140ms de pura opacidad. Un aviso de error que se desliza durante medio
   * segundo se lee como un susto, y este ya interrumpe con `role="alert"`.
   */
  const entrada = tono === 'error' ? 'entra-seco' : 'entra-acerca-corto';

  return (
    <p
      className={[estilos.aviso, clase, entrada].filter(Boolean).join(' ')}
      role={tono === 'error' ? 'alert' : tono === 'exito' ? 'status' : undefined}
    >
      {children}
    </p>
  );
}

/* ------------------------------------------------------------ estructura */

export type AnchoContenedor = 'contenido' | 'medio' | 'angosto' | 'formulario';

/**
 * Contenedor de pagina.
 *
 * ⚠️ EXISTE PORQUE ESTABA REPETIDO SIETE VECES. `max-width` + `margin: 0 auto`
 * + el mismo padding aparecia copiado en `page.module.css`, `buscar`,
 * `vendedor.module.css`, `admin.module.css`, `resumen.module.css` y
 * `form.module.css`, cada uno con su ancho escrito a mano. Nadie podia saber
 * si dos pantallas median lo mismo a proposito o de casualidad.
 */
export function Contenedor({
  ancho = 'contenido',
  vertical = false,
  className,
  children,
}: {
  ancho?: AnchoContenedor;
  /** Agrega el aire vertical de una pantalla suelta: errores, 404, avisos. */
  vertical?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const clase =
    ancho === 'medio'
      ? estilos.contenedorMedio
      : ancho === 'angosto'
        ? estilos.contenedorAngosto
        : ancho === 'formulario'
          ? estilos.contenedorFormulario
          : estilos.contenedorAncho;

  return (
    <div
      className={[estilos.contenedor, clase, vertical ? estilos.contenedorVertical : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

/**
 * Fila de acciones.
 *
 * ⚠️ EXISTE PORQUE LOS BOTONES SE APILABAN. Dentro de un estado vacio —que es
 * una columna centrada— dos botones uno debajo del otro se leen como dos pasos
 * de un proceso, no como dos alternativas. Envuelve en telefono, donde apilarse
 * si es lo correcto.
 */
export function FilaDeAcciones({
  centrada = true,
  children,
}: {
  centrada?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={[estilos.fila, centrada ? estilos.filaCentrada : ''].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

/**
 * Superficie de vidrio con borde. La tarjeta generica que cada modulo redefinia.
 *
 * ⚠️ ES DE VIDRIO (`backdrop-filter`) Y POR ESO NO VA EN UNA GRILLA: cada
 * vidrio recompone lo que tiene detras en cada cuadro de scroll, y el techo son
 * ~6 visibles a la vez. Una grilla de fichas es `.sup-ficha` + `.eleva`.
 */
export function Tarjeta({
  interactiva = false,
  className,
  children,
}: {
  /**
   * La tarjeta responde al puntero y al foco: se eleva 6px con glow, se
   * inclina hacia el cursor (`tilt`, solo con puntero fino) y la cruza un
   * destello.
   *
   * ⚠️ SOLO SI DE VERDAD SE PUEDE TOCAR. Una tarjeta que se levanta al pasar el
   * mouse y no lleva a ningun lado promete un enlace que no existe. Y el hover
   * nunca puede ser la unica señal de que algo es interactivo: en un telefono
   * no existe el hover.
   */
  interactiva?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={[
        estilos.tarjeta,
        interactiva ? `${estilos.tarjetaInteractiva} eleva tilt destello` : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------- estados vacios */

/**
 * ⚠️ UN ESTADO VACIO SIN SALIDA ES UN CALLEJON. Antes solo tenia titulo y
 * texto; ahora acepta un icono de la identidad y una accion, porque decirle a
 * alguien "no hay nada" sin ofrecerle el proximo paso lo deja mirando una caja
 * punteada.
 */
export function EstadoVacio({
  titulo,
  icono,
  como = 'p',
  children,
}: {
  titulo: string;
  icono?: ReactNode;
  /**
   * Que elemento es el titulo.
   *
   * ⚠️ POR DEFECTO ES UN `<p>` Y ESO ESTA BIEN: un estado vacio dentro de una
   * pantalla que ya tiene su `h1` no debe agregar otro encabezado, o el indice
   * de encabezados —por donde navega quien usa lector de pantalla— se llena de
   * titulos falsos.
   *
   * ⚠️ PERO EN CINCO PANTALLAS EL ESTADO VACIO ES *TODO* EL CONTENIDO
   * —verificar-email en sus tres ramas, revisa-tu-email, restablecer-password,
   * 404 y error—, y ahi tiene que ser `h1`: hasta ahora esas pantallas no
   * tenian NINGUN encabezado. Con lector de pantalla no habia forma de saber
   * en que pagina se estaba parado, y el atajo "ir al titulo" no llevaba a
   * ninguna parte.
   */
  como?: 'h1' | 'h2' | 'p';
  children?: ReactNode;
}) {
  const Titulo = como;

  /*
   * ⚠️ `escena-luz` VA EN EL MISMO ELEMENTO QUE LOS BLOBS, Y NO ES DECORACION:
   * es lo que fija el presupuesto de luz de una tarjeta clara (verde-400 0.16 /
   * Cambio 0.55) JUNTO con los remapeos de texto que ese presupuesto exige
   * —tenue, alerta, borde de control—, medidos en `tokens.css`. Blobs sin
   * `escena-luz` serian un lavado invisible; `escena-luz` sin sus remapeos
   * seria texto debajo de AA. Adentro de un pliego oscuro, `ui.module.css`
   * baja el presupuesto al de noche.
   *
   * ⚠️ EL ICONO ENTRA CON ESCALA Y OVERSHOOT (`aparece-escala`) y el titulo
   * lleva el gradiente de titular, que aguanta cualquier tamaño (5.16:1).
   */
  return (
    <div className={`${estilos.vacio} escena-luz`}>
      {BLOBS}
      {icono !== undefined && (
        <span className={`${estilos.vacioIcono} aparece-escala`} aria-hidden="true">
          {icono}
        </span>
      )}
      <Titulo className={`${estilos.vacioTitulo} titular-degradado`}>{titulo}</Titulo>
      {children !== undefined && <div className={estilos.vacioCuerpo}>{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------ esqueletos */

/**
 * Bloque de carga.
 *
 * ⚠️ TODAS LAS PANTALLAS SON `force-dynamic`: no hay nada en pantalla hasta que
 * el servidor responde. Sin un esqueleto, navegar se siente como que el sitio
 * se colgo —el navegador se queda en la pagina anterior y aparentemente no
 * pasa nada—.
 *
 * ⚠️ SE COMPONE LA CLASE **GLOBAL** `esqueleto`, QUE ES LA QUE TRAE EL SHIMMER.
 * Una copia local con su propio keyframe queda fuera de la red de seguridad de
 * `prefers-reduced-motion` de `movimiento.css` —que lista
 * `.esqueleto::after { animation: none }`, y ese selector nunca va a matchear
 * una clase hasheada de CSS Module—. El modulo aporta solo la forma.
 *
 * ⚠️ `aria-hidden`: es un dibujo, no informacion. Quien usa un lector de
 * pantalla no necesita que le describan tres rectangulos grises; necesita el
 * `aria-busy` de la region que los contiene.
 */
export function Esqueleto({
  alto = 16,
  ancho = '100%',
  className,
}: {
  alto?: number | string;
  ancho?: number | string;
  className?: string;
}) {
  return (
    <span
      className={['esqueleto', estilos.esqueleto, className].filter(Boolean).join(' ')}
      style={{ height: typeof alto === 'number' ? `${alto}px` : alto, width: ancho }}
      aria-hidden="true"
    />
  );
}

/* ------------------------------------------------------------ migas de pan */

export interface Miga {
  texto: string;
  /** Sin `href` es el eslabon actual: no es enlace y no se resalta. */
  href?: string;
}

/**
 * Migas de pan.
 *
 * ⚠️ EL SEPARADOR ES CSS, NO UN CARACTER EN EL MARCADO. Un "/" escrito en el
 * HTML lo lee el lector de pantalla: "Catalogo barra Buscar barra Camiseta
 * River". Como `::before` no existe para el — y de paso es el rombo de la
 * bandera en vez de un caracter de teclado.
 *
 * ⚠️ EL SUBRAYADO SE COMPONE CON LA CLASE GLOBAL `subraya`, QUE LO DIBUJA CON
 * `background-size` Y NO CON UN `::after`. Una miga puede ser el titulo de una
 * publicacion y partirse en dos lineas: un pseudo subraya el RECTANGULO del
 * enlace, asi que la raya cruzaria el aire a la derecha de la primera linea.
 *
 * ⚠️ LOS ENLACES MARCAN `retrocede`: una miga siempre va hacia arriba en la
 * jerarquia, asi que la pantalla de destino entra desde la izquierda.
 */
export function Migas({ items }: { items: Miga[] }) {
  return (
    <nav className={estilos.migas} aria-label="Migas de pan">
      <ol className={estilos.migasLista}>
        {items.map((item) =>
          item.href === undefined ? (
            <li key={item.texto} aria-current="page">
              {item.texto}
            </li>
          ) : (
            <li key={item.texto}>
              <Link href={item.href} className="subraya" transitionTypes={['retrocede']}>
                {item.texto}
              </Link>
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}

/* --------------------------------------------------------------- seccion */

/**
 * Encabezado de seccion: titulo a la izquierda, dato o accion a la derecha,
 * compartiendo linea de base.
 *
 * ⚠️ EXISTE PORQUE ESTABA REPETIDO. La vitrina, el inventario del vendedor, las
 * ventas y la consola de pagos arman el mismo bloque —un `h2` en mayusculas, a
 * veces un conteo, a veces un boton— cada una con su propio CSS.
 */
export function Seccion({
  titulo,
  dato,
  accion,
  children,
}: {
  titulo: string;
  /** Un conteo, una fecha, un total. Va en tono secundario. */
  dato?: string;
  /** Un boton o un enlace. Va al extremo derecho. */
  accion?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className={estilos.seccion}>
      <div className={estilos.seccionEncabezado}>
        {/*
         * ⚠️ `titular-degradado` ELIGE EL DEGRADADO POR SUPERFICIE: tinta →
         * cancha sobre claro (peor stop 5.16:1, vale a cualquier tamaño) y
         * papel → Cambio adentro de un pliego oscuro o de marca.
         */}
        <h2 className={`${estilos.seccionTitulo} titular-degradado`}>{titulo}</h2>
        {dato !== undefined && <p className={estilos.seccionDato}>{dato}</p>}
        {accion !== undefined && <div className={estilos.seccionAccion}>{accion}</div>}
      </div>
      {children}
    </section>
  );
}

/* ----------------------------------------------------------- fila de datos */

/**
 * Concepto a la izquierda, valor a la derecha.
 *
 * ⚠️ ES LA TABLA DE ESTE SISTEMA. Este par —`.linea` + `.concepto`— estaba
 * triplicado identico en `resumen.module.css`, `vendedor.module.css` y
 * `admin.module.css`.
 *
 * ⚠️ EL VALOR USA CIFRAS TABULARES. Sin eso, dos importes en filas consecutivas
 * no alinean sus comas y una lista de precios se lee como un desorden.
 */
export function FilaDeDatos({
  concepto,
  destacada = false,
  children,
}: {
  concepto: string;
  /** El total de un resumen: filete de la identidad arriba y tipografia de titular. */
  destacada?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={[estilos.fila2, destacada ? estilos.filaTotal : ''].filter(Boolean).join(' ')}>
      <span className={estilos.filaConcepto}>{concepto}</span>
      <span className={estilos.filaValor}>
        {/*
         * ⚠️ EL TOTAL PUEDE ENTRAR, NUNCA PUEDE ESTAR EN MOVIMIENTO.
         * `cifra-entra` lo levanta UNA VEZ detras de su mascara mostrando el
         * valor FINAL desde el primer cuadro. Nada de contar hacia arriba: es
         * la plata que la persona esta por transferirle a un desconocido.
         *
         * ⚠️ LAS FILAS NO DESTACADAS NO SE ANIMAN: si se animaran las cinco
         * lineas de un resumen, el total dejaria de destacarse.
         */}
        {destacada ? (
          <span className={`cifra-entra ${estilos.mascaraCifra}`}>
            <span>{children}</span>
          </span>
        ) : (
          children
        )}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- pasos */

export interface Paso {
  titulo: string;
  detalle?: string;
  hecho: boolean;
  /** Contenido que aparece SOLO si el paso esta pendiente: el boton que lo cierra. */
  accion?: ReactNode;
}

/**
 * Progreso por pasos, dibujado como LINEA DE TIEMPO.
 *
 * ⚠️ EL ESTADO SE COMUNICA CON TEXTO Y CON FORMA, NUNCA SOLO CON COLOR. El
 * marcador hecho es un rombo LLENO y el pendiente uno HUECO —diferencia de
 * forma, no de color—, y ademas el titulo escribe "listo" o "pendiente" con
 * todas las letras. Por eso el pendiente ya no lleva glifo: un `○` adentro de
 * un rombo era ruido puro.
 *
 * ⚠️ LA BARRA DE PROGRESO ES DECORATIVA (`aria-hidden`): el conteo "2 de 3" que
 * va al lado es la version accesible del mismo dato, y duplicarlo haria que un
 * lector de pantalla lo diga dos veces.
 */
export function Pasos({ pasos, etiqueta }: { pasos: Paso[]; etiqueta?: string }) {
  const hechos = pasos.filter((paso) => paso.hecho).length;

  return (
    <div className={estilos.pasos}>
      <div className={estilos.pasosCabecera}>
        <p className={estilos.pasosCuenta}>
          {etiqueta === undefined ? '' : `${etiqueta}: `}
          {hechos} de {pasos.length}
        </p>
        <div className={estilos.pasosBarra} aria-hidden="true">
          {/*
           * ⚠️ EL PROGRESO LLEGA YA CALCULADO DESDE EL SERVIDOR, asi que la
           * `transition` que habia aca NO SE DISPARABA NUNCA y la barra
           * aparecia entera y quieta. Ahora la dibuja un keyframe declarado
           * SIN `to`, cuyo valor final es este mismo `scaleX`.
           */}
          <span
            className={estilos.pasosBarraLlena}
            style={{ transform: `scaleX(${pasos.length === 0 ? 0 : hechos / pasos.length})` }}
          />
        </div>
      </div>

      {/*
       * ⚠️ `escalona escalona-lado`: cada paso entra de costado con luz, uno
       * detras del otro, y el riel del paso hecho se enciende 200ms despues de
       * que su `<li>` llego. Los `nth-child` de `.escalona` asignan `--i` con
       * los mismos valores que usa el riel, asi que no se pelean.
       */}
      <ol className={`${estilos.pasosLista} escalona escalona-lado`}>
        {pasos.map((paso) => (
          <li
            key={paso.titulo}
            className={[estilos.paso2, paso.hecho ? estilos.pasoHecho : '']
              .filter(Boolean)
              .join(' ')}
          >
            <span className={estilos.pasoMarca} aria-hidden="true">
              {paso.hecho ? '✓' : ''}
            </span>
            <div className={estilos.pasoCuerpo2}>
              <p className={estilos.pasoTitulo2}>
                {paso.titulo} — {paso.hecho ? 'listo' : 'pendiente'}
              </p>
              {paso.detalle !== undefined && <p className={estilos.pasoDetalle2}>{paso.detalle}</p>}
              {!paso.hecho && paso.accion}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------- confirmar */

/**
 * Confirmacion en dos pasos para una accion destructiva.
 *
 * ⚠️ NO USA `window.confirm` NI UN MODAL CON ESTADO. Es un `<details>`: el
 * navegador lo abre y lo cierra solo, responde a Enter y a Espacio, y anuncia
 * expandido/contraido sin una linea de `aria`. Sin JavaScript funciona igual,
 * que es la regla de este proyecto — y `window.confirm` directamente no
 * existiria.
 *
 * ⚠️ EL PRIMER CLIC NO EJECUTA NADA: abre. El boton real vive adentro. Eliminar
 * una publicacion y emitir un reembolso son irreversibles, y hasta ahora
 * pasaban con un solo clic.
 *
 * ⚠️ LA ALTURA LA ANIMA LA CLASE GLOBAL `desplegable` (via `::details-content` +
 * `interpolate-size`), no un fade local. Es la unica animacion del sistema que
 * toca el layout y esta permitida porque su proposito ES el layout: la altura es
 * la informacion. Sin soporte del navegador el panel abre de golpe, que es lo
 * que hace un `<details>` por defecto.
 */
export function Confirmar({
  etiqueta,
  pregunta,
  children,
}: {
  /** Lo que dice el disparador. Ej: "Eliminar". */
  etiqueta: string;
  /** Que consecuencia tiene. Se lee ANTES de decidir. */
  pregunta: string;
  /** El control que ejecuta de verdad: normalmente un `<Formulario>`. */
  children: ReactNode;
}) {
  return (
    <details className={`${estilos.confirmar} desplegable`}>
      <summary className={estilos.confirmarDisparador}>{etiqueta}</summary>
      <div className={estilos.confirmarPanel}>
        <p className={estilos.confirmarPregunta}>{pregunta}</p>
        {children}
      </div>
    </details>
  );
}

/* --------------------------------------------------------------- pastilla */

/**
 * Pastilla que se saca tocandola: un filtro aplicado, una etiqueta que se
 * puede quitar.
 *
 * ⚠️ ES UNA PASTILLA DE VERDAD (`--radio-pastilla`) Y BRILLA AL PASAR EL
 * MOUSE: algo que se saca tocandolo se reconoce por su silueta antes que por
 * su texto, y el halo dice "esto responde" antes de leer la descripcion.
 */
export function Pastilla({
  href,
  descripcion,
  children,
}: {
  href: string;
  /** Que hace al tocarla, para lectores de pantalla. */
  descripcion: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={estilos.pastilla}>
      <span>{children}</span>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="m5.5 5.5 13 13M18.5 5.5l-13 13" />
      </svg>
      <span className="solo-lectores">{descripcion}</span>
    </Link>
  );
}

/* ----------------------------------------------------------------- tabla */

/**
 * Tabla de datos.
 *
 * ⚠️ EL CONTENEDOR TIENE SCROLL HORIZONTAL PROPIO. Una tabla de ventas con seis
 * columnas no entra en un telefono, y sin esto el que scrollea de costado es el
 * documento entero: la barra superior se corre, el pie se corre, y el sitio
 * parece roto. Con `overflow-x` acotado, se mueve la tabla y nada mas.
 *
 * ⚠️ `<caption>` NO ES DECORACION. Es lo que un lector de pantalla anuncia al
 * entrar a la tabla; sin el, la persona escucha una grilla de numeros sin saber
 * de que son. Se oculta a la vista con `.solo-lectores` cuando el titulo ya
 * esta arriba.
 */
export function Tabla({
  titulo,
  tituloVisible = false,
  children,
}: {
  titulo: string;
  tituloVisible?: boolean;
  children: ReactNode;
}) {
  return (
    /*
     * ⚠️ `tabIndex={0}` NO ES OPCIONAL EN UNA REGION QUE SCROLLEA (WCAG 2.1.1).
     * Sin el, el unico modo de ver las columnas de la derecha es arrastrar con
     * el mouse, y ahi viven los importes de /vendedor/ventas y /admin/pagos. Con
     * `role="region"` + `aria-label` el lector de pantalla ademas dice de que
     * tabla se trata al entrar, en vez de anunciar un grupo sin nombre.
     */
    <div className={estilos.tablaMarco} tabIndex={0} role="region" aria-label={titulo}>
      <table className={estilos.tabla}>
        <caption className={tituloVisible ? estilos.tablaTitulo : 'solo-lectores'}>
          {titulo}
        </caption>
        {children}
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ pasos breves */

/**
 * Progreso horizontal de un flujo corto: alta de cuenta, compra.
 *
 * ⚠️ NO ES EL MISMO COMPONENTE QUE `Pasos`. Aquel es un checklist —los pasos se
 * completan en cualquier orden y cada uno tiene su accion—; este es una
 * SECUENCIA, donde importa en cual estas y cuantos faltan. Mezclarlos daria un
 * componente con la mitad de las props apagadas en cada uso.
 *
 * ⚠️ `aria-current="step"` ES LO QUE HACE QUE FUNCIONE SIN VER LA PANTALLA. Sin
 * eso, un lector de pantalla lee tres textos sueltos y ninguna señal de en cual
 * esta parada la persona.
 */
export function PasosBreves({ pasos, actual }: { pasos: string[]; actual: number }) {
  return (
    <nav className={estilos.pasosBreves} aria-label="Progreso">
      <ol className={estilos.pasosBrevesLista}>
        {pasos.map((paso, indice) => {
          const numero = indice + 1;
          const estado = numero < actual ? 'hecho' : numero === actual ? 'actual' : 'pendiente';

          return (
            <li
              key={paso}
              className={
                estado === 'hecho'
                  ? estilos.pasoBreveHecho
                  : estado === 'actual'
                    ? estilos.pasoBreveActual
                    : estilos.pasoBreve
              }
              aria-current={estado === 'actual' ? 'step' : undefined}
            >
              <span className={estilos.pasoBreveNumero} aria-hidden="true">
                {estado === 'hecho' ? '✓' : numero}
              </span>
              <span className={estilos.pasoBreveTexto}>{paso}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------------------------------------------------------------- panel */

export type TonoPanel = 'neutro' | 'exito' | 'alerta';

/**
 * Panel de mensaje: una confirmacion, un aviso grande, un callejon con salida.
 *
 * ⚠️ NO ES `EstadoVacio`, Y LA DIFERENCIA IMPORTA. Un estado vacio dice "acá no
 * hay nada"; un panel dice "pasó esto". Se venian usando indistintamente, asi
 * que "¡Listo! Tu email está verificado" —el mejor momento del alta— aparecia
 * dentro de una caja de borde punteado, que es el lenguaje visual de un hueco.
 * Por eso el panel FLOTA y el estado vacio APOYA: la elevacion dice cual de los
 * dos es un hecho recien ocurrido.
 *
 * ⚠️ ENTRA CON `entra-acerca`, QUE ES UNA ANIMACION DE RELOJ Y NO DE SCROLL.
 * `Panel` es SIEMPRE el contenido entero de su pantalla y ya esta arriba del
 * pliegue cuando la pagina pinta: un revelado por scroll ahi no correria nunca.
 */
export function Panel({
  titulo,
  tono = 'neutro',
  icono,
  children,
}: {
  titulo: string;
  tono?: TonoPanel;
  icono?: ReactNode;
  children?: ReactNode;
}) {
  const clase =
    tono === 'exito' ? estilos.panelExito : tono === 'alerta' ? estilos.panelAlerta : '';

  /*
   * ⚠️ EL ICONO Y EL TITULO ANIMAN EN SUS PROPIOS ELEMENTOS, no en el panel:
   * `animation` es un shorthand y dos clases sobre el mismo elemento se pisan.
   * El icono aparece con escala y overshoot; el titulo surge con luz y lo
   * cruza una banda una sola vez (`shimmer-titulo`), con el gradiente vivo que
   * `--display-3` (≥30px) habilita. `titular-vivo` elige solo por superficie.
   */
  return (
    <div className={[estilos.panel, clase, 'entra-acerca'].filter(Boolean).join(' ')}>
      {icono !== undefined && (
        <span className={`${estilos.panelIcono} aparece-escala`} aria-hidden="true">
          {icono}
        </span>
      )}
      <h1 className={`${estilos.panelTitulo} shimmer-titulo titular-vivo`}>{titulo}</h1>
      {children !== undefined && <div className={estilos.panelCuerpo}>{children}</div>}
    </div>
  );
}

/**
 * Celda de numero dentro de una `Tabla`.
 *
 * ⚠️ EXISTE PORQUE LA CLASE NO SE PUEDE COMPARTIR. `.tabla .numero` vive en
 * `ui.module.css`, que es un CSS Module: el nombre se hashea al compilar. Una
 * pantalla que importa `admin.module.css` no tiene forma de escribir esa clase,
 * asi que la alineacion a la derecha y las cifras tabulares —que es lo que hace
 * que una columna de importes se pueda leer— quedaban fuera de alcance. Se
 * expone como componente en vez de como string.
 */
export function CeldaNumero({ children }: { children: ReactNode }) {
  return <td className={estilos.numero}>{children}</td>;
}

export function EncabezadoNumero({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className={estilos.numero}>
      {children}
    </th>
  );
}

/* ---------------------------------------------------------- nav de seccion */

export interface ItemDeSeccion {
  clave: string;
  texto: string;
  href: string;
  /** Un numero al lado del nombre: cuantas publicaciones, cuantas ventas. */
  dato?: number;
}

/**
 * Navegacion interna de una seccion: el panel del vendedor, el back-office.
 *
 * ⚠️ EL ITEM ACTIVO LO DICE LA PANTALLA, NO EL COMPONENTE. Saberlo solo
 * requiere `usePathname`, que es un hook: convertiria esta barra —y con ella el
 * layout entero— en Client Component, para resolver algo que la pantalla ya
 * sabe de si misma. Se pasa como prop y listo.
 *
 * ⚠️ EL ACTIVO SE MARCA CON `aria-current="page"`, no solo con color. Es lo que
 * le dice a un lector de pantalla en que seccion esta parada la persona.
 */
export function NavDeSeccion({
  items,
  activo,
  etiqueta,
}: {
  items: ItemDeSeccion[];
  activo: string;
  etiqueta: string;
}) {
  return (
    <nav className={estilos.navSeccion} aria-label={etiqueta}>
      <ul className={estilos.navSeccionLista}>
        {items.map((item) => {
          const esActivo = item.clave === activo;

          return (
            <li key={item.clave}>
              <Link
                href={item.href}
                className={esActivo ? estilos.navSeccionActivo : estilos.navSeccionItem}
                aria-current={esActivo ? 'page' : undefined}
              >
                {item.texto}
                {item.dato !== undefined && item.dato > 0 && (
                  <span className={estilos.navSeccionDato}>{item.dato}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ----------------------------------------------------------------- cifras */

export interface Cifra {
  valor: string;
  etiqueta: string;
  /**
   * Una linea corta de contexto debajo del numero.
   *
   * ⚠️ `| undefined` EXPLICITO: con `exactOptionalPropertyTypes` un opcional NO
   * acepta que le pasen `undefined` a proposito, y quien arma la lista lo hace
   * con un ternario.
   */
  detalle?: string | undefined;
}

/**
 * Fila de numeros para un panel.
 *
 * ⚠️ EL NUMERO VA EN LA TIPOGRAFIA DE TITULARES. Es la unica parte del sistema,
 * ademas del precio, donde un numero es el contenido y no un dato al costado —y
 * la identidad asigna Big Noodle justamente a "titulares, precios, numeros de
 * camiseta"—.
 *
 * ⚠️ NO SE ANIMA EL CONTEO. Un numero que sube desde cero es un efecto de
 * dashboard: en un panel donde ese numero son ventas reales, tarda mas en poder
 * leerse y no aporta nada. Lo unico permitido es que ENTRE una vez, mostrando
 * el valor final desde el primer cuadro.
 */
export function Cifras({
  cifras,
  quietas = false,
}: {
  cifras: Cifra[];
  /**
   * Sin entrada animada del numero.
   *
   * ⚠️ ES PARA EL BACK-OFFICE. La consola de pagos y la pantalla de comision
   * son herramientas de operaciones: ahi cada milisegundo de animacion es un
   * milisegundo esperando para leer un dato, y quien las usa las abre veinte
   * veces por dia.
   */
  quietas?: boolean;
}) {
  return (
    <dl className={estilos.cifras}>
      {cifras.map((cifra) => (
        /*
         * ⚠️ `<dt>` ANTES DE `<dd>`, Y EL DETALLE ADENTRO DEL `<dd>`. Dentro de
         * un `<dl>`, un `<div>` solo puede contener `<dt>` seguidos de `<dd>`:
         * el orden invertido de antes y el `<p>` suelto eran marcado invalido,
         * que algunos lectores de pantalla directamente no emparejan. El orden
         * VISUAL —etiqueta chiquita, numero grande, detalle— ahora coincide con
         * el del DOM, asi que no hace falta reordenar con CSS.
         */
        <div key={cifra.etiqueta} className={estilos.cifra}>
          <dt className={estilos.cifraEtiqueta}>{cifra.etiqueta}</dt>
          <dd className={estilos.cifraValor}>
            {/*
             * ⚠️ EL IMPORTE PUEDE ENTRAR, NUNCA PUEDE ESTAR EN MOVIMIENTO. Nada
             * de contar hacia arriba: dos de las tres pantallas que usan esto
             * muestran plata ajena, y un numero que sube mientras alguien lo lee
             * se interpreta como un numero que todavia se esta calculando.
             */}
            {quietas ? (
              cifra.valor
            ) : (
              <span className={`cifra-entra ${estilos.mascaraCifra}`}>
                <span>{cifra.valor}</span>
              </span>
            )}
            {cifra.detalle !== undefined && (
              <span className={estilos.cifraDetalle}>{cifra.detalle}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ----------------------------------------------------------------- precio */

export type TamanioPrecio = 'ficha' | 'display';

/**
 * El precio de una publicacion.
 *
 * ⚠️ EL VALOR LLEGA YA FORMATEADO. Este componente NO llama a `precio()` ni
 * conoce centavos ni moneda: formatear plata es del dominio, y meterle
 * `Intl.NumberFormat` a una primitiva visual es la forma de que dentro de seis
 * meses haya dos redondeos distintos en el sitio.
 *
 * ⚠️ `animado` ESTA APAGADO POR DEFECTO Y ESO ES DELIBERADO. En una grilla de
 * veinticuatro fichas, veinticuatro importes levantandose a la vez al primer
 * pintado es ruido. Se enciende donde el precio ES la pantalla: la ficha de
 * producto, el resumen, el checkout. Y aun encendido entra UNA VEZ, mostrando
 * el valor final desde el primer cuadro y terminando quieto: un numero en
 * movimiento se lee como un numero que todavia no esta decidido.
 */
export function Precio({
  valor,
  tamanio = 'ficha',
  animado = false,
  className,
}: {
  valor: string;
  tamanio?: TamanioPrecio;
  animado?: boolean;
  className?: string;
}) {
  return (
    <p
      className={[
        estilos.precio,
        tamanio === 'display' ? estilos.precioDisplay : estilos.precioFicha,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {animado ? (
        <span className={`cifra-entra ${estilos.mascaraCifra}`}>
          <span>{valor}</span>
        </span>
      ) : (
        valor
      )}
    </p>
  );
}

/* ----------------------------------------------------------------- pliego */

export type SuperficiePliego = 'noche' | 'fosa' | 'cancha';

/**
 * Franja de pagina con superficie propia: un bloque oscuro o de marca que corta
 * el scroll y le da ritmo vertical al sitio.
 *
 * ⚠️ NO HAY VARIANTE OSCURA DE NINGUNA PRIMITIVA, Y ES A PROPOSITO. Las clases
 * `.sup-*` remapean `--superficie-1`, `--superficie-2`, `--linea-tenue`,
 * `--linea-control`, `--color-foco` y los ocho tokens de boton; todas las
 * primitivas de este archivo usan esos tokens y ninguna escribe `--color-blanco`
 * ni `--color-neutro-borde`. Consecuencia: cualquier cosa que se meta adentro de
 * un `<Pliego>` ya viene dada vuelta.
 *
 * ⚠️ EL PATRON VA EN UN HIJO Y NO EN LA MISMA CAJA. `.sup-noche::before` es el
 * filo de luz del borde superior y `.patron-vivo::before` son los rombos en
 * deriva: en el mismo elemento una pisa a la otra y se pierde el filo, que es lo
 * que hace que un bloque oscuro sea un objeto y no un rectangulo.
 *
 * ⚠️⚠️ Y ESE HIJO ES UNA CAPA VACIA, **NO EL ENVOLTORIO DEL CONTENIDO**. Es la
 * correccion que mas importa de este componente: `.patron-vivo` declara
 * `overflow: hidden` —lo necesita para esconder el mosaico de mas que hace que
 * la deriva no salte—, y `overflow: hidden` es un CONTENEDOR DE SCROLL. Colgado
 * del envoltorio del contenido rompia cuatro cosas a la vez y ninguna avisaba:
 * recortaba el `outline` de foco de lo que quedara contra el borde, mataba el
 * `position: sticky` de cualquier hijo, comia el `translateY(-4px)` del hover de
 * una ficha, y —la peor— dejaba sin correr toda animacion con
 * `animation-timeline: view()` de adentro, porque `view()` resuelve contra el
 * contenedor de scroll mas cercano. O sea que meter una grilla con `.revela-*`
 * en un `<Pliego patron>` la dejaba invisible o quieta sin un solo error. En una
 * capa hermana en `position: absolute`, el patron sigue cubriendo el pliego
 * entero —incluido el padding, que antes quedaba pelado— y el contenido no vive
 * adentro de ningun recorte.
 *
 * ⚠️ `corte` NO SE USA EN UN PLIEGO QUE CONTENGA UN `<details>` O ALGO PEGADO.
 * `clip-path` recorta tambien la sombra y cualquier hijo que se desborde, y
 * rompe el `position: sticky` de lo que tenga adentro. Es una franja editorial,
 * no un contenedor de controles.
 */
export function Pliego({
  superficie = 'noche',
  patron = false,
  corte = false,
  luz = true,
  flotante = false,
  className,
  children,
}: {
  superficie?: SuperficiePliego;
  /** Los rombos de la bandera derivando de fondo, muy apagados. */
  patron?: boolean;
  /** Corte diagonal en el borde inferior, en el eje del sistema. */
  corte?: boolean;
  /**
   * Blobs de luz flotando detras del contenido.
   *
   * ⚠️ ENCENDIDO POR DEFECTO, Y CUANTO SE VEN LO DECIDE LA SUPERFICIE, NO ESTA
   * PROP: `.sup-fosa` los deja en 0.14/0.08, `.sup-noche` en 0.04/0.02 y
   * `.sup-cancha` en cero, porque sobre Verde Cancha el texto tiene 0.10 de
   * aire y no hay luz que sumar. Los numeros estan en `tokens.css`. Se apaga
   * donde el bloque lleva su propia luz o donde el costo (tres capas de
   * compositor) no se justifica.
   *
   * ⚠️ SOBRE `cancha` NO SE RENDERIZAN AUNQUE ESTE EN `true`: el presupuesto es
   * cero por contrato, asi que serian tres capas de compositor animadas para
   * pintar exactamente nada. La prop se conserva para que el llamador no tenga
   * que saberlo.
   */
  luz?: boolean;
  /**
   * Panel redondeado y separado del canal, en vez de franja de borde a borde.
   *
   * ⚠️ NO SE COMBINA CON `corte`: `clip-path` y `border-radius` sobre el mismo
   * bloque se pisan y el resultado es un corte con esquinas raras.
   */
  flotante?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const claseSuperficie =
    superficie === 'cancha' ? 'sup-cancha' : superficie === 'fosa' ? 'sup-fosa' : 'sup-noche';

  /*
   * ⚠️ ORDEN DE LAS CAPAS: blobs, patron, contenido. Las dos capas vacias van
   * en `z-index: -1` dentro del contexto que `.sup-*` aisla, asi que pintan
   * arriba de la malla y debajo del contenido; entre ellas decide el orden del
   * arbol, y el patron va encima de la luz.
   */
  return (
    <section
      className={[
        estilos.pliego,
        flotante ? estilos.pliegoFlotante : '',
        corte ? estilos.pliegoCorte : '',
        claseSuperficie,
        'con-grano',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {luz && superficie !== 'cancha' && BLOBS}
      {patron && <span className={`${estilos.pliegoPatron} patron-vivo`} aria-hidden="true" />}
      <div className={estilos.pliegoInterior}>{children}</div>
    </section>
  );
}
