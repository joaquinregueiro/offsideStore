import { BarraFantasma, Cargando, EsqueletoDeVitrina } from '@/components/esqueletos';
import { Contenedor, Esqueleto } from '@/components/ui';

import estilos from './loading.module.css';

/**
 * Carga de las pantallas publicas: vitrina, busqueda y ficha.
 *
 * ⚠️ ESTE ES EL LIMITE DE SUSPENSE DEL SEGMENTO RAIZ, asi que cubre TODA ruta
 * que no tenga uno mas cercano. Por eso cada grupo —(auth), (compra),
 * (vendedor), (admin)— tiene el suyo: si no, alguien entrando a "Ingresar"
 * veria durante un instante el esqueleto de una grilla de camisetas.
 *
 * ⚠️ EL FANTASMA DE PORTADA NO ES ADORNO. Sin el, el esqueleto arranca con una
 * grilla gris arriba de todo y la pagina real llega con una portada verde de
 * casi una pantalla: el salto es de setecientos pixeles y ocurre en CADA visita,
 * porque la vitrina es `force-dynamic`. Un esqueleto que no se parece a lo que
 * viene despues promete una pagina y entrega otra.
 *
 * ⚠️ EL FANTASMA NO LLEVA `patron-vivo` NI `paralaje-portada`. Es lo que se ve
 * mientras el navegador todavia esta trabajando: sumarle una animacion infinita
 * y una linea de tiempo de scroll es gastar compositor justo en el peor momento,
 * y ademas nada de eso se percibe en los ~300ms que dura.
 *
 * ⚠️ LA CLASE VA EN UN TEMPLATE Y NO PELADA. Con `noUncheckedIndexedAccess`,
 * `estilos.loQueSea` de un CSS Module es `string | undefined` —el tipo que
 * genera Next para `*.module.css` es una firma de indice— y `Esqueleto` declara
 * `className?: string` sin `| undefined`, que con `exactOptionalPropertyTypes`
 * no lo acepta. El template lo resuelve sin tocar la primitiva, que no es de
 * esta superficie.
 */
export default function CargandoVitrina() {
  return (
    <main id="contenido">
      <BarraFantasma />

      <div className={`${estilos.portadaFantasma} sup-cancha con-grano`} aria-hidden="true">
        <div className={estilos.portadaFantasmaInterior}>
          <Esqueleto alto={12} ancho="180px" className={`${estilos.lineaClara}`} />
          <Esqueleto alto={64} ancho="min(9ch, 60%)" className={`${estilos.lineaClara}`} />
          <Esqueleto alto={64} ancho="min(12ch, 74%)" className={`${estilos.lineaClara}`} />
          <Esqueleto alto={16} ancho="min(46ch, 100%)" className={`${estilos.lineaClara}`} />
          <Esqueleto alto={44} ancho="min(260px, 100%)" className={`${estilos.lineaClara}`} />
        </div>
      </div>

      <Contenedor vertical>
        <Cargando>
          <EsqueletoDeVitrina />
        </Cargando>
      </Contenedor>
    </main>
  );
}
