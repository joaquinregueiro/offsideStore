import Link from 'next/link';
import type { ReactNode } from 'react';

import { salir } from '@/app/(auth)/acciones';
import { elegirTema } from '@/app/acciones';
import { capabilitiesFor } from '@/lib/permissions';
import { getSessionUser } from '@/lib/session';

import { countCartItems } from '@/modules/cart/services/cart.service';
import { countUnread } from '@/modules/notifications/services/inapp-notification.service';

import estilos from './header.module.css';
import {
  IconoBuscar,
  IconoCampana,
  IconoCarrito,
  IconoCerrar,
  IconoLuna,
  IconoMenu,
  IconoSol,
} from './iconos';
import { Logo } from './marca';
import { Contador } from './ui';

/**
 * Barra superior, en todas las pantallas.
 *
 * Server Component: lee la sesion en el servidor y decide que enlaces mostrar.
 * No hay parpadeo de "cargando sesion" ni un estado intermedio en el que la
 * barra dice "Ingresar" a alguien que ya inicio sesion.
 *
 * ⚠️ EL MENU DE TELEFONO NO USA JAVASCRIPT. Es un `<details>`: el navegador ya
 * sabe abrirlo y cerrarlo, responde a Enter y a Espacio, y expone el estado
 * abierto/cerrado a los lectores de pantalla sin una linea de `aria`. La
 * alternativa habitual —un `useState` y un `onClick`— convertiria la barra en
 * Client Component y mandaria la sesion entera al bundle, para reimplementar
 * peor algo que el HTML ya hace.
 *
 * ⚠️ LOS ENLACES SE RENDERIZAN DOS VECES, y es deliberado: una lista para
 * escritorio y otra dentro del menu. Un solo marcado obligaria a pelearle a la
 * hoja de estilos del navegador para que el contenido de un `<details>` cerrado
 * se muestre igual en escritorio, y eso se rompe distinto en cada navegador. El
 * costo real es unos pocos nodos duplicados, de los cuales uno siempre esta en
 * `display: none` —o sea, tampoco llega al arbol de accesibilidad—.
 */

/**
 * ⚠️ LA SECCION ACTIVA LLEGA POR PROP Y NO SE DEDUCE DEL PATHNAME, y no es una
 * comodidad: `usePathname` obliga a `'use client'`, y esta barra lee la sesion
 * en el servidor. Convertirla mandaria la sesion entera al bundle para
 * reimplementar peor algo que el que enlaza ya sabe. Es opcional: sin prop no
 * hay `aria-current` y la barra se comporta exactamente como antes.
 */
export type SeccionDeNavegacion = 'explorar' | 'compras' | 'vender' | 'admin';

/**
 * ⚠️ QUE TIPO DE TRANSICION LLEVA CADA ENLACE DE LA BARRA, Y POR QUE NO SON
 * TODOS `avanza`. Sin `transitionTypes` un `<Link>` cae en el `default: 'none'`
 * de `components/movimiento.tsx`: `Pantalla` no produce ningun cuadro por mas
 * que este puesto en la pantalla de destino. O sea que la falta NO se ve como un
 * error, se ve como "todavia no lo hicimos".
 *
 *   marca (`/`)            retrocede — el logo siempre vuelve a la raiz del
 *                          sitio, desde donde sea. Entrar por la derecha diria
 *                          que se avanza a algun lado.
 *   Explorar (`/buscar`)   barrido — vitrina ↔ busqueda es el ejemplo textual de
 *                          salto lateral, y es el tipo que ya usan los enlaces a
 *                          `/buscar` de la portada.
 *   Mis compras · Vender   barrido — son las SECCIONES HERMANAS de una barra de
 *   · Admin                navegacion global: entre ellas no hay adelante ni
 *                          atras, igual que las pestañas del back-office.
 *   Ingresar · Crear       avanza — no son secciones hermanas de nada: se entra
 *   cuenta                 a un flujo desde cualquier pantalla.
 */
export async function Header({
  consulta,
  seccion,
}: { consulta?: string; seccion?: SeccionDeNavegacion } = {}) {
  const user = await getSessionUser();

  /*
   * ⚠️ LA CAMPANITA NO PUEDE VOLTEAR LA BARRA. Es un conteo de cortesia en el
   * componente que esta en TODAS las pantallas: si la consulta falla, la barra
   * sale sin globo y el error queda en el log, no en la cara de la persona.
   */
  const [noLeidas, enElCarrito] =
    user === null ? [0, 0] : await Promise.all([contarNoLeidas(user), contarEnElCarrito(user)]);

  /*
   * `aria-current="page"` es lo que anuncia la seccion activa a un lector de
   * pantalla; el subrayado de `header.module.css` cuelga del MISMO atributo, asi
   * que no hay forma de que la señal visual y la accesible se desincronicen.
   */
  const actual = (s: SeccionDeNavegacion) =>
    seccion === s ? { 'aria-current': 'page' as const } : {};

  /*
   * ⚠️ LA CAMPANITA SE DIBUJA DISTINTO SEGUN DONDE ESTE: en la barra es un
   * icono con globo (hay lugar y se lee de un vistazo); adentro del menu de
   * telefono es una fila de texto como las demas, porque una fila de ancho
   * completo con un icono solo se ve rota.
   */
  const carrito = (donde: 'barra' | 'menu'): ReactNode =>
    enElCarrito === 0 && donde === 'menu' ? null : donde === 'barra' ? (
      <Contador
        href="/carrito"
        icono={<IconoCarrito tamanio={20} />}
        texto="Carrito"
        cantidad={enElCarrito}
        className={estilos.contadorBarra}
      />
    ) : (
      <Link href="/carrito" className={estilos.enlace} transitionTypes={['barrido']}>
        Carrito
        <span className={estilos.globoMenu}>{enElCarrito > 99 ? '99+' : enElCarrito}</span>
      </Link>
    );

  const campanita = (donde: 'barra' | 'menu'): ReactNode =>
    donde === 'barra' ? (
      <Contador
        href="/cuenta/notificaciones"
        icono={<IconoCampana tamanio={20} />}
        texto="Notificaciones"
        cantidad={noLeidas}
        className={estilos.contadorBarra}
      />
    ) : (
      <Link href="/cuenta/notificaciones" className={estilos.enlace} transitionTypes={['barrido']}>
        Notificaciones
        {noLeidas > 0 && (
          <span className={estilos.globoMenu}>{noLeidas > 99 ? '99+' : noLeidas}</span>
        )}
      </Link>
    );

  const enlaces = (donde: 'barra' | 'menu'): ReactNode =>
    user === null ? (
      <>
        <Link
          href="/buscar"
          className={estilos.enlace}
          transitionTypes={['barrido']}
          {...actual('explorar')}
        >
          Explorar
        </Link>
        <Link href="/ingresar" className={estilos.enlace} transitionTypes={['avanza']}>
          Ingresar
        </Link>
        <Link href="/crear-cuenta" className={estilos.enlaceDestacado} transitionTypes={['avanza']}>
          Crear cuenta
        </Link>
      </>
    ) : (
      <>
        {/*
          ⚠️ LA BARRA YA NO REPITE LAS SECCIONES DEL PANEL (2026-09-11). Antes
          decia "Mis compras" y "Vender", que ahora son dos de las seis
          secciones de la barra LATERAL del area privada: tenerlas en los dos
          lados hacia que la misma persona viera dos navegaciones distintas
          para lo mismo y no supiera cual manda. La barra superior queda con lo
          que es global —buscar, vender, tu cuenta— y el panel se encarga del
          resto.

          ⚠️ "VENDER" SE QUEDA, y no es una excepcion arbitraria: es el unico
          camino para descubrir que se puede vender desde la home, la busqueda
          o una ficha, que es donde no hay barra lateral.
        */}
        <Link
          href="/vendedor/publicaciones/nueva"
          className={estilos.enlace}
          transitionTypes={['barrido']}
          {...actual('vender')}
        >
          Vender
        </Link>
        <Link
          href="/cuenta"
          className={estilos.enlace}
          transitionTypes={['barrido']}
          {...actual('compras')}
        >
          Mi cuenta
        </Link>
        {/*
          El acceso al back-office aparece SOLO para quien tiene alguna
          capacidad. No es una medida de seguridad —cada pantalla y cada Server
          Action exigen la suya—, sino la unica forma de llegar sin escribir la
          URL a mano.
        */}
        {capabilitiesFor(user.adminRole).length > 0 && (
          <Link
            href="/admin"
            className={estilos.enlace}
            transitionTypes={['barrido']}
            {...actual('admin')}
          >
            Admin
          </Link>
        )}
        {carrito(donde)}
        {campanita(donde)}
        {/*
          Salir es una MUTACION —invalida la sesion en la base—, asi que va en
          un `<form>` con POST, no en un enlace. Un GET que cambia estado se
          dispara con un prefetch del navegador o con una imagen incrustada en
          otro sitio.
        */}
        <form action={salir}>
          <button type="submit" className={estilos.enlaceBoton}>
            Salir
          </button>
        </form>
      </>
    );

  return (
    /*
      ⚠️ `viewTransitionName` ANCLA LA BARRA. Durante una transicion entre
      pantallas todo lo demas se desliza; si la barra tambien se moviera, no
      quedaria ningun punto fijo y la sensacion seria "se fue todo" en vez de
      "cambio el contenido". El nombre lo consume `movimiento.css`, que le apaga
      la animacion.

      ⚠️ LA BARRA ES DE VIDRIO Y FLOTA (2026-09-10). Un elemento con
      `view-transition-name` se captura como SNAPSHOT y el backdrop NO se
      captura: durante los ~420ms de una navegacion la barra se ve un 8% mas
      transparente y sin desenfoque, y nada mas —la snapshot nueva TAPA a la
      vieja, no se suman—. Es el costo aceptado a cambio de la isla de vidrio
      que pidio el dueño; el detalle esta en `header.module.css`.

      ⚠️ `sup-cancha` ES LA UNICA LINEA QUE DEFINE LOS TOKENS DE LA SUPERFICIE,
      y por eso sale del sistema y no se escribe a mano: trae el remapeo de
      `--color-foco` y de `--luz-marca` a Amarillo Cambio —o sea que todo glow
      de la barra es amarillo—, `--destello`, los tokens de boton sobre verde y
      el `isolation: isolate` del que dependen las capas de fondo (el velo del
      scroll y la cinta del filo). El vidrio, el radio y la sombra los pone el
      modulo encima.
    */
    <header className={`${estilos.barra} sup-cancha`} style={{ viewTransitionName: 'barra' }}>
      {/*
        ⚠️ SALTAR AL CONTENIDO. Quien navega con teclado o con lector de pantalla
        tenia que recorrer la marca, el buscador y cinco enlaces en CADA
        pantalla antes de llegar a lo que vino a leer. Es invisible hasta que
        recibe el foco (WCAG 2.4.1).
      */}
      <a href="#contenido" className={estilos.saltar}>
        Saltar al contenido
      </a>

      <div className={estilos.contenido}>
        <Link
          href="/"
          className={estilos.marca}
          aria-label="Offside Store — inicio"
          transitionTypes={['retrocede']}
        >
          <Logo invertido />
        </Link>

        {/*
          ⚠️ ES UN <form> CON GET, no un campo con JavaScript. Asi la busqueda
          viaja en la URL: se puede compartir, guardar en favoritos y volver con
          el boton atras. Y funciona sin JS, como el resto del sitio.
        */}
        <form action="/buscar" method="get" className={estilos.buscadorForm} role="search">
          <label htmlFor="busqueda-global" className="solo-lectores">
            Buscar publicaciones
          </label>
          <input
            id="busqueda-global"
            className={estilos.buscador}
            type="search"
            name="q"
            placeholder="Buscar camiseta, club, temporada…"
            /*
              ⚠️ EL CAMPO CONSERVA LO QUE SE BUSCO. Antes se vaciaba: en
              `/buscar?q=river` el titulo decia "Resultados para river" y el
              buscador estaba en blanco, asi que afinar la busqueda obligaba a
              escribir todo de nuevo. Solo la pantalla de busqueda pasa el
              valor; en el resto la barra arranca vacia, que es lo correcto.
            */
            defaultValue={consulta}
          />
          {/*
            ⚠️ EL BOTON DE LUPA NO ES DECORACION. En escritorio se puede apretar
            Enter; en un telefono el teclado virtual muestra "ir" y mucha gente
            no lo asocia con buscar. Ademas es el unico control de la barra que
            confirma que el campo hace algo.
          */}
          <button type="submit" className={estilos.buscadorBoton}>
            <IconoBuscar tamanio={18} />
            <span className="solo-lectores">Buscar</span>
          </button>
        </form>

        {/*
          EL INTERRUPTOR DE TEMA.

          ⚠️ SON DOS BOTONES SIEMPRE RENDERIZADOS Y EL CSS ELIGE CUAL SE VE, la
          misma tecnica que ya usa el boton de menu acá abajo con sus dos
          iconos. No es capricho: sin JavaScript no hay forma de que el servidor
          sepa si quien mira tiene el sistema en claro o en oscuro, así que con
          la preferencia en "automático" un único botón no podría saber qué
          ofrecer. Con los dos puestos, la decisión la toma el `@media`, que sí
          lo sabe. Cada uno manda un valor FIJO —no alterna—, así que tampoco
          hay estado que se pueda desincronizar.

          ⚠️ VIVE FUERA DE `.acciones` PORQUE `.acciones` SE ESCONDE ABAJO DE
          900px. El tema tiene que poder cambiarse desde el teléfono, que es
          donde más molesta una pantalla blanca de noche.

          ⚠️ EL TEXTO ACCESIBLE VA EN EL BOTON Y DICE LA ACCION, no el estado:
          "Cambiar a modo claro" es lo que va a pasar si se aprieta. Los iconos
          son decorativos y ya vienen `aria-hidden`.
        */}
        <form action={elegirTema} className={estilos.tema}>
          <button
            type="submit"
            name="tema"
            value="claro"
            data-para="claro"
            className={estilos.temaBoton}
          >
            <IconoSol tamanio={20} />
            <span className="solo-lectores">Cambiar a modo claro</span>
          </button>
          <button
            type="submit"
            name="tema"
            value="oscuro"
            data-para="oscuro"
            className={estilos.temaBoton}
          >
            <IconoLuna tamanio={20} />
            <span className="solo-lectores">Cambiar a modo oscuro</span>
          </button>
        </form>

        <nav className={estilos.acciones} aria-label="Principal">
          {enlaces('barra')}
        </nav>

        <details className={estilos.menu}>
          <summary className={estilos.menuBoton}>
            {/*
              ⚠️ LOS DOS ICONOS SE RENDERIZAN SIEMPRE y `[open]` decide cual se
              ve. Rotar tres rayas 90° da tres rayas verticales, que no
              significan nada; y cambiar el marcado necesitaria JavaScript. Los
              dos son decorativos: el texto accesible es el `.solo-lectores` de
              abajo, que no se duplica.
            */}
            <span className={estilos.menuIcono} data-icono="abrir">
              <IconoMenu tamanio={22} />
            </span>
            <span className={estilos.menuIcono} data-icono="cerrar">
              <IconoCerrar tamanio={22} />
            </span>
            <span className="solo-lectores">Menú</span>
          </summary>
          {/*
            ⚠️ `sup-noche` ES LO QUE DA EL SALTO DE TONO CONTRA LA BARRA, y
            `escena-luz` es lo que habilita los blobs que se VEN: sobre noche
            pelada el presupuesto de alfa es un lavado (4% / 2%) y con la escena
            sube a 10% / 6%, con los tokens de texto remapeados a los que aguantan
            ese punto (`tokens.css`). Los blobs van ULTIMOS: el escalonado de
            apertura cuenta hijos por orden y los enlaces tienen que ser los
            primeros.
          */}
          <nav className={`${estilos.menuPanel} sup-noche escena-luz`} aria-label="Menú">
            {enlaces('menu')}
            <div className={`${estilos.menuLuz} blobs`} aria-hidden="true">
              <i className="blob blob-cancha blob-grande" />
              <i className="blob blob-cambio blob-chico" />
            </div>
          </nav>
        </details>
      </div>

      {/*
        CINTA DE LA BANDERA en el filo inferior, en TODOS los viewports: las
        diagonales de la bandera del juez de linea como una tira de luz entre
        las dos esquinas redondeadas de la isla. Una cinta de 6px sobrevive a
        los 320px porque no compite con nada.
      */}
      <div className={`${estilos.cinta} patron-vivo`} aria-hidden="true" />
    </header>
  );
}

/**
 * Conteo de notificaciones sin leer, a prueba de fallas: la barra no depende
 * de que la tabla responda.
 */
async function contarNoLeidas(user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>) {
  try {
    return await countUnread(user);
  } catch (error) {
    console.error('[header] no se pudo contar las notificaciones sin leer', error);

    return 0;
  }
}

/**
 * Cuantas unidades hay en el carrito. Mismo criterio que la campanita: un
 * fallo acá saca el globo, no la barra.
 *
 * ⚠️ CON `feature_cart` APAGADO DEVUELVE 0, asi que el icono desaparece solo:
 * `countCartItems` consulta la perilla y el globo nunca ofrece una pantalla
 * que da 404.
 */
async function contarEnElCarrito(user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>) {
  try {
    return await countCartItems(user);
  } catch (error) {
    console.error('[header] no se pudo contar el carrito', error);

    return 0;
  }
}
