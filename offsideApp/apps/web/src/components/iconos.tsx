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
