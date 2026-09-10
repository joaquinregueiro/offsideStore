import { BarraFantasma, Cargando } from '@/components/esqueletos';

import estilos from './page.module.css';

/**
 * Carga de la ficha de producto.
 *
 * ⚠️ ESTE ARCHIVO EXISTE PORQUE EL LIMITE DE SUSPENSE MAS CERCANO ERA
 * `app/loading.tsx`, QUE PINTA LA GRILLA DE LA VITRINA. Ocho tarjetas de
 * catalogo reemplazadas de golpe por una ficha de una columna es un salto
 * completo de layout: peor que no mostrar nada. Es el mismo motivo por el que
 * cada grupo de rutas tiene el suyo, y el mismo por el que `/buscar` se hizo el
 * propio.
 *
 * ⚠️ LA BARRA FANTASMA HACE FALTA. Las tres pantallas publicas —vitrina,
 * busqueda y ficha— renderizan su propio `Header` DENTRO de la pagina, asi que
 * durante la carga desaparece y el sitio se ve decapitado.
 *
 * ⚠️ LAS MEDIDAS IMITAN AL CONTENIDO REAL, y por eso reusa las clases del
 * modulo de la ficha: `.grilla`, `.escenario` y `.diapositiva` traen la misma
 * proporcion, el mismo radio y la misma sombra. Si la ficha cambia de forma,
 * esto cambia con ella.
 *
 * ⚠️ EL SHIMMER LO PONE LA CLASE GLOBAL `.esqueleto` (`movimiento.css`), que ya
 * lo apaga sola con `prefers-reduced-motion` y ya escalona el brillo entre
 * hermanos. Una copia local con su propio keyframe quedaria fuera de esa red.
 *
 * ⚠️ EL ANUNCIO LO DA `Cargando` (`role="status"` mas `aria-busy`), no un texto
 * inventado aca: las cajas grises van `aria-hidden` porque no existen para
 * quien no ve la pantalla, y sin el anuncio no habria forma de distinguir
 * "cargando" de "vacio".
 */
export default function CargandoFicha() {
  return (
    <main id="contenido" className={estilos.pagina}>
      <BarraFantasma />

      <div className={estilos.contenedor}>
        <Cargando>
          <div className={estilos.grilla} aria-hidden="true">
            <div className={estilos.encabezado}>
              <div className={`esqueleto ${estilos.fantasmaTitulo}`} />
              <div className={`esqueleto ${estilos.fantasmaFilete}`} />
              <div className={`esqueleto ${estilos.fantasmaPrecio}`} />
              <div className={`esqueleto ${estilos.fantasmaChips}`} />
            </div>

            <div className={estilos.columnaFotos}>
              <div className={estilos.pista}>
                <ul className={estilos.galeria} role="list">
                  <li className={`esqueleto ${estilos.escenario} ${estilos.fantasmaPortada}`} />
                  {[1, 2, 3, 4].map((indice) => (
                    <li
                      key={indice}
                      className={`esqueleto ${estilos.diapositiva} ${estilos.fantasmaFoto}`}
                    />
                  ))}
                </ul>
              </div>
            </div>

            <div className={estilos.detalle}>
              <div className={`esqueleto ${estilos.fantasmaPanel}`} />
            </div>
          </div>
        </Cargando>
      </div>
    </main>
  );
}
