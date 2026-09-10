import type { CSSProperties, ReactNode } from 'react';

import { Logo } from './marca';

import estilos from './esqueletos.module.css';

/**
 * ESQUELETOS DE CARGA
 * =============================================================================
 *
 * ⚠️ POR QUE HACEN FALTA: todas las pantallas son `export const dynamic =
 * 'force-dynamic'`. El servidor arma el HTML en cada visita, consultando
 * PostgreSQL —y en la vitrina, tambien las portadas de todas las
 * publicaciones—. Hasta que esa respuesta llega, el navegador se queda en la
 * pagina ANTERIOR sin ninguna señal: la persona aprieta una camiseta, durante
 * medio segundo no pasa nada, y aprieta de nuevo.
 *
 * Un `loading.tsx` le da a Next un limite de Suspense para pintar mientras
 * tanto. No acelera nada; hace visible que el sitio esta trabajando, que es una
 * cosa distinta y a veces mas importante.
 *
 * ⚠️ VERSION LUMINOSA (2026-09-10): pastillas en vez de rectangulos, fichas con
 * el radio del sistema, sus lavados de luz y el anillo conico de la ficha real,
 * marco de foto con su punto de luz y el boton de comprar ya en verde con halo.
 * La barra fantasma es la misma ISLA de vidrio que la barra real. La forma
 * vive en `esqueletos.module.css`; aca solo se decide QUE se dibuja y en que
 * orden.
 *
 * ⚠️ EL BRILLO SALE DE LA CLASE GLOBAL `.esqueleto` (`app/movimiento.css`) Y NO
 * DE LA PRIMITIVA DE `ui`. La global mueve un pseudo con `transform` —una banda
 * verde y Amarillo Cambio con pico blanco, en el eje del sistema—, escalona el
 * brillo entre hermanos y vive adentro de `@media (prefers-reduced-motion:
 * no-preference)`: con movimiento reducido no queda ninguna animacion infinita
 * despertando al compositor.
 *
 * ⚠️ ESTOS BLOQUES CALCAN LA FORMA REAL. Cada medida de `esqueletos.module.css`
 * tiene al lado el archivo del que salio. Un esqueleto con proporciones
 * inventadas produce un salto al llegar el contenido, que es peor que no poner
 * nada.
 */

/**
 * La pastilla.
 *
 * ⚠️ `aria-hidden` SIEMPRE. Es un dibujo, no informacion: quien usa un lector
 * de pantalla no necesita que le describan doce rectangulos. Lo que necesita es
 * el anuncio de `Cargando`, que va una sola vez y en su propia region.
 */
function Barra({
  alto,
  ancho = '100%',
  className,
}: {
  alto: number | string;
  ancho?: number | string;
  /**
   * ⚠️ `| undefined` EXPLICITO Y NO ES REDUNDANTE. Con
   * `exactOptionalPropertyTypes` una prop `className?: string` NO acepta que le
   * pasen `undefined`, y con `noUncheckedIndexedAccess` un `estilos.loQueSea`
   * de un CSS Module ES `string | undefined` —el tipo que genera Next para
   * `*.module.css` es una firma de indice—. Sin esto, pasarle una clase del
   * propio modulo no compila.
   */
  className?: string | undefined;
}) {
  return (
    <span
      className={[estilos.barra, 'esqueleto', className].filter(Boolean).join(' ')}
      style={{
        height: typeof alto === 'number' ? `${alto}px` : alto,
        width: typeof ancho === 'number' ? `${ancho}px` : ancho,
      }}
      aria-hidden="true"
    />
  );
}

/* ========================================================== barra fantasma */

/**
 * Barra superior fantasma, para las tres pantallas publicas.
 *
 * ⚠️ LA MARCA VA DE VERDAD, NO COMO BLOQUE GRIS. El logo es presentacion pura
 * —no lee sesion, no consulta nada— asi que puede pintarse completo desde el
 * primer cuadro, con su halo. Dibujarlo como un rectangulo seria fingir que
 * falta algo que ya esta.
 *
 * ⚠️ LO QUE SI FALTA —el buscador y los enlaces— NO BRILLA. El brillo significa
 * "esto lo estamos trayendo", y la barra no se trae: se va a renderizar igual a
 * como esta dibujada. Ademas es lo unico estable de la pantalla mientras el
 * resto llega, y algo que titila no es un punto fijo.
 */
export function BarraFantasma() {
  return (
    <div className={estilos.barraFantasma} aria-hidden="true">
      <div className={estilos.barraFantasmaContenido}>
        <span className={estilos.barraFantasmaMarca}>
          <Logo invertido />
        </span>

        <span className={estilos.barraFantasmaBuscador} />

        <span className={estilos.barraFantasmaAcciones}>
          <span className={estilos.barraFantasmaEnlace} style={{ width: 74 }} />
          <span className={estilos.barraFantasmaEnlace} style={{ width: 58 }} />
          {/*
            "Crear cuenta" es una PASTILLA de 44px con borde de Cambio en la
            barra real, no texto: se dibuja con su forma o deja un hueco de
            31px que se llena de golpe al llegar la barra.
          */}
          <span className={estilos.barraFantasmaEnlaceDestacado} style={{ width: 132 }} />
        </span>

        <span className={estilos.barraFantasmaMenu} />
      </div>

      {/*
        La tira de diagonales del filo inferior. Son 6px que la barra real
        cuenta dentro de su padding: sin dibujarlos, el fantasma termina en un
        corte seco y al llegar la barra aparece un borde que no estaba. Va
        entre las dos esquinas redondeadas, como en la isla real.
      */}
      <span className={estilos.barraFantasmaCinta} />
    </div>
  );
}

/* ================================================================ vitrina */

/**
 * Una ficha de catalogo mientras carga. Calca `listing-card`: mismo fondo con
 * dos luces, misma sombra con halo verde debajo y el mismo anillo conico de
 * 1px en reposo —quieto: el de la real gira solo en hover—. Todo eso lo pone
 * `.ficha.ficha` en el modulo con especificidad (0,2,0), porque `.sup-ficha`
 * declara las mismas propiedades y el orden de inyeccion no esta garantizado.
 */
function FichaFantasma() {
  return (
    <li className={`${estilos.ficha} sup-ficha`}>
      <div className={`${estilos.marco} esqueleto`} aria-hidden="true" />

      <div className={estilos.cuerpo}>
        {/*
          ⚠️ EL PRECIO VA PRIMERO, COMO EN `listing-card.tsx`. Esa ficha lo subio
          arriba del titulo —en una grilla de marketplace el barrido es foto,
          precio, titulo— y el esqueleto que conserva el orden viejo hace que al
          llegar el contenido los dos bloques se intercambien de lugar.

          El alto viaja por `--alto-precio` porque el precio real CAMBIA de
          tamaño en el corte de 600px, igual que la grilla. La pastilla lleva un
          poco mas de Cambio: es el resaltador que la ficha real pone detras de
          la cifra.
        */}
        <Barra alto="var(--alto-precio)" ancho="46%" className={estilos.precio} />

        <span className={estilos.titulo}>
          <Barra alto={12} />
          <Barra alto={12} ancho="72%" />
        </span>

        {/*
          ⚠️ TALLE Y CONDICION SON TEXTO CORRIDO DE 12px, NO DOS PASTILLAS: la
          ficha real las saco de las `Etiqueta` con borde. Una pastilla mide
          25px y esta linea 16.8, o sea 8px de salto por ficha.
        */}
        <Barra alto="calc(1.4 * var(--texto-xs))" ancho="68%" className={estilos.metadatosTexto} />

        <span className={estilos.vendedor}>
          <Barra alto={12} ancho="58%" />
        </span>
      </div>
    </li>
  );
}

/**
 * Grilla de la vitrina y de la busqueda.
 *
 * ⚠️ OCHO FICHAS, NO LAS QUE VAYAN A VENIR. No se sabe cuantas hay hasta que
 * responde la base; ocho llenan una pantalla de escritorio sin dejar un hueco
 * enorme si al final hay tres.
 */
export function EsqueletoDeVitrina({
  fichas = 8,
  conEncabezado = true,
}: {
  fichas?: number;
  /** El rotulo y el titular que toda seccion del sitio lleva encima de la grilla. */
  conEncabezado?: boolean;
}) {
  return (
    <>
      {conEncabezado && (
        <div className={estilos.encabezado} aria-hidden="true">
          <Barra alto={12} ancho={110} />
          <Barra alto="var(--display-3)" ancho="52%" />
        </div>
      )}

      <ul className={estilos.grilla} aria-hidden="true">
        {Array.from({ length: fichas }, (_, indice) => (
          <FichaFantasma key={indice} />
        ))}
      </ul>
    </>
  );
}

/* ================================================================== texto */

/**
 * Bloque de texto: rotulo, titular, parrafo y —opcionalmente— un panel de
 * datos. Sirve para casi cualquier pantalla de (auth), (compra), (vendedor) y
 * (admin), que arrancan todas con el mismo par titulo/bajada.
 */
export function EsqueletoDeTexto({
  lineas = 3,
  tarjeta = false,
}: {
  lineas?: number;
  /** Agrega el panel de filas concepto/valor que cierra casi todas esas pantallas. */
  tarjeta?: boolean;
}) {
  return (
    <div className={estilos.texto} aria-hidden="true">
      <div className={estilos.encabezado}>
        <Barra alto={12} ancho={96} />
        <Barra alto="var(--display-3)" ancho="64%" />
      </div>

      <div className={estilos.parrafo}>
        {Array.from({ length: lineas }, (_, indice) => (
          <Barra key={indice} alto={13} ancho={indice === lineas - 1 ? '58%' : '100%'} />
        ))}
      </div>

      {tarjeta && (
        <div className={`${estilos.tarjeta} sup-ficha`}>
          {Array.from({ length: 3 }, (_, indice) => (
            <span key={indice} className={estilos.tarjetaFila}>
              <Barra alto={13} ancho={130} />
              <Barra alto={13} ancho={82} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ==================================================== ficha de publicacion */

/**
 * El detalle de una publicacion.
 *
 * ⚠️ ES LA PANTALLA DONDE MAS DUELE EL SALTO: se llega desde la vitrina con la
 * foto haciendo morph, asi que si el marco de la foto no mide lo mismo, la
 * imagen aterriza y despues se corre. La relacion 4/5 es la misma que en la
 * grilla, que es justamente lo que hace que el morph sea creible.
 *
 * ⚠️ `app/p/[id]/loading.tsx` hoy dibuja su esqueleto con las clases del propio
 * modulo de la ficha, asi que este bloque queda como pieza reutilizable para
 * cualquier otra pantalla de detalle. Se conserva con su firma.
 */
export function EsqueletoDeFicha() {
  return (
    <div className={estilos.detalle} aria-hidden="true">
      {/*
        ⚠️ DOS FOTOS APILADAS Y NINGUNA MINIATURA. La pantalla real muestra la
        galeria entera en columna, sin carrusel: dibujar una tira de miniaturas
        promete una navegacion que el sitio no tiene.
      */}
      <div className={estilos.detalleFotos}>
        <div className={`${estilos.detalleFoto} esqueleto`} />
        <div className={`${estilos.detalleFoto} esqueleto`} />
      </div>

      <div className={estilos.detalleColumna}>
        <Barra alto={12} ancho={110} />
        <Barra alto="var(--display-3)" ancho="88%" />
        <Barra alto="var(--texto-3xl)" ancho="40%" className={estilos.precio} />

        <span className={estilos.metadatos}>
          <Barra alto={25} ancho={72} />
          <Barra alto={25} ancho={92} />
          <Barra alto={25} ancho={104} />
        </span>

        {/* El CTA ya se dibuja verde y con halo: el esqueleto dice donde va a estar la accion. */}
        <Barra alto="var(--alto-control)" className={estilos.detalleBoton} />

        <div className={estilos.detalleDatos}>
          {Array.from({ length: 3 }, (_, indice) => (
            <Barra key={indice} alto={13} ancho={indice === 2 ? '62%' : '100%'} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== tabla */

/**
 * Tablas del back-office y de la bandeja de ventas.
 *
 * ⚠️ LAS COLUMNAS VIAJAN POR UNA CUSTOM PROPERTY Y NO POR UNA CLASE POR
 * CANTIDAD. Una clase `.tabla4` obliga a inventar una nueva cada vez que
 * aparece una tabla de cinco; una variable la resuelve una sola vez.
 *
 * ⚠️ ES EL UNICO ESQUELETO SIN LUZ DE MAS: la consola de pagos es una
 * herramienta de operaciones y queda fuera de todo efecto por contrato de
 * `movimiento.css`. El radio y el shimmer alcanzan.
 */
export function EsqueletoDeTabla({
  filas = 5,
  columnas = 4,
}: {
  filas?: number;
  columnas?: number;
}) {
  return (
    <div className={`${estilos.tabla} sup-ficha`} aria-hidden="true">
      {Array.from({ length: filas }, (_, fila) => (
        <span
          key={fila}
          className={estilos.tablaFila}
          style={{ '--columnas': columnas } as CSSProperties}
        >
          {Array.from({ length: columnas }, (_, columna) => (
            <Barra key={columna} alto={13} ancho={columna === 0 ? '78%' : '56%'} />
          ))}
        </span>
      ))}
    </div>
  );
}

/* =============================================================== anuncio */

/**
 * Region que esta cargando.
 *
 * ⚠️ EL ANUNCIO VA AFUERA DEL BLOQUE `aria-busy`, Y ANTES ESTABA ADENTRO. Eso
 * no es un detalle: `aria-busy="true"` le dice al lector de pantalla que
 * RETENGA lo que haya en esa region hasta que termine de cargar — y esta region
 * nunca "termina", se desmonta entera cuando llega el contenido. O sea que el
 * "Cargando…" que estaba adentro podia no anunciarse nunca, que es exactamente
 * el silencio que venia a evitar.
 *
 * ⚠️ `role="status"` Y NO `aria-live` A MANO: implica `aria-live="polite"` mas
 * `aria-atomic`, no interrumpe lo que se este leyendo, y es lo que corresponde
 * para un cambio de estado que la persona no pidio explicitamente.
 */
export function Cargando({ children }: { children: ReactNode }) {
  return (
    <>
      <p role="status" className="solo-lectores">
        Cargando…
      </p>
      <div aria-busy="true">{children}</div>
    </>
  );
}
