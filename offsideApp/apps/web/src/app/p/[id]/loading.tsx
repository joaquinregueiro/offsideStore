import { BarraFantasma, Cargando } from '@/components/esqueletos';

import estilos from './page.module.css';

/** Esqueleto de la ficha, con las mismas tres columnas para que nada salte al cargar. */
export default function CargandoFicha() {
  return (
    <main id="contenido" className={estilos.pagina}>
      <BarraFantasma />

      <div className={estilos.contenedor}>
        <Cargando>
          <div className={estilos.tarjeta} aria-hidden="true">
            <div className={estilos.grilla}>
              <div className={`esqueleto ${estilos.fantasmaFoto}`} />
              <div className={estilos.encabezado}>
                <div className={`esqueleto ${estilos.fantasmaTitulo}`} />
                <div className={`esqueleto ${estilos.fantasmaPrecio}`} />
              </div>
              <div className={`esqueleto ${estilos.fantasmaCaja}`} />
            </div>
          </div>
        </Cargando>
      </div>
    </main>
  );
}
