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
 * BARRA LATERAL DEL AREA PRIVADA.
 *
 * ⚠️ ES UNA SOLA PARA COMPRAR Y PARA VENDER, y ese es el cambio de fondo. Antes
 * habia dos paneles separados —`/cuenta` con nueve pestañas y `/vendedor` con
 * once— y la misma persona, que compra y vende con la misma cuenta (BS-021),
 * tenia que saber en cual de los dos estaba parada para encontrar sus
 * preguntas. Entrar a una seccion hacia desaparecer las de la otra: veinte
 * destinos repartidos en dos rieles horizontales que no se veian entre si.
 *
 * ⚠️ SEIS SECCIONES, NI UNA MAS. Un riel de once pestañas no es navegacion: es
 * una lista. Las seis son las cosas que alguien viene a hacer —mirar su cuenta,
 * vender, gestionar lo que publica, contestar preguntas, ver lo que compro,
 * mirar lo que guardo— y lo demas son SOLAPAS adentro de cada una.
 *
 * ⚠️ ES NAVEGACION, NO ESTADO: seis `<a>` a seis URLs. Se comparten, vuelven con
 * el boton atras y andan sin JavaScript. La seccion activa la pasa cada
 * pantalla —saberla acá obligaria a `usePathname`, que es un hook, y volveria
 * Client Component a todo el layout— y se marca con `aria-current="page"`, que
 * es a la vez la señal visual y la accesible: no se pueden desincronizar.
 *
 * ⚠️ EN TELEFONO NO ES UNA BARRA LATERAL: es una fila que se desliza. Una
 * columna de 240px al costado de una pantalla de 375 deja 120px para el
 * contenido. Se ordena solo con `grid-template-columns` y una media query, sin
 * duplicar el marcado.
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

interface ItemDelPanel {
  clave: SeccionDelPanel;
  texto: string;
  detalle: string;
  href: string;
  icono: ReactNode;
  /** Numero que pide una accion. `null` o `0` no se dibuja. */
  dato?: number | null;
  /** Solo para vendedores. */
  soloVendedor?: boolean;
}

function itemsDelPanel(conteos: ConteosDelPanel, esVendedor: boolean): ItemDelPanel[] {
  const todos: ItemDelPanel[] = [
    {
      clave: 'cuenta',
      texto: 'Mi cuenta',
      detalle: 'Tus datos, direcciones y avisos',
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
      detalle: 'Publicá una prenda ahora',
      href: '/vendedor/publicaciones/nueva',
      icono: <IconoEtiqueta tamanio={20} />,
    },
    {
      clave: 'publicaciones',
      texto: 'Publicaciones',
      detalle: 'Lo que publicaste y lo que vendiste',
      href: '/vendedor/publicaciones',
      icono: <IconoCamiseta tamanio={20} />,
      dato: conteos.ventasPorDespachar,
      soloVendedor: true,
    },
    {
      clave: 'preguntas',
      texto: 'Preguntas',
      detalle: 'Las que te hacen y las que hacés',
      href: '/cuenta/preguntas',
      icono: <IconoPregunta tamanio={20} />,
      dato: conteos.preguntasSinResponder,
    },
    {
      clave: 'compras',
      texto: 'Compras',
      detalle: 'Historial, reclamos y reseñas',
      href: '/cuenta/compras',
      icono: <IconoCarrito tamanio={20} />,
      dato: conteos.comprasEnCurso,
    },
    {
      clave: 'favoritos',
      texto: 'Favoritos',
      detalle: 'Lo que guardaste para después',
      href: '/cuenta/favoritos',
      icono: <IconoFavorito tamanio={20} />,
    },
  ];

  return todos.filter((item) => esVendedor || item.soloVendedor !== true);
}

/**
 * El armazon de todas las pantallas privadas: barra lateral + contenido.
 *
 * ⚠️ LA BARRA VA EN UN `<nav>` PROPIO Y EL CONTENIDO EN EL `<main>`, que lo pone
 * la pantalla. Meter el `<main>` acá obligaria a que cada pantalla no lo
 * escribiera, y basta con que una se olvide para tener dos `<main>` —que fue un
 * bug real de este proyecto—.
 */
export function Panel({
  seccion,
  conteos,
  esVendedor,
  children,
}: {
  seccion: SeccionDelPanel;
  conteos: ConteosDelPanel;
  esVendedor: boolean;
  children: ReactNode;
}) {
  const items = itemsDelPanel(conteos, esVendedor);

  return (
    <div className={estilos.armazon}>
      <nav className={estilos.barra} aria-label="Tu cuenta">
        <ul className={estilos.lista}>
          {items.map((item) => {
            const activo = item.clave === seccion;
            const dato = item.dato ?? 0;

            return (
              <li key={item.clave}>
                <Link
                  href={item.href}
                  className={activo ? estilos.itemActivo : estilos.item}
                  aria-current={activo ? 'page' : undefined}
                  transitionTypes={['barrido']}
                >
                  <span className={estilos.itemIcono} aria-hidden="true">
                    {item.icono}
                  </span>
                  <span className={estilos.itemTexto}>
                    <span className={estilos.itemNombre}>{item.texto}</span>
                    <span className={estilos.itemDetalle}>{item.detalle}</span>
                  </span>
                  {dato > 0 && (
                    <span className={estilos.itemDato}>
                      {dato > 99 ? '99+' : dato}
                      <span className="solo-lectores"> pendientes</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {!esVendedor && (
          /*
           * ⚠️ A QUIEN NO VENDE NO SE LE ESCONDE LA MITAD DEL PANEL SIN DECIR
           * NADA. "Publicaciones" no aparece porque no tiene ninguna; el
           * renglon explica que existe y como llegar, en vez de dejar un hueco
           * que se lee como una funcionalidad rota.
           */
          <p className={estilos.barraNota}>
            ¿Querés vender? Con tu misma cuenta podés. Verificás tu identidad una vez y publicás.
          </p>
        )}
      </nav>

      <div className={estilos.contenido}>{children}</div>
    </div>
  );
}

/**
 * SOLAPAS de una seccion: el segundo nivel, adentro del contenido.
 *
 * ⚠️ NO SON LA NAVEGACION PRINCIPAL Y POR ESO NO SE VEN COMO TAL. Son enlaces
 * de texto con un filete abajo, sin marco ni sombra ni glow: la barra lateral
 * ya dice donde estas parado, y dos rieles compitiendo por la misma jerarquia
 * es lo que hacia que la pantalla anterior no se entendiera.
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
