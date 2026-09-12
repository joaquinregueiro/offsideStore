import type { SVGProps } from 'react';

/**
 * Set de iconos.
 *
 * ⚠️ TRANSCRIPCION DEL §04 DE LA IDENTIDAD, no un set inventado. Los seis
 * primeros —balon, camiseta, etiqueta, intercambio, favorito, autenticado— son
 * los que la lamina define, con la regla que la lamina fija: **trazo de 1.5px,
 * esquinas suaves, sin relleno**. Los ultimos (menu, cerrar, buscar, flecha,
 * filtro) NO estan en la identidad: son de interfaz pura y se dibujan con la
 * misma regla para que no se noten de otro juego. Quedan marcados como
 * pendientes de validacion con el diseño.
 *
 * ⚠️ SON SVG INLINE, NO LOS PNG DE `design/assets/icons/`. Los archivos de la
 * identidad son laminas de presentacion: vienen con fondo, con el nombre del
 * icono debajo y con el verde quemado en el pixel. Un icono de interfaz tiene
 * que heredar el color de su contexto —el mismo icono va sobre papel y sobre
 * la barra verde— y eso solo lo da `currentColor`.
 *
 * ⚠️ SIN `aria-label` POR DEFECTO: son decorativos y van junto a un texto que
 * ya dice lo mismo. `aria-hidden` evita que un lector de pantalla lea dos veces
 * lo mismo. Cuando un icono va SOLO —un boton de cerrar— quien lo usa tiene que
 * poner el texto accesible en el boton, no en el icono.
 */

type PropsIcono = SVGProps<SVGSVGElement> & { tamanio?: number };

function Icono({ tamanio = 20, children, ...props }: PropsIcono) {
  return (
    <svg
      width={tamanio}
      height={tamanio}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ------------------------------------------------- identidad §04 (los seis) */

export function IconoBalon(props: PropsIcono) {
  return (
    <Icono {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.2 8.3 9.9l1.4 4.3h4.6l1.4-4.3z" />
      <path d="M12 3v4.2M4.5 9.4l3.8.5M6.9 18.6l2.8-4.4M17.1 18.6l-2.8-4.4M19.5 9.4l-3.8.5" />
    </Icono>
  );
}

export function IconoCamiseta(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M9 3 4 5.6l1.6 4L8 8.9V21h8V8.9l2.4.7 1.6-4L15 3" />
      <path d="M9 3a3 3 0 0 0 6 0" />
    </Icono>
  );
}

export function IconoEtiqueta(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M20.4 12.6 12.6 20.4a1.9 1.9 0 0 1-2.7 0l-6.3-6.3a1.9 1.9 0 0 1-.6-1.4V4.8A1.8 1.8 0 0 1 4.8 3h7.9c.5 0 1 .2 1.4.6l6.3 6.3a1.9 1.9 0 0 1 0 2.7z" />
      <circle cx="7.9" cy="7.9" r="1.4" />
    </Icono>
  );
}

export function IconoIntercambio(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M4 8.5h13M13.5 5 17 8.5 13.5 12" />
      <path d="M20 15.5H7M10.5 12 7 15.5 10.5 19" />
    </Icono>
  );
}

export function IconoFavorito(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="m12 3.6 2.6 5.6 6 .7-4.5 4.2 1.2 6.1L12 17.2l-5.3 3 1.2-6.1L3.4 9.9l6-.7z" />
    </Icono>
  );
}

export function IconoAutenticado(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M12 3 4.5 6v6c0 4.3 3 7.7 7.5 9 4.5-1.3 7.5-4.7 7.5-9V6z" />
      <path d="m8.7 11.8 2.3 2.3 4.3-4.3" />
    </Icono>
  );
}

/* --------------------------------------------- interfaz (fuera de la lamina) */

export function IconoMenu(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </Icono>
  );
}

export function IconoCerrar(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="m5.5 5.5 13 13M18.5 5.5l-13 13" />
    </Icono>
  );
}

export function IconoBuscar(props: PropsIcono) {
  return (
    <Icono {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.4 15.4 4.6 4.6" />
    </Icono>
  );
}

export function IconoFlechaIzquierda(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M19 12H5M10.5 6.5 5 12l5.5 5.5" />
    </Icono>
  );
}

export function IconoFlechaDerecha(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />
    </Icono>
  );
}

/* ------------------------------------------- prendas (categorias, PS §4.3) */

/**
 * ⚠️ NO ESTAN EN LA LAMINA DE LA IDENTIDAD: el §04 solo dibuja la camiseta. Las
 * otras cinco categorias del enum `garment_category` se dibujan con la misma
 * regla —trazo 1.5, esquinas suaves, sin relleno— para que en la grilla de
 * categorias las seis se lean como un solo juego. Pendientes de validacion con
 * el diseño, igual que los de interfaz.
 */

export function IconoShort(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M5 4h14l1 14h-6.2L12 12l-1.8 6H4z" />
      <path d="M5 8h14" />
    </Icono>
  );
}

export function IconoBuzo(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M9 4 4 6.6l1.5 4 2.5-.7V20h8V9.9l2.5.7 1.5-4L15 4" />
      <path d="M9 4c0 1.2.6 2 1.5 2.4M15 4c0 1.2-.6 2-1.5 2.4" />
      <path d="M8 16.5h8" />
    </Icono>
  );
}

export function IconoCampera(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M9 3 4 5.6l1.6 4L8 8.9V21h8V8.9l2.4.7 1.6-4L15 3" />
      <path d="M12 6.5V21" />
      <path d="M9 3c.6 1.3 1.6 2.2 3 2.6 1.4-.4 2.4-1.3 3-2.6" />
    </Icono>
  );
}

export function IconoConjunto(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M8 3 3.8 5.2l1.3 3.3 2-.6V13h6.6V7.9l2 .6 1.3-3.3L13 3" />
      <path d="M8 3a2.5 2.5 0 0 0 5 0" />
      <path d="M7.4 13h8.4l.7 8h-4.2l-.7-4.3-.7 4.3H6.7z" />
    </Icono>
  );
}

/* --------------------------------------------- interfaz (2026-09-11, panel) */

export function IconoCampana(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </Icono>
  );
}

export function IconoCarrito(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M3 4h2.4l2.2 11.2a1.5 1.5 0 0 0 1.5 1.3h8.6a1.5 1.5 0 0 0 1.5-1.2L21 8H6.4" />
      <circle cx="9.5" cy="20" r="1.2" />
      <circle cx="17.5" cy="20" r="1.2" />
    </Icono>
  );
}

export function IconoEstrella(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="m12 3.6 2.6 5.6 6 .7-4.5 4.2 1.2 6.1L12 17.2l-5.3 3 1.2-6.1L3.4 9.9l6-.7z" />
    </Icono>
  );
}

export function IconoCamion(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M3 6.5h11v9H3zM14 10h4l3 3v2.5h-7z" />
      <circle cx="7" cy="17.5" r="1.6" />
      <circle cx="17" cy="17.5" r="1.6" />
    </Icono>
  );
}

export function IconoPregunta(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M4 5.5h16v10H12l-4.5 3.5V15.5H4z" />
      <path d="M9.8 9.2a2.2 2.2 0 1 1 3 2c-.6.3-.8.6-.8 1.2M12 13.9v.1" />
    </Icono>
  );
}

export function IconoBandera(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M5 21V4" />
      <path d="M5 4h13l-2.5 4 2.5 4H5" />
    </Icono>
  );
}

export function IconoReloj(props: PropsIcono) {
  return (
    <Icono {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </Icono>
  );
}

export function IconoUbicacion(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 0 0-13 0c0 5 6.5 11 6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </Icono>
  );
}

export function IconoTienda(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M4 9.5 5.5 4h13L20 9.5" />
      <path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" />
      <path d="M5.5 12v8h13v-8M10 20v-5h4v5" />
    </Icono>
  );
}

export function IconoMedalla(props: PropsIcono) {
  return (
    <Icono {...props}>
      <circle cx="12" cy="14" r="5.5" />
      <path d="m8.5 9.5-2.5-6h4l2 4.5M15.5 9.5l2.5-6h-4l-2 4.5" />
      <path d="m12 11.5.9 1.9 2.1.3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.4 2.1-.3z" />
    </Icono>
  );
}

export function IconoRayo(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M13 3 5 13.5h6L10 21l9-11h-6z" />
    </Icono>
  );
}

/**
 * SOL Y LUNA — el interruptor de tema.
 *
 * ⚠️ NO ESTAN EN LA IDENTIDAD §04: son de interfaz pura, dibujados con la misma
 * regla que el resto (trazo 1.5, esquinas suaves, sin relleno) para que no se
 * noten de otro juego. Quedan pendientes de validacion con diseño.
 *
 * ⚠️ LA LUNA ES UNA SOLA FORMA, no un circulo con otro circulo encima tapandolo.
 * Con dos circulos, el de arriba tiene que pintarse del color del FONDO para
 * recortar, y entonces deja de heredar `currentColor`: el icono se rompe apenas
 * cambia la superficie, que es justo lo que este boton hace todo el tiempo.
 */
export function IconoSol(props: PropsIcono) {
  return (
    <Icono {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icono>
  );
}

export function IconoLuna(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
    </Icono>
  );
}

export function IconoCasa(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="m4 11 8-7 8 7" />
      <path d="M6.5 9.5V20h11V9.5M10 20v-5h4v5" />
    </Icono>
  );
}

export function IconoPausa(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M8 5v14M16 5v14" />
    </Icono>
  );
}

export function IconoAjustes(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </Icono>
  );
}

export function IconoSobre(props: PropsIcono) {
  return (
    <Icono {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
      <path d="m3.6 6.4 7.5 5.6a1.5 1.5 0 0 0 1.8 0l7.5-5.6" />
    </Icono>
  );
}

/** Marca de verificacion suelta, para confirmaciones grandes. */
export function IconoTilde(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Icono>
  );
}

/** Llave: recuperar el acceso a una cuenta. */
export function IconoLlave(props: PropsIcono) {
  return (
    <Icono {...props}>
      <circle cx="8" cy="8" r="4.5" />
      <path d="m11.2 11.2 8.3 8.3M16.5 16.5l2-2M14 14l1.6-1.6" />
    </Icono>
  );
}

export function IconoFiltro(props: PropsIcono) {
  return (
    <Icono {...props}>
      <path d="M3 6h18M6.5 12h11M10 18h4" />
    </Icono>
  );
}
