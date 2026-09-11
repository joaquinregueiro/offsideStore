import { Cargando } from '@/components/esqueletos';

import estilos from './cuenta.module.css';

/**
 * Carga del grupo (cuenta).
 *
 * ⚠️ EXISTE PARA NO HEREDAR EL DE LA RAÍZ, que dibuja una grilla de camisetas.
 * La barra superior no hace falta acá: la pone el layout del grupo y sigue en
 * pantalla mientras esto se muestra.
 *
 * ⚠️ SÓLO SE DIBUJA LO QUE TIENEN TODAS LAS PANTALLAS DEL GRUPO: la chapa, el
 * riel de pestañas y tres bloques. El tablero de cifras existe en una sola de
 * las catorce, así que prometerlo acá produce el salto que un esqueleto viene a
 * evitar.
 *
 * ⚠️ EL SHIMMER LO APORTA LA CLASE GLOBAL `.esqueleto`. Un esqueleto quieto no
 * se lee como "cargando", se lee como "roto" — y todas las pantallas del sitio
 * son `force-dynamic`, o sea que esto se ve en cada navegación.
 *
 * ⚠️ NO LLEVA BLOBS. Una capa promovida (`will-change: transform`) que se crea,
 * flota 200ms y se destruye es GPU gastada en el único momento en que el
 * navegador ya está ocupado.
 *
 * ⚠️ `aria-hidden` EN LAS CAJAS Y `aria-busy` EN LA REGIÓN (lo pone `Cargando`).
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
