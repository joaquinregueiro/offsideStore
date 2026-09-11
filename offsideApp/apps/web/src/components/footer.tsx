import Link from 'next/link';

import estilos from './footer.module.css';
import { Logo } from './marca';

/**
 * Pie del sitio.
 *
 * ⚠️ ANTES NO EXISTIA. En NINGUNA pantalla: `grep '<footer'` daba cero. El
 * documento terminaba donde terminaba el contenido, asi que al llegar al final
 * de la vitrina —o de cualquier pantalla— no habia ninguna salida y el sitio
 * parecia cortado.
 *
 * ⚠️ NO HAY UN SOLO ENLACE A UNA PANTALLA QUE NO EXISTA. Es la tentacion obvia
 * de un pie: llenarlo de "Ayuda", "Sobre nosotros", "Prensa". Cada uno de esos
 * seria un 404 con aspecto de promesa. Las secciones que faltan estan anotadas
 * en la documentacion de implementacion, no simuladas aca.
 *
 * ⚠️ FALTAN TERMINOS Y POLITICA DE PRIVACIDAD, Y NO ES UN OLVIDO. El formulario
 * de alta ya le pide a la gente que los acepte —"Acepto los términos y
 * condiciones y la política de privacidad"— y hoy son texto plano: no hay nada
 * que leer. Redactarlos es 🔴 (requiere asesoramiento profesional,
 * `docs/01-business/legal.md`), asi que no se inventan; queda reportado como
 * bloqueo.
 *
 * ⚠️ CADA ENLACE DECLARA SU `transitionTypes`, Y NO TODOS EL MISMO. Sin el, un
 * `<Link>` cae en el `default: 'none'` de `components/movimiento.tsx` y la
 * navegacion no produce ningun cuadro por mas que `Pantalla` este puesta en el
 * destino: la falta no se ve como un error, se ve como "todavia no lo hicimos".
 * `Catálogo` vuelve a la raiz (retrocede); `Buscar` y `Mis compras` son
 * secciones hermanas del sitio (barrido); el resto entra a un flujo (avanza).
 * Mismo destino, mismo tipo que en la barra: si el mismo enlace se animara
 * distinto segun desde donde se toca, el movimiento dejaria de significar algo.
 *
 * ⚠️ TRES PLANOS, NO UNO. Antes era UN rectangulo de Tinta y por eso se leia
 * como un apendice: cinta de rombos → bloque noche con malla, grano y blobs de
 * luz → tira legal en fosa. Ninguno se escribe a mano: son clases del sistema
 * (`sup-*`, `escena-luz`, `blobs`, `patron-vivo`, `con-grano`).
 */
export function Footer() {
  return (
    /*
      Mismo criterio que la barra: el pie es el otro borde fijo de la pagina, y
      por eso tiene nombre propio de View Transition y no se anima al navegar.

      ⚠️ EL FONDO NO SE ESCRIBE ACA. `background: var(--color-tinta)` a mano era
      una de las tres declaraciones que el sistema de superficies vino a
      reemplazar: `sup-noche` trae la malla, el filo de luz, `--color-foco` en
      Amarillo Cambio y el remapeo de los neutros para fondo oscuro.
      `escena-luz` es lo que deja que los blobs se VEAN sobre noche (10% / 6%)
      y remapea lo que un blob tumba; el presupuesto esta medido en
      `tokens.css`. El radio de panel, el recorte y el halo hacia arriba los
      pone `footer.module.css`.
    */
    <footer
      className={`${estilos.pie} sup-noche escena-luz con-grano`}
      style={{ viewTransitionName: 'pie' }}
    >
      {/*
        Cinta de seccion (identidad §05), en su escala real (28px), con halo y
        una banda de luz que la recorre; el rombo se corre un mosaico EXACTO
        cada 26s, asi que el bucle es invisible. Un "200% corrido -50%"
        saltaria cada vuelta.
      */}
      <div className={`${estilos.cinta} patron-vivo patron-vivo-cinta`} aria-hidden="true" />

      {/*
        BLOBS DE LUZ detras de las columnas: verde arriba a la derecha, amarillo
        abajo a la izquierda, un verde chico arriba al medio (las posiciones por
        defecto salen del orden). Son gradientes radiales sin `filter: blur`,
        flotando con `transform` a 26s: una capa de compositor cada uno y cero
        pintura. El grano de `con-grano` pinta por encima, que es lo buscado.
        Decorativos: `aria-hidden`.
      */}
      <div className="blobs" aria-hidden="true">
        <i className="blob blob-cancha blob-grande" />
        <i className="blob blob-cambio" />
        <i className="blob blob-cancha blob-chico" />
      </div>

      {/*
        `revela-grilla-luz`: los cuatro bloques se acercan al entrar en
        pantalla, en el orden en que llegan —lo da la geometria, no un
        contador—. Dirigido por scroll porque el pie esta SIEMPRE debajo del
        pliegue: una entrada al primer pintado se consumiria donde nadie la ve.
        Sin soporte de `animation-timeline` queda dibujado, no en blanco.
      */}
      <div className={`${estilos.contenido} revela-grilla-luz`}>
        <div className={estilos.marca}>
          <Logo invertido alto={34} />

          {/*
            ⚠️ EL CLAIM ES DISPLAY Y ES LO QUE CONVIERTE AL PIE EN UN CIERRE. Con
            cuatro columnas de 13px todas iguales no habia jerarquia: habia una
            lista. `titular-vivo` le pone el gradiente que sobre noche va de
            papel a Amarillo Cambio y termina en verde-400 —4.11:1 sobre el
            peor punto de la escena, y es texto grande (≥30px): AA—. Sin
            soporte de `background-clip: text` queda en papel solido (12.59:1).

            `revela-suave` y no `entra`: el pie esta SIEMPRE debajo del pliegue,
            asi que una entrada al primer pintado se consume donde nadie la ve.
            Dirigida por scroll aparece cuando la persona llega, que es el unico
            momento en que el claim significa algo. Sin soporte de
            `animation-timeline` queda dibujado, no en blanco.
          */}
          <p className={`${estilos.claim} display display-3 oblicuo titular-vivo revela-suave`}>
            Camisetas con historia
          </p>

          <p className={estilos.bajada}>
            Compra y venta de camisetas de fútbol para coleccionistas.
          </p>
        </div>

        <nav className={estilos.columna} aria-label="Comprar">
          {/* El filete se dibuja de izquierda a derecha al entrar la seccion. */}
          <span className={`${estilos.filete} revela-linea`} aria-hidden="true" />
          <h2 className={estilos.columnaTitulo}>Comprar</h2>
          <Link href="/" className={estilos.enlace} transitionTypes={['retrocede']}>
            Catálogo
          </Link>
          <Link href="/buscar" className={estilos.enlace} transitionTypes={['barrido']}>
            Buscar por club o marca
          </Link>
          <Link href="/como-funciona" className={estilos.enlace} transitionTypes={['avanza']}>
            Cómo funciona
          </Link>
          {/*
            ⚠️ EL CARRITO ENTRA AL PIE PORQUE DEC-026 LO VUELVE UN PASO DEL
            FLUJO, no un extra: una compra de dos vendedores se parte en dos
            órdenes, así que la lista previa es donde eso se ve por primera vez.
            Sin sesión la pantalla manda al login; no se esconde el enlace,
            porque esconderlo haría que el pie cambie de forma según quién mira.
          */}
          <Link href="/carrito" className={estilos.enlace} transitionTypes={['barrido']}>
            Mi carrito
          </Link>
          <Link href="/mis-compras" className={estilos.enlace} transitionTypes={['barrido']}>
            Mis compras
          </Link>
        </nav>

        <nav className={estilos.columna} aria-label="Vender">
          <span className={`${estilos.filete} revela-linea`} aria-hidden="true" />
          <h2 className={estilos.columnaTitulo}>Vender</h2>
          <Link href="/vendedor/empezar" className={estilos.enlace} transitionTypes={['avanza']}>
            Empezar a vender
          </Link>
          <Link
            href="/vendedor/publicaciones"
            className={estilos.enlace}
            transitionTypes={['avanza']}
          >
            Mis publicaciones
          </Link>
          <Link href="/vendedor/ventas" className={estilos.enlace} transitionTypes={['avanza']}>
            Mis ventas
          </Link>
        </nav>

        <nav className={estilos.columna} aria-label="Cuenta">
          <span className={`${estilos.filete} revela-linea`} aria-hidden="true" />
          <h2 className={estilos.columnaTitulo}>Cuenta</h2>
          <Link href="/ingresar" className={estilos.enlace} transitionTypes={['avanza']}>
            Ingresar
          </Link>
          <Link href="/crear-cuenta" className={estilos.enlace} transitionTypes={['avanza']}>
            Crear cuenta
          </Link>
        </nav>
      </div>

      {/*
        ⚠️ LA TIRA LEGAL BAJA UN PLANO (`sup-fosa`) EN VEZ DE LLEVAR UN
        `border-top`. Una linea de 1px dice "hay una division"; un plano mas
        hondo dice "esto es otra cosa". Y `.sup-fosa` trae su propio filo de luz
        arriba, que es la division que el borde intentaba ser.

        ⚠️ NO LLEVA CLASE DE MODULO. Una regla vacia solo para tener un nombre la
        borra cualquier minificador, y despues alguien la lee como "esto perdio
        sus estilos". El padding vive en `.legalTexto`, que es lo unico que lo
        necesita.
      */}
      <div className="sup-fosa">
        {/*
          ⚠️ SIN AÑO DINAMICO. Un "© 2026" calculado con `new Date()` obliga a
          renderizar el pie en el servidor en cada visita y no aporta nada:
          nadie mira el año de un copyright. Lo que si importa —quien opera el
          sitio y con que reglas— es lo que va escrito.
        */}
        <p className={estilos.legalTexto}>
          Offside Store — marketplace de camisetas de fútbol. Los pagos se procesan con Mercado
          Pago; cada vendedor cobra en su propia cuenta.
        </p>
      </div>
    </footer>
  );
}
