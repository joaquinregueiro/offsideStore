import { getDatabase, schema, type Database } from '@offside/database';
import { and, asc, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';

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
  /** Referencia para pedir el rotulo o buscar el envio en el proveedor. */
  labelRef?: string | null;
  /** SNAPSHOT del origen (ERD §20.2): el domicilio del vendedor, copiado. */
  origin?: unknown;
  /** SNAPSHOT del destino (ERD §20.2): la direccion de la orden, copiada. */
  destination: unknown;
  /** Peso y medidas declarados al despachar. */
  packageInfo?: unknown;
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
      labelRef: values.labelRef ?? null,
      origin: values.origin ?? null,
      destination: values.destination,
      packageInfo: values.packageInfo ?? null,
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

/**
 * Borra un envio que nunca llego a existir en el proveedor.
 *
 * ⚠️ EL UNICO BORRADO DE ESTA TABLA, y tiene un solo uso: el alta automatica
 * reserva la fila ANTES de llamar al proveedor —el indice unico por orden es lo
 * que impide que dos clics den de alta dos envios reales— y, si el proveedor
 * rechaza el pedido, la reserva se libera para poder reintentar. Un envio que
 * el proveedor si acepto nunca pasa por aca.
 */
export async function deleteReservation(shipmentId: string, db?: Database): Promise<void> {
  await conn(db)
    .delete(schema.shipments)
    .where(and(eq(schema.shipments.id, shipmentId), isNull(schema.shipments.trackingNumber)));
}

export interface ProviderUpdateValues {
  trackingNumber?: string | null;
  labelRef?: string | null;
  status?: ShipmentStatus;
  raw?: Record<string, unknown> | null;
  dispatchedAt?: Date | null;
  deliveredAt?: Date | null;
}

/** Actualiza lo que informo el proveedor. Solo los campos presentes. */
export async function updateFromProvider(
  shipmentId: string,
  values: ProviderUpdateValues,
  db?: Database,
): Promise<ShipmentRow | undefined> {
  const [row] = await conn(db)
    .update(schema.shipments)
    .set(values)
    .where(eq(schema.shipments.id, shipmentId))
    .returning();

  return row;
}

/**
 * Los envios de un proveedor que todavia pueden cambiar, los mas viejos primero.
 *
 * ⚠️ `delivered` Y `returned` QUEDAN AFUERA: ya no se mueven. `delivery_issue`
 * NO, porque "No entregado" puede volver a "Entregado" en otra visita del
 * repartidor —el plugin oficial lo trata igual—.
 */
export async function findForSync(
  provider: string,
  limit: number,
  orderIds?: string[],
  db?: Database,
): Promise<ShipmentRow[]> {
  return conn(db)
    .select()
    .from(schema.shipments)
    .where(
      and(
        eq(schema.shipments.provider, provider),
        notInArray(schema.shipments.status, ['delivered', 'returned']),
        orderIds === undefined ? undefined : inArray(schema.shipments.orderId, orderIds),
      ),
    )
    .orderBy(asc(schema.shipments.createdAt))
    .limit(limit);
}

export async function findByIds(ids: string[], db?: Database): Promise<ShipmentRow[]> {
  if (ids.length === 0) return [];

  return conn(db).select().from(schema.shipments).where(inArray(schema.shipments.id, ids));
}
