import { Cargando } from '@/components/esqueletos';

import estilos from './admin.module.css';

/**
 * Carga del grupo (admin).
 *
 * ⚠️ EXISTE PARA NO HEREDAR EL DE LA RAIZ, que dibuja una grilla de camisetas.
 * La barra superior no hace falta acá — la pone el layout del grupo y sigue en
 * pantalla mientras esto se muestra.
 *
 * ⚠️ TIENE LA FORMA DE LO QUE VIENE, Y NO ES PROLIJIDAD. El grupo entero es
 * `force-dynamic`: esto se ve SIEMPRE, en cada entrada a cada una de las tres
 * pantallas. Con cuatro líneas grises sobre papel, al resolverse la navegación
 * aparecía de golpe una banda oscura a sangre — un salto de fondo completo.
 *
 * ⚠️ SE DIBUJAN LOS CUATRO RENGLONES DE LA BANDA —rótulo, identidad, pestañas y
 * título— y también el filete. Cada uno que falte es un alto distinto al de la
 * consola real, y la diferencia se paga como un salto del título en el momento
 * exacto en que la pantalla resuelve.
 *
 * ⚠️ LOS BLOQUES DE LA BANDA NO USAN LA CLASE GLOBAL `.esqueleto`: su brillo es
 * `rgb(255 255 255 / 0.75)`, calibrado contra una base CLARA, y sobre la banda
 * oscura sería un flash. En la hoja sí se usa, que es donde corresponde.
 *
 * ⚠️ LA BANDA VA `aria-hidden`: el estado de carga se anuncia con el `aria-busy`
 * de `Cargando`, no describiendo rectángulos.
 */
export default function CargandoPantalla() {
  return (
    <main id="contenido" className={estilos.pagina}>
      <div className={`${estilos.consola} sup-noche con-grano`} aria-hidden="true">
        <span className={estilos.rombos} />
        <div className={estilos.consolaCentro}>
          <div className={estilos.consolaEncabezado}>
            <p className={estilos.marcaConsola}>Back-office</p>
            <span className={`${estilos.esqueletoOscuro} ${estilos.esqueletoIdentidad}`} />
          </div>

          <div className={estilos.esqueletoTabs}>
            <span className={`${estilos.esqueletoOscuro} ${estilos.esqueletoTab}`} />
            <span className={`${estilos.esqueletoOscuro} ${estilos.esqueletoTab}`} />
            <span className={`${estilos.esqueletoOscuro} ${estilos.esqueletoTab}`} />
          </div>

          <span className={`${estilos.esqueletoOscuro} ${estilos.esqueletoTitulo}`} />
          <hr className={estilos.filete} />
        </div>
      </div>

      <div className={estilos.hoja}>
        <Cargando>
          <div className={estilos.esqueletoBloques} aria-hidden="true">
            <span className={`${estilos.esqueletoBloque} esqueleto`} />
            <span className={`${estilos.esqueletoBloque} esqueleto`} />
            <span className={`${estilos.esqueletoBloque} esqueleto`} />
          </div>
        </Cargando>
      </div>
    </main>
  );
}
