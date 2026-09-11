import type { ReactNode } from 'react';

import estilos from './cuenta.module.css';

/**
 * Chapa de sección: el masthead del panel del comprador.
 *
 * ⚠️ EXISTE PARA QUE LAS CATORCE PANTALLAS SE LEAN COMO UNA SECCIÓN. Sin ella
 * cada una empezaría con un `<h1>` negro sobre papel, igual que cualquier otra
 * pantalla del sitio, y nada diría "esto es tu cuenta". Es hermana de la del
 * vendedor y no la misma: `(vendedor)/chapa.tsx` importa su propio módulo, y
 * compartirla obligaría a que dos grupos de rutas dependieran de una hoja.
 *
 * ⚠️ `sup-cancha` Y `patron-vivo` NO PUEDEN IR EN EL MISMO ELEMENTO. Las dos
 * pintan `::before` —una el filo de luz que le da canto al bloque, la otra el
 * patrón de rombos en deriva— y la segunda mata a la primera sin dar ningún
 * error. Por eso el patrón vive en su propio `<span>` decorativo y vacío.
 *
 * ⚠️ NO LLEVA `overflow: hidden`. El anillo de foco no lo recorta el propio
 * elemento, pero SÍ lo recorta un ancestro con overflow oculto — y la chapa
 * lleva enlaces adentro. Lo que hay que recortar se recorta solo: el patrón con
 * su propio `overflow`, la máscara del titular con `overflow: clip`.
 */
export function ChapaDeCuenta({
  rotulo,
  titulo,
  detalle,
  lateral,
}: {
  /** De qué sección es esta pantalla. Va arriba, en versalitas. */
  rotulo: string;
  titulo: string;
  /** Una línea corta debajo del título: el email, la antigüedad, un conteo. */
  detalle?: ReactNode;
  /** La insignia de nivel, un botón, un estado. */
  lateral?: ReactNode;
}) {
  return (
    <header className={`${estilos.chapa} sup-cancha con-grano entra-acerca`}>
      <span className={`${estilos.chapaPatron} patron-vivo patron-vivo-cinta`} aria-hidden="true" />

      <div>
        <p className={estilos.chapaRotulo}>{rotulo}</p>
        {/*
          ⚠️ DOS `<span>` ANIDADOS Y NO UNO: `translateY(100%)` sin una máscara no
          es un revelado, es texto que se superpone al de abajo. El externo
          recorta, el interno se mueve.
        */}
        <h1 className={estilos.chapaTitulo}>
          <span>
            <span>{titulo}</span>
          </span>
        </h1>
        {detalle}
      </div>

      {lateral !== undefined && <div className={estilos.chapaLateral}>{lateral}</div>}
    </header>
  );
}
