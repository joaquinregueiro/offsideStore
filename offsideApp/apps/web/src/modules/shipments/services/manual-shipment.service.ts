import type { Database } from '@offside/database';

import * as shipmentRepo from '../repositories/shipment.repository';
import * as errors from '../shipments.errors';
import { getCarriers, trackingUrlFor, type Carrier } from './carrier-catalog.service';

/**
 * Despacho MANUAL: el vendedor despacha por su cuenta y declara transportista
 * y numero de seguimiento (SH-010 / MF-031 sin Correo Argentino).
 *
 * ⚠️ NO USA `ShippingPort` NI EL ADAPTADOR SIMULADO, a proposito. Correo
 * Argentino no existe todavia (`infrastructure/shipping/index.ts` explica por
 * que el simulado esta prohibido en produccion) y un despacho declarado por
 * una persona NO es un envio "creado" contra un proveedor: no hay cotizacion,
 * ni rotulo, ni tracking que consultar. `provider = 'manual'` deja escrito que
 * los datos los puso el vendedor, y eso es lo que una disputa de "producto no
 * recibido" (SH-002) tiene que saber al leer la evidencia.
 *
 * El dia que exista el adaptador real, el despacho por Correo convive con este:
 * son dos `provider` distintos sobre la misma tabla.
 */

export const MANUAL_PROVIDER = 'manual';

const TRACKING_MIN = 4;
const TRACKING_MAX = 64;

/**
 * Numero de seguimiento normalizado, o `VALIDATION_FAILED`.
 *
 * Solo largo y ausencia de caracteres de control: cada correo tiene su propio
 * formato y validar uno inventado rechazaria numeros reales.
 */
export function normalizeTrackingNumber(raw: string): string {
  const numero = raw.trim();

  if (
    numero.length < TRACKING_MIN ||
    numero.length > TRACKING_MAX ||
    // eslint-disable-next-line no-control-regex -- justamente se buscan controles
    /[\x00-\x1f\x7f]/.test(numero)
  ) {
    throw errors.trackingNumberInvalid();
  }

  return numero;
}

export interface RegisterManualDispatchInput {
  orderId: string;
  carrier: Carrier;
  trackingNumber: string;
  /** Snapshot del destino: la direccion de la orden, copiada (ERD §20.2). */
  destination: unknown;
  currency: string;
  dispatchedAt: Date;
}

/**
 * Registra el envio despachado y su primer evento de tracking.
 *
 * Corre en la transaccion que le pasan: `orders` mueve la orden a `SHIPPED`
 * en el mismo commit, y un envio sin orden despachada —o al reves— no puede
 * quedar escrito. `raw` guarda lo que el vendedor declaro tal cual, que es lo
 * que SH-002 va a leer como evidencia.
 */
export async function registerManualDispatch(
  input: RegisterManualDispatchInput,
  db?: Database,
): Promise<shipmentRepo.ShipmentRow> {
  const trackingNumber = normalizeTrackingNumber(input.trackingNumber);

  if ((await shipmentRepo.findByOrderId(input.orderId, db)) !== undefined) {
    throw errors.shipmentAlreadyExists();
  }

  const shipment = await shipmentRepo.insert(
    {
      orderId: input.orderId,
      provider: MANUAL_PROVIDER,
      status: 'dispatched',
      trackingNumber,
      destination: input.destination,
      currency: input.currency,
      raw: {
        carrier: input.carrier.code,
        carrierName: input.carrier.name,
        declaredBy: 'seller',
      },
      dispatchedAt: input.dispatchedAt,
    },
    db,
  );

  await shipmentRepo.appendTrackingEvent(
    {
      shipmentId: shipment.id,
      status: 'dispatched',
      providerStatus: null,
      description: `Despachado por ${input.carrier.name}`,
      occurredAt: input.dispatchedAt,
      raw: null,
    },
    db,
  );

  return shipment;
}

/**
 * Marca el envio de la orden como entregado. Idempotente: si ya lo estaba no
 * mueve `delivered_at` ni agrega un segundo evento. Devuelve `undefined` si
 * la orden no tiene envio (no deberia: `DELIVERED` exige `SHIPPED`).
 */
export async function markShipmentDelivered(
  orderId: string,
  deliveredAt: Date,
  db?: Database,
): Promise<shipmentRepo.ShipmentRow | undefined> {
  const shipment = await shipmentRepo.findByOrderId(orderId, db);
  if (shipment === undefined) return undefined;

  const actualizado = await shipmentRepo.markDelivered(shipment.id, deliveredAt, db);
  if (actualizado === undefined) return shipment;

  await shipmentRepo.appendTrackingEvent(
    {
      shipmentId: shipment.id,
      status: 'delivered',
      providerStatus: null,
      description: 'Entrega confirmada por el comprador',
      occurredAt: deliveredAt,
      raw: null,
    },
    db,
  );

  return actualizado;
}

/** Un evento del historico de tracking, tal como lo ven las pantallas (SH-012). */
export interface PublicTrackingEvent {
  status: shipmentRepo.ShipmentStatus;
  description: string | null;
  occurredAt: string | null;
}

/** El envio de una orden, abstraido del proveedor (SH-012). */
export interface PublicShipment {
  id: string;
  provider: string | null;
  status: shipmentRepo.ShipmentStatus;
  /** Codigo del transportista declarado (`shipping_carriers`), si es manual. */
  carrierCode: string | null;
  /** Nombre visible del transportista, o el codigo si ya no esta en la lista. */
  carrierName: string | null;
  trackingNumber: string | null;
  /** Enlace publico de seguimiento, si el transportista tiene template. */
  trackingUrl: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  events: PublicTrackingEvent[];
}

/**
 * El envio de una orden con su historico, o `null` si no fue despachada.
 *
 * ⚠️ NO AUTORIZA: quien llama ya verifico que la orden es suya. Existe para
 * que `orders` no lea `shipments` por su cuenta (`modules/README.md`).
 */
export async function getShipmentForOrder(orderId: string): Promise<PublicShipment | null> {
  const shipment = await shipmentRepo.findByOrderId(orderId);
  if (shipment === undefined) return null;

  const events = await shipmentRepo.findTrackingEvents(shipment.id);
  const raw = (shipment.raw ?? {}) as { carrier?: unknown; carrierName?: unknown };
  const carrierCode = typeof raw.carrier === 'string' ? raw.carrier : null;

  // El nombre se resuelve contra la lista VIGENTE: si el administrador corrigio
  // "Correo Arg." por "Correo Argentino", las ordenes viejas lo muestran bien.
  // Si el codigo ya no esta en la lista, se cae al nombre guardado al despachar.
  const carrier =
    carrierCode === null ? undefined : (await getCarriers()).find((c) => c.code === carrierCode);
  const carrierName =
    carrier?.name ?? (typeof raw.carrierName === 'string' ? raw.carrierName : carrierCode);

  return {
    id: shipment.id,
    provider: shipment.provider,
    status: shipment.status,
    carrierCode,
    carrierName,
    trackingNumber: shipment.trackingNumber,
    trackingUrl:
      carrier !== undefined && shipment.trackingNumber !== null
        ? trackingUrlFor(carrier, shipment.trackingNumber)
        : null,
    dispatchedAt: shipment.dispatchedAt?.toISOString() ?? null,
    deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
    events: events.map((e) => ({
      status: e.status,
      description: e.description,
      occurredAt: e.occurredAt?.toISOString() ?? null,
    })),
  };
}
