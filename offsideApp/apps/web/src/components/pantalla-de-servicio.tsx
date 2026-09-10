import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

import { Isotipo, Logo } from './marca';
import { Blobs } from './movimiento';
import { Contenedor } from './ui';

import estilos from './pantalla-de-servicio.module.css';

/**
 * LA BANDERA IZADA — ornamento del 404.
 *
 * ⚠️ ES EL GESTO LITERAL DEL FUERA DE JUEGO. La animacion la levanta desde
 * 38deg hasta su reposo en -12deg y despues la deja ondeando apenas: es la
 * unica animacion del sitio que dice literalmente lo que la pantalla significa.
 * El halo de Amarillo Cambio alrededor es estatico y va FUERA del dibujo.
 */
export function BanderaIzada() {
  return (
    <span className={estilos.bandera}>
      <Isotipo alto={72} />
    </span>
  );
}

/**
 * LA HOJA DIAGONAL — ornamento del error.
 *
 * ⚠️ NO ES LA BANDERA, Y ESA ES LA DECISION. El 404 es un problema de LUGAR y el
 * error es un problema de MOMENTO. Las rayas cruzan en el eje del sistema y
 * entran con un telon diagonal: se lee "se paro el juego" sin gastar el simbolo
 * del offside en algo que no es un offside.
 */
export function HojaDiagonal() {
  return <span className={`${estilos.hoja} entra-telon-diagonal`} />;
}

/**
 * Escena de servicio: el 404 y el error de la raiz.
 *
 * ⚠️ EXISTE PORQUE ERAN LA MISMA PANTALLA ESCRITA DOS VECES, y las dos con la
 * primitiva mas neutra del sistema: `EstadoVacio`, o sea la caja de borde
 * punteado que significa "esta lista esta vacia". Un 404 no es una lista vacia.
 *
 * ⚠️ VERSION LUMINOSA (2026-09-10). La escena es fosa con tres blobs que
 * flotan detras, el codigo grande lleva el gradiente claro vivo con la banda
 * de luz que lo cruza una vez y un halo alrededor, el texto y las acciones van
 * en un panel de vidrio oscuro, y la esquina inferior de la escena se redondea
 * para que la tira de recuperacion se lea como otra capa. Todo entra
 * escalonado en el primer segundo; nada late despues.
 *
 * ⚠️ NO LO USA `ErrorDePantalla` DE LOS GRUPOS, y no es un olvido: ese vive
 * DENTRO del layout de su grupo —en (auth) cae en una columna angosta al lado
 * del panel de marca— asi que tiene que ser un panel contenido.
 *
 * ⚠️ NO LLEVA `'use client'`. Lo importa `app/error.tsx`, que si es cliente:
 * como no tiene estado ni manejadores, se compila para el cliente sin sumar
 * logica.
 */
export function PantallaDeServicio({
  codigo,
  titulo,
  ornamento,
  marca = false,
  pie,
  children,
}: {
  /**
   * El rotulo grande. Es ORNAMENTO y va `aria-hidden`: el significado lo carga
   * el `<h1>` y el texto de abajo. Un lector de pantalla leyendo "cuatrocientos
   * cuatro" no informa nada que el titulo no diga mejor — por eso el numero de
   * error se escribe TAMBIEN en el parrafo.
   */
  codigo: string;
  titulo: string;
  /** `<BanderaIzada />` en el 404, `<HojaDiagonal />` en el error. */
  ornamento: ReactNode;
  /**
   * Muestra el logo con enlace al catalogo. Solo lo usa el error de la raiz,
   * que es la unica pantalla del sitio sin barra superior.
   */
  marca?: boolean;
  /**
   * Contenido que va DESPUES de la escena, sobre papel y fuera de la superficie
   * oscura. ⚠️ Es donde tiene que ir cualquier ficha de catalogo: adentro de
   * `.sup-fosa`, `--color-neutro-tenue` se remapea a #8fa79a y sobre el blanco
   * de la ficha da 2.57:1.
   */
  pie?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main id="contenido" className={estilos.marco}>
      {/*
        ⚠️ `escena-luz` SOBRE `sup-fosa` NO SUBE EL PRESUPUESTO DE LOS BLOBS
        (0.14 / 0.08 es el techo de fosa, medido en tokens.css) pero si deja
        escrito que aca la luz se VE. Las dos clases traen `position: relative;
        isolation: isolate`, que es lo que mantiene las capas de z -1 adentro.
      */}
      <section className={`${estilos.escena} sup-fosa escena-luz`}>
        {/*
          ⚠️ CAPAS DE FONDO ANIDADAS Y NINGUNA COMPARTE ELEMENTO CON `.sup-fosa`:
          `.sup-fosa::before` es el filo de luz y `.patron-vivo::before` es el
          patron. Misma especificidad, y `movimiento.css` gana por orden de
          importacion, asi que compartir elemento apaga el filo sin avisar. Los
          blobs van primero: la trama de rombos se pinta encima de la luz.
        */}
        <Blobs />
        <div className={`${estilos.trama} flota flota-lento`} aria-hidden="true">
          <div className={`${estilos.tramaCapa} patron-vivo`} />
        </div>

        {/*
          ⚠️ LAS ENTRADAS VAN CLASE POR CLASE Y NO CON `.escena-entra`, y es a
          proposito: esa clase reparte las animaciones por ORDEN de hijos, y
          aca el orden cambia segun `marca` —el error de la raiz lleva el logo
          adelante y el 404 no—. Con clases explicitas cada pieza entra igual
          en las dos pantallas.

          ⚠️ EL TEMPLATE LITERAL NO SOBRA. `Contenedor` declara
          `className?: string` sin `| undefined`, y `estilos.contenido` es
          `string | undefined` por `noUncheckedIndexedAccess`.
        */}
        <Contenedor ancho="medio" className={`${estilos.contenido}`}>
          {marca && (
            <Link
              href="/"
              className={`${estilos.marcaEnlace} marca-brilla entra-veloz`}
              aria-label="Offside Store — inicio"
            >
              <Logo invertido alto={26} />
            </Link>
          )}

          {/*
            El ornamento se ENCIENDE (escala con overshoot y un flash de halo)
            mientras adentro la bandera se iza o la hoja se descorre. Son dos
            elementos distintos, asi que las dos animaciones conviven.
          */}
          <div
            className={`${estilos.ornamento} enciende`}
            style={{ '--retraso': '80ms' } as CSSProperties}
            aria-hidden="true"
          >
            {ornamento}
          </div>

          {/*
            ⚠️ EL HALO DEL CODIGO VA EN UN ENVOLTORIO, NO EN EL `<p>`. La banda
            de luz de `.shimmer-titulo` anima `filter` con `both`, asi que un
            `filter: drop-shadow` puesto en el mismo elemento quedaria pisado
            para siempre por el `blur(0)` final de la entrada. El envoltorio
            filtra el resultado —gradiente recortado al texto incluido— y no se
            anima nunca.
          */}
          <div className={estilos.codigoHalo} aria-hidden="true">
            <p
              className={`${estilos.codigo} shimmer-titulo`}
              style={{ '--retraso': '140ms' } as CSSProperties}
            >
              {codigo}
            </p>
          </div>

          <h1
            className={`${estilos.titulo} entra-luz`}
            style={{ '--retraso': '280ms' } as CSSProperties}
          >
            {titulo}
          </h1>

          {/*
            ⚠️ VIDRIO OSCURO PARA EL TEXTO Y LAS ACCIONES. Fosa al 86% con
            desenfoque: deja pasar la luz de los blobs difuminada y remapea los
            mismos tokens que `.sup-noche`, asi que el boton primario sale en
            Amarillo Cambio sobre tinta y el parrafo en `--color-sobre-oscuro-2`
            sin una variante escrita a mano. Medido en tokens.css: hasta con
            blanco puro detras todos los tokens de noche pasan AA.
          */}
          <div
            className={`${estilos.cuerpo} sup-vidrio-oscuro entra`}
            style={{ '--retraso': '400ms' } as CSSProperties}
          >
            {children}
          </div>
        </Contenedor>
      </section>

      {pie}
    </main>
  );
}

/**
 * TIRA DE RECUPERACION — lo que va DESPUES de la escena, sobre papel.
 *
 * ⚠️ EXISTE PARA QUE EL 404 NO SEA UN CALLEJON. Quien cae aca desde el enlace
 * de una camiseta que ya se vendio —un enlace de WhatsApp sobrevive al
 * catalogo— no quiere la home: quiere otra camiseta parecida.
 *
 * ⚠️ VA FUERA DE `.sup-fosa` Y ESO NO ES ESTETICA. Las fichas de catalogo
 * declaran `background: var(--color-blanco)` literal, asi que adentro de una
 * superficie oscura seguirian siendo blancas — pero sus tokens de TEXTO si se
 * remapean: el nombre del vendedor usa `--color-neutro-tenue`, que dentro de
 * `.sup-fosa` vale #8fa79a y sobre blanco da **2.57:1**. Una ficha de catalogo
 * no puede entrar a un bloque oscuro hasta que migre a `--superficie-1`.
 *
 * ⚠️ ES UNA `.escena-luz` SOBRE PAPEL: dos blobs que se ven detras de las
 * fichas, con los tokens de texto remapeados a los que aguantan el punto mas
 * claro (medido en tokens.css: texto 4.88-5.18, enlace 5.84, borde 3.05+).
 *
 * ⚠️ LOS HIJOS TIENEN QUE SER `<li>`: el contenedor es una lista, para que un
 * lector de pantalla anuncie cuantas opciones hay antes de recorrerlas.
 */
export function TiraDeRecuperacion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className={`${estilos.recuperacion} escena-luz`}>
      {/* Dos luces alcanzan: la principal arriba a la derecha y la calida abajo a la izquierda. */}
      <Blobs luces={[{ tono: 'cancha' }, { tono: 'cambio', x: '10%', y: '92%' }]} />

      <div className={estilos.recuperacionContenido}>
        <h2 className={`${estilos.recuperacionTitulo} revela`}>{titulo}</h2>
        {/* El escalonado sale de la geometria: cada ficha se revela al entrar, con la curva viva. */}
        <ul className={`${estilos.recuperacionGrilla} revela-grilla-luz`}>{children}</ul>
      </div>
    </section>
  );
}
