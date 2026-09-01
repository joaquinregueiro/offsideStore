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

        <input
          className={estilos.buscador}
          type="search"
          placeholder="Buscar camiseta, club, temporada…"
          disabled
          aria-label="Buscar (todavía no disponible)"
        />

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
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
