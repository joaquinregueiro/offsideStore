import { BarraFantasma, Cargando, EsqueletoDeVitrina } from '@/components/esqueletos';

import estilos from './page.module.css';

/**
 * Carga de `/buscar`.
 *
 * ⚠️ ANTES CAIA EN `app/loading.tsx`, el del segmento raiz, que es el esqueleto
 * de la VITRINA. Esta pantalla es la consulta mas cara del sitio —full-text mas
 * trigramas mas diez agregaciones de faceta— y es `force-dynamic`, asi que la
 * espera es real y se ve.
 *
 * ⚠️ LA BANDA SE PINTA ENTERA PORQUE NO DEPENDE DE LA CONSULTA: el fondo, el
 * grano, los rombos y el kicker son los mismos con cualquier busqueda. Lo unico
 * que se reemplaza al llegar el dato es el titular y el marcador. Eso es lo que
 * convierte "pantalla en blanco" en "la pagina ya esta, falta el contenido".
 *
 * ⚠️ LA BARRA FANTASMA HACE FALTA. Las tres pantallas publicas —vitrina,
 * busqueda y ficha— renderizan su propio `Header` DENTRO de la pagina, asi que
 * durante la carga desaparece y el sitio se ve decapitado. En los grupos de
 * rutas la barra la pone el layout y esto no hace falta.
 *
 * ⚠️ LA GRILLA VA SIN ENCABEZADO PROPIO: el rotulo y el titular ya los dibuja la
 * banda de arriba. Con los dos, al llegar el contenido desaparecen dos barras
 * grises que nunca tuvieron un equivalente real y la pagina salta.
 */
export default function CargandoBusqueda() {
  return (
    <main id="contenido" className={estilos.pagina}>
      <BarraFantasma />

      <div className={`${estilos.franja} sup-noche con-grano`}>
        <div className={`${estilos.rombos} patron-vivo`} aria-hidden="true" />

        <div className={estilos.franjaCuerpo}>
          <p className={estilos.kicker}>Catálogo</p>
          <h1 className={`${estilos.titulo} display display-3`}>
            <span>
              <span>Buscando</span>
            </span>
          </h1>
        </div>
      </div>

      <div className={estilos.cuerpo}>
        <Cargando>
          <EsqueletoDeVitrina conEncabezado={false} />
        </Cargando>
      </div>
    </main>
  );
}
