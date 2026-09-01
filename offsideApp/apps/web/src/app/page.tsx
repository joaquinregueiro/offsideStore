import { ListingCard } from '@/components/listing-card';
import { listPublicCatalog } from '@/modules/listings/services/listing.service';

import estilos from './page.module.css';

/**
 * Home — la vitrina publica.
 *
 * SERVER COMPONENT que llama al Service DIRECTAMENTE, sin pasar por HTTP
 * (decision del owner, 2026-09-01). Backend y frontend viven en la misma app
 * Next, asi que una peticion de la pagina a su propia API seria un rodeo: mismo
 * proceso, misma base, una serializacion de mas.
 *
 * La API sigue existiendo y sirve para lo que fue pensada: clientes externos y
 * una app movil futura.
 *
 * ⚠️ NO EXIGE SESION. Es la vitrina: cualquiera tiene que poder ver el catalogo
 * sin registrarse, y por eso `listPublicCatalog` no recibe usuario.
 */

/**
 * ⚠️ SIN CACHE. El catalogo cambia cuando alguien publica o cuando se vende la
 * ultima unidad, y mostrar stock que ya no existe lleva a un checkout que
 * falla. Cuando haya volumen esto se revisa con datos, no antes.
 */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const listings = await listPublicCatalog();

  return (
    <div className={estilos.pagina}>
      <header className={estilos.barra}>
        <div className={estilos.barraContenido}>
          <a href="/" className={estilos.marca}>
            Offside
          </a>

          {/*
            El buscador esta en el mockup de la identidad §06, pero la busqueda
            (DEC-042, full-text sobre `search_vector`) no esta implementada.
            Se muestra deshabilitado en vez de fingir que funciona: un campo que
            no responde es peor que uno que avisa.
          */}
          <input
            className={estilos.buscador}
            type="search"
            placeholder="Buscar camiseta, club, temporada…"
            disabled
            aria-label="Buscar (todavía no disponible)"
          />

          <a href="/ingresar" className={estilos.acceso}>
            Ingresar
          </a>
        </div>
      </header>

      <section className={estilos.portada}>
        <div className={estilos.portadaContenido}>
          <h1 className={estilos.titulo}>Camisetas con historia</h1>
          <p className={estilos.bajada}>
            Compra y venta de camisetas de fútbol para coleccionistas.
          </p>
        </div>
      </section>

      <main className={estilos.catalogo}>
        <h2 className={estilos.tituloSeccion}>En venta</h2>

        {listings.length === 0 ? (
          <div className={estilos.vacio}>
            <p className={estilos.vacioTitulo}>Todavía no hay publicaciones</p>
            <p>Cuando un vendedor publique su primera camiseta, va a aparecer acá.</p>
          </div>
        ) : (
          <ul className={estilos.grilla}>
            {listings.map((listing) => (
              <li key={listing.id}>
                <ListingCard listing={listing} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
