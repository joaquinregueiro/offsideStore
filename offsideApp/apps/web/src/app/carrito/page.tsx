import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CampoOculto, Formulario } from '@/components/form';
import { IconoCamiseta, IconoCarrito, IconoTienda } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { Aviso, BotonEnlace, Etiqueta, EstadoVacio, Migas } from '@/components/ui';
import { cantidad as cantidadLegible, precio } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { getDefaultAddress, listAddresses } from '@/modules/addresses/services/address.service';
import { getCart } from '@/modules/cart/services/cart.service';
import { isFeatureEnabled } from '@/modules/config/services/setting-store.service';

import { SelectorDeDireccion } from '../(compra)/selector-de-direccion';
import { cambiarCantidad, comprarCarrito, quitarDelCarrito } from './acciones';
import estilos from './carrito.module.css';

export const metadata: Metadata = { title: 'Tu carrito' };
export const dynamic = 'force-dynamic';

/** Tope de opciones del desplegable. El limite real es el stock de la linea. */
const MAX_OPCIONES = 20;

/**
 * El carrito (BS-060/061/062, ERD §10).
 *
 * ⚠️ AGRUPADO POR VENDEDOR PORQUE ASI SE VA A COBRAR (DEC-026: una orden = un
 * vendedor). Mostrar una sola lista plana con un solo total prometeria un pago
 * unico que no existe: al comprar salen N ordenes y N pagos, uno por vendedor.
 * Esta pantalla lo dice ANTES, no despues.
 *
 * ⚠️ EL CARRITO NO RESERVA NADA (MF-010 / BS-060). Ni stock ni precio: el
 * precio que manda es el ACTUAL de la publicacion y por eso se avisa cuando
 * cambio desde que se agrego. Congelarlo seria dejar comprar a un precio que el
 * vendedor ya cambio (BR-023).
 *
 * ⚠️ NO ESCONDE LO QUE NO SE PUEDE COMPRAR. Una linea agotada o de un vendedor
 * desconectado se muestra marcada, no desaparece: que algo se esfume del
 * carrito sin explicacion es peor que verlo tachado.
 */
export default async function Carrito() {
  /*
   * ⚠️ LA PERILLA SE MIRA ANTES QUE LA SESION. Con `feature_cart` apagado, el
   * carrito no existe para NADIE: mandar primero al login para despues devolver
   * 404 le contaria a un desconocido que la pantalla existe pero esta apagada.
   */
  if (!(await isFeatureEnabled('cart'))) notFound();

  const user = await requireVerifiedSessionUser('/carrito');

  const [carrito, direcciones, predeterminada] = await Promise.all([
    getCart(user),
    listAddresses(user),
    getDefaultAddress(user),
  ]);

  const vacio = carrito.cantidadItems === 0;

  /*
   * ⚠️ LA MONEDA SALE DE LAS LINEAS, NO ESTA ESCRITA A MANO. `CartView` suma
   * `total` y `subtotal` como string de centavos sin decir en que moneda, y cada
   * publicacion lleva la suya (`currency char(3)`, ERD). Hoy todas son ARS; el
   * dia que no lo sean, escribir "ARS" aca seria mostrar un total en una moneda
   * que nadie eligio.
   */
  const moneda = carrito.vendedores[0]?.items[0]?.currency ?? 'ARS';

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Migas items={[{ texto: 'Catálogo', href: '/' }, { texto: 'Tu carrito' }]} />

        <div className={`${estilos.cabecera} entra`}>
          <h1 className={estilos.titulo}>Tu carrito</h1>
          <span
            className={`${estilos.reglaTitulo} ${estilos.reglaTituloAnimada}`}
            aria-hidden="true"
          />
          {!vacio && (
            <p className={estilos.resumenCabecera}>
              {cantidadLegible(carrito.cantidadUnidades, 'unidad', 'unidades')} ·{' '}
              {cantidadLegible(carrito.vendedores.length, 'vendedor', 'vendedores')}
            </p>
          )}
        </div>

        {vacio ? (
          <EstadoVacio titulo="Tu carrito está vacío" icono={<IconoCarrito tamanio={40} />}>
            <p>
              Guardá acá las camisetas que estás mirando. El carrito no reserva stock ni congela el
              precio: eso pasa recién cuando comprás.
            </p>
            <BotonEnlace href="/buscar" flecha>
              Buscar camisetas
            </BotonEnlace>
          </EstadoVacio>
        ) : (
          <>
            {carrito.tieneProblemas && (
              /*
                ⚠️ EL AVISO VA ARRIBA Y ES ROJO PORQUE BLOQUEA LA COMPRA ENTERA:
                `checkoutCart` revalida TODO antes de crear la primera orden, asi
                que una sola linea sin stock deja las demas sin comprarse. Es
                mejor saberlo antes de completar la direccion.
              */
              <Aviso tono="error">
                Hay publicaciones que ya no se pueden comprar. Sacalas del carrito para poder
                seguir: mientras estén, la compra no se puede confirmar.
              </Aviso>
            )}

            {carrito.vendedores.map((grupo) => (
              <section key={grupo.sellerId} className={`${estilos.grupo} sup-ficha con-grano`}>
                <header className={estilos.grupoCabecera}>
                  <h2 className={estilos.grupoTitulo}>
                    <IconoTienda tamanio={18} />
                    <span>{grupo.sellerDisplayName}</span>
                  </h2>
                  {!grupo.operativo && <Etiqueta tono="alerta">No puede vender ahora</Etiqueta>}
                </header>

                <ul className={estilos.lineas}>
                  {grupo.items.map((item) => {
                    const subio = BigInt(item.unitPriceAmount) > BigInt(item.unitPriceSnapshot);
                    const tope = Math.max(
                      1,
                      Math.min(Math.max(item.stockDisponible, item.quantity), MAX_OPCIONES),
                    );
                    const alcanza = item.stockDisponible >= item.quantity;

                    return (
                      <li
                        key={item.listingId}
                        className={estilos.linea}
                        data-problema={item.comprable && alcanza ? undefined : 'si'}
                      >
                        <Link
                          href={`/p/${item.listingId}`}
                          className={`${estilos.lineaMarco} zoom-marco`}
                          transitionTypes={['avanza']}
                        >
                          {item.coverUrl === null ? (
                            <span className={estilos.lineaPatron} aria-hidden="true" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className={`${estilos.lineaFoto} zoom-foto`}
                              src={item.coverUrl}
                              alt=""
                              width={84}
                              height={105}
                              loading="lazy"
                              decoding="async"
                            />
                          )}
                        </Link>

                        <div className={estilos.lineaCuerpo}>
                          <p className={estilos.lineaTitulo}>
                            <Link
                              href={`/p/${item.listingId}`}
                              className="subraya"
                              transitionTypes={['avanza']}
                            >
                              {item.title}
                            </Link>
                          </p>

                          <p className={estilos.lineaPrecio}>
                            {precio(item.unitPriceAmount, item.currency)}{' '}
                            <span className={estilos.lineaPorUnidad}>por unidad</span>
                          </p>

                          {/*
                            ⚠️ EL CAMBIO DE PRECIO SE AVISA CON EL VIEJO A LA
                            VISTA. `unit_price_snapshot` existe solo para esto:
                            decir "cambió" sin decir desde cuánto obliga a
                            recordar lo que uno vio hace una semana.
                          */}
                          {item.precioCambio && (
                            <p className={estilos.lineaCambio}>
                              {subio ? 'Subió' : 'Bajó'} desde que la agregaste: antes{' '}
                              {precio(item.unitPriceSnapshot, item.currency)}.
                            </p>
                          )}

                          {!item.comprable && (
                            <p className={estilos.lineaProblema}>
                              Ya no está a la venta. Sacala del carrito para poder comprar el resto.
                            </p>
                          )}

                          {item.comprable && !alcanza && (
                            <p className={estilos.lineaProblema}>
                              {item.stockDisponible === 0
                                ? 'Se quedó sin stock.'
                                : `Quedan ${cantidadLegible(item.stockDisponible, 'unidad', 'unidades')}: bajá la cantidad.`}
                            </p>
                          )}

                          {/*
                            Cada accion es un formulario propio: son mutaciones y
                            van por POST. Un enlace GET que cambia el carrito se
                            dispara solo con el prefetch del navegador.
                          */}
                          <div className={estilos.lineaAcciones}>
                            <Formulario
                              accion={cambiarCantidad}
                              enviar="Actualizar"
                              variante="fantasma"
                              tamanio="chico"
                              bloque={false}
                            >
                              <CampoOculto nombre="listingId" valor={item.listingId} />
                              {/*
                                ⚠️ EL `id` LLEVA EL `listingId` ADENTRO. Cinco
                                lineas con `id="cantidad"` hacen que las cinco
                                etiquetas enfoquen el control de la PRIMERA.
                              */}
                              <label
                                htmlFor={`cantidad-${item.listingId}`}
                                className="solo-lectores"
                              >
                                Cantidad de {item.title}
                              </label>
                              <select
                                id={`cantidad-${item.listingId}`}
                                name="cantidad"
                                className={estilos.cantidadSelect}
                                defaultValue={String(item.quantity)}
                              >
                                {Array.from({ length: tope }, (_, indice) => indice + 1).map(
                                  (valor) => (
                                    <option key={valor} value={valor}>
                                      {valor}
                                    </option>
                                  ),
                                )}
                              </select>
                            </Formulario>

                            <Formulario
                              accion={quitarDelCarrito}
                              enviar="Quitar"
                              variante="fantasma"
                              tamanio="chico"
                              bloque={false}
                            >
                              <CampoOculto nombre="listingId" valor={item.listingId} />
                            </Formulario>
                          </div>
                        </div>

                        <p className={estilos.lineaSubtotal}>
                          <span className={estilos.lineaSubtotalRotulo}>
                            {item.quantity === 1 ? 'Subtotal' : `${item.quantity} unidades`}
                          </span>
                          <span className={estilos.lineaSubtotalValor}>
                            {precio(item.subtotal, item.currency)}
                          </span>
                        </p>
                      </li>
                    );
                  })}
                </ul>

                <footer className={estilos.grupoPie}>
                  {/*
                    ⚠️ SE DICE QUE EL ENVIO LO DECLARA QUIEN VENDE, y no cuanto
                    sale: `getCart` no expone el modo de envio declarado
                    (`listings.shipping_mode`, delta §11) y afirmar "incluido" o
                    "a cargo del comprador" seria inventarlo. El importe real se
                    congela en cada orden (DEC-030) y se ve en el checkout, antes
                    de pagar. Queda reportado.
                  */}
                  <p className={estilos.grupoEnvio}>
                    El envío lo declara {grupo.sellerDisplayName} y queda fijado en la orden.
                  </p>
                  <p className={estilos.grupoSubtotal}>
                    <span>Subtotal</span>
                    <strong>{precio(grupo.subtotal, grupo.items[0]?.currency ?? moneda)}</strong>
                  </p>
                </footer>
              </section>
            ))}

            <section className={`${estilos.cierre} sup-2`}>
              <div className={estilos.totalFila}>
                <span className={estilos.totalRotulo}>Total del carrito</span>
                {/*
                  ⚠️ `.cifra-entra` ENTRA UNA VEZ Y TERMINA QUIETA. Es la unica
                  animacion permitida sobre plata.
                */}
                <span className={`${estilos.totalValor} cifra-entra`}>
                  <span>{precio(carrito.total, moneda)}</span>
                </span>
              </div>

              {/*
                ⚠️ DEC-026 SE EXPLICA ANTES DE APRETAR, no despues. Quien tiene
                camisetas de dos vendedores va a terminar con dos ordenes y dos
                pagos: enterarse en la pantalla siguiente se lee como un error
                del sitio.
              */}
              {carrito.vendedores.length > 1 && (
                <p className={estilos.totalNota}>
                  Se crean {cantidadLegible(carrito.vendedores.length, 'orden', 'órdenes')}, una por
                  vendedor, y cada una se paga por separado en Mercado Pago.
                </p>
              )}
            </section>

            <h2 className={estilos.subtitulo}>¿A dónde lo enviamos?</h2>

            <Formulario
              accion={comprarCarrito}
              enviar="Comprar"
              pie={
                <div className={`${estilos.barraCompra} sup-cancha`}>
                  <span className={estilos.barraRotulo}>Total del carrito</span>
                  <span className={estilos.barraTotal}>{precio(carrito.total, moneda)}</span>
                </div>
              }
            >
              <SelectorDeDireccion direcciones={direcciones} predeterminada={predeterminada} />
            </Formulario>

            <p className={estilos.nota}>
              <IconoCamiseta tamanio={16} />
              <span>
                Al comprar creamos las órdenes y te llevamos a pagarlas. El stock se descuenta
                recién cuando Mercado Pago confirma el pago.
              </span>
            </p>
          </>
        )}
      </main>
    </Pantalla>
  );
}
