'use client';

import { HojaDiagonal, PantallaDeServicio } from '@/components/pantalla-de-servicio';
import { Boton, BotonEnlace, FilaDeAcciones } from '@/components/ui';

/**
 * Pantalla de error de la raiz.
 *
 * ⚠️ TIENE QUE SER CLIENT COMPONENT: Next lo exige porque necesita el
 * `ErrorBoundary` de React, que vive en el cliente. Es la unica excepcion al
 * criterio de mantener todo en el servidor.
 *
 * ⚠️ NO SE MUESTRA `error.message`. Puede arrastrar detalle interno —una
 * consulta, una ruta, el nombre de una tabla— que no le sirve a la persona y sí
 * a quien quiera atacar. El detalle va al log del servidor.
 *
 * ⚠️ NO LLEVA `Header`, Y NO ES UN OLVIDO. La barra superior lee la sesion en
 * el servidor; si lo que fallo fue justamente esa lectura, renderizarla acá
 * volveria a fallar y el usuario veria el error del error. Por eso
 * `PantallaDeServicio` recibe `marca`: el `Logo` es presentacion pura —no lee
 * sesion— asi que devuelve la señal de en que sitio estas sin reintroducir el
 * fallo.
 *
 * ⚠️ EL ORNAMENTO NO ES LA BANDERA, Y ESA ES LA DECISION. El 404 es un problema
 * de LUGAR —esto no existe: fuera de juego— y esto es un problema de MOMENTO
 * —se rompio acá y ahora—. Usar el simbolo del offside en los dos lo vacia.
 *
 * ⚠️ DEJO DE SER UN `EstadoVacio`. Esa primitiva es la caja de borde punteado
 * que significa "esta lista esta vacia", y se estaba usando en la pantalla que
 * mas gente ve sin haberla pedido.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <PantallaDeServicio codigo="Pausa" titulo="Se paró el juego" ornamento={<HojaDiagonal />} marca>
      <p>
        Tuvimos un problema al cargar esta página. No es cosa tuya y no perdiste nada: probá de
        nuevo y, si vuelve a pasar, entrá al catálogo y seguí desde ahí.
      </p>

      {/*
        ⚠️ `centrada={false}`: la escena alinea todo a la izquierda, y una fila de
        botones centrada en el medio de una columna alineada a la izquierda se lee
        como un bloque suelto que se olvidaron de acomodar.

        Los dos botones toman los tokens oscuros que `.sup-fosa` remapea, asi que
        el primario sale en Amarillo Cambio sobre tinta (13.97:1) sin una sola
        variante "oscura" escrita a mano.
      */}
      <FilaDeAcciones centrada={false}>
        <Boton onClick={reset} variante="primario">
          Reintentar
        </Boton>
        <BotonEnlace href="/" variante="secundario">
          Ir al catálogo
        </BotonEnlace>
      </FilaDeAcciones>
    </PantallaDeServicio>
  );
}
