import Link from 'next/link';

import { salir } from '@/app/(auth)/acciones';
import { capabilitiesFor } from '@/lib/permissions';
import { getSessionUser } from '@/lib/session';
import { countCartItems } from '@/modules/cart/services/cart.service';
import { catalogoDeLaVitrina } from '@/modules/listings/services/listing.service';
import { countUnread } from '@/modules/notifications/services/inapp-notification.service';

import { CajonDeCuenta } from './cajon';
import estilos from './header.module.css';
import { IconoBuscar, IconoCampana, IconoCarrito } from './iconos';
import { LogoLockup } from './marca';
import { SECCIONES_DEL_CATALOGO } from './secciones-del-catalogo';
import { Contador } from './ui';

/**
 * Barra superior, en todas las pantallas.
 *
 * Dos filas de borde a borde (2026-11-06): arriba la marca y el buscador; abajo
 * las secciones del catalogo y la cuenta. La estructura sale de Mercado Libre,
 * el marketplace de referencia en Argentina; el color y la marca son de Offside.
 *
 * ⚠️ Server Component: lee la sesion en el servidor. No hay parpadeo de "cargando
 * sesion" ni un estado en el que la barra le dice "Ingresar" a quien ya entro.
 *
 * ⚠️ LOS DESPLEGABLES SON `<details>`, SIN JAVASCRIPT, igual que el resto del
 * sitio: el navegador los abre con teclado y los anuncia a un lector de pantalla.
 * Un `useState` mandaria la sesion entera al bundle.
 *
 * ⚠️ NO HAY "OFERTAS", "CUPONES" NI "ENVIAR A". Son partes de Mercado Libre que
 * Offside no tiene: copiarlas seria prometer funciones que no existen.
 */
export type SeccionDeNavegacion = 'explorar' | 'compras' | 'vender' | 'admin';

export async function Header({
  consulta,
  seccion,
}: { consulta?: string; seccion?: SeccionDeNavegacion } = {}) {
  /*
   * ⚠️ LA SESION VA PRIMERO Y SOLA. Leer la cookie vuelve dinamica la pantalla; si
   * el catalogo se pidiera en paralelo, el build consultaria la base al prerenderizar
   * y en el servidor de build no hay base.
   */
  const user = await getSessionUser();
  const categorias = await categoriasDelMenu();

  /*
   * ⚠️ LOS CONTADORES NO PUEDEN VOLTEAR LA BARRA. Son cortesia en el componente
   * que esta en todas las pantallas: si la consulta falla, sale sin globo y el
   * error queda en el log.
   */
  const [noLeidas, enElCarrito] =
    user === null ? [0, 0] : await Promise.all([contarNoLeidas(user), contarEnElCarrito(user)]);

  const actual = (s: SeccionDeNavegacion) =>
    seccion === s ? { 'aria-current': 'page' as const } : {};

  const carrito = (
    <Contador
      href="/carrito"
      icono={<IconoCarrito tamanio={22} />}
      texto="Carrito"
      cantidad={enElCarrito}
      className={estilos.contador}
    />
  );

  return (
    <header className={`${estilos.barra} sup-cancha`}>
      <a href="#contenido" className={estilos.saltar}>
        Saltar al contenido
      </a>

      <div className={estilos.fila}>
        <div className={estilos.soloTelefono}>
          <CajonDeCuenta />
        </div>

        <Link href="/" className={estilos.marca} aria-label="Offside Store, inicio">
          <LogoLockup alto={30} />
        </Link>

        {/* Un <form> con GET: la busqueda viaja en la URL y anda sin JavaScript. */}
        <form action="/buscar" method="get" className={estilos.buscador} role="search">
          <label htmlFor="busqueda-global" className="solo-lectores">
            Buscar publicaciones
          </label>
          <input
            id="busqueda-global"
            className={estilos.buscadorCampo}
            type="search"
            name="q"
            placeholder="Buscar camiseta, club, temporada…"
            defaultValue={consulta}
          />
          <button type="submit" className={estilos.buscadorBoton}>
            <IconoBuscar tamanio={20} />
            <span className="solo-lectores">Buscar</span>
          </button>
        </form>

        <Link
          href={user === null ? '/vendedor/empezar' : '/vendedor/publicaciones/nueva'}
          className={`${estilos.vender} ${estilos.soloEscritorio}`}
          {...actual('vender')}
        >
          Vendé tu camiseta
        </Link>

        <div className={estilos.soloTelefono}>{carrito}</div>
      </div>

      <div className={`${estilos.fila2} ${estilos.soloEscritorio}`}>
        <nav className={estilos.catalogo} aria-label="Catálogo">
          {categorias.length > 0 && (
            <details className={estilos.menu}>
              <summary className={estilos.menuBoton}>Categorías</summary>
              <ul className={estilos.menuPanel}>
                {categorias.map((categoria) => (
                  <li key={categoria.id}>
                    <Link href={`/buscar?categoria=${categoria.id}`}>{categoria.name}</Link>
                  </li>
                ))}
                <li className={estilos.menuPie}>
                  <Link href="/buscar" {...actual('explorar')}>
                    Ver todas las publicaciones
                  </Link>
                </li>
              </ul>
            </details>
          )}
          {SECCIONES_DEL_CATALOGO.map((item) => (
            <Link key={item.href} href={item.href} className={estilos.enlace}>
              {item.texto}
            </Link>
          ))}
        </nav>

        <nav className={estilos.cuenta} aria-label="Tu cuenta">
          {user === null ? (
            <>
              <Link href="/crear-cuenta" className={estilos.enlace}>
                Creá tu cuenta
              </Link>
              <Link href="/ingresar" className={estilos.enlace}>
                Ingresá
              </Link>
              <Link href="/cuenta/compras" className={estilos.enlace}>
                Mis compras
              </Link>
            </>
          ) : (
            <>
              <Link href="/cuenta" className={estilos.enlace} {...actual('compras')}>
                {user.displayName ?? 'Mi cuenta'}
              </Link>
              <Link href="/cuenta/compras" className={estilos.enlace}>
                Mis compras
              </Link>
              {/*
                El acceso al back-office aparece solo para quien tiene alguna
                capacidad. No es seguridad: cada pantalla y cada Server Action
                exigen la suya.
              */}
              {capabilitiesFor(user.adminRole).length > 0 && (
                <Link href="/admin" className={estilos.enlace} {...actual('admin')}>
                  Admin
                </Link>
              )}
              <Contador
                href="/cuenta/notificaciones"
                icono={<IconoCampana tamanio={22} />}
                texto="Notificaciones"
                cantidad={noLeidas}
                className={estilos.contador}
              />
            </>
          )}
          {carrito}
          {user !== null && (
            /* Salir invalida la sesion: va por POST, nunca por un enlace. */
            <form action={salir}>
              <button type="submit" className={estilos.salir}>
                Salir
              </button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}

/**
 * Las seis categorias del menu. Un fallo saca el desplegable, no la barra.
 */
async function categoriasDelMenu() {
  try {
    return (await catalogoDeLaVitrina()).categorias;
  } catch (error) {
    console.error('[header] no se pudieron leer las categorias', error);

    return [];
  }
}

async function contarNoLeidas(user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>) {
  try {
    return await countUnread(user);
  } catch (error) {
    console.error('[header] no se pudo contar las notificaciones sin leer', error);

    return 0;
  }
}

/** Con `feature_cart` apagado devuelve 0: `countCartItems` consulta la perilla. */
async function contarEnElCarrito(user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>) {
  try {
    return await countCartItems(user);
  } catch (error) {
    console.error('[header] no se pudo contar el carrito', error);

    return 0;
  }
}
