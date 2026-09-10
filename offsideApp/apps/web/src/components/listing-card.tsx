<<<<<<< HEAD
import Link from 'next/link';

=======
>>>>>>> origin/main
import { condicion, precio } from '@/lib/formato';
import type { CatalogListing } from '@/modules/listings/services/listing.service';

import estilos from './listing-card.module.css';
<<<<<<< HEAD
import { FotoCompartida } from './movimiento';
import { Etiqueta } from './ui';
=======
>>>>>>> origin/main

/**
 * Ficha de producto del catalogo.
 *
 * Server Component: no tiene interactividad y no necesita JavaScript en el
<<<<<<< HEAD
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
 * (`:nth-child(k) > .ficha` en el CSS): no hay `style` inline ni contador. Las
 * dos grillas que la usan la ponen como unico hijo de un `<li>`, y ese contrato
 * es lo que hace que la primera fila entre en cascada.
=======
 * cliente. Agregarle `'use client'` solo para renderizar texto mandaria el
 * componente al bundle sin ganar nada.
>>>>>>> origin/main
 */

export function ListingCard({ listing }: { listing: CatalogListing }) {
  return (
<<<<<<< HEAD
    /*
      ⚠️ `transitionTypes` MARCA LA DIRECCION. Entrar a una ficha es avanzar; el
      enlace lo declara y la pantalla de destino traduce ese tipo a la
      animacion. No es automatico a proposito: el framework no puede saber que
      es "adentro" en la jerarquia de este sitio.

      ⚠️ NO LLEVA LAS CLASES GLOBALES `eleva` NI `tilt`. La elevacion, el glow y
      la inclinacion los escribe el modulo, porque el contorno de esta ficha
      viaja en la MISMA lista de `box-shadow` que la sombra y el glow, y esa
      lista no se puede repartir entre dos archivos. La razon larga esta en el
      encabezado del CSS.
    */
    <Link href={`/p/${listing.id}`} className={estilos.ficha} transitionTypes={['avanza']}>
=======
    <a href={`/p/${listing.id}`} className={estilos.ficha}>
>>>>>>> origin/main
      {/*
        La portada, o el patron de la identidad §05 si la publicacion no tiene
        fotos. El marco reserva la proporcion en los dos casos, asi que la
        grilla no se reacomoda segun cuales tengan imagen.

        ⚠️ `<img>` y no `next/image`: la foto ya viene redimensionada desde el
        CDN del bucket —el procesador genera tres variantes—. Pasarla otra vez
        por el optimizador de Next la procesaria dos veces y meteria al servidor
        en el camino de cada imagen de cada visita, que es lo que un CDN evita.
<<<<<<< HEAD

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
          <FotoCompartida id={listing.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={estilos.foto}
              src={listing.coverUrl}
              alt=""
              loading="lazy"
              decoding="async"
            />
          </FotoCompartida>
        )}

        {/*
          ⚠️ "ULTIMA UNIDAD" VA ENCIMA DE LA FOTO, CON CHISPA. Es la señal que
          mas mueve una compra en un marketplace de piezas unicas —el propio
          Service lo documenta asi—, y por eso lleva luz amarilla alrededor y
          una estrella que titila tres veces al cargar (las dos en el CSS del
          contenedor, sin tocar la etiqueta).

          ⚠️ SOLO CUANDO ES UNA. Con dos o tres el aviso pierde fuerza —y en la
          ficha de producto ya hay un umbral distinto, porque ahi la persona
          esta decidiendo y el matiz importa—.

          ⚠️ EL PULSO Y LA CHISPA NO SON LA INFORMACION: la etiqueta ya lo dice
          con texto y con color (`--color-alerta`, 4.88:1 sobre su fondo blanco
          propio). Quien no ve la animacion no se pierde nada, y las dos paran a
          las tres vueltas —WCAG 2.2.2— en vez de latir para siempre al lado de
          un precio.
        */}
        {listing.stock === 1 && (
          <span className={`${estilos.insignia} pulso-atencion`}>
            <Etiqueta tono="alerta">Última unidad</Etiqueta>
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
=======
      */}
      {listing.coverUrl === null ? (
        <div className={estilos.marco} aria-hidden="true" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={estilos.marco}
          src={listing.coverUrl}
          alt=""
          loading="lazy"
          decoding="async"
        />
      )}

      <div className={estilos.cuerpo}>
        <h3 className={estilos.titulo}>{listing.title}</h3>

        <p className={estilos.precio}>{precio(listing.priceAmount, listing.currency)}</p>

        <div className={estilos.metadatos}>
          <span className={estilos.etiqueta}>Talle {listing.sizeValue}</span>
          <span className={estilos.etiqueta}>{condicion(listing.condition)}</span>
        </div>

        <p className={estilos.vendedor}>{listing.sellerDisplayName}</p>
      </div>
    </a>
>>>>>>> origin/main
  );
}
