import Link from 'next/link';
import { cache } from 'react';
import type { ReactNode } from 'react';

import type { PublicUser } from '@/modules/auth/services/auth.service';
import { countCartItems } from '@/modules/cart/services/cart.service';
import { countFavoritesOf } from '@/modules/favorites/services/favorite.service';
import { countMyListings } from '@/modules/listings/services/listing.service';
import { countUnread } from '@/modules/notifications/services/inapp-notification.service';
import { countMyOpenOrders, countSalesToShip } from '@/modules/orders/services/order.service';
import { countPendingForSeller } from '@/modules/questions/services/question.service';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

import {
  IconoCamiseta,
  IconoCarrito,
  IconoEtiqueta,
  IconoFavorito,
  IconoPregunta,
  IconoTienda,
} from './iconos';
import estilos from './panel.module.css';

/**
 * LAS SECCIONES DEL AREA PRIVADA — su definicion y el armazon de las pantallas.
 *
 * ⚠️ ACA YA NO SE DIBUJA NINGUNA BARRA LATERAL (2026-09-12). Las seis secciones
 * se veian DOS veces al mismo tiempo: en el cajon de las tres rayitas y otra vez
 * como columna al costado de cada pantalla privada. Repetir la misma navegacion
 * a 20cm de distancia no ayuda a orientarse, y ademas le comia 15.5rem de ancho
 * a listas que los necesitan —el historial de compras, el inventario—.
 *
 * ⚠️ LAS SEIS SECCIONES SIGUEN VIVIENDO ACA, en `itemsDelPanel`. Las consume el
 * cajon. Si se definieran alla, este archivo y el cajon podrian divergir —que es
 * el problema que el panel unico vino a resolver en primer lugar—.
 *
 * ⚠️ LAS SOLAPAS SE QUEDAN. Son el segundo nivel DENTRO de una seccion
 * (Historial / Reclamos / Reseñas), no la navegacion principal: el cajon no las
 * reemplaza, y sin ellas esas pantallas quedan sin forma de llegar a sus
 * hermanas.
 */

export type SeccionDelPanel =
  'cuenta' | 'vender' | 'publicaciones' | 'preguntas' | 'compras' | 'favoritos';

/**
 * Los numeros que la barra muestra al lado de cada seccion.
 *
 * ⚠️ SOLO LO QUE PIDE UNA ACCION DE ESTA PERSONA. "3 publicaciones activas" no
 * va: es un dato, no algo que hacer, y un numero que siempre esta ahi deja de
 * significar nada. Van los que bajan a cero cuando alguien se ocupa: preguntas
 * sin responder, ventas por despachar, avisos sin leer.
 */
export interface ConteosDelPanel {
  comprasEnCurso: number;
  favoritos: number;
  sinLeer: number;
  enElCarrito: number;
  /** `null` para quien no es vendedor: esas secciones no muestran numero. */
  preguntasSinResponder: number | null;
  ventasPorDespachar: number | null;
  publicacionesActivas: number | null;
}

const VACIOS: ConteosDelPanel = {
  comprasEnCurso: 0,
  favoritos: 0,
  sinLeer: 0,
  enElCarrito: 0,
  preguntasSinResponder: null,
  ventasPorDespachar: null,
  publicacionesActivas: null,
};

/**
 * Todos los conteos de la barra, en una sola pasada y UNA sola vez por request.
 *
 * ⚠️ `cache()` NO ES UNA OPTIMIZACION COSMETICA. La barra la dibuja el layout y
 * varias pantallas quieren los mismos numeros para su propio contenido; sin
 * memorizar, `/cuenta` haria siete consultas para el tablero y otras siete para
 * la barra. Con `cache()` de React se resuelven una vez y las dos las leen.
 *
 * ⚠️ NINGUNA PUEDE VOLTEAR EL PANEL. Son numeritos de cortesia en un componente
 * que esta en TODAS las pantallas privadas: si una consulta falla, la barra sale
 * sin ese numero y el error queda en el log, no en la cara de la persona.
 */
export const conteosDelPanel = cache(async (user: PublicUser): Promise<ConteosDelPanel> => {
  const seguro = async <T,>(que: string, leer: () => Promise<T>, siFalla: T): Promise<T> => {
    try {
      return await leer();
    } catch (error) {
      console.error(
        `[panel] no se pudo contar ${que}:`,
        error instanceof Error ? error.message : String(error),
      );

      return siFalla;
    }
  };

  const perfil = await seguro('el perfil de vendedor', () => getMySellerProfile(user.id), null);
  const esVendedor = perfil !== null;

  const [comprasEnCurso, favoritos, sinLeer, enElCarrito] = await Promise.all([
    seguro('las compras en curso', () => countMyOpenOrders(user), 0),
    seguro('los favoritos', () => countFavoritesOf(user), 0),
    seguro('los avisos sin leer', () => countUnread(user), 0),
    seguro('el carrito', () => countCartItems(user), 0),
  ]);

  if (!esVendedor) {
    return { ...VACIOS, comprasEnCurso, favoritos, sinLeer, enElCarrito };
  }

  const [preguntasSinResponder, ventasPorDespachar, publicaciones] = await Promise.all([
    seguro('las preguntas sin responder', () => countPendingForSeller(user), 0),
    seguro('las ventas por despachar', () => countSalesToShip(user), 0),
    seguro('las publicaciones', () => countMyListings(user), null),
  ]);

  return {
    comprasEnCurso,
    favoritos,
    sinLeer,
    enElCarrito,
    preguntasSinResponder,
    ventasPorDespachar,
    publicacionesActivas: publicaciones?.activas ?? null,
  };
});

/**
 * ⚠️ LA UNICA DEFINICION DE LAS SEIS SECCIONES. Hoy las consume el cajon de las
 * tres rayitas y nadie mas; vive aca —y no adentro del cajon— porque es la lista
 * del AREA PRIVADA, no de un componente de la barra, y `SeccionDelPanel` y las
 * solapas de cada seccion se definen contra ella.
 */
export interface ItemDelPanel {
  clave: SeccionDelPanel;
  texto: string;
  href: string;
  icono: ReactNode;
  /** Numero que pide una accion. `null` o `0` no se dibuja. */
  dato?: number | null;
  /** Solo para vendedores. */
  soloVendedor?: boolean;
}

export function itemsDelPanel(conteos: ConteosDelPanel, esVendedor: boolean): ItemDelPanel[] {
  const todos: ItemDelPanel[] = [
    {
      clave: 'cuenta',
      texto: 'Mi cuenta',
      href: '/cuenta',
      icono: <IconoTienda tamanio={20} />,
      dato: conteos.sinLeer,
    },
    {
      clave: 'vender',
      texto: 'Vender',
      /*
       * ⚠️ VA A PUBLICAR DIRECTO, NO A UN INDICE. "Vender" es un verbo: quien lo
       * toca quiere publicar algo, no leer sobre vender. Si todavia no es
       * vendedor, el guard de esa pantalla lo manda al alta, que es el unico
       * paso que le falta.
       */
      href: '/vendedor/publicaciones/nueva',
      icono: <IconoEtiqueta tamanio={20} />,
    },
    {
      clave: 'publicaciones',
      texto: 'Publicaciones',
      href: '/vendedor/publicaciones',
      icono: <IconoCamiseta tamanio={20} />,
      dato: conteos.ventasPorDespachar,
      soloVendedor: true,
    },
    {
      clave: 'preguntas',
      texto: 'Preguntas',
      href: '/cuenta/preguntas',
      icono: <IconoPregunta tamanio={20} />,
      dato: conteos.preguntasSinResponder,
    },
    {
      clave: 'compras',
      texto: 'Compras',
      href: '/cuenta/compras',
      icono: <IconoCarrito tamanio={20} />,
      dato: conteos.comprasEnCurso,
    },
    {
      clave: 'favoritos',
      texto: 'Favoritos',
      href: '/cuenta/favoritos',
      icono: <IconoFavorito tamanio={20} />,
    },
  ];

  return todos.filter((item) => esVendedor || item.soloVendedor !== true);
}

/**
 * El armazon de las pantallas privadas: ancho, centrado y aire.
 *
 * ⚠️ QUEDA COMO CONTENEDOR AUNQUE YA NO TENGA BARRA. Es lo que les da a las 31
 * pantallas privadas el mismo ancho maximo y el mismo canal lateral; si cada una
 * se lo pusiera sola, alcanzaria con que una se olvidara para que se viera
 * distinta.
 *
 * ⚠️ NO PONE EL `<main>`, y no es un olvido: lo escribe cada pantalla. Ponerlo
 * aca obligaria a que ninguna lo escribiera, y basta con que una se equivoque
 * para tener dos `<main>` —que fue un bug real de este proyecto—.
 */
export function Panel({ children }: { children: ReactNode }) {
  return <div className={estilos.armazon}>{children}</div>;
}

/**
 * SOLAPAS de una seccion: el segundo nivel, adentro del contenido.
 *
 * ⚠️ NO SON LA NAVEGACION PRINCIPAL Y POR ESO NO SE VEN COMO TAL. Son enlaces
 * de texto con un filete abajo, sin marco ni sombra ni glow: el titulo de la
 * pantalla ya dice donde estas parado, y dos rieles compitiendo por la misma
 * jerarquia es lo que hacia que la pantalla anterior no se entendiera.
 */
export interface Solapa {
  clave: string;
  texto: string;
  href: string;
  dato?: number | undefined;
}

export function Solapas({
  solapas,
  activa,
  etiqueta,
}: {
  solapas: Solapa[];
  activa: string;
  etiqueta: string;
}) {
  if (solapas.length < 2) return null;

  return (
    <nav className={estilos.solapas} aria-label={etiqueta}>
      <ul className={estilos.solapasLista}>
        {solapas.map((solapa) => {
          const esActiva = solapa.clave === activa;

          return (
            <li key={solapa.clave}>
              <Link
                href={solapa.href}
                className={esActiva ? estilos.solapaActiva : estilos.solapa}
                aria-current={esActiva ? 'page' : undefined}
                transitionTypes={['barrido']}
              >
                {solapa.texto}
                {solapa.dato !== undefined && solapa.dato > 0 && (
                  <span className={estilos.solapaDato}>{solapa.dato}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
