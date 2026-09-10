import type { ReactNode } from 'react';

<<<<<<< HEAD
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { IconoAutenticado, IconoEtiqueta, IconoIntercambio } from '@/components/iconos';
import { Logo } from '@/components/marca';

import estilos from './auth.module.css';

/**
 * Todas las pantallas de autenticacion comparten la barra, el pie y el panel de
 * marca.
 *
 * ⚠️ EL PANEL VA EN EL LAYOUT, NO EN CADA PANTALLA. Son seis pantallas y
 * repetirlo seis veces garantiza que en algun momento digan cosas distintas.
 *
 * ⚠️ EL TEXTO ES EL MISMO EN LAS SEIS, y sigue siendo deliberado: quien esta
 * creando una cuenta y quien esta recuperando una contraseña necesitan la misma
 * respuesta a la misma pregunta —"¿por que le doy mis datos a este sitio?"—. Lo
 * que cambia por pantalla es el antetitulo y el titular, que viven en cada
 * `page.tsx`.
 *
 * ⚠️ EL `<main>` LO PONE ESTE LAYOUT Y NINGUNA PANTALLA PUEDE PONER OTRO. Ese
 * bug ya se arreglo una vez.
 *
 * ⚠️ LA SUPERFICIE NO SE ESCRIBE A MANO. `sup-cancha` trae la malla de marca, el
 * filo de luz, los ocho tokens de boton, `--color-foco` en Amarillo Cambio y
 * `--patron-color`; `con-grano` trae la textura de papel impreso. Antes esto era
 * `background: var(--color-cancha)` a secas, y por eso quedaba afuera de
 * cualquier mejora del sistema.
 */

/**
 * ⚠️ SON CLUBES REALES DEL CATALOGO, NO VERBOS DE MARCA. La migracion `0007`
 * siembra estos clubes con sus alias; esta lista es un subconjunto y es COPY, no
 * un dato vivo: no necesita ninguna consulta y el layout —Server Component
 * compartido por las seis pantallas— sigue sin una sola query. Meterle una query
 * a /ingresar y a /verificar-email, que son pantallas donde alguien esta apurado
 * o frustrado, cuesta mas de lo que aporta.
 *
 * ⚠️ CON TILDES Y APOSTROFE, aunque en la base los nombres esten sin acentos:
 * esto es texto visible.
 */
const CLUBES = [
  'River Plate',
  'Boca Juniors',
  'Racing',
  'Independiente',
  'San Lorenzo',
  'Vélez',
  'Huracán',
  'Estudiantes',
  "Newell's",
  'Rosario Central',
  'Talleres',
  'Lanús',
];

/**
 * ⚠️ DOS GRUPOS, Y LA CONDICION ES GEOMETRICA: `.marquesina-pista` se traslada
 * exactamente `-50%` de si misma, asi que el bucle es continuo si UN grupo es
 * mas ancho que el contenedor. Doce nombres en Big Noodle a 22px miden ~2000px
 * contra un panel de ~600px: sobra. Con grupos mas cortos que el panel quedaria
 * verde vacio a la derecha en parte de cada vuelta.
 */
function GrupoDeCinta() {
  return (
    <ul className="marquesina-grupo">
      {CLUBES.map((club) => (
        <li key={club}>
          {club}
          <span className={estilos.rombo} />
        </li>
      ))}
    </ul>
  );
}

=======
import { Header } from '@/components/header';

/** Todas las pantallas de autenticacion comparten la barra superior. */
>>>>>>> origin/main
export default function LayoutDeAutenticacion({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
<<<<<<< HEAD

      <main id="contenido" className={estilos.marco}>
        <aside className={`${estilos.panel} sup-cancha con-grano`}>
          {/*
            ⚠️ EL PATRON NECESITA SU PROPIO ELEMENTO. Los dos pseudos del panel ya
            estan tomados: `sup-cancha::before` es el filo de luz y
            `con-grano::after` es la textura. `patron-vivo` necesita un `::before`
            libre para su capa en deriva.
          */}
          <div className={`${estilos.panelPatron} patron-vivo`} aria-hidden="true" />
          <div className={estilos.costura} aria-hidden="true" />

          <div className={estilos.panelContenido}>
            <div className="entra-acerca">
              <Logo invertido alto={34} />
            </div>

            {/*
              ⚠️ CADA LINEA EN SU PROPIO `<span>` DESDE EL SERVIDOR. No hay forma
              de partir un titular en lineas con CSS sin JavaScript, y el
              JavaScript esta descartado. Como es texto fijo y corto, componer el
              corte a mano es lo correcto: es la misma decision que se toma en
              una revista.
              ⚠️ SON `<span>` Y NO `<i>`: en Big Noodle la variacion es la
              OBLICUA, asi que un `<i>` inclinaria el titular sin que nadie lo
              haya pedido.

              ⚠️⚠️ ES UN `<p>` Y NO UN `<h2>`, Y NO ES UN DETALLE DE MARCADO. El
              panel vive en el layout, o sea ANTES del `<h1>` de la pantalla en
              el orden del documento: como encabezado, quien navega por titulos
              se choca "Camisetas con historia" primero en las SEIS pantallas y
              recien despues encuentra "Ingresar". Es copy de marca, no
              estructura del documento — la estructura la da el `<h1>` de cada
              `page.tsx`. El tamaño lo pone `display display-3`, que no depende
              del tag.
            */}
            <p className={`${estilos.panelTitulo} display display-3 entra-lineas`}>
              <span>
                <span>Camisetas</span>
              </span>
              <span>
                <span>con historia</span>
              </span>
            </p>

            <p className={`${estilos.panelBajada} entra`}>
              Una cuenta te sirve para las dos puntas: comprar la camiseta que buscabas hace años y
              vender la que ya no usás.
            </p>

            {/*
              ⚠️ SON HECHOS DEL SISTEMA, NO PROMESAS. Cada una se puede comprobar
              leyendo el codigo. No hay ningun "vendedor verificado": BR-003 y
              SS-012 dicen que conectar Mercado Pago NO otorga confianza.
              ⚠️ EN TELEFONO QUEDA SOLO LA PRIMERA (ver `auth.module.css`): tres
              items en 288px utiles empujan el campo de email fuera de pantalla.
            */}
            <ul className={`${estilos.panelLista} escalona`}>
              <li>
                <IconoIntercambio tamanio={18} />
                <span>
                  Los pagos pasan por Mercado Pago. Offside no ve los datos de tu tarjeta.
                </span>
              </li>
              <li>
                <IconoAutenticado tamanio={18} />
                <span>Para publicar hay que verificar el email y declarar identidad fiscal.</span>
              </li>
              <li>
                <IconoEtiqueta tamanio={18} />
                <span>El precio de una compra queda congelado en la orden.</span>
              </li>
            </ul>
          </div>

          {/*
            ⚠️ `aria-hidden` EN EL CONTENEDOR ENTERO, no solo en la copia. La
            cinta es decoracion repetida: un lector de pantalla que la lea una vez
            ya esta leyendo ruido, y si lee las dos copias, dos veces.
            ⚠️ SE FRENA CON `:hover` Y `:focus-within` desde la clase global. No
            hay enlaces adentro —y por eso no hay nada que perseguir con el
            teclado—, pero la regla es del sistema y no se negocia por caso.
          */}
          <div className={`${estilos.panelCinta} marquesina`} aria-hidden="true">
            <div className="marquesina-pista">
              <GrupoDeCinta />
              <GrupoDeCinta />
            </div>
          </div>
        </aside>

        <div className={estilos.columna}>{children}</div>
      </main>

      <Footer />
=======
      {children}
>>>>>>> origin/main
    </>
  );
}
