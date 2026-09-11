import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AreaDeTexto, Campo, CampoOculto, Formulario, Seleccion } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  Confirmar,
  Cronologia,
  Definiciones,
  Etiqueta,
  FilaDeDatos,
  Migas,
  Panel,
  Seccion,
  type Hito,
} from '@/components/ui';
import {
  estadoDeDisputa,
  estadoDeEnvio,
  estadoDeOrden,
  fechaYHora,
  motivoDeReclamo,
  multiplicador,
  porcentajeDeComision,
  precio,
  tonoDeDisputa,
  tonoDeOrden,
} from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { getDisputeForOrder } from '@/modules/disputes/services/dispute.service';
import { findById, getSaleDetail } from '@/modules/orders/services/order.service';
import { listTiers } from '@/modules/sellers/services/seller-tier.service';
import { getCarriers } from '@/modules/shipments/services/carrier-catalog.service';

import { cancelarVenta, despachar, responderReclamo } from '../../../acciones';
import { Chapa } from '../../../chapa';
import { NavDelVendedor } from '../../../nav';
import estilos from '../../../vendedor.module.css';

export const metadata: Metadata = { title: 'Detalle de la venta' };
export const dynamic = 'force-dynamic';

/**
 * Ficha de una venta (SS-071) y el lugar desde donde se despacha (SS-080).
 *
 * ⚠️ ES EL UNICO LUGAR DONDE EL VENDEDOR VE NOMBRE Y DIRECCION DEL COMPRADOR, y
 * sólo de una orden suya que ya se pagó. La bandeja no los muestra: una lista
 * con las direcciones de todos los compradores es mucho más de lo que hace falta
 * para despachar una. Quien decide eso es el Service —`getSaleDetail` devuelve
 * el comprador vacío mientras la orden esté `PENDING_PAYMENT` o `CANCELLED`—;
 * acá sólo se dibuja.
 *
 * ⚠️ UNA ORDEN AJENA DEVUELVE 404, IGUAL QUE UNA QUE NO EXISTE. Distinguirlas
 * convertiría esta pantalla en un oráculo de qué órdenes hay en el sistema.
 */
export default async function DetalleDeVenta({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const user = await requireSellerSessionUser(`/vendedor/ventas/${orderId}`);

  const venta = await getSaleDetail(user, orderId);
  if (venta === null) notFound();

  /*
   * ⚠️ `findById` NO AUTORIZA Y ACA NO HACE FALTA QUE LO HAGA: se llama DESPUES
   * de que `getSaleDetail` probó que la orden es de este vendedor. Existe porque
   * `PublicOrder` no expone el snapshot que explica la comisión
   * —`commission_source`, la tasa congelada, el multiplicador y el tier—, y sin
   * eso la pantalla podría mostrar cuánto se cobró pero no POR QUÉ. Reconstruirlo
   * desde la configuración de hoy sería exactamente lo que DEC-030 prohíbe.
   */
  const [fila, reclamo, transportistas, niveles] = await Promise.all([
    findById(orderId),
    getDisputeForOrder(user, orderId),
    getCarriers(),
    listTiers(),
  ]);

  const comision = origenDeLaComision(fila, niveles);
  const direccion = camposDeDireccion(venta.buyer.shippingAddress);

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Migas
          items={[
            { texto: 'Panel', href: '/vendedor' },
            { texto: 'Ventas', href: '/vendedor/ventas' },
            { texto: venta.orderNumber },
          ]}
        />

        <Chapa
          rotulo="Venta"
          titulo={venta.items[0]?.title ?? venta.orderNumber}
          chica
          detalle={
            <p className={estilos.chapaDetalle}>
              Orden {venta.orderNumber} · {fechaYHora(venta.createdAt)}
            </p>
          }
          estado={{ texto: estadoDeOrden(venta.status), tono: tonoDeOrden(venta.status) }}
        />

        <NavDelVendedor activo="ventas" />

        {/*
          ⚠️ EL PLAZO VENCIDO ES LO PRIMERO QUE SE LEE. Es lo único de esta
          pantalla que tiene consecuencia sobre la reputación del vendedor
          (BR-032), y no se anima más allá de la entrada seca que traen los
          avisos: el estado de una orden no late.
        */}
        {venta.windows.dispatchOverdue && (
          <Aviso tono="error">
            <strong>El plazo para despachar ya venció.</strong> Vencía el{' '}
            {venta.windows.dispatchDeadline === null
              ? 'plazo acordado'
              : fechaYHora(venta.windows.dispatchDeadline)}
            . Despachala cuanto antes: los despachos fuera de plazo cuentan en tu reputación.
          </Aviso>
        )}

        {reclamo !== null && (
          <>
            <Aviso tono={reclamo.abierta ? 'error' : 'neutro'}>
              <strong>Esta venta tiene un reclamo: {motivoDeReclamo(reclamo.reason)}.</strong>{' '}
              <Etiqueta tono={tonoDeDisputa(reclamo.status)}>
                {estadoDeDisputa(reclamo.status)}
              </Etiqueta>{' '}
              {reclamo.sellerResponseDueAt !== null && reclamo.sellerRespondedAt === null && (
                <>Tenés tiempo de responder hasta el {fechaYHora(reclamo.sellerResponseDueAt)}. </>
              )}
              <Link href={`/cuenta/reclamos/${reclamo.id}`}>Ver el reclamo completo</Link>
            </Aviso>

            {/*
              ⚠️ RESPONDER SE OFRECE ACA Y NO SOLO EN LA FICHA DEL RECLAMO. El
              vendedor entra por la venta, no por el reclamo, y el plazo corre:
              pasado `dispute_seller_response_days` el caso escala a revisión de
              Offside con lo que haya. Mandarlo a buscar otra pantalla es la
              forma más segura de que el plazo se venza.
            */}
            {reclamo.abierta && reclamo.sellerRespondedAt === null && (
              <Seccion titulo="Tu versión">
                <div className={estilos.tarjeta}>
                  <p className={estilos.bajada}>
                    Contá qué pasó de tu lado. Lo lee quien resuelve el reclamo, junto con lo que
                    dijo el comprador.
                  </p>
                  <Formulario accion={responderReclamo} enviar="Enviar mi respuesta">
                    <CampoOculto nombre="disputeId" valor={reclamo.id} />
                    <AreaDeTexto
                      nombre="texto"
                      etiqueta="Qué pasó"
                      requerido
                      filas={5}
                      maximo={2000}
                      ayuda="Datos concretos: cuándo lo despachaste, con qué número, qué acordaron."
                    />
                  </Formulario>
                </div>
              </Seccion>
            )}
          </>
        )}

        <Seccion titulo="Qué se vendió">
          <ul className={estilos.itemsVenta}>
            {venta.items.map((item) => (
              <li key={item.id} className={estilos.itemVenta}>
                <div>
                  {/*
                    ⚠️ EL TITULO ES EL CONGELADO EN LA ORDEN (DEC-030) y el enlace
                    va a la publicación de hoy: son dos datos distintos y el que
                    manda es el snapshot. Si el vendedor le cambió el nombre o la
                    eliminó, la orden sigue diciendo qué se compró.
                  */}
                  <p className={estilos.itemTitulo}>
                    <Link href={`/p/${item.listingId}`} className="subraya">
                      {item.title}
                    </Link>
                  </p>
                  <p className={estilos.itemMeta}>
                    {item.quantity === 1 ? '1 unidad' : `${item.quantity} unidades`} ·{' '}
                    {precio(item.unitPriceAmount, venta.currency)} c/u
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Seccion>

        <Seccion titulo="Lo que cobrás">
          <div className={estilos.tarjeta}>
            <FilaDeDatos concepto="Producto">
              {precio(venta.productAmount, venta.currency)}
            </FilaDeDatos>
            <FilaDeDatos concepto="Envío declarado">
              {precio(venta.shippingAmount, venta.currency)}
            </FilaDeDatos>
            <FilaDeDatos concepto="Total que pagó el comprador">
              {precio(venta.totalAmount, venta.currency)}
            </FilaDeDatos>
            <FilaDeDatos concepto={`Comisión de Offside${comision.sufijo}`}>
              −{precio(venta.commissionAmount, venta.currency)}
            </FilaDeDatos>
            <FilaDeDatos concepto="Te queda, antes del costo de Mercado Pago" destacada>
              {precio(venta.sellerAmount, venta.currency)}
            </FilaDeDatos>
          </div>

          {/*
            ⚠️ DE DONDE SALIO LA COMISION SE DICE CON TODAS LAS LETRAS. El
            snapshot guarda `commission_source` justamente para que dentro de seis
            meses se pueda explicar por qué esta orden pagó el triple que la de al
            lado, y esconderlo obligaría al vendedor a deducirlo dividiendo.
          */}
          <p className={estilos.nota}>{comision.explicacion}</p>

          {/*
            ⚠️ "TE QUEDA" ES ANTES DEL COSTO DE MERCADO PAGO (DEC-043). MP
            descuenta su procesamiento del lado del vendedor y Offside no lo
            conoce al crear la orden: prometer un neto exacto sería mentir.
          */}
          <p className={estilos.nota}>
            Mercado Pago cobra además su propio costo de procesamiento, que se descuenta de tu parte
            al acreditarse el pago. Offside no lo conoce y por eso no lo puede mostrar acá.
          </p>
        </Seccion>

        {direccion.length > 0 ? (
          <Seccion titulo="A dónde lo mandás">
            <div className={estilos.tarjeta}>
              <Definiciones
                columnas={2}
                items={[
                  {
                    termino: 'Comprador',
                    valor: venta.buyer.displayName ?? 'Sin nombre cargado',
                  },
                  ...direccion,
                ]}
              />
            </div>
            {/*
              ⚠️ ES UN DATO PERSONAL DE OTRA PERSONA, y decirlo no es
              burocracia: quien despacha tiene que saber que esto no se comparte
              ni se usa para nada más.
            */}
            <p className={estilos.nota}>
              Estos datos son del comprador y están acá sólo para que puedas despachar.
            </p>
          </Seccion>
        ) : (
          <Seccion titulo="A dónde lo mandás">
            <p className={estilos.nota}>
              Los datos del comprador aparecen cuando la orden está paga. Todavía no hay nada que
              despachar.
            </p>
          </Seccion>
        )}

        {venta.shipment !== null && (
          <Seccion titulo="El envío">
            <div className={estilos.tarjeta}>
              <FilaDeDatos concepto="Estado">{estadoDeEnvio(venta.shipment.status)}</FilaDeDatos>
              <FilaDeDatos concepto="Transportista">
                {venta.shipment.carrierName ?? venta.shipment.carrierCode ?? 'Sin declarar'}
              </FilaDeDatos>
              <FilaDeDatos concepto="Seguimiento">
                {venta.shipment.trackingUrl === null ? (
                  (venta.shipment.trackingNumber ?? 'Sin número')
                ) : (
                  <a href={venta.shipment.trackingUrl} rel="noreferrer" target="_blank">
                    {venta.shipment.trackingNumber}
                  </a>
                )}
              </FilaDeDatos>
              {venta.shipment.dispatchedAt !== null && (
                <FilaDeDatos concepto="Despachado">
                  {fechaYHora(venta.shipment.dispatchedAt)}
                </FilaDeDatos>
              )}
            </div>
            {/*
              ⚠️ OFFSIDE NO HACE SEGUIMIENTO AUTOMATICO. No hay integración con
              Correo Argentino: lo que se ve acá es lo que el vendedor declaró.
              Prometer tracking en vivo sería prometer algo que no existe.
            */}
            <p className={estilos.nota}>
              El seguimiento lo actualiza el transportista en su propio sitio. Offside no lo
              consulta solo.
            </p>
          </Seccion>
        )}

        <Seccion titulo="Cómo viene">
          <Cronologia etiqueta="Estados de la orden" hitos={hitosDeLaVenta(venta)} />
        </Seccion>

        {(venta.actions.canShip || venta.actions.canCancel) && (
          <Seccion titulo="Qué podés hacer">
            <div className={estilos.accionesVenta}>
              {venta.actions.canShip && (
                <div className={estilos.tarjeta}>
                  <p className={estilos.bajada}>
                    Marcala como despachada cuando la lleves. Transportista y número de seguimiento
                    son obligatorios: sin ellos el comprador no puede saber dónde está su paquete.
                  </p>
                  <Formulario accion={despachar} enviar="Marcar como despachada">
                    <CampoOculto nombre="orderId" valor={venta.id} />
                    {/*
                      ⚠️ LA LISTA SALE DE `shipping_carriers` (⚙️ Config Store),
                      no de una constante en esta pantalla: agregar un
                      transportista no puede exigir un redeploy.
                    */}
                    <Seleccion
                      nombre="carrier"
                      etiqueta="Transportista"
                      opciones={transportistas.map((c) => ({ valor: c.code, etiqueta: c.name }))}
                    />
                    <Campo
                      nombre="trackingNumber"
                      etiqueta="Número de seguimiento"
                      ayuda="Tal cual te lo dio el transportista. Se lo mostramos al comprador."
                    />
                  </Formulario>
                </div>
              )}

              {venta.actions.canCancel && (
                <div className={estilos.tarjeta}>
                  <p className={estilos.bajada}>
                    Cancelar devuelve el stock y deja la orden cerrada. El comprador ya pagó: el
                    reembolso lo gestiona Offside y la cancelación queda en tu historial.
                  </p>
                  {/*
                    ⚠️ VA EN DOS PASOS Y CON `<details>`, no con `window.confirm`
                    —que directamente no existe sin JavaScript—. El primer clic
                    abre; el que ejecuta vive adentro.
                  */}
                  <Confirmar
                    etiqueta="Cancelar la venta"
                    pregunta="Le cancelás la compra a alguien que ya pagó. No se puede deshacer."
                  >
                    <Formulario
                      accion={cancelarVenta}
                      enviar="Sí, cancelar la venta"
                      variante="peligro"
                    >
                      <CampoOculto nombre="orderId" valor={venta.id} />
                      <AreaDeTexto
                        nombre="motivo"
                        etiqueta="Por qué la cancelás"
                        requerido
                        filas={3}
                        maximo={500}
                        ayuda="Lo lee el comprador y queda en el historial de la orden."
                      />
                    </Formulario>
                  </Confirmar>
                </div>
              )}
            </div>
          </Seccion>
        )}

        {!venta.actions.canShip && !venta.actions.canCancel && venta.status !== 'CANCELLED' && (
          <Panel titulo="No hay nada pendiente de tu lado" tono="exito">
            <p>
              Esta orden ya siguió su curso. Si el comprador abre un reclamo, lo vas a ver acá y en
              tu bandeja.
            </p>
          </Panel>
        )}
      </main>
    </Pantalla>
  );
}

/* -------------------------------------------------------------------------- */

/** Las claves de dirección que escribe hoy la pantalla de compra. */
const CLAVES_DE_DIRECCION: readonly { clave: string; termino: string }[] = [
  { clave: 'nombre', termino: 'A nombre de' },
  { clave: 'calle', termino: 'Calle y número' },
  { clave: 'ciudad', termino: 'Localidad' },
  { clave: 'provincia', termino: 'Provincia' },
  { clave: 'codigoPostal', termino: 'Código postal' },
  { clave: 'telefono', termino: 'Teléfono' },
];

/**
 * La dirección de envío, que en la orden es un snapshot JSON y no una FK.
 *
 * ⚠️ SE LEE POR CLAVES CONOCIDAS Y NO SE ITERA EL OBJETO. `orders.shipping_address`
 * es `jsonb` libre —la libreta de direcciones del ERD §6.1 todavía no gobierna
 * este flujo—, así que volcar lo que venga imprimiría en pantalla cualquier cosa
 * que alguien haya guardado ahí, con el nombre técnico de la clave como etiqueta.
 */
function camposDeDireccion(
  direccion: Record<string, unknown>,
): { termino: string; valor: string }[] {
  return CLAVES_DE_DIRECCION.flatMap(({ clave, termino }) => {
    const valor = direccion[clave];
    if (typeof valor !== 'string' || valor.trim() === '') return [];

    return [{ termino, valor }];
  });
}

/** Quién produjo una transición, en palabras. */
function actorLegible(actorType: string, nombre: string | null): string {
  if (actorType === 'seller') return 'vos';
  if (actorType === 'user') return nombre ?? 'el comprador';
  if (actorType === 'admin') return 'Offside';

  return 'el sistema';
}

/** Los estados que todavía faltan, según dónde esté la orden. */
const PENDIENTES: Record<string, readonly string[]> = {
  PENDING_PAYMENT: ['PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED'],
  PAID: ['SHIPPED', 'DELIVERED', 'COMPLETED'],
  PROCESSING: ['SHIPPED', 'DELIVERED', 'COMPLETED'],
  SHIPPED: ['DELIVERED', 'COMPLETED'],
  DELIVERED: ['COMPLETED'],
};

/**
 * La línea de tiempo de la venta.
 *
 * ⚠️ EL PRIMER HITO ES SINTETICO. La creación de la orden no es una transición y
 * por eso no está en `order_status_history`: sin él, la cronología de una orden
 * recién creada estaría vacía y no se entendería desde cuándo corre nada.
 *
 * ⚠️ UNA CANCELACION CORTA LA LINEA. No se dibujan los estados siguientes
 * apagados: prometerían un recorrido que ya no existe.
 */
function hitosDeLaVenta(venta: {
  status: string;
  createdAt: string;
  timeline: readonly {
    toStatus: string;
    actorType: string;
    actorDisplayName: string | null;
    note: string | null;
    createdAt: string;
  }[];
}): Hito[] {
  const hechos: Hito[] = [
    {
      clave: 'creada',
      titulo: 'Orden creada',
      estado: 'hecho',
      fecha: fechaYHora(venta.createdAt),
    },
    ...venta.timeline.map((entrada, indice) => ({
      clave: `t-${indice}`,
      titulo: estadoDeOrden(entrada.toStatus),
      estado: entrada.toStatus === 'CANCELLED' ? ('cancelado' as const) : ('hecho' as const),
      fecha: fechaYHora(entrada.createdAt),
      actor: actorLegible(entrada.actorType, entrada.actorDisplayName),
      ...(entrada.note === null ? {} : { nota: entrada.note }),
    })),
  ];

  const ultimo = hechos[hechos.length - 1];
  if (ultimo?.estado === 'hecho' && venta.status !== 'COMPLETED') {
    ultimo.estado = 'actual';
  }

  const futuros = (PENDIENTES[venta.status] ?? []).map((estado) => ({
    clave: `f-${estado}`,
    titulo: estadoDeOrden(estado),
    estado: 'futuro' as const,
  }));

  return [...hechos, ...futuros];
}

/**
 * De dónde salió la comisión que se congeló en esta orden.
 *
 * ⚠️ SALE DEL SNAPSHOT DE LA ORDEN Y NUNCA DE LA CONFIGURACION DE HOY (DEC-030).
 * `commission_source` dice si fue la tasa general, la del nivel del vendedor o
 * la de una publicación promocionada; `commission_rate_at_transaction` dice
 * cuánto fue, y `promotion_multiplier_at_transaction` por cuánto se multiplicó.
 * Recalcularlo con la configuración actual daría un número distinto en cuanto
 * alguien cambie la comisión desde Admin.
 *
 * ⚠️ NINGUNA CIFRA ESTA ESCRITA ACA: las dos salen de la fila y se formatean con
 * `porcentajeDeComision` y `multiplicador`.
 */
function origenDeLaComision(
  fila:
    | {
        commissionSource: string;
        commissionRateAtTransaction: string | null;
        promotionMultiplierAtTransaction: string | null;
        sellerTierCodeAtTransaction: string | null;
      }
    | undefined,
  niveles: readonly { code: string; name: string }[],
): { sufijo: string; explicacion: string } {
  if (fila?.commissionRateAtTransaction == null) {
    return {
      sufijo: '',
      explicacion:
        'La comisión quedó congelada al crearse la orden: cambiarla después no toca esta venta.',
    };
  }

  // `numeric(6,4)` llega como string: `'0.0600'` son 600 basis points.
  const basisPoints = Math.round(Number(fila.commissionRateAtTransaction) * 10_000);
  const tasa = porcentajeDeComision(basisPoints);

  if (fila.commissionSource === 'promoted') {
    const factor =
      fila.promotionMultiplierAtTransaction === null
        ? null
        : multiplicador(Number(fila.promotionMultiplierAtTransaction));

    return {
      sufijo: ` (${tasa})`,
      explicacion: `Se aplicó ${tasa} porque la publicación estaba promocionada${
        factor === null ? '' : `: la promoción multiplica tu comisión ${factor}`
      }. Es lo que se congeló al crearse la orden y no cambia después.`,
    };
  }

  if (fila.commissionSource === 'seller_tier') {
    const nivel = niveles.find((n) => n.code === fila.sellerTierCodeAtTransaction);

    return {
      sufijo: ` (${tasa})`,
      explicacion: `Se aplicó ${tasa}, la tasa de tu nivel ${
        nivel?.name ?? fila.sellerTierCodeAtTransaction ?? 'de vendedor'
      } al momento de la venta. Quedó congelada: subir de nivel no cambia las ventas ya hechas.`,
    };
  }

  return {
    sufijo: ` (${tasa})`,
    explicacion: `Se aplicó ${tasa}, la comisión general de Offside al momento de la venta. Quedó congelada al crearse la orden.`,
  };
}
