'use client';

import { Boton, BotonEnlace, Contenedor, FilaDeAcciones } from './ui';

import estilos from './error-de-pantalla.module.css';

/**
 * Cuerpo compartido de los límites de error de grupo.
 *
 * ⚠️ HAY UN `error.tsx` POR GRUPO DE RUTAS Y NO UNO SOLO EN LA RAIZ. El de la
 * raíz reemplaza TODO el árbol: un fallo al cargar una orden se llevaba puesto
 * el layout del grupo —y con él la barra superior y el pie—, justo cuando el
 * comprador no sabe si su pago pasó y necesita poder navegar a "Mis compras".
 * Dentro del grupo, el layout sobrevive y sólo se reemplaza el contenido.
 *
 * ⚠️ NO SE MUESTRA `error.message`. Puede arrastrar detalle interno —una
 * consulta, una ruta, el nombre de una tabla— que no le sirve a la persona y sí
 * a quien quiera atacar. El detalle va al log del servidor.
 *
 * ⚠️ LA SUPERFICIE ES `.sup-flotante`, NO `.sup-ficha` (2026-09-10): radio de
 * panel (24px), sombra de objeto levantado y un glow suave de marca en reposo.
 * Es la clase del sistema para "algo que tapa la pagina", que es exactamente lo
 * que un limite de error hace. El modulo propio no cambia: la cinta de rayas
 * naranjas y el cuerpo siguen iguales, y `overflow: hidden` respeta el radio
 * nuevo solo.
 *
 * ⚠️ LA UNICA ANIMACION DE ENTRADA ES `entra-seco`, Y ES LA REGLA, NO UNA
 * LIMITACION. `.entra-seco` son 140ms de opacidad, sin desplazamiento: alcanza
 * para que el ojo registre que llegó algo nuevo y no para que se sienta una
 * animación. Un error que entra deslizándose durante medio segundo se lee como
 * una alarma, y esta pantalla ya interrumpe bastante por sí sola. El glow del
 * panel es estático: un error no late.
 */
export function ErrorDePantalla({
  titulo,
  detalle,
  volverA,
  textoVolver,
  reset,
}: {
  titulo: string;
  detalle: string;
  volverA: string;
  textoVolver: string;
  reset: () => void;
}) {
  return (
    <Contenedor ancho="angosto" vertical>
      <section className={`${estilos.panel} sup-flotante entra-seco`}>
        <span className={estilos.cinta} aria-hidden="true" />

        <div className={estilos.cuerpo}>
          <p className={estilos.rotulo}>Error del sitio</p>

          {/*
            ⚠️ ES UN `<h1>` Y ANTES TAMBIEN LO ERA: cuando el límite de error
            reemplaza el contenido, el `<h1>` de la pantalla original ya no
            existe. Sin este, la página se queda sin encabezado de nivel uno y
            el atajo "ir al título" no lleva a ninguna parte.
          */}
          <h1 className={`${estilos.titulo} display display-3`}>{titulo}</h1>

          <p className={estilos.detalle}>{detalle}</p>

          <div className={estilos.acciones}>
            {/*
              ⚠️ "REINTENTAR" VA PRIMERO Y ES SECUNDARIO. Reintentar es lo que
              más probablemente funcione —la mayoría de estos fallos son de red
              o de una consulta que tardó—, pero la acción afirmativa de la
              pantalla es salir a un lugar seguro: dejar el reintento como botón
              primario invita a golpearlo en loop.

              ⚠️ EL PRIMARIO YA TRAE `luz-filo` DESDE `ui.tsx` (`clasesDeBoton`
              se la agrega a toda variante primaria): la banda de luz de 2px
              que corre por el filo al aparecer y en cada hover no se pide acá.
              Pasarla otra vez por `className` la duplicaba en el `class` del
              enlace sin cambiar nada.

              ⚠️ `centrada={false}`: el panel es editorial y se lee de
              izquierda a derecha. Botones centrados debajo de un texto
              alineado a la izquierda es la firma del diálogo genérico.
            */}
            <FilaDeAcciones centrada={false}>
              <Boton onClick={reset} variante="secundario">
                Reintentar
              </Boton>
              <BotonEnlace href={volverA}>{textoVolver}</BotonEnlace>
            </FilaDeAcciones>
          </div>
        </div>
      </section>
    </Contenedor>
  );
}
