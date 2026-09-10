import type { CSSProperties } from 'react';

import estilos from './resumen.module.css';

/**
 * Los tres pasos de una compra, en un solo lugar.
 *
 * ⚠️ LOS ROTULOS SON CORTOS POR UNA RESTRICCION MEDIDA, no por gusto: a 320px
 * con `--canal` en 16px quedan 288px utiles, cada columna mide 96px y el texto
 * lleva `--espacio-1` de padding a cada lado, o sea 88px. A 12px en Inter 600
 * mayusculas entran nueve caracteres justos: "Dirección" y "Confirmar" son
 * exactamente nueve. "Confirmación" —doce— se pasaba y se partia en dos lineas
 * en el elemento que existe para decirte en que paso de un pago estas.
 *
 * ⚠️ EL DETALLE COMPLETO VIAJA EN UN `.solo-lectores`. Quien usa lector de
 * pantalla escucha "Pagar con Mercado Pago — en curso", que es la frase util;
 * quien mira la pantalla lee "Pago" y ve el rombo lleno con su anillo.
 */
const PASOS = [
  { titulo: 'Dirección', detalle: 'Confirmar la dirección de envío' },
  { titulo: 'Pago', detalle: 'Pagar con Mercado Pago' },
  { titulo: 'Confirmar', detalle: 'Confirmación del pago' },
] as const;

/**
 * Linea de pasos de la compra.
 *
 * ⚠️ REEMPLAZA A `<Pasos>` EN ESTE TRAMO PORQUE ESE COMPONENTE SOLO CONOCE
 * HECHO Y NO HECHO: en `/comprar` los tres pasos se pasaban con `hecho: false`,
 * asi que imprimia tres "pendiente" y **nada indicaba en cual estabas**. Es un
 * defecto de informacion, no de estilo. `Pasos` sigue intacto y en uso en el
 * panel del vendedor.
 *
 * @param actual En que paso esta la persona AHORA (1, 2 o 3). `4` significa que
 *   los tres estan cerrados: la orden ya se pago.
 * @param animar Si el riel se dibuja al primer pintado.
 *
 *   ⚠️ EXISTE POR EL `<meta http-equiv="refresh">` DEL CHECKOUT. Mientras se
 *   confirma un pago, la pantalla se recarga entera cada cinco segundos: cada
 *   recarga es un primer pintado y el riel se volveria a dibujar cinco veces,
 *   al lado del importe. Quien sabe si eso esta pasando es la pantalla.
 */
export function RutaDeCompra({
  actual,
  animar = true,
}: {
  actual: 1 | 2 | 3 | 4;
  animar?: boolean;
}) {
  /*
   * El riel llega al CENTRO del paso actual. Que llegue hasta el tercer rombo
   * mientras todavia se confirma no miente: ese rombo esta marcado como "en
   * curso" —anillo, no tilde—, asi que se lee "llegaste al ultimo paso y esta
   * pasando", que es exactamente lo que ocurre.
   */
  const avance = Math.min(actual - 1, PASOS.length - 1) / (PASOS.length - 1);

  return (
    <nav
      className={estilos.ruta}
      aria-label="Progreso de la compra"
      /*
        ⚠️ LA CANTIDAD DE PASOS ES UN DATO Y VIAJA COMO TAL. El riel se posiciona
        con `50% / var(--pasos)`, que es el centro de la primera y de la ultima
        columna: el dia que exista el modulo de envios y haya un cuarto paso, el
        riel sigue cayendo sobre las marcas sin tocar una linea de CSS.
      */
      style={{ '--pasos': PASOS.length, '--avance': avance } as CSSProperties}
    >
      {/*
        ⚠️ EL RIEL VA PRIMERO EN EL DOM. Asi las marcas se pintan encima sin
        necesitar un z-index mas alto que el resto de la pantalla.
      */}
      <div className={estilos.rutaRiel} aria-hidden="true">
        <span
          className={[estilos.rutaAvance, animar ? estilos.rutaAvanceAnimada : '']
            .filter(Boolean)
            .join(' ')}
        />
      </div>

      <ol className={estilos.rutaLista}>
        {PASOS.map((paso, indice) => {
          const numero = indice + 1;
          const hecho = numero < actual;
          const esActual = numero === actual;

          return (
            <li
              key={paso.titulo}
              className={[
                estilos.rutaPaso,
                hecho ? estilos.rutaHecho : '',
                esActual ? estilos.rutaActual : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-current={esActual ? 'step' : undefined}
            >
              {/*
                El rombo esta rotado 45 grados por CSS; el `<span>` de adentro se
                contra-rota para que el numero se lea derecho.
              */}
              <span className={estilos.rutaMarca} aria-hidden="true">
                <span>{hecho ? '✓' : numero}</span>
              </span>
              <span className={estilos.rutaTexto} aria-hidden="true">
                {paso.titulo}
              </span>
              <span className="solo-lectores">
                {paso.detalle} — {hecho ? 'listo' : esActual ? 'en curso' : 'pendiente'}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
