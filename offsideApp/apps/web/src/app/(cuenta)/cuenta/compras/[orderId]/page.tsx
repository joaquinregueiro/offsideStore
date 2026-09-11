import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CampoOculto, Formulario } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  BotonEnlace,
  Confirmar,
  Cronologia,
  Etiqueta,
  FilaDeDatos,
  Migas,
  type Hito,
} from '@/components/ui';
import {
  cantidad,
  estadoDeDisputa,
  estadoDeEnvio,
  estadoDeOrden,
  fecha,
  fechaYHora,
  motivoDeReclamo,
  precio,
  tonoDeDisputa,
  tonoDeOrden,
} from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import {
  getDispatchDeadlineHours,
  getDisputeWindowDays,
  getReviewWindowDays,
} from '@/modules/config/services/setting-store.service';
import { getDisputeForOrder } from '@/modules/disputes/services/dispute.service';
import { claimEligibility } from '@/modules/disputes/services/dispute-rules';
import { coverUrls } from '@/modules/listings/services/listing.service';
import {
  getMyOrderDetail,
  type OrderStatus,
  type TimelineEntry,
} from '@/modules/orders/services/order.service';
import { getReviewForOrder } from '@/modules/reviews/services/review.service';
import { isWithinReviewWindow } from '@/modules/reviews/services/review-rules';

import { cancelarCompra, confirmarRecepcion } from '../../../acciones';
import { ChapaDeCuenta } from '../../../chapa';
import { NavDeCuenta } from '../../../nav';
import estilos from '../../../cuenta.module.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orderId: string }>;
}): Promise<Metadata> {
  const { orderId } = await params;
  const user = await requireVerifiedSessionUser(`/cuenta/compras/${orderId}`);
  const orden = await getMyOrderDetail(user, orderId);

  return { title: orden === null ? 'Compra' : `Orden ${orden.orderNumber}` };
}

/**
 * EL RECORRIDO DE UNA ORDEN, tal como DEC-029 lo fija.
 *
 * ⚠️ `PAID` NO ESTÁ EN LA LISTA Y NO ES UN OLVIDO: es un instante —el pago
 * aprobado deja la orden en `PROCESSING`—, así que dibujarlo como un hito
 * prometería un escalón que en la práctica no se ve. Si una orden se queda en
 * `PAID` por un faltante de stock, la línea igual lo muestra: sale del
 * historial real, no de esta lista.
 *
 * ⚠️ ESTO ES PRESENTACIÓN: sirve para pintar los pasos que FALTAN en gris. Los
 * que ya pasaron salen siempre de `getOrderTimeline`, que es el historial de
 * verdad.
 */
const RECORRIDO: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
];

/**
 * Lee una clave del snapshot de dirección, o `null`.
 *
 * ⚠️ EL SNAPSHOT ES `jsonb` LIBRE Y NO TIENE UNA SOLA FORMA. Las órdenes viejas
 * las escribió el formulario del checkout (`nombre`, `calle`, `ciudad`,
 * `provincia`, `codigoPostal`, `telefono`) y las nuevas salen de
 * `toShippingSnapshot`, que además trae `numero`, `departamento` y `etiqueta`.
 * Tipar esto como si siempre fuera lo segundo haría que una compra vieja
 * imprimiera `undefined` en la etiqueta de envío. Por eso se lee clave por
 * clave y se comprueba que sea texto.
 */
function campo(snapshot: Record<string, unknown>, clave: string): string | null {
  const valor = snapshot[clave];

  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

/**
 * La dirección de la orden, dibujada como una etiqueta de envío.
 *
 * ⚠️ ES UN `<address>` DE VERDAD: un lector de pantalla anuncia que lo que
 * sigue es una dirección, y se lee con la misma forma que lo que va pegado al
 * paquete.
 *
 * ⚠️ SI EL SNAPSHOT NO TIENE NI CALLE NI LOCALIDAD NO SE DIBUJA UNA CAJA VACÍA.
 * Es `jsonb` libre y una orden importada o vieja puede no traer nada: media
 * etiqueta de envío en blanco se lee como un dato perdido.
 */
function Domicilio({ snapshot }: { snapshot: Record<string, unknown> }) {
  const nombre = campo(snapshot, 'nombre');
  const calle = campo(snapshot, 'calle');
  const numero = campo(snapshot, 'numero');
  const departamento = campo(snapshot, 'departamento');
  const ciudad = campo(snapshot, 'ciudad');
  const provincia = campo(snapshot, 'provincia');
  const codigoPostal = campo(snapshot, 'codigoPostal');
  const telefono = campo(snapshot, 'telefono');

  if (calle === null && ciudad === null) {
    return <p className={estilos.nota}>No quedó registrada la dirección de esta compra.</p>;
  }

  return (
    <address className={estilos.domicilio}>
      {nombre !== null && <span className={estilos.domicilioNombre}>{nombre}</span>}
      {calle}
      {numero !== null && ` ${numero}`}
      {departamento !== null && `, ${departamento}`}
      {(calle !== null || numero !== null) && <br />}
      {codigoPostal !== null && `${codigoPostal} `}
      {ciudad}
      {provincia !== null && (
        <>
          <br />
          {provincia}
        </>
      )}
      {telefono !== null && (
        <>
          <br />
          Tel. {telefono}
        </>
      )}
    </address>
  );
}

/**
 * Quién produjo cada transición, en la voz del comprador.
 *
 * ⚠️ ES UNA FUNCIÓN Y NO UNA CONSTANTE PORQUE EL VENDEDOR TIENE NOMBRE. "El
 * vendedor despachó" y "Retro Cancha despachó" dicen lo mismo, pero la segunda
 * es la que alguien puede buscar en su correo o mencionar en un reclamo. Cuando
 * `sellerDisplayName` viene `null` —una orden vieja, un perfil borrado— se cae
 * al genérico en vez de imprimir un hueco.
 */
function actoresDe(tienda: string | null): Record<TimelineEntry['actorType'], string> {
  return {
    user: 'vos',
    seller: tienda ?? 'el vendedor',
    admin: 'Offside',
    system: 'automático',
  };
}

/**
 * Convierte el historial en hitos, y agrega en gris lo que todavía falta.
 *
 * ⚠️ UNA CANCELACIÓN CORTA LA LÍNEA. No hay nada después de una orden
 * cancelada, y dibujar los hitos siguientes apagados prometería un recorrido
 * que ya no existe.
 */
function hitosDe(timeline: TimelineEntry[], status: OrderStatus, tienda: string | null): Hito[] {
  const actores = actoresDe(tienda);

  const hechos: Hito[] = timeline.map((entrada, indice) => ({
    clave: `${entrada.toStatus}-${entrada.createdAt}-${indice}`,
    titulo: estadoDeOrden(entrada.toStatus),
    estado:
      indice < timeline.length - 1
        ? 'hecho'
        : entrada.toStatus === 'CANCELLED'
          ? 'cancelado'
          : 'actual',
    fecha: fechaYHora(entrada.createdAt),
    actor: actores[entrada.actorType],
    nota: entrada.note ?? undefined,
  }));

  if (status === 'CANCELLED') return hechos;

  const alcanzado = RECORRIDO.indexOf(status);
  if (alcanzado < 0) return hechos;

  const faltan: Hito[] = RECORRIDO.slice(alcanzado + 1).map((futuro) => ({
    clave: `futuro-${futuro}`,
    titulo: estadoDeOrden(futuro),
    estado: 'futuro',
  }));

  return [...hechos, ...faltan];
}

/**
 * FICHA DE UNA COMPRA.
 *
 * ⚠️ UNA ORDEN AJENA DA 404, NO 403. `getMyOrderDetail` devuelve `null` tanto
 * para una orden de otro como para una que no existe, y acá los dos casos se
 * ven igual: distinguirlos permitiría enumerar las órdenes de otras personas.
 *
 * ⚠️ LAS ACCIONES SALEN DE LA MÁQUINA DE ESTADOS, NO DE UN `if` DE PANTALLA.
 * `detalle.actions` ya trae `canPay`, `canCancel` y `canConfirmDelivery`
 * resueltos con `canTransition`; la elegibilidad del reclamo la decide
 * `claimEligibility` y la de la reseña `isWithinReviewWindow`. Una copia de esas
 * reglas acá sería una segunda definición que se separa de la buena.
 */
export default async function FichaDeCompra({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const user = await requireVerifiedSessionUser(`/cuenta/compras/${orderId}`);

  const detalle = await getMyOrderDetail(user, orderId);
  if (detalle === null) notFound();

  const ahora = new Date();

  const [reclamo, resena, diasDeReclamo, diasDeResena, horasDeDespacho, portadas] =
    await Promise.all([
      getDisputeForOrder(user, orderId),
      getReviewForOrder(orderId),
      getDisputeWindowDays(),
      getReviewWindowDays(),
      getDispatchDeadlineHours(),
      coverUrls(detalle.items.map((item) => item.listingId)),
    ]);

  /*
   * ⚠️ SE PREGUNTA POR `not_received` Y ESO CUBRE LOS DOS CAMINOS. Con la orden
   * despachada, entregada o completada cualquier motivo entra si la ventana
   * sigue abierta; con la orden en `PROCESSING` y el despacho vencido, BR-032
   * habilita SÓLO ese motivo. O sea: si "no lo recibí" no se puede, no se puede
   * ninguno.
   */
  const elegible = claimEligibility(
    {
      status: detalle.status,
      paidAt: detalle.paidAt === null ? null : new Date(detalle.paidAt),
      shippedAt: detalle.shippedAt === null ? null : new Date(detalle.shippedAt),
      deliveredAt: detalle.deliveredAt === null ? null : new Date(detalle.deliveredAt),
    },
    'not_received',
    { windowDays: diasDeReclamo, dispatchDeadlineHours: horasDeDespacho },
    ahora,
  );

  /*
   * ⚠️ EL NOMBRE DE LA TIENDA, CON GENÉRICO DE RESPALDO. Decir "Retro Cancha
   * todavía no lo despachó" en vez de "el vendedor" es lo que convierte un
   * estado en algo sobre lo que se puede actuar: es el nombre que la persona
   * puede buscar en su correo o mencionar en un reclamo. `sellerDisplayName`
   * puede venir `null` —orden vieja, perfil borrado—, y ahí el genérico es
   * mejor que un hueco.
   */
  const tienda = detalle.sellerDisplayName ?? 'el vendedor';

  const puedeReclamar = elegible.ok && reclamo === null;
  const puedeCalificar =
    detalle.status === 'COMPLETED' &&
    resena === null &&
    isWithinReviewWindow(
      detalle.completedAt === null ? null : new Date(detalle.completedAt),
      diasDeResena,
      ahora,
    );

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <ChapaDeCuenta
          rotulo={`Orden ${detalle.orderNumber}`}
          titulo={detalle.items[0]?.title ?? 'Tu compra'}
          detalle={
            <p className={estilos.chapaDetalle}>
              Comprada el {fecha(detalle.createdAt)}
              {detalle.sellerDisplayName !== null && ` · ${detalle.sellerDisplayName}`}
            </p>
          }
          lateral={
            <Etiqueta tono={tonoDeOrden(detalle.status)}>{estadoDeOrden(detalle.status)}</Etiqueta>
          }
        />

        <NavDeCuenta activo="compras" />

        <Migas
          items={[
            { texto: 'Mi cuenta', href: '/cuenta' },
            { texto: 'Mis compras', href: '/cuenta/compras' },
            { texto: `Orden ${detalle.orderNumber}` },
          ]}
        />

        <div className={estilos.ficha}>
          <div className={estilos.columna}>
            <section className={`${estilos.bloque} sup-ficha entraBloque`}>
              <h2 className={estilos.bloqueTitulo}>Seguimiento</h2>
              <Cronologia
                etiqueta={`Estado de la orden ${detalle.orderNumber}`}
                hitos={hitosDe(detalle.timeline, detalle.status, detalle.sellerDisplayName)}
              />
            </section>

            <section className={`${estilos.bloque} sup-ficha`}>
              <h2 className={estilos.bloqueTitulo}>Qué compraste</h2>
              <ul className={estilos.items}>
                {detalle.items.map((item) => {
                  const portada = portadas.get(item.listingId);

                  return (
                    <li key={item.id} className={estilos.item}>
                      <span className={estilos.itemMarco}>
                        {portada === undefined ? (
                          <span
                            className={`${estilos.itemPatron} ${estilos.rombos}`}
                            aria-hidden="true"
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className={estilos.itemFoto}
                            src={portada}
                            alt=""
                            width={64}
                            height={80}
                            loading="lazy"
                            decoding="async"
                          />
                        )}
                      </span>
                      <div>
                        {/*
                          ⚠️ EL TÍTULO ES EL SNAPSHOT (DEC-030) Y EL ENLACE VA A LA
                          PUBLICACIÓN ACTUAL: son dos cosas distintas a propósito.
                          El enlace puede terminar en 404 si el vendedor la
                          eliminó, y eso está bien; lo que NO puede pasar es que
                          el título cambie después de comprar.
                        */}
                        <p className={estilos.itemTitulo}>
                          <Link href={`/p/${item.listingId}`}>{item.title}</Link>
                        </p>
                        <p className={estilos.itemMeta}>
                          {cantidad(item.quantity, 'unidad', 'unidades')} ·{' '}
                          {precio(item.unitPriceAmount, detalle.currency)} c/u
                        </p>
                      </div>
                      <span className={estilos.itemPrecio}>
                        {precio(item.unitPriceAmount, detalle.currency)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className={`${estilos.bloque} sup-ficha`}>
              <h2 className={estilos.bloqueTitulo}>Envío</h2>
              {detalle.shipment === null ? (
                <p className={estilos.nota}>
                  {detalle.status === 'PENDING_PAYMENT'
                    ? `Cuando se acredite el pago, ${tienda} prepara el paquete y carga acá el transportista y el número de seguimiento.`
                    : `Todavía no lo despacharon. Cuando ${tienda} lo despache vas a ver acá el transportista y el número de seguimiento que declare.`}
                </p>
              ) : (
                <>
                  <FilaDeDatos concepto="Estado">
                    {estadoDeEnvio(detalle.shipment.status)}
                  </FilaDeDatos>
                  <FilaDeDatos concepto="Transportista">
                    {detalle.shipment.carrierName ?? 'Sin declarar'}
                  </FilaDeDatos>
                  <FilaDeDatos concepto="Número de seguimiento">
                    {/*
                      ⚠️ EL NÚMERO SE MUESTRA SIEMPRE QUE EXISTA, aunque no haya
                      enlace: el transportista puede no tener una página de
                      seguimiento cargada, y esconder el número por eso deja a la
                      persona sin el único dato con el que puede reclamar.
                    */}
                    {detalle.shipment.trackingNumber === null ? (
                      'Sin número'
                    ) : detalle.shipment.trackingUrl === null ? (
                      detalle.shipment.trackingNumber
                    ) : (
                      <a
                        href={detalle.shipment.trackingUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {detalle.shipment.trackingNumber}
                      </a>
                    )}
                  </FilaDeDatos>
                  {detalle.shipment.dispatchedAt !== null && (
                    <FilaDeDatos concepto="Despachado">
                      {fechaYHora(detalle.shipment.dispatchedAt)}
                    </FilaDeDatos>
                  )}
                  {/*
                    ⚠️ ESTO NO ES SEGUIMIENTO AUTOMÁTICO Y LA PANTALLA LO DICE. No
                    hay integración con ningún transportista: lo de arriba es lo
                    que el vendedor declaró a mano. Presentarlo como tracking en
                    vivo sería prometer algo que no existe.
                  */}
                  <p className={estilos.nota}>
                    Estos datos los carga {tienda}. Offside todavía no se conecta con el
                    transportista, así que el seguimiento hay que hacerlo en la página de ellos.
                  </p>
                </>
              )}
            </section>

            <section className={`${estilos.bloque} sup-ficha`}>
              <h2 className={estilos.bloqueTitulo}>A dónde va</h2>
              <Domicilio snapshot={detalle.shippingAddress} />
              {/*
                ⚠️ SE DICE QUE ES LA DIRECCIÓN DE ESE DÍA Y NO LA DE LA LIBRETA.
                La orden congeló su `shipping_address` al crearse (DEC-030): si
                alguien se mudó o editó la libreta después, esto sigue diciendo a
                dónde viajó el paquete. Sin esa línea, ver una dirección vieja se
                lee como un bug.
              */}
              <p className={estilos.nota}>
                Es la dirección que cargaste al comprar. Cambiarla en tus direcciones no cambia esta
                compra.
              </p>
            </section>
          </div>

          <div className={estilos.columna}>
            <section className={`${estilos.bloque} sup-ficha entraBloque`}>
              <h2 className={estilos.bloqueTitulo}>Importes</h2>
              <FilaDeDatos concepto="Productos">
                {precio(detalle.productAmount, detalle.currency)}
              </FilaDeDatos>
              <FilaDeDatos concepto="Envío">
                {/*
                  ⚠️ CERO NO ES "GRATIS". Con el envío incluido en el precio el
                  costo está adentro del producto; no hay envío sin costo en
                  ningún lado y prometerlo sería la primera queja.
                */}
                {detalle.shippingAmount === '0'
                  ? 'Sin costo aparte'
                  : precio(detalle.shippingAmount, detalle.currency)}
              </FilaDeDatos>
              <FilaDeDatos concepto="Total" destacada>
                {precio(detalle.totalAmount, detalle.currency)}
              </FilaDeDatos>
            </section>

            <section className={`${estilos.bloque} sup-ficha`}>
              <h2 className={estilos.bloqueTitulo}>Qué podés hacer</h2>

              {detalle.actions.canPay && detalle.windows.paymentDeadline !== null && (
                <Aviso tono="neutro">
                  Tenés tiempo de pagar hasta el {fechaYHora(detalle.windows.paymentDeadline)}.
                </Aviso>
              )}

              <div className={estilos.acciones}>
                {/*
                  ⚠️ "PAGAR" ES UN ENLACE AL CHECKOUT, NO UN FORMULARIO QUE LLAME
                  A MERCADO PAGO DESDE ACÁ. El checkout es la pantalla que sabe
                  mostrar la vuelta del proveedor (`?status=`), el "estamos
                  confirmando" y el vencimiento; duplicar el inicio de pago acá
                  sería una segunda puerta a la misma preferencia.
                */}
                {detalle.actions.canPay && (
                  <BotonEnlace href={`/checkout/${detalle.id}`} flecha>
                    Pagar
                  </BotonEnlace>
                )}

                {detalle.actions.canConfirmDelivery && (
                  <Confirmar
                    etiqueta="Lo recibí"
                    pregunta="Al confirmar, la compra pasa a entregada y empieza a correr el plazo de protección. Confirmá sólo cuando tengas el paquete en la mano."
                  >
                    <Formulario
                      accion={confirmarRecepcion}
                      enviar="Sí, lo recibí"
                      tamanio="medio"
                      bloque={false}
                    >
                      <CampoOculto nombre="orderId" valor={detalle.id} />
                    </Formulario>
                  </Confirmar>
                )}

                {detalle.actions.canCancel && (
                  <Confirmar
                    etiqueta="Cancelar la compra"
                    pregunta="Se cancela la orden y la unidad vuelve a estar disponible para otra persona. No se puede deshacer."
                  >
                    <Formulario
                      accion={cancelarCompra}
                      enviar="Cancelar la compra"
                      variante="peligro"
                      tamanio="medio"
                      bloque={false}
                    >
                      <CampoOculto nombre="orderId" valor={detalle.id} />
                    </Formulario>
                  </Confirmar>
                )}

                {puedeCalificar && (
                  <BotonEnlace
                    href={`/cuenta/compras/${detalle.id}/calificar`}
                    variante="secundario"
                  >
                    {/*
                      ⚠️ LA PREPOSICIÓN CAMBIA CON EL NOMBRE: "Calificar a Retro
                      Cancha" contra "Calificar al vendedor". Un `Calificar a
                      ${tienda}` con el genérico adentro daría "Calificar a el
                      vendedor".
                    */}
                    {detalle.sellerDisplayName === null
                      ? 'Calificar al vendedor'
                      : `Calificar a ${detalle.sellerDisplayName}`}
                  </BotonEnlace>
                )}

                {resena !== null && (
                  <BotonEnlace href={`/cuenta/compras/${detalle.id}/calificar`} variante="fantasma">
                    Ver tu calificación
                  </BotonEnlace>
                )}

                {puedeReclamar && (
                  <BotonEnlace
                    href={`/cuenta/compras/${detalle.id}/reclamar`}
                    variante="secundario"
                  >
                    Abrir un reclamo
                  </BotonEnlace>
                )}
              </div>

              {detalle.status === 'COMPLETED' && !puedeCalificar && resena === null && (
                <p className={estilos.nota}>
                  El plazo para calificar esta compra ({cantidad(diasDeResena, 'día', 'días')} desde
                  que se completó) ya pasó.
                </p>
              )}

              {reclamo === null && !puedeReclamar && (
                <p className={estilos.nota}>
                  {/*
                    ⚠️ SE EXPLICA POR QUÉ NO SE PUEDE RECLAMAR, no se esconde el
                    botón y listo. `claimEligibility` distingue cuatro motivos y
                    cada uno se resuelve de una forma distinta: esperar el
                    despacho no es lo mismo que haberse quedado sin ventana.
                  */}
                  {detalle.status === 'PENDING_PAYMENT' || detalle.status === 'CANCELLED'
                    ? 'Los reclamos se abren sobre una compra que ya se pagó.'
                    : !elegible.ok && elegible.motivo === 'despacho_en_plazo'
                      ? /*
                         * ⚠️ MAYÚSCULA INICIAL A MANO: `tienda` es el genérico
                         * "el vendedor" en minúscula cuando no hay nombre, y
                         * arranca la oración. Con el nombre de la tienda ya
                         * viene capitalizado.
                         */
                        `${tienda === 'el vendedor' ? 'El vendedor' : tienda} todavía está dentro del plazo para despachar. Si se vence, vas a poder reclamar desde acá.`
                      : !elegible.ok && elegible.motivo === 'ventana_vencida'
                        ? `El plazo para reclamar (${cantidad(diasDeReclamo, 'día', 'días')}) ya pasó.`
                        : 'Vas a poder abrir un reclamo cuando la compra esté despachada.'}
                </p>
              )}
            </section>

            {reclamo !== null && (
              <section className={`${estilos.bloque} sup-ficha`}>
                <h2 className={estilos.bloqueTitulo}>Tu reclamo</h2>
                <FilaDeDatos concepto="Motivo">{motivoDeReclamo(reclamo.reason)}</FilaDeDatos>
                <FilaDeDatos concepto="Estado">
                  <Etiqueta tono={tonoDeDisputa(reclamo.status)}>
                    {estadoDeDisputa(reclamo.status)}
                  </Etiqueta>
                </FilaDeDatos>
                <FilaDeDatos concepto="Abierto">{fecha(reclamo.openedAt)}</FilaDeDatos>
                <div className={estilos.acciones}>
                  <BotonEnlace
                    href={`/cuenta/reclamos/${reclamo.id}`}
                    variante="secundario"
                    tamanio="medio"
                    flecha
                  >
                    Ver el reclamo
                  </BotonEnlace>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
    </Pantalla>
  );
}
