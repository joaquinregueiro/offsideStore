import { BarraFantasma, Cargando } from '@/components/esqueletos';

import estilos from './page.module.css';

/**
 * Carga de la tienda publica.
 *
 * ⚠️ EXISTE POR EL MISMO MOTIVO QUE EL DE LA FICHA: el limite de Suspense mas
 * cercano seria `app/loading.tsx`, que dibuja la GRILLA de la vitrina. Ocho
 * tarjetas de catalogo reemplazadas de golpe por una columna de datos es un
 * salto entero de layout, peor que no mostrar nada.
 *
 * ⚠️ LA BARRA FANTASMA HACE FALTA. Las pantallas publicas renderizan su propio
 * `Header` DENTRO de la pagina, asi que durante la carga desaparece y el sitio
 * se ve decapitado.
 *
 * ⚠️ REUSA LAS CLASES REALES DEL MODULO. `.encabezado`, `.marca` y `.dato` traen
 * las mismas medidas, el mismo radio y el mismo borde que el contenido: si la
 * tienda cambia de forma, esto cambia con ella en vez de quedar viejo.
 *
 * ⚠️ EL ANUNCIO LO DA `Cargando` (`role="status"`), no un texto escrito acá: las
 * cajas grises van `aria-hidden` porque no existen para quien no ve la pantalla.
 */
export default function CargandoTienda() {
  return (
    <main id="contenido" className={estilos.pagina}>
      <BarraFantasma />

      <div className={estilos.contenedor}>
        <Cargando>
          <div aria-hidden="true">
            <div className={estilos.encabezado}>
              <span className={`esqueleto ${estilos.marca}`} />
              <div className={estilos.identidad}>
                <div className={`esqueleto ${estilos.fantasmaTitulo}`} />
                <div className={`esqueleto ${estilos.fantasmaLinea}`} />
              </div>
            </div>

            <div className={estilos.bloque}>
              <div className={`esqueleto ${estilos.fantasmaRotulo}`} />
              <div className={estilos.datos}>
                {[1, 2, 3, 4].map((indice) => (
                  <div
                    key={indice}
                    className={`esqueleto ${estilos.dato} ${estilos.fantasmaDato}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </Cargando>
      </div>
    </main>
  );
}
