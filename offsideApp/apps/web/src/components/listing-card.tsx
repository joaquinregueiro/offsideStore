import Link from 'next/link';

import { alternarFavorito } from '@/app/acciones';
import { condicion, precio } from '@/lib/formato';
import type { CatalogListing } from '@/modules/listings/services/listing.service';

import { IconoFavorito } from './iconos';
import estilos from './listing-card.module.css';
import { FotoCompartida } from './movimiento';
import { Distintivo, Etiqueta } from './ui';

/**
 * Ficha de producto del catalogo.
 *
 * Server Component: no tiene interactividad y no necesita JavaScript en el
 * cliente. Todo el movimiento de esta ficha es CSS —entrada escalonada,
 * elevacion con glow, tilt, zoom de la foto, anillo de luz que gira, chispa de
 * "Última unidad"—, asi que el rediseño no suma un solo byte al bundle: lo
 * unico que cambia aca es marcado y clases.
 *
 * ⚠️ USA `Etiqueta` EN VEZ DE SU PROPIA CLASE. La ficha tenia una `.etiqueta`
 * copiada casi al caracter de la de `ui.module.css`. Dos definiciones del mismo
 * objeto significan que arreglar el contraste en una deja rota la otra.
 *
 * ⚠️ NO LLEVA `aria-label` COMPUESTO, Y ES UNA DECISION. El nombre accesible del
 * enlace es la concatenacion de lo que hay adentro, y el orden del DOM esta
 * elegido para que eso se lea bien de corrido: "Última unidad, $145.000,
 * Camiseta titular retro, Talle L, Muy buen estado, Camisetas del Tano". Un
 * `aria-label` tendria que repetir los seis datos y quedaria viejo el dia que se
 * agregue el septimo, sin que nada avise.
 *
 * ⚠️ EL ESCALONADO DE LA ENTRADA SALE DEL INDICE DEL `<li>` QUE LA ENVUELVE
 * (`:nth-child(k) > .envoltorio > .ficha` en el CSS): no hay `style` inline ni
 * contador. Las grillas que la usan la ponen como unico hijo de un `<li>`, y ese
 * contrato es lo que hace que la primera fila entre en cascada.
 */

/** Lo que la ficha necesita saber para pintar —y mover— el corazon. */
export interface EstadoDeFavorito {
  /** Si esta cuenta ya la tiene guardada (`favoriteIdsOf`). */
  activo: boolean;
  /** A donde vuelve el POST. Se valida con `rutaInternaSegura` del otro lado. */
  volverA: string;
}

export function ListingCard({
  listing,
  promocionada = false,
  compartirFoto = true,
  favorito,
}: {
  listing: CatalogListing;
  /** Tiene promocion vigente (PS-021). Lo resuelve la pantalla, no la ficha. */
  promocionada?: boolean;
  /**
   * Si esta ficha participa del morph de la foto hacia la ficha del producto.
   *
   * ⚠️ HAY QUE APAGARLO CUANDO LA MISMA PUBLICACION APARECE DOS VECES EN UNA
   * PANTALLA, que es exactamente lo que pasa en la home: la seccion de
   * promocionadas y la grilla general muestran la misma camiseta. Dos
   * elementos con el mismo `view-transition-name` vivos al mismo tiempo
   * ROMPEN LA TRANSICION ENTERA —React avisa por consola y el navegador
   * aborta la animacion—, asi que la copia de arriba no se nombra y la de la
   * grilla, que es la canonica, conserva el morph.
   */
  compartirFoto?: boolean;
  /**
   * ⚠️ `undefined` SIN SESION, Y NO UN CORAZON APAGADO QUE LLEVA AL LOGIN. Un
   * control que se ve igual para todos y que a la mitad la saca de la pantalla
   * en la que estaba es peor que no ofrecerlo: quien no tiene cuenta pierde la
   * grilla que estaba mirando. Sin sesion la ficha se pinta sin corazon.
   *
   * `| undefined` explicito: con `exactOptionalPropertyTypes` un opcional NO
   * acepta que le pasen `undefined` a proposito, y las pantallas lo calculan.
   */
  favorito?: EstadoDeFavorito | undefined;
}) {
  const hayMarcas = promocionada || listing.stock === 1;

  return (
    /*
      ⚠️ EL ENVOLTORIO EXISTE POR UNA SOLA RAZON Y ES DE HTML: un `<form>` no
      puede vivir DENTRO de un `<a>`. La ficha entera es un enlace desde
      siempre, asi que el corazon —que MUTA y por lo tanto va por POST— tiene
      que ser su HERMANO, no su hijo. El envoltorio es lo que les da un ancestro
      posicionado comun para que el boton caiga sobre la esquina de la foto.

      ⚠️ SE RENDERIZA AUNQUE NO HAYA CORAZON. Si apareciera solo con sesion, el
      selector del escalonado (`> .envoltorio > .ficha`) fallaria para quien
      mira sin cuenta y la primera fila entraria de golpe: la vitrina se veria
      distinta segun si hay sesion, por un detalle de implementacion.
    */
    <div className={estilos.envoltorio}>
      {/*
        ⚠️ `transitionTypes` MARCA LA DIRECCION. Entrar a una ficha es avanzar; el
        enlace lo declara y la pantalla de destino traduce ese tipo a la
        animacion. No es automatico a proposito: el framework no puede saber que
        es "adentro" en la jerarquia de este sitio.

        ⚠️ NO LLEVA LAS CLASES GLOBALES `eleva` NI `tilt`. La elevacion, el glow y
        la inclinacion los escribe el modulo, porque el contorno de esta ficha
        viaja en la MISMA lista de `box-shadow` que la sombra y el glow, y esa
        lista no se puede repartir entre dos archivos. La razon larga esta en el
        encabezado del CSS.
      */}
      <Link href={`/p/${listing.id}`} className={estilos.ficha} transitionTypes={['avanza']}>
        {/*
          La portada, o el patron de la identidad §05 si la publicacion no tiene
          fotos. El marco reserva la proporcion en los dos casos, asi que la
          grilla no se reacomoda segun cuales tengan imagen.

          ⚠️ `<img>` y no `next/image`: la foto ya viene redimensionada desde el
          CDN del bucket —el procesador genera tres variantes—. Pasarla otra vez
          por el optimizador de Next la procesaria dos veces y meteria al servidor
          en el camino de cada imagen de cada visita, que es lo que un CDN evita.

          ⚠️ LA FOTO COMPARTE IDENTIDAD CON LA DE LA FICHA DE PRODUCTO. Al tocar la
          camiseta, esta misma imagen se agranda hasta ocupar el detalle en vez de
          desaparecer y ser reemplazada por otra. Es lo que convierte dos pantallas
          en un solo objeto que se acerca.

          ⚠️ EL DESTELLO, LA INSIGNIA Y LA MARCA DE IR SON HERMANOS DE LA FOTO,
          NUNCA HIJOS: lo que viaja en la transicion es el <img> nombrado y nada
          mas. Si alguno entrara adentro de `FotoCompartida`, viajaria con ella.

          Sin foto no se comparte nada: el patron de rombos es un marcador, no la
          prenda, y verlo viajar de una pantalla a otra seria mentir sobre que es.

          ⚠️ `data-foto` EN EL PLACEHOLDER NO ES DECORACION: es lo que hace que la
          utilidad global `enfoca-hermanos` lo alcance. Su selector es `img,
          [data-foto]`; sin el atributo, al pasar el mouse por una ficha las que
          tienen foto bajan saturacion y las del patron quedan a full brillo, y se
          leen como si fueran ELLAS las apuntadas.
        */}
        <div className={estilos.marco}>
          {listing.coverUrl === null ? (
            <div className={estilos.patron} data-foto aria-hidden="true" />
          ) : (
            <Foto compartida={compartirFoto} id={listing.id} url={listing.coverUrl} />
          )}

          {/*
            LAS DOS MARCAS DE LA FOTO, EN UNA COLUMNA.

            ⚠️ ANTES "ÚLTIMA UNIDAD" ESTABA POSICIONADA SOLA EN LA ESQUINA. Con
            la promocion son DOS chips que pelean el mismo punto: apilados en un
            flex se ordenan solos y a 320px bajan de linea sin taparse.

            ⚠️ "PROMOCIONADA" VA PRIMERA Y SE LLAMA POR SU NOMBRE. No dice
            "Destacada" ni "Recomendada": eso sugeriria que la eligio Offside, y
            la eligio el vendedor pagando una comision agravada (PS-021). Decirlo
            es lo que mantiene la grilla honesta.

            ⚠️ "ÚLTIMA UNIDAD" SOLO CUANDO ES UNA. Con dos o tres el aviso pierde
            fuerza —y en la ficha de producto ya hay un umbral distinto, porque
            ahi la persona esta decidiendo y el matiz importa—.

            ⚠️ EL PULSO Y LA CHISPA NO SON LA INFORMACION: la etiqueta ya lo dice
            con texto y con color (`--color-alerta`, 4.88:1 sobre su fondo blanco
            propio). Quien no ve la animacion no se pierde nada, y las dos paran a
            las tres vueltas —WCAG 2.2.2— en vez de latir para siempre al lado de
            un precio.
          */}
          {hayMarcas && (
            <span className={estilos.marcas}>
              {promocionada && <Distintivo />}
              {listing.stock === 1 && (
                <span className={`${estilos.insignia} pulso-atencion`}>
                  <Etiqueta tono="alerta">Última unidad</Etiqueta>
                </span>
              )}
            </span>
          )}

          {/*
            ⚠️ LA FLECHA VA `aria-hidden`: la ficha entera ya es un enlace y su
            nombre accesible dice a donde va. Una flecha leida en voz alta es
            ruido. Lo que aporta es visual y es para el DEDO: en un telefono no
            hay hover, y sin una señal permanente nada dice que la ficha lleva a
            algun lado.

            ⚠️ ES UN SVG Y NO EL CARACTER "→": el glifo depende de la fuente y no
            se puede dibujar con el trazo de 1.5px del sistema ni mover como
            icono. Con `stroke: currentColor` toma el color del chip en cada
            estado, incluido el modo de alto contraste.
          */}
          <span className={estilos.marcaIr} aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M5 12h14" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </span>
        </div>

        <div className={estilos.cuerpo}>
          {/*
            ⚠️ EL PRECIO VA PRIMERO. En una grilla de marketplace el barrido es
            foto → precio → titulo. El orden anterior era el de un formulario.

            ⚠️ EL <span> NO ES DECORATIVO: el marcador de Amarillo Cambio es un
            fondo del TEXTO, y un fondo puesto sobre el <p> pintaria la linea
            entera en vez de las cifras. El numero no se mueve ni cuenta: solo
            crece la marca de resaltador, que ya esta puesta en reposo, y el glow
            del precio es un `text-shadow` estatico.
          */}
          <p className={estilos.precio}>
            <span className={estilos.cifra}>{precio(listing.priceAmount, listing.currency)}</span>
          </p>

          <h3 className={estilos.titulo}>{listing.title}</h3>

          {/*
            ⚠️ TALLE Y CONDICION DEJAN DE SER `Etiqueta`. Son filtros, no señales:
            con caja pesaban lo mismo que "Última unidad". El separador es un
            `::before` de CSS —un rombo chiquito— para que el lector de pantalla
            no diga "punto".
          */}
          <p className={estilos.metadatos}>
            <span>Talle {listing.sizeValue}</span>
            <span>{condicion(listing.condition)}</span>
          </p>

          <p className={estilos.vendedor}>{listing.sellerDisplayName}</p>
        </div>
      </Link>

      {/*
        EL CORAZON (BS-050).

        ⚠️ ES UN `<form method="post">` DE VERDAD, NO UN BOTON CON `onClick`. Sin
        JavaScript el navegador envia el formulario, la accion redirige a
        `volverA` y la grilla vuelve con la estrella pintada. Es el mismo
        contrato que el resto del sitio.

        ⚠️ `aria-pressed` ES LO QUE LO CONVIERTE EN UN INTERRUPTOR. Sin el, un
        lector de pantalla anuncia dos botones distintos —"Guardar" y "Quitar"—
        sin decir nunca en que estado esta; con el, anuncia "Guardar, activado".
        El texto visible no existe: el nombre accesible lo da el `.solo-lectores`,
        que ademas nombra LA PUBLICACION, porque en una grilla de 60 hay 60
        botones con el mismo texto.
      */}
      {favorito !== undefined && (
        <form action={alternarFavorito} className={estilos.favorito}>
          <input type="hidden" name="listingId" value={listing.id} />
          <input type="hidden" name="volverA" value={favorito.volverA} />
          <button
            type="submit"
            className={estilos.favoritoBoton}
            aria-pressed={favorito.activo}
            data-activo={favorito.activo ? 'si' : undefined}
          >
            <IconoFavorito tamanio={20} />
            <span className="solo-lectores">
              {favorito.activo ? 'Quitar de guardadas' : 'Guardar'}: {listing.title}
            </span>
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * La foto de la ficha, con o sin nombre de transicion.
 *
 * Existe para que el `<img>` se escriba UNA sola vez: con la condicion inline,
 * la misma etiqueta aparecia dos veces y el dia que alguien le agregue un
 * `srcset` se lo pone a una sola.
 */
function Foto({ compartida, id, url }: { compartida: boolean; id: string; url: string }) {
  const imagen = (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img className={estilos.foto} src={url} alt="" loading="lazy" decoding="async" />
  );

  return compartida ? <FotoCompartida id={id}>{imagen}</FotoCompartida> : imagen;
}
