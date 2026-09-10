import type { Metadata } from 'next';
<<<<<<< HEAD
import type { CSSProperties } from 'react';

import { IconoIntercambio } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import {
  CeldaNumero,
  Cifras,
  EncabezadoNumero,
  EstadoVacio,
  Etiqueta,
  Seccion,
  Tabla,
} from '@/components/ui';
import { estadoDeOrden, fecha, precio, tonoDeOrden } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { coverUrls } from '@/modules/listings/services/listing.service';
import { listMySales } from '@/modules/orders/services/order.service';

import { Chapa } from '../../chapa';
import { NavDelVendedor } from '../../nav';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mis ventas' };
=======

import { EstadoVacio, Etiqueta } from '@/components/ui';
import { estadoDeOrden, fecha, precio } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { listMySales } from '@/modules/orders/services/order.service';

import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mis ventas — Offside Store' };
>>>>>>> origin/main
export const dynamic = 'force-dynamic';

/**
 * Bandeja de ventas (SS-070).
 *
 * ⚠️ LOS IMPORTES SON EL SNAPSHOT DE LA ORDEN, no un cálculo de ahora. La
 * comisión se congeló al crearse la orden (DEC-030): si mañana cambia la tasa,
 * estas ventas siguen mostrando la que efectivamente se aplicó.
 *
 * ⚠️ NO HAY DETALLE NI ACCIONES (SS-071, SS-080). Despachar exige el módulo de
 * envíos con Correo Argentino, que no existe, y mostrar los datos del comprador
 * sin una pantalla que los use sería exponer datos personales sin motivo.
<<<<<<< HEAD
 *
 * ⚠️ ES UNA TABLA, NO UNA LISTA DE TARJETAS. Eran cuatro filas de
 * concepto/valor por venta: para comparar cuánto dejó cada una había que leer
 * cuatro tarjetas enteras. Una columna de importes alineados a la derecha, con
 * cifras tabulares, se compara de un vistazo — y eso es exactamente lo que
 * alguien viene a hacer a esta pantalla.
=======
>>>>>>> origin/main
 */
export default async function MisVentas() {
  const user = await requireSellerSessionUser('/vendedor/ventas');
  const ventas = await listMySales(user);

<<<<<<< HEAD
  const portadas = await coverUrls(ventas.flatMap((v) => v.items.map((i) => i.listingId)));

  /*
   * ⚠️ EL TOTAL SE SUMA CON `BigInt`, NO CON `Number`. Los importes viajan como
   * string de centavos justamente para no perder precisión; sumarlos como
   * punto flotante reintroduce el problema que el resto del sistema evita con
   * cuidado. `precio()` recién convierte al final, para dibujar.
   */
  const cobradas = ventas.filter((v) => v.status !== 'PENDING_PAYMENT' && v.status !== 'CANCELLED');
  const neto = cobradas.reduce((suma, v) => suma + BigInt(v.sellerAmount), 0n);
  const comision = cobradas.reduce((suma, v) => suma + BigInt(v.commissionAmount), 0n);
  const moneda = ventas[0]?.currency ?? 'ARS';

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Chapa rotulo="Cobros" titulo="Mis ventas" chica />

        <NavDelVendedor activo="ventas" ventas={ventas.length} />

        {ventas.length === 0 ? (
          <EstadoVacio titulo="Todavía no vendiste nada" icono={<IconoIntercambio tamanio={40} />}>
            <p>
              Cuando alguien te compre, la orden va a aparecer acá con su estado y con lo que te
              queda después de la comisión.
            </p>
          </EstadoVacio>
        ) : (
          <>
            {/*
              ⚠️ DOS DE LAS TRES CIFRAS SON PLATA: entran con el bloque y quedan
              QUIETAS. Nada de contar hacia arriba —un importe que sube mientras
              alguien lo lee se interpreta como un importe que todavía se está
              calculando—. El pliego oscuro es lo que corta el scroll y le da al
              número el peso que tenía el borde de la caja blanca.
            */}
            <div className={`${estilos.tablero} sup-noche con-grano`}>
              <Cifras
                cifras={[
                  {
                    valor: String(cobradas.length),
                    etiqueta: 'Ventas cobradas',
                    detalle: `de ${ventas.length} órdenes`,
                  },
                  {
                    valor: precio(neto.toString(), moneda),
                    etiqueta: 'Te quedó',
                    detalle: 'antes del costo de Mercado Pago',
                  },
                  {
                    valor: precio(comision.toString(), moneda),
                    etiqueta: 'Comisión de Offside',
                  },
                ]}
              />
            </div>

            <Seccion titulo="Órdenes recibidas">
              <div className={estilos.marcoVentas}>
                <Tabla titulo="Órdenes recibidas">
                  <thead>
                    <tr>
                      <th scope="col">Qué se vendió</th>
                      <th scope="col">Estado</th>
                      <EncabezadoNumero>Total</EncabezadoNumero>
                      <EncabezadoNumero>Comisión</EncabezadoNumero>
                      <EncabezadoNumero>Te queda</EncabezadoNumero>
                    </tr>
                  </thead>
                  <tbody>
                    {ventas.map((venta) => {
                      const principal = venta.items[0];
                      const portada =
                        principal === undefined ? undefined : portadas.get(principal.listingId);
                      const otros = venta.items.length - 1;

                      /*
                       * ⚠️ LA PROPORCION SE SACA CON `BigInt` Y RECIEN AL FINAL
                       * SE VUELVE NUMERO. Los importes viajan como string de
                       * centavos justamente para no perder precisión; dividir dos
                       * `Number` de centavos reintroduce el problema que el resto
                       * del sistema evita con cuidado.
                       *
                       * ⚠️ NO ES UN DATO NUEVO: `sellerAmount` y `totalAmount` ya
                       * son el snapshot congelado de la orden (DEC-030). Es la
                       * misma información, dibujada.
                       */
                      const total = BigInt(venta.totalAmount);
                      const parte =
                        total === 0n
                          ? 0
                          : Number((BigInt(venta.sellerAmount) * 1000n) / total) / 1000;

                      return (
                        <tr key={venta.id}>
                          <td>
                            <div className={estilos.celdaVenta}>
                              <span className={estilos.celdaMarco}>
                                {portada === undefined ? (
                                  <span className={estilos.celdaPatron} aria-hidden="true" />
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    className={estilos.celdaFoto}
                                    src={portada}
                                    alt=""
                                    width={44}
                                    height={55}
                                    loading="lazy"
                                    decoding="async"
                                  />
                                )}
                              </span>
                              <div>
                                {/*
                                  ⚠️ EL TITULO CONGELADO EN LA ORDEN, no el de la
                                  publicación de hoy (DEC-030). La bandeja decía
                                  sólo "Orden OFF-XXXXXXXXXX": para saber QUÉ se
                                  vendió había que ir a buscarla.
                                */}
                                <p className={estilos.celdaTitulo}>
                                  {principal?.title ?? `Orden ${venta.orderNumber}`}
                                  {otros > 0 && (
                                    <span className={estilos.celdaOtros}> +{otros}</span>
                                  )}
                                </p>
                                <p className={estilos.celdaMeta}>
                                  {fecha(venta.createdAt)} · {venta.orderNumber}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td>
                            <Etiqueta tono={tonoDeOrden(venta.status)}>
                              {estadoDeOrden(venta.status)}
                            </Etiqueta>
                          </td>
                          <CeldaNumero>{precio(venta.totalAmount, venta.currency)}</CeldaNumero>
                          <CeldaNumero>
                            −{precio(venta.commissionAmount, venta.currency)}
                          </CeldaNumero>
                          <CeldaNumero>
                            <strong>{precio(venta.sellerAmount, venta.currency)}</strong>
                            {/*
                              ⚠️ LA BARRA ES FORMA, NO EL DATO, Y POR ESO VA
                              `aria-hidden`. El importe está escrito arriba; esto
                              sólo sirve para comparar dos ventas de un vistazo sin
                              hacer la división mentalmente en cada fila. Entra una
                              vez y queda quieta: es lo único que se mueve cerca de
                              un importe y no toca el número.

                              ⚠️ EL `as CSSProperties` HACE FALTA: React todavía no
                              tipa las propiedades personalizadas en `style`.
                            */}
                            <span
                              className={estilos.barraNeto}
                              style={{ '--parte': parte } as CSSProperties}
                              aria-hidden="true"
                            />
                          </CeldaNumero>
                        </tr>
                      );
                    })}
                  </tbody>
                </Tabla>
              </div>
            </Seccion>
          </>
        )}

        {/*
          ⚠️ "Te queda" ES ANTES DEL COSTO DE MERCADO PAGO. DEC-043: el costo de
          MP se descuenta del lado del vendedor, y Offside no lo conoce al crear
          la orden. Prometer un neto exacto sería mentir — y eso no puede estar en
          gris de 13px al pie.
        */}
        <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
          <p className={estilos.nota}>
            Mercado Pago cobra además su propio costo de procesamiento, que se descuenta de tu parte
            al acreditarse el pago. Por eso lo de arriba dice «te quedó» y no «cobraste».
          </p>
        </div>
      </main>
    </Pantalla>
=======
  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Mis ventas</h1>

      {ventas.length === 0 ? (
        <EstadoVacio titulo="Todavía no vendiste nada">
          Cuando alguien te compre, la orden va a aparecer acá con su estado y lo que te queda.
        </EstadoVacio>
      ) : (
        ventas.map((venta) => (
          <article key={venta.id} className={estilos.tarjeta}>
            <div className={estilos.linea}>
              <span>Orden {venta.orderNumber}</span>
              <Etiqueta aviso={venta.status === 'CANCELLED'}>
                {estadoDeOrden(venta.status)}
              </Etiqueta>
            </div>
            <div className={estilos.linea}>
              <span className={estilos.concepto}>{fecha(venta.createdAt)}</span>
              <span>{precio(venta.totalAmount, venta.currency)}</span>
            </div>
            <div className={estilos.linea}>
              <span className={estilos.concepto}>Comisión de Offside</span>
              <span>−{precio(venta.commissionAmount, venta.currency)}</span>
            </div>
            <div className={estilos.linea}>
              <span className={estilos.concepto}>Te queda</span>
              <span>{precio(venta.sellerAmount, venta.currency)}</span>
            </div>
          </article>
        ))
      )}

      {/*
        ⚠️ "Te queda" ES ANTES DEL COSTO DE MERCADO PAGO. DEC-043: el costo de MP
        se descuenta del lado del vendedor, y Offside no lo conoce al crear la
        orden. Prometer un neto exacto sería mentir.
      */}
      <p className={estilos.nota}>
        Mercado Pago cobra además su propio costo de procesamiento, que se descuenta de tu parte al
        acreditarse el pago.
      </p>
    </main>
>>>>>>> origin/main
  );
}
