import { ViewTransition } from 'react';
import type { CSSProperties, ReactNode } from 'react';

/**
 * TRANSICIONES ENTRE PANTALLAS Y CAPAS DE LUZ
 * =============================================================================
 *
 * ⚠️ ESTO NO ES UNA LIBRERIA DE ANIMACION. `ViewTransition` es un componente de
 * React que le pone nombre a un elemento para que el navegador pueda animar
 * entre su posicion vieja y su posicion nueva, usando la View Transitions API
 * nativa. No hay JavaScript de animacion corriendo: React nombra, el navegador
 * anima, y el CSS de `app/movimiento.css` decide como.
 *
 * ⚠️ SIN SOPORTE DEL NAVEGADOR NO PASA NADA MALO. La navegacion funciona igual
 * y no se anima. Es una API aditiva: no hay degradacion que manejar.
 *
 * ⚠️ SON SERVER COMPONENTS. `ViewTransition` no tiene estado ni manejadores; no
 * hace falta `'use client'` y no suma un byte al bundle. `Blobs` tampoco: es
 * marcado vacio que el CSS global hace flotar.
 *
 * ⚠️ VERSION LUMINOSA (2026-09-10): los cuatro tipos de navegacion y la foto
 * compartida se conservan con su firma —los usan 22 pantallas—, y se suma
 * `Blobs`, la capa de luz que las escenas ponen detras del contenido. El CSS
 * (`.blobs`, `.blob*`) ya existia en `movimiento.css`; esto evita que cada
 * pantalla copie el mismo marcado con `aria-hidden` a mano y se olvide uno.
 */

/**
 * Los cuatro tipos de navegacion del sitio.
 *
 * ⚠️ EL TIPO LO DECIDE QUIEN ENLAZA, NO EL FRAMEWORK. Un `<Link>` declara
 * `transitionTypes={['avanza']}` y esta tabla traduce ese tipo a la clase de
 * View Transition que lo anima. Next no puede saber que es "adentro" en la
 * jerarquia de este sitio, y adivinarlo mal marea mas que no animar nada.
 *
 * ⚠️ CADA UNO DICE ALGO DISTINTO Y CONFUNDIRLOS DESORIENTA:
 *
 *   avanza     entras a algo. La pantalla nueva llega desde la derecha, como
 *              la pagina de un libro. Vitrina → ficha, panel → publicar.
 *   retrocede  volves. La convencion inversa, y esta tan asentada que romperla
 *              se siente como un error del sitio. Migas de pan, "volver".
 *   barrido    salto LATERAL entre pantallas hermanas, donde "adelante" y
 *              "atras" no significan nada: vitrina ↔ busqueda, pestañas del
 *              back-office. La vieja no se mueve; la nueva la tapa con un corte
 *              en diagonal, que es la bandera cruzando el cuadro. Dos capas
 *              desplazandose a la vez se leen como un error de sincronizacion.
 *   emerge     una pantalla que se abre POR ENCIMA de la anterior y de la que
 *              se vuelve: el checkout, una confirmacion. Sube y se acerca
 *              (`emerger-vt` trae un pelo de escala): deslizar de costado diria
 *              "seguis en la misma serie"; subir dice "esto es un paso aparte".
 *
 * ⚠️ `default: 'none'` ES LO QUE EVITA QUE TODO SE ANIME. Sin el, cualquier
 * transicion —el boton atras del navegador, el revelado de un Suspense— dispara
 * un deslizamiento que nadie pidio.
 */
const DIRECCION = {
  avanza: 'avanza',
  retrocede: 'retrocede',
  barrido: 'barrido',
  emerge: 'emerge',
  default: 'none',
} as const;

/**
 * Tipo de una navegacion, para tipar el `transitionTypes` de un `<Link>`.
 *
 * ⚠️ EXISTE PARA QUE UN TIPO MAL ESCRITO NO SEA UNA ANIMACION QUE NO OCURRE.
 * `transitionTypes={['avanzar']}` no rompe nada, no avisa nada y simplemente no
 * anima: es el peor tipo de bug, el que se ve igual que "todavia no lo hicimos".
 */
export type TipoDeTransicion = Exclude<keyof typeof DIRECCION, 'default'>;

/**
 * Envuelve el contenido de una pantalla para que entre y salga con direccion.
 *
 * ⚠️ VA EN EL `page.tsx`, NUNCA EN EL `layout.tsx`. Un layout persiste entre
 * navegaciones dentro de su grupo, asi que ahi el enter y el exit no se
 * disparan nunca y la animacion no ocurre.
 */
export function Pantalla({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter={DIRECCION} exit={DIRECCION} default="none">
      {children}
    </ViewTransition>
  );
}

/**
 * La foto de una publicacion, con identidad compartida entre la vitrina y la
 * ficha.
 *
 * Es la transicion que mas comunica de todo el sitio: la misma camiseta que se
 * toco en la grilla se despega, se agranda y aterriza en la ficha. Sin esto
 * una foto desaparece y otra aparece, y nada dice que son la misma prenda.
 *
 * ⚠️ EL NOMBRE TIENE QUE SER EL MISMO EN LAS DOS PANTALLAS y unico en cada una:
 * por eso lleva el id de la publicacion. `foto-<id>` es un contrato que leen
 * `listing-card`, la ficha, el panel del vendedor y el checkout: no se cambia.
 *
 * ⚠️ `default="none"` NO ES OPCIONAL. Sin eso, cada foto nombrada se anima en
 * CUALQUIER transicion de la pagina, no solo cuando es su par el que viaja: al
 * pasar de la vitrina a la busqueda se moverian las veinte fichas a la vez.
 * Y con `default="none"` hay que dejar el `share` explicito, o el par deja de
 * hacer morph en silencio.
 */
export function FotoCompartida({ id, children }: { id: string; children: ReactNode }) {
  return (
    <ViewTransition name={`foto-${id}`} share="morph" default="none">
      {children}
    </ViewTransition>
  );
}

/**
 * Contenido que reemplaza a un esqueleto.
 *
 * El esqueleto se va hacia abajo y rapido; el contenido llega desde abajo y mas
 * lento. La direccion vertical codifica jerarquia: lo que baja se retira, lo
 * que sube llega.
 *
 * ⚠️ EL TIEMPO ES ASIMETRICO A PROPOSITO (140ms contra 200ms + espera, en
 * `movimiento.css`). Es la diferencia entre un reemplazo y un relevo: si los
 * dos duran lo mismo, se ve como que la pagina parpadeo.
 */
export function LlegaContenido({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="sube" default="none">
      {children}
    </ViewTransition>
  );
}

export function SeVaElEsqueleto({ children }: { children: ReactNode }) {
  return (
    <ViewTransition exit="baja" default="none">
      {children}
    </ViewTransition>
  );
}

/* ================================================================== blobs */

/**
 * Una luz que flota. `cancha` lee `--luz-blob` (verde luminoso sobre claro,
 * verde-500 sobre oscuro); `cambio` es Amarillo Cambio. La alfa NO la elige el
 * blob: la fija la superficie (`--blob-alfa-*`, tabla en `tokens.css`).
 */
export interface Luz {
  tono: 'cancha' | 'cambio';
  tamanio?: 'chico' | 'normal' | 'grande';
  /**
   * Centro del blob, como porcentaje del contenedor. Sin esto vale la posicion
   * por defecto de `movimiento.css` segun el orden: arriba a la derecha —de
   * donde viene la luz del sistema—, abajo a la izquierda, arriba al medio.
   */
  x?: string;
  y?: string;
}

/**
 * Las tres luces por defecto: la principal arriba a la derecha, la calida
 * abajo a la izquierda y una chica arriba al medio. Tres trayectorias y tres
 * duraciones distintas en el CSS, asi que nunca se mueven al unisono.
 */
const TRES_LUCES: readonly Luz[] = [
  { tono: 'cancha' },
  { tono: 'cambio' },
  { tono: 'cancha', tamanio: 'chico' },
];

/**
 * CAPA DE BLOBS: luz difusa flotando DETRAS del contenido de una escena.
 *
 * Va como primer hijo de una `.sup-*` o de una `.escena-luz` —las dos traen
 * `position: relative; isolation: isolate`, que es lo que mantiene el
 * `z-index: -1` de la capa adentro del bloque— y el resto del contenido sigue
 * normal.
 *
 * ⚠️ `aria-hidden` SIEMPRE, Y POR ESO EXISTE ESTE COMPONENTE: son cajas vacias
 * que un lector de pantalla no tiene por que recorrer, y el marcado copiado a
 * mano en cada escena es exactamente el lugar donde ese atributo se olvida.
 *
 * ⚠️ EL CONTRASTE LO GARANTIZA LA SUPERFICIE, NO EL LLAMADOR. `.blob-cancha` y
 * `.blob-cambio` leen `--blob-alfa-cancha` / `--blob-alfa-cambio`, que cada
 * `.sup-*` y `.escena-luz` fijan a lo que su texto aguanta, medido con dos
 * blobs superpuestos. Sobre papel pelado son un lavado casi invisible a
 * proposito; una seccion que quiera luz que se VEA lleva `.escena-luz`. Adentro
 * de `.sup-vidrio-oscuro` valen 0: los blobs van detras del vidrio, no adentro.
 *
 * ⚠️ TRES POR ESCENA, NO MAS. Cada uno es una capa de compositor promovida
 * (`will-change: transform`) que flota durante toda la visita. Sin
 * `filter: blur()`: la caida suave la da el propio gradiente radial.
 *
 * ⚠️ NO VA EN UN ESQUELETO. Una capa promovida que se crea, flota 200ms y se
 * destruye es GPU gastada en el unico momento en que el navegador ya esta
 * ocupado.
 */
export function Blobs({ luces = TRES_LUCES }: { luces?: readonly Luz[] }) {
  return (
    <div className="blobs" aria-hidden="true">
      {luces.map((luz, indice) => {
        const estilo: Record<string, string> = {};
        if (luz.x !== undefined) estilo['--blob-x'] = luz.x;
        if (luz.y !== undefined) estilo['--blob-y'] = luz.y;

        return (
          <span
            key={indice}
            className={[
              'blob',
              luz.tono === 'cambio' ? 'blob-cambio' : 'blob-cancha',
              luz.tamanio === 'chico' ? 'blob-chico' : '',
              luz.tamanio === 'grande' ? 'blob-grande' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            /*
              El `style` va solo si hay posicion propia: un `style=""` vacio en
              cada blob es ruido en el HTML que se sirve en cada visita.
            */
            {...(Object.keys(estilo).length > 0 ? { style: estilo as CSSProperties } : {})}
          />
        );
      })}
    </div>
  );
}
