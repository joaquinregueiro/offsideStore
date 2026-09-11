import type { Metadata } from 'next';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { IconoIntercambio } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import {
  CeldaNumero,
  Cifras,
  EncabezadoNumero,
  EstadoVacio,
  Etiqueta,
  NavDeSeccion,
  Seccion,
  Tabla,
} from '@/components/ui';
import { estadoDeOrden, fecha, precio, tonoDeOrden } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { PanelDeCuenta, SolapasDeCuenta } from '../../../(cuenta)/panel';
import { getDispatchDeadlineHours } from '@/modules/config/services/setting-store.service';
import { listForSeller } from '@/modules/disputes/services/dispute.service';
import { coverUrls } from '@/modules/listings/services/listing.service';
import { isDispatchOverdue } from '@/modules/orders/services/order-transitions';
import { listMySales, type PublicOrderConItems } from '@/modules/orders/services/order.service';

import { Chapa } from '../../chapa';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mis ventas' };
export const dynamic = 'force-dynamic';

/**
 * Las pestañas de la bandeja, en el orden del ciclo de la orden (DEC-029).
 *
 * ⚠️ SON ESTADOS DE TRABAJO, NO NOMBRES DE ENUM. "A despachar" junta `PAID` y
 * `PROCESSING` porque para quien vende son la misma tarea —hay plata cobrada y
 * un paquete que armar—, y `PAID` es un instante: el pago aprobado deja la
 * orden en `PROCESSING` salvo faltante de stock. Separarlas mostraría una
 * pestaña casi siempre vacía al lado de otra idéntica.
 *
 * ⚠️ "TODAS" EXISTE Y VA PRIMERA. Sin ella, las órdenes `PENDING_PAYMENT` —que
 * no son ninguna de las seis— no aparecerían en ninguna pestaña: el vendedor
 * vería menos ventas de las que tiene y no habría forma de explicarle por qué.
 */
const PESTANIAS = [
  { clave: 'todas', texto: 'Todas' },
  { clave: 'a-despachar', texto: 'A despachar' },
  { clave: 'en-camino', texto: 'En camino' },
  { clave: 'entregadas', texto: 'Entregadas' },
  { clave: 'completadas', texto: 'Completadas' },
  { clave: 'canceladas', texto: 'Canceladas' },
  { clave: 'con-reclamo', texto: 'Con reclamo' },
] as const;

type ClaveDePestania = (typeof PESTANIAS)[number]['clave'];

function esClave(valor: string | undefined): valor is ClaveDePestania {
  return PESTANIAS.some((p) => p.clave === valor);
}

/** Qué estados de orden entran en cada pestaña. `con-reclamo` no filtra por estado. */
const ESTADOS: Record<Exclude<ClaveDePestania, 'todas' | 'con-reclamo'>, readonly string[]> = {
  'a-despachar': ['PAID', 'PROCESSING'],
  'en-camino': ['SHIPPED'],
  entregadas: ['DELIVERED'],
  completadas: ['COMPLETED'],
  canceladas: ['CANCELLED'],
};

/**
 * Bandeja de ventas (SS-070).
 *
 * ⚠️ LA PESTAÑA VIAJA EN LA URL (`?estado=`), NO EN ESTADO DE REACT. Así una
 * bandeja se comparte, se guarda en favoritos, vuelve con el botón atrás y
 * funciona sin una línea de JavaScript: cada pestaña es un `<a href>`.
 *
 * ⚠️ SE PIDEN TODAS LAS VENTAS UNA SOLA VEZ Y SE FILTRAN EN MEMORIA, en vez de
 * llamar a `listMySales({estado})` por pestaña. Dos motivos: "a despachar" son
 * dos estados y "con reclamo" no es un estado de la orden —lo decide el módulo
 * de disputas—, así que igual haría falta cruzar; y el conteo de cada pestaña
 * necesita el total de todas, que con un filtro por estado serían siete
 * consultas para dibujar siete numeritos.
 *
 * ⚠️ LOS IMPORTES SON EL SNAPSHOT DE LA ORDEN, no un cálculo de ahora. La
 * comisión se congeló al crearse la orden (DEC-030): si mañana cambia la tasa,
 * estas ventas siguen mostrando la que efectivamente se aplicó.
 */
export default async function MisVentas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSellerSessionUser('/vendedor/ventas');
  const params = await searchParams;

  const crudo = Array.isArray(params.estado) ? params.estado[0] : params.estado;
  const pestania: ClaveDePestania = esClave(crudo) ? crudo : 'todas';

  const [ventas, reclamos, horasDeDespacho] = await Promise.all([
    listMySales(user),
    listForSeller(user),
    getDispatchDeadlineHours(),
  ]);

  const conReclamo = new Set(reclamos.map((reclamo) => reclamo.orderId));

  const deLaPestania = (clave: ClaveDePestania): PublicOrderConItems[] => {
    if (clave === 'todas') return ventas;
    if (clave === 'con-reclamo') return ventas.filter((venta) => conReclamo.has(venta.id));

    return ventas.filter((venta) => ESTADOS[clave].includes(venta.status));
  };

  const visibles = deLaPestania(pestania);
  const portadas = await coverUrls(visibles.flatMap((v) => v.items.map((i) => i.listingId)));

  /*
   * ⚠️ EL PLAZO SE RESUELVE UNA VEZ Y SE APLICA A TODAS. `getDispatchDeadline`
   * lee la configuración en cada llamada: usarla por fila serían N lecturas de
   * `app_settings` para dibujar una lista. `isDispatchOverdue` es la misma
   * regla, pura, con las horas ya resueltas.
   */
  const ahora = new Date();
  const vencida = (venta: PublicOrderConItems): boolean =>
    isDispatchOverdue(
      { status: venta.status, paidAt: venta.paidAt === null ? null : new Date(venta.paidAt) },
      horasDeDespacho,
      ahora,
    );

  const vencidas = ventas.filter(vencida).length;

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
      <PanelDeCuenta user={user} seccion="publicaciones">
        <main id="contenido">
          <Chapa rotulo="Publicaciones" titulo="Mis ventas" chica />

          <SolapasDeCuenta user={user} seccion="publicaciones" activa="ventas" />

          {ventas.length === 0 ? (
            <EstadoVacio
              titulo="Todavía no vendiste nada"
              icono={<IconoIntercambio tamanio={40} />}
            >
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

              {/*
              ⚠️ EL VENCIMIENTO SE AVISA ARRIBA Y NO SOLO EN LA FILA. Un plazo de
              despacho vencido (BR-032) es lo único de esta pantalla que tiene
              consecuencia sobre la reputación del vendedor, y descubrirlo
              scrolleando una tabla de treinta filas es descubrirlo tarde.
            */}
              {vencidas > 0 && (
                <p className={estilos.avisoPlazo}>
                  {vencidas === 1
                    ? 'Hay 1 venta con el plazo de despacho vencido.'
                    : `Hay ${vencidas} ventas con el plazo de despacho vencido.`}{' '}
                  <Link href="/vendedor/ventas?estado=a-despachar">Ver cuáles</Link>
                </p>
              )}

              {/*
              ⚠️ LAS PESTAÑAS SON ENLACES A URLs DISTINTAS, no botones con estado.
              `NavDeSeccion` marca la activa con `aria-current="page"`, que es lo
              que un lector de pantalla anuncia; el color solo acelera la lectura.
            */}
              <div className={estilos.navMarco}>
                <NavDeSeccion
                  etiqueta="Ventas por estado"
                  activo={pestania}
                  items={PESTANIAS.map((p) => {
                    const cuantas = deLaPestania(p.clave).length;

                    return {
                      clave: p.clave,
                      texto: p.texto,
                      href:
                        p.clave === 'todas'
                          ? '/vendedor/ventas'
                          : `/vendedor/ventas?estado=${p.clave}`,
                      ...(cuantas > 0 ? { dato: cuantas } : {}),
                    };
                  })}
                />
              </div>

              {visibles.length === 0 ? (
                <EstadoVacio titulo="Nada en esta pestaña">
                  <p>
                    No hay ventas en este estado. Probá con{' '}
                    <Link href="/vendedor/ventas">todas</Link>.
                  </p>
                </EstadoVacio>
              ) : (
                <Seccion
                  titulo="Órdenes recibidas"
                  dato={visibles.length === 1 ? '1 orden' : `${visibles.length} órdenes`}
                >
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
                        {visibles.map((venta) => {
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
                                    publicación de hoy (DEC-030), y ahora ADEMAS es
                                    el enlace al detalle: la bandeja no tenía ninguna
                                    salida, así que despachar era imposible desde acá.
                                  */}
                                    <p className={estilos.celdaTitulo}>
                                      <Link
                                        href={`/vendedor/ventas/${venta.id}`}
                                        className="subraya"
                                        transitionTypes={['avanza']}
                                      >
                                        {principal?.title ?? `Orden ${venta.orderNumber}`}
                                      </Link>
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
                                {/*
                                ⚠️ EL PLAZO VENCIDO SE DICE CON TEXTO, no sólo con
                                color: quien no distingue naranja de gris lee lo
                                mismo. Y el reclamo se marca en la fila porque es la
                                única señal de que esa orden necesita una respuesta.
                              */}
                                {vencida(venta) && (
                                  <span className={estilos.marcaVencida}>Plazo vencido</span>
                                )}
                                {conReclamo.has(venta.id) && (
                                  <span className={estilos.marcaReclamo}>Con reclamo</span>
                                )}
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
                                vez y queda quieta.

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
              )}
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
              Mercado Pago cobra además su propio costo de procesamiento, que se descuenta de tu
              parte al acreditarse el pago. Por eso lo de arriba dice «te quedó» y no «cobraste».
            </p>
          </div>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
