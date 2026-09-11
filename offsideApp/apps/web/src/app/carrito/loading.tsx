import { Cargando } from '@/components/esqueletos';
import { Esqueleto } from '@/components/ui';

import estilos from './carrito.module.css';

/**
 * Carga del carrito.
 *
 * ⚠️ EXISTE PARA NO HEREDAR EL DE LA RAIZ, que dibuja una grilla de camisetas:
 * el carrito es una lista de filas anchas, y un esqueleto con la forma
 * equivocada produce un salto al llegar el contenido —que es peor que no poner
 * nada—.
 *
 * ⚠️ `aria-hidden` EN EL DIBUJO Y `aria-busy` EN LA REGION. Los rectangulos no
 * existen para quien no ve la pantalla; lo que necesita es saber que se esta
 * cargando, y eso lo dice `<Cargando>`.
 */
export default function CargandoCarrito() {
  return (
    <main id="contenido" className={estilos.pagina}>
      <Cargando>
        <div className={estilos.cabecera}>
          <Esqueleto alto={36} ancho="45%" />
        </div>

        <div className={estilos.fantasma} aria-hidden="true">
          {[0, 1].map((fila) => (
            <div key={fila} className={estilos.fantasmaLinea}>
              <Esqueleto alto={105} ancho={84} />
              <div className={estilos.fantasmaTexto}>
                <Esqueleto alto={16} ancho="70%" />
                <Esqueleto alto={14} ancho="40%" />
                <Esqueleto alto={32} ancho="55%" />
              </div>
            </div>
          ))}
        </div>
      </Cargando>
    </main>
  );
}
