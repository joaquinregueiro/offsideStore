import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CampoOculto, Formulario } from '@/components/form';
import { IconoAutenticado, IconoCarrito, IconoIntercambio } from '@/components/iconos';
import { FotoCompartida, Pantalla } from '@/components/movimiento';
import { Etiqueta, Migas } from '@/components/ui';
import { cantidad as cantidadLegible, condicion, precio } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { listAddresses, getDefaultAddress } from '@/modules/addresses/services/address.service';
import { isFeatureEnabled } from '@/modules/config/services/setting-store.service';
import { findPublicListing } from '@/modules/listings/services/listing.service';

import { agregarAlCarrito } from '../../../carrito/acciones';
import { comprar } from '../../acciones';
import estilos from '../../resumen.module.css';
import { RutaDeCompra } from '../../ruta';
import { SelectorDeDireccion } from '../../selector-de-direccion';

export const metadata: Metadata = { title: 'Confirmar compra' };
export const dynamic = 'force-dynamic';

/**
 * Cuantas unidades se ofrecen en el desplegable como maximo.
 *
 * ⚠️ EL TOPE REAL ES EL STOCK: esto solo evita que una publicacion con 400
 * unidades convierta el selector en una lista de 400 numeros. No es un cupo de
 * negocio —esos son ⚙️ del Config Store— y el Service valida el stock igual.
 */
const MAX_OPCIONES_DE_CANTIDAD = 20;

/**
 * Confirmacion de compra: cantidad, direccion de envio y resumen.
 *
 * ⚠️ EXIGE EMAIL VERIFICADO (BR-001): comprar es "operar". Sin verificar, el
 * guard manda a `/verificar-email` en vez de dejar avanzar hasta que el Service
 * rechace la orden.
 *
 * ⚠️ LA CANTIDAD VIAJA EN LA URL (`?cantidad=`) Y NO EN UN ESTADO DE REACT, y
 * es lo que hace que el resumen sea cierto sin JavaScript: el subtotal y el
 * total se calculan en el servidor con el numero que la URL dice. Un `<select>`
 * suelto adentro del formulario de compra dejaria el ticket mostrando el precio
 * de una unidad mientras la orden se crea por tres.
 */
export default async function Comprar({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cantidad?: string }>;
}) {
  const [{ id }, { cantidad: cantidadCruda }] = await Promise.all([params, searchParams]);

  // El guard va primero: si no hay sesion, no hace falta consultar nada.
  const user = await requireVerifiedSessionUser(`/comprar/${id}`);

  const listing = await findPublicListing(id);
  if (listing === null) notFound();

  const [direcciones, predeterminada, carritoHabilitado] = await Promise.all([
    listAddresses(user),
    getDefaultAddress(user),
    isFeatureEnabled('cart'),
  ]);

  /*
   * ⚠️ SE RECORTA AL STOCK, NO SE RECHAZA. `?cantidad=99` sobre una publicacion
   * con dos unidades es un enlace viejo o una URL tocada a mano: mostrar dos y
   * seguir es mejor que un error, y `createOrder` vuelve a validar el stock
   * contra la fila cuando se confirma.
   */
  const pedidas = Number.parseInt(cantidadCruda ?? '1', 10);
  const cantidad = Math.min(
    Math.max(Number.isFinite(pedidas) ? pedidas : 1, 1),
    Math.max(listing.stock, 1),
  );
  const opciones = Math.min(listing.stock, MAX_OPCIONES_DE_CANTIDAD);

  const portada = listing.images[0];

  /*
   * ⚠️ LA SUMA ES EN `BigInt` Y NO EN `Number`. Los importes son centavos y
   * viajan como string justamente porque un `number` de JavaScript pierde
   * precision arriba de 9.007.199.254.740.991: en centavos eso son 90 mil
   * millones de pesos, pero el dia que alguien multiplique mal no hay error, hay
   * un total distinto.
   */
  const unitario = BigInt(listing.priceAmount);
  const total = unitario * BigInt(cantidad);

  /*
   * ⚠️ EL IMPORTE SE FORMATEA UNA SOLA VEZ Y SE MUESTRA TRES: ticket, barra
   * pegada al pie y nota. Si cada lugar llamara a `precio()` por su cuenta, el
   * dia que alguien cambie el redondeo en uno los tres dejarian de coincidir en
   * la pantalla donde se entrega plata.
   */
  const importeTotal = precio(total.toString(), listing.currency);
  const importeUnitario = precio(listing.priceAmount, listing.currency);

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
              {listing.stock === 1 && <Etiqueta tono="alerta">Última unidad</Etiqueta>}
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
          ⚠️ ES UN `<form method="get">` HERMANO, NO UN CONTROL ADENTRO DEL
          FORMULARIO DE COMPRA: anidar formularios es HTML invalido, y ademas la
          cantidad tiene que cambiar el TICKET —que se arma en el servidor—, no
          solo viajar con el POST. Elegir y apretar "Actualizar" recarga la misma
          pantalla con el total correcto, sin una linea de JavaScript.
        */}
        {listing.stock > 1 && (
          <form method="get" className={`${estilos.cantidad} sup-2`}>
            <label className={estilos.cantidadEtiqueta} htmlFor="cantidad-compra">
              ¿Cuántas unidades?
            </label>
            <select
              id="cantidad-compra"
              name="cantidad"
              className={estilos.cantidadSelect}
              defaultValue={String(cantidad)}
            >
              {Array.from({ length: opciones }, (_, indice) => indice + 1).map((valor) => (
                <option key={valor} value={valor}>
                  {valor}
                </option>
              ))}
            </select>
            <button type="submit" className={`${estilos.cantidadBoton} presiona`}>
              Actualizar
            </button>
            <span className={estilos.cantidadNota}>
              {cantidadLegible(listing.stock, 'unidad', 'unidades')} disponibles
            </span>
          </form>
        )}

        {/*
          ⚠️ EL RESUMEN ES UN TICKET Y NO UNA CAJA MAS. El total vive en otro
          plano (`.sup-2`) despues del troquel: es la unica jerarquia que no
          depende de que alguien lea.
        */}
        <section className={`${estilos.ticket} sup-ficha con-grano entra`} data-tono="marca">
          <div className={`${estilos.ticketBanda} ${estilos.rombos}`} aria-hidden="true" />

          <header className={estilos.ticketCabecera}>
            <p className={estilos.ticketRotulo}>Resumen de la compra</p>
            <Etiqueta tono="marca">Precio congelado</Etiqueta>
          </header>

          <div className={estilos.ticketCuerpo}>
            <div className={estilos.lineaTicket}>
              <span className={estilos.conceptoTicket}>
                Precio por unidad
                {cantidad > 1 && ` × ${cantidad}`}
              </span>
              <span className={estilos.guia} aria-hidden="true" />
              <span className={estilos.valorTicket}>{importeUnitario}</span>
            </div>

            {/*
              ⚠️ SE DICE EL HECHO, NO LA POLITICA. El vendedor DECLARA como se
              resuelve el envio (`listings.shipping_mode`, delta §11) y ese
              importe se congela en la orden (DEC-030), pero `findPublicListing`
              todavia no expone el modo: la pantalla no puede afirmar "incluido"
              ni "no incluido" sin inventarlo. Se dice lo unico cierto —que lo
              declara quien vende y que se ve antes de pagar— y queda reportado.
            */}
            <div className={estilos.lineaTicket}>
              <span className={estilos.conceptoTicket}>Envío</span>
              <span className={estilos.guia} aria-hidden="true" />
              <span className={`${estilos.valorTicket} ${estilos.pendiente}`}>
                Lo declara el vendedor
              </span>
            </div>
          </div>

          <div className={estilos.perforacion} aria-hidden="true" />

          <div className={`${estilos.total} sup-2`}>
            <span className={estilos.totalConcepto}>
              {cantidad === 1 ? 'Total a pagar ahora' : `Total por ${cantidad} unidades`}
            </span>
            {/*
              ⚠️ `.cifra-entra` ES LA UNICA ANIMACION PERMITIDA SOBRE PLATA:
              sube una vez detras de una mascara, muestra el valor FINAL desde el
              primer cuadro y termina quieta. Nada de contar hacia arriba.
            */}
            <span className={`${estilos.totalValor} cifra-entra`}>
              <span>{importeTotal}</span>
            </span>
            <p className={estilos.totalNota}>
              Si el vendedor declaró un envío con costo, se suma al crear la orden y lo vas a ver
              antes de pagar.
            </p>
          </div>
        </section>

        <h2 className={estilos.subtitulo}>¿A dónde lo enviamos?</h2>

        {/*
          ⚠️ `Comprar` NO COBRA NADA: crea la orden y lleva a la pantalla donde
          se decide pagar. Por eso no dice "Pagar" — un boton que dice "pagar" y
          no cobra le enseña a la gente a desconfiar del proximo, que si cobra.
        */}
        <Formulario
          accion={comprar}
          enviar="Comprar"
          pie={
            /*
              ⚠️ LA BARRA PEGADA AL PIE ARREGLA LA FALLA MAS CARA DE LA PANTALLA:
              el total estaba ARRIBA de los campos de direccion, asi que en un
              telefono se completaba la direccion entera sin volver a ver ni una
              vez cuanto se iba a pagar.
            */
            <div className={`${estilos.barraCompra} sup-cancha`}>
              <span className={estilos.barraRotulo}>Total a pagar ahora</span>
              <span className={estilos.barraTotal}>{importeTotal}</span>
            </div>
          }
        >
          <CampoOculto nombre="listingId" valor={listing.id} />
          <CampoOculto nombre="cantidad" valor={String(cantidad)} />

          <SelectorDeDireccion direcciones={direcciones} predeterminada={predeterminada} />

          {/*
            ⚠️ BLOQUE OSCURO: es el momento exacto en el que alguien duda, y es
            el unico plano oscuro de la pantalla. Las tres son hechos
            comprobables del sistema, no promesas — BR-003 y SS-012 dicen que
            conectar Mercado Pago NO otorga confianza, asi que no se lo presenta
            como un sello.
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
        </Formulario>

        {/*
          ⚠️ ES UN FORMULARIO APARTE Y ESO ES DELIBERADO. Dos submits en el mismo
          `<form>` significan que apretar Enter adentro de un campo de direccion
          dispara el PRIMERO —el carrito—, y la direccion recien tipeada se
          pierde. Separados, cada boton hace una sola cosa.

          ⚠️ LA CANTIDAD ELEGIDA VIAJA TAMBIEN ACA: agregar al carrito lo que se
          eligio arriba y no "una unidad" es lo que hace que las dos acciones se
          lean como la misma decision.
        */}
        {carritoHabilitado && (
          <div className={estilos.segundaAccion}>
            <Formulario
              accion={agregarAlCarrito}
              enviar="Agregar al carrito"
              variante="secundario"
              tamanio="medio"
              bloque={false}
            >
              <CampoOculto nombre="listingId" valor={listing.id} />
              <CampoOculto nombre="cantidad" valor={String(cantidad)} />
            </Formulario>
            <p className={estilos.segundaAccionNota}>
              <IconoCarrito tamanio={16} />
              <span>
                Guardala para decidir después. El carrito no reserva stock ni congela el precio.
              </span>
            </p>
          </div>
        )}

        {/*
          ⚠️ SE DICE QUE LA DIRECCION SE COPIA A LA ORDEN. Editarla o borrarla
          despues no cambia a donde se despacho (ERD §6.1: la orden guarda un
          snapshot, no una referencia).
        */}
        <p className={estilos.nota}>
          La dirección se copia a la orden: si después la cambiás en tu libreta, esta compra sigue
          yendo a donde la mandaste.
        </p>
      </main>
    </Pantalla>
  );
}
