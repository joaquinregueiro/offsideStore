import { Cargando } from '@/components/esqueletos';

import estilos from './vendedor.module.css';

/**
 * Carga del grupo (vendedor).
 *
 * ⚠️ EXISTE PARA NO HEREDAR EL DE LA RAIZ, que dibuja una grilla de camisetas. La
 * barra superior no hace falta acá: la pone el layout del grupo y sigue en
 * pantalla mientras esto se muestra.
 *
 * ⚠️ SOLO SE DIBUJA LO QUE TIENEN LAS NUEVE PANTALLAS DEL GRUPO: la chapa, el
 * riel de la navegación y tres bloques de contenido. El tablero de cifras y las
 * filas del inventario existen en tres de las nueve, así que prometerlos acá
 * produce el salto que un esqueleto viene a evitar —`/vendedor/empezar` y
 * `/vendedor/fiscal` son un formulario corto y nada más—.
 *
 * ⚠️ EL SHIMMER LO APORTA LA CLASE GLOBAL `.esqueleto`. Un esqueleto quieto no se
 * lee como "cargando", se lee como "roto" — y todas las pantallas del sitio son
 * `force-dynamic`, o sea que esto se ve en cada navegación.
 *
 * ⚠️ `aria-hidden` EN LAS CAJAS Y `aria-busy` EN LA REGION (lo pone `Cargando`).
 * El estado de carga se anuncia una vez; describir cajas grises no le sirve a
 * nadie.
 */
export default function CargandoPantalla() {
  return (
    <main id="contenido" className={estilos.pagina}>
      <Cargando>
        <div aria-hidden="true">
          <div className={`${estilos.cargandoChapa} esqueleto`} />
          <div className={`${estilos.cargandoNav} esqueleto`} />
          <div className={estilos.cargandoBloques}>
            <div className={`${estilos.cargandoBloque} esqueleto`} />
            <div className={`${estilos.cargandoBloque} esqueleto`} />
            <div className={`${estilos.cargandoBloque} esqueleto`} />
          </div>
        </div>
      </Cargando>
    </main>
  );
}
