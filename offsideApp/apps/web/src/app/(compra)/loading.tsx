import { Cargando } from '@/components/esqueletos';
import { Esqueleto } from '@/components/ui';

import estilos from './resumen.module.css';

/**
 * Carga del grupo (compra).
 *
 * ⚠️ EXISTE PARA NO HEREDAR EL DE LA RAIZ, que dibuja una grilla de camisetas.
 * La barra superior no hace falta aca — la pone el layout del grupo y sigue en
 * pantalla mientras esto se muestra.
 *
 * ⚠️ LA SILUETA ES LA DEL TICKET, NO CUATRO BARRAS GRISES. Con las tres
 * pantallas en `force-dynamic` y una consulta de portadas de por medio, este es
 * literalmente el primer cuadro de cada navegacion al checkout: un esqueleto con
 * proporciones inventadas produce un salto cuando llega el contenido, que es
 * peor que no poner nada.
 *
 * ⚠️ `aria-hidden` EN EL DIBUJO Y `aria-busy` EN LA REGION. Los rectangulos no
 * existen para quien no ve la pantalla; lo que necesita es saber que se esta
 * cargando, y eso lo dice `<Cargando>`.
 */
export default function CargandoPantalla() {
  return (
    <main id="contenido" className={estilos.pagina}>
      <Cargando>
        <div className={estilos.cabecera}>
          <Esqueleto alto={36} ancho="60%" />
        </div>

        <div className={estilos.fantasma} aria-hidden="true">
          <div className={estilos.fantasmaBanda} />

          <div className={estilos.fantasmaCuerpo}>
            <Esqueleto alto={14} ancho="45%" />
            <Esqueleto alto={14} ancho="70%" />
            <Esqueleto alto={14} ancho="55%" />
          </div>

          <div className={estilos.perforacion} />

          <div className={estilos.fantasmaPie}>
            <Esqueleto alto={14} ancho="40%" />
            <Esqueleto alto={34} ancho="35%" />
          </div>
        </div>
      </Cargando>
    </main>
  );
}
