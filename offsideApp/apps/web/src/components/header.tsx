import { salir } from '@/app/(auth)/acciones';
import { capabilitiesFor } from '@/lib/permissions';
import { getSessionUser } from '@/lib/session';

import estilos from './header.module.css';

/**
 * Barra superior, en todas las pantallas publicas.
 *
 * Server Component: lee la sesion en el servidor y decide que enlaces mostrar.
 * No hay parpadeo de "cargando sesion" ni un estado intermedio en el que la
 * barra dice "Ingresar" a alguien que ya inicio sesion.
 */
export async function Header() {
  const user = await getSessionUser();

  return (
    <header className={estilos.barra}>
      <div className={estilos.contenido}>
        <a href="/" className={estilos.marca}>
          Offside
        </a>

        {/*
          ⚠️ ES UN <form> CON GET, no un campo con JavaScript. Asi la busqueda
          viaja en la URL: se puede compartir, guardar en favoritos y volver con
          el boton atras. Y funciona sin JS, como el resto del sitio.
        */}
        <form action="/buscar" method="get" className={estilos.buscadorForm} role="search">
          <input
            className={estilos.buscador}
            type="search"
            name="q"
            placeholder="Buscar camiseta, club, temporada…"
            aria-label="Buscar publicaciones"
          />
        </form>

        <nav className={estilos.acciones}>
          {user === null ? (
            <>
              <a href="/ingresar" className={estilos.enlace}>
                Ingresar
              </a>
              <a href="/crear-cuenta" className={estilos.enlace}>
                Crear cuenta
              </a>
            </>
          ) : (
            <>
              <a href="/mis-compras" className={estilos.enlace}>
                Mis compras
              </a>
              <a href="/vendedor" className={estilos.enlace}>
                Vender
              </a>
              {/*
                El acceso al back-office aparece SOLO para quien tiene alguna
                capacidad. No es una medida de seguridad —cada pantalla y cada
                Server Action exigen la suya—, sino la unica forma de llegar sin
                escribir la URL a mano.
              */}
              {capabilitiesFor(user.adminRole).length > 0 && (
                <a href="/admin" className={estilos.enlace}>
                  Admin
                </a>
              )}
              {/*
                Salir es una MUTACION —invalida la sesion en la base—, asi que
                va en un `<form>` con POST, no en un enlace. Un GET que cambia
                estado se dispara con un prefetch del navegador o con una imagen
                incrustada en otro sitio.
              */}
              <form action={salir}>
                <button type="submit" className={estilos.enlaceBoton}>
                  Salir
                </button>
              </form>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
