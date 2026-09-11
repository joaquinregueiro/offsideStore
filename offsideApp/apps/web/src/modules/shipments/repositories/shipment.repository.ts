import { getDatabase, schema, type Database } from '@offside/database';
import { and, desc, eq, isNull } from 'drizzle-orm';

/**
 * Acceso a `shipments` y `shipment_tracking_events` (ERD §13). Sin reglas de
 * negocio.
 *
 * ⚠️ NO HABLA CON NINGUN PROVEEDOR. El puerto `ShippingPort` y su adaptador
 * simulado viven en `infrastructure/shipping/` y este repository no los
 * conoce: aca solo se persiste lo que el Service decidio.
 */

export type ShipmentRow = typeof schema.shipments.$inferSelect;
export type ShipmentTrackingEventRow = typeof schema.shipmentTrackingEvents.$inferSelect;
export type ShipmentStatus = ShipmentRow['status'];

const conn = (db?: Database): Database => db ?? getDatabase();

export async function findByOrderId(
  orderId: string,
  db?: Database,
): Promise<ShipmentRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.shipments)
    .where(eq(schema.shipments.orderId, orderId))
    .limit(1);

  return row;
}

export interface InsertShipmentValues {
  orderId: string;
  provider: string;
  status: ShipmentStatus;
  trackingNumber: string | null;
  /** SNAPSHOT del destino (ERD §20.2): la direccion de la orden, copiada. */
  destination: unknown;
  currency: string;
  /** Lo que el vendedor declaro, tal cual (transportista, etc.). */
  raw: Record<string, unknown> | null;
  dispatchedAt: Date | null;
}

export async function insert(values: InsertShipmentValues, db?: Database): Promise<ShipmentRow> {
  const [row] = await conn(db)
    .insert(schema.shipments)
    .values({
      orderId: values.orderId,
      provider: values.provider,
      status: values.status,
      trackingNumber: values.trackingNumber,
      destination: values.destination,
      currency: values.currency,
      raw: values.raw,
      dispatchedAt: values.dispatchedAt,
    })
    .returning();

  return row!;
}

/**
 * Marca el envio como entregado. CONDICIONAL: solo si todavia no lo estaba,
 * asi que repetirlo no mueve `delivered_at`.
 */
export async function markDelivered(
  shipmentId: string,
  deliveredAt: Date,
  db?: Database,
): Promise<ShipmentRow | undefined> {
  const [row] = await conn(db)
    .update(schema.shipments)
    .set({ status: 'delivered', deliveredAt })
    .where(and(eq(schema.shipments.id, shipmentId), isNull(schema.shipments.deliveredAt)))
    .returning();

  return row;
}

export interface InsertTrackingEventValues {
  shipmentId: string;
  status: ShipmentStatus;
  providerStatus: string | null;
  description: string | null;
  occurredAt: Date;
  raw: Record<string, unknown> | null;
}

/** Agrega un evento al historial de tracking (ERD §13.2). Append-only. */
export async function appendTrackingEvent(
  values: InsertTrackingEventValues,
  db?: Database,
): Promise<void> {
  await conn(db).insert(schema.shipmentTrackingEvents).values({
    shipmentId: values.shipmentId,
    status: values.status,
    providerStatus: values.providerStatus,
    description: values.description,
    occurredAt: values.occurredAt,
    raw: values.raw,
  });
}

export async function findTrackingEvents(
  shipmentId: string,
  db?: Database,
): Promise<ShipmentTrackingEventRow[]> {
  return conn(db)
    .select()
    .from(schema.shipmentTrackingEvents)
    .where(eq(schema.shipmentTrackingEvents.shipmentId, shipmentId))
    .orderBy(schema.shipmentTrackingEvents.occurredAt, schema.shipmentTrackingEvents.id);
}

/**
 * Valor vigente de una clave GLOBAL de `app_settings`.
 *
 * ⚠️ DUPLICA LA LECTURA DEL CONFIG STORE, igual que `orders` y por el mismo
 * motivo: el Service de `config` solo expone la comision, y un modulo no
 * importa el repository de otro. Cuando `config` exponga
 * `getJsonSetting(key)`, esto se borra. `undefined` = la clave no esta cargada.
 */
export async function findGlobalSettingValue(key: string, db?: Database): Promise<unknown> {
  const [row] = await conn(db)
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(
      and(
        eq(schema.appSettings.scope, 'global'),
        isNull(schema.appSettings.scopeId),
        eq(schema.appSettings.key, key),
      ),
    )
    .orderBy(desc(schema.appSettings.version))
    .limit(1);

  return row?.value;
}
