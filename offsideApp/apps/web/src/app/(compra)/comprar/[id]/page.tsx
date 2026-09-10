import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Campo, CampoOculto, Fila, Formulario } from '@/components/form';
import { IconoAutenticado, IconoIntercambio } from '@/components/iconos';
import { FotoCompartida, Pantalla } from '@/components/movimiento';
import { Etiqueta, Migas } from '@/components/ui';
import { condicion, precio } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { findPublicListing } from '@/modules/listings/services/listing.service';

import { comprar } from '../../acciones';
import estilos from '../../resumen.module.css';
import { RutaDeCompra } from '../../ruta';

export const metadata: Metadata = { title: 'Confirmar compra' };
export const dynamic = 'force-dynamic';

/**
 * Confirmacion de compra: resumen + direccion de envio.
 *
 * ⚠️ EXIGE EMAIL VERIFICADO (BR-001): comprar es "operar". Sin verificar, el
 * guard manda a `/verificar-email` en vez de dejar avanzar hasta que el Service
 * rechace la orden.
 *
 * ⚠️ NO SE PIDE LA CANTIDAD. La compra es directa y de una unidad: el carrito
 * (BS-060) no existe y DEC-026 hace que una orden sea siempre de un vendedor.
 */
export default async function Comprar({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // El guard va primero: si no hay sesion, no hace falta consultar nada.
  await requireVerifiedSessionUser(`/comprar/${id}`);

  const listing = await findPublicListing(id);
  if (listing === null) notFound();

  const portada = listing.images[0];
  /*
   * ⚠️ EL IMPORTE SE FORMATEA UNA SOLA VEZ Y SE MUESTRA TRES: ticket, barra
   * pegada al pie y nota. Si cada lugar llamara a `precio()` por su cuenta, el
   * dia que alguien cambie el redondeo en uno los tres dejarian de coincidir en
   * la pantalla donde se entrega plata.
   */
  const importe = precio(listing.priceAmount, listing.currency);

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Migas
          items={[
            { texto: 'Catálogo', href: '/' },
            { texto: listing.title, href: `/p/${listing.id}` },
            { texto: 'Confirmar compra' },
          ]}
        />

        <div className={`${estilos.cabecera} entra`}>
          <h1 className={estilos.titulo}>Confirmar compra</h1>
          <span
            className={`${estilos.reglaTitulo} ${estilos.reglaTituloAnimada}`}
            aria-hidden="true"
          />
        </div>

        {/*
          ⚠️ EL PROGRESO ES LO PRIMERO QUE SE VE. Alguien que esta por entregar
          plata necesita saber cuantos pasos faltan ANTES de empezar a llenar
          campos. Sin esto, "Confirmar compra" podia leerse como el ultimo paso
          y el boton parecia el que cobra.

          ⚠️ Y AHORA DICE EN CUAL ESTA. Con `<Pasos>` los tres decian
          "pendiente": el componente solo conoce hecho / no hecho.
        */}
        <RutaDeCompra actual={1} />

        {/*
          ⚠️ LA FOTO NO ES DECORACION. Esta es la ultima pantalla antes de pagar
          y ver la prenda es lo que permite darse cuenta de que se entro a la
          publicacion equivocada. Por eso CRECE en telefono en vez de achicarse.

          La foto ademas COMPARTE IDENTIDAD con la de la ficha: viene volando
          desde la pantalla anterior en vez de aparecer de la nada.

          ⚠️ EL `<article>` NO LLEVA `.eleva` NI `.destello`: no es clickeable, y
          una ficha que se levanta y se pone verde al pasar el mouse promete un
          clic que no existe.
        */}
        <article className={`${estilos.producto} sup-ficha con-grano entra`}>
          <Link
            href={`/p/${listing.id}`}
            className={`${estilos.productoFoto} zoom-marco`}
            transitionTypes={['retrocede']}
          >
            {portada === undefined ? (
              <span
                className={`${estilos.productoPatron} ${estilos.rombos} ${estilos.rombosFinos}`}
                aria-hidden="true"
              />
            ) : (
              <FotoCompartida id={listing.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="zoom-foto"
                  src={portada.url}
                  alt=""
                  width={176}
                  height={220}
                  decoding="async"
                />
              </FotoCompartida>
            )}
          </Link>

          <div className={estilos.productoDatos}>
            <h2 className={estilos.productoTitulo}>{listing.title}</h2>
            <div className={estilos.productoEtiquetas}>
              <Etiqueta>Talle {listing.sizeValue}</Etiqueta>
              <Etiqueta>{condicion(listing.condition)}</Etiqueta>
            </div>
            <p className={estilos.productoVendedor}>
              <IconoAutenticado tamanio={16} />
              <span>
                Vendida por <strong>{listing.sellerDisplayName}</strong>
              </span>
            </p>
            <Link
              href={`/p/${listing.id}`}
              className={`${estilos.productoEnlace} subraya`}
              transitionTypes={['retrocede']}
            >
              Ver la publicación
            </Link>
          </div>
        </article>

        {/*
          ⚠️ EL RESUMEN ES UN TICKET Y NO UNA CAJA MAS. El total vive en otro
          plano (`.sup-2`) despues del troquel: es la unica jerarquia que no
          depende de que alguien lea.

          ⚠️ NO USA `<FilaDeDatos>`: ese componente lo comparten el back-office y
          el panel del vendedor, y la guia punteada y la tipografia de recibo son
          de esta pantalla. El componente queda intacto y en uso alla.
        */}
        <section className={`${estilos.ticket} sup-ficha con-grano entra`} data-tono="marca">
          <div className={`${estilos.ticketBanda} ${estilos.rombos}`} aria-hidden="true" />

          <header className={estilos.ticketCabecera}>
            <p className={estilos.ticketRotulo}>Resumen de la compra</p>
            <Etiqueta tono="marca">Precio congelado</Etiqueta>
          </header>

          <div className={estilos.ticketCuerpo}>
            <div className={estilos.lineaTicket}>
              <span className={estilos.conceptoTicket}>Precio</span>
              <span className={estilos.guia} aria-hidden="true" />
              <span className={estilos.valorTicket}>{importe}</span>
            </div>

            {/*
              ⚠️ SE DICE EL HECHO, NO LA POLITICA. El envio no esta calculado
              —`shipping_amount` queda en 0 y el modulo `shipments` no existe— y
              QUIEN LO PAGA sigue 🟡 en `shipping.md` §5.b. Escribir "a coordinar
              con el vendedor" seria inventar esa decision desde la interfaz; no
              decir nada deja leer "envio gratis", que es peor.
            */}
            <div className={estilos.lineaTicket}>
              <span className={estilos.conceptoTicket}>Envío</span>
              <span className={estilos.guia} aria-hidden="true" />
              <span className={`${estilos.valorTicket} ${estilos.pendiente}`}>No incluido</span>
            </div>
          </div>

          <div className={estilos.perforacion} aria-hidden="true" />

          <div className={`${estilos.total} sup-2`}>
            <span className={estilos.totalConcepto}>Total a pagar ahora</span>
            {/*
              ⚠️ `.cifra-entra` ES LA UNICA ANIMACION PERMITIDA SOBRE PLATA:
              sube una vez detras de una mascara, muestra el valor FINAL desde el
              primer cuadro y termina quieta. Nada de contar hacia arriba.
            */}
            <span className={`${estilos.totalValor} cifra-entra`}>
              <span>{importe}</span>
            </span>
            <p className={estilos.totalNota}>
              El total no incluye el envío. Todavía no lo calculamos automáticamente.
            </p>
          </div>
        </section>

        <h2 className={estilos.subtitulo}>¿A dónde lo enviamos?</h2>

        {/*
          ⚠️ `Continuar al pago` Y NO `Confirmar y pagar`. Este boton NO cobra
          nada: crea la orden y lleva a la pantalla donde se decide pagar. Un
          boton que dice "pagar" y no cobra le enseña a la gente a desconfiar
          del proximo, que si cobra.
        */}
        <Formulario accion={comprar} enviar="Continuar al pago">
          <CampoOculto nombre="listingId" valor={listing.id} />

          <Campo nombre="nombre" etiqueta="Nombre y apellido" autoComplete="name" />
          <Campo nombre="calle" etiqueta="Calle y número" autoComplete="street-address" />

          <Fila>
            <Campo nombre="ciudad" etiqueta="Localidad" autoComplete="address-level2" />
            <Campo nombre="provincia" etiqueta="Provincia" autoComplete="address-level1" />
          </Fila>

          <Fila>
            <Campo
              nombre="codigoPostal"
              etiqueta="Código postal"
              autoComplete="postal-code"
              inputMode="numeric"
            />
            <Campo nombre="telefono" etiqueta="Teléfono" tipo="tel" autoComplete="tel" />
          </Fila>

          {/*
            ⚠️ AHORA SI VAN JUSTO ANTES DEL BOTON. Estaban DESPUES de
            `<Formulario>`, o sea despues del submit, mientras el comentario
            afirmaba lo contrario.

            ⚠️ BLOQUE OSCURO: es el momento exacto en el que alguien duda, y es
            el unico plano oscuro de la pantalla. Las tres son hechos
            comprobables del sistema, no promesas — BR-003 y SS-012 dicen que
            conectar Mercado Pago NO otorga confianza, asi que no se lo presenta
            como un sello.

            ⚠️ NO LLEVA `.revela-acerca`, Y SACARLA ES UN ARREGLO. Esta `<ul>` es
            hijo DIRECTO del cuerpo del `<Formulario>`, y `form.module.css` le
            aplica ahi `animation: entraCampo … both` a `.cuerpo > *`. Las dos
            reglas tienen la misma especificidad (0,1,0) y estan en hojas
            distintas, asi que cual gana lo decide el ORDEN DE INYECCION: el
            bloque entraba con reloj o con scroll segun como quedara el bundle.
            Ademas la abreviada `animation` resetea `animation-timeline`, con lo
            que la version por scroll podia quedarse sin su `view()` y no la del
            todo. Se deja el escalonado del formulario, que es determinista y ya
            estaba pensado para esta columna.
          */}
          <ul className={`${estilos.garantias} sup-noche con-grano`}>
            <li>
              <IconoIntercambio tamanio={18} />
              <span>
                Pagás dentro de Mercado Pago. Offside no ve ni guarda los datos de tu tarjeta.
              </span>
            </li>
            <li>
              <IconoAutenticado tamanio={18} />
              <span>
                Para publicar, este vendedor verificó su email y declaró su identidad fiscal.
              </span>
            </li>
            <li>
              <IconoAutenticado tamanio={18} />
              <span>El precio queda congelado en esta orden aunque después cambie.</span>
            </li>
          </ul>

          {/*
            ⚠️ LA BARRA PEGADA AL PIE ARREGLA LA FALLA MAS CARA DE LA PANTALLA:
            el total estaba ARRIBA de seis campos de direccion, asi que en un
            telefono se completaba nombre, calle, localidad, provincia, CP y
            telefono sin volver a ver ni una vez cuanto se iba a pagar.

            ⚠️ VA COMO ULTIMO HIJO DEL FORMULARIO Y ESO ES LO QUE LA HACE
            FUNCIONAR: un `sticky` con `bottom: 0` se pega cuando su posicion
            natural cae por debajo del viewport. Cerca del final de un contenedor
            largo queda clavada abajo desde el primer cuadro y se suelta recien
            al llegar al final; puesta arriba no se pegaria nunca.

            ⚠️ EL BOTON QUEDA JUSTO DEBAJO, y no adentro de la barra: lo pinta
            `<Formulario>` y ese componente no acepta contenido junto al submit.
            Anotado en el reporte.
          */}
          <div className={`${estilos.barraCompra} sup-cancha`}>
            <span className={estilos.barraRotulo}>Total a pagar ahora</span>
            <span className={estilos.barraTotal}>{importe}</span>
          </div>
        </Formulario>

        {/*
          ⚠️ La direccion NO se guarda para la proxima compra: `user_addresses`
          existe en el ERD pero esta vacia y sin modulo. Se avisa en vez de
          simular una libreta que no existe.
        */}
        <p className={estilos.nota}>La dirección se guarda sólo en esta orden.</p>
      </main>
    </Pantalla>
  );
}
