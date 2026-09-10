/**
 * Puerto de envios.
 *
 * El dominio conoce ESTA interfaz y nada mas. Correo Argentino vive detras de
 * ella (CLAUDE.md §11), igual que Mercado Pago, SES y R2. Lo pide ademas
 * `shipping.md` §3.2 con nombre propio: "todas las integraciones externas de
 * logistica se ocultan detras de una interfaz interna `ShippingService` con
 * operaciones agnosticas del proveedor".
 *
 * =============================================================================
 * ⚠️ ESTE PUERTO SE DISEÑO CONTRA EL CONTRATO REAL, NO CONTRA LA IMAGINACION
 * =============================================================================
 *
 * El relevamiento de los dos manuales oficiales esta en
 * `docs-implementation/correo-argentino-spec.md`. Tres cosas de ahi cambian la
 * forma de esta interfaz, y ninguna se habria adivinado:
 *
 *  1. **NO HAY WEBHOOKS.** `shipping.md` §3.2 lista `handleWebhook(evento)`
 *     como operacion esperada y marca 🌐 VERIFY al lado. Verificado: no
 *     existen. El seguimiento es POLLING. Por eso esa operacion **no esta** en
 *     este puerto: modelar una capacidad que el proveedor no tiene obliga a
 *     todos los adaptadores a fingirla.
 *  2. **El tracking se consulta POR LOTE.** `GET /v1/tracking` acepta N numeros
 *     por llamada. Si `getTracking` recibiera uno solo, un barrido de 500
 *     envios serian 500 requests en vez de unas pocas.
 *  3. **Cotizar devuelve VARIAS tarifas y VENCEN.** No es un numero: es una
 *     lista por modalidad y producto, con fecha de expiracion.
 */

/**
 * Modalidad de entrega, en vocabulario NUESTRO.
 *
 * ⚠️ CADA API DEL PROVEEDOR LA LLAMA DISTINTO, y esa es media razon de ser del
 * puerto: MiCorreo usa `deliveredType: "D" | "S"` para cotizar y
 * `deliveryType: "D" | "S"` para importar —el mismo concepto con dos nombres
 * dentro de la misma API—, y PAQ.AR usa `deliveryType: homeDelivery | agency |
 * locker`. Traducir es trabajo del adaptador.
 *
 * ⚠️ NO SE INCLUYE `locker` aunque PAQ.AR lo soporte. **SH-015 sigue 🔴**: que
 * modalidades ofrece el MVP no esta decidido, y la documentacion de producto
 * solo nombra domicilio y sucursal. Agregar una tercera seria decidir alcance
 * desde el codigo.
 */
export type DeliveryMode = 'home' | 'agency';

/**
 * Estado normalizado de un envio (`shipping.md` §5).
 *
 * Es el MISMO conjunto que el enum `shipment_status` del ERD §13.1, y tiene que
 * seguir siendolo: si divergieran, guardar un estado seria imposible.
 *
 * ⚠️ EL MAPEO DESDE LOS ESTADOS DEL PROVEEDOR NO SE PUEDE ESCRIBIR TODAVIA.
 * SH-003 lo deja explicito ("se define al conocer su API real") y el manual de
 * PAQ.AR **nunca enumera los `statusId`**: en 37 paginas solo aparecen `PRE`,
 * `CAN` y `CAU`, y **no hay ningun codigo documentado para "entregado"** — justo
 * el que mueve la orden a `DELIVERED` y el que SH-002 necesita como evidencia
 * en disputas. Se descubre contra el ambiente de test; hasta entonces el unico
 * adaptador honesto es el falso.
 */
export type ShipmentStatus =
  'created' | 'dispatched' | 'in_transit' | 'delivered' | 'delivery_issue' | 'returned';

/** Una direccion, en la forma minima que necesita cotizar y despachar. */
export interface ShippingAddress {
  streetName: string;
  streetNumber: string;
  floor?: string;
  apartment?: string;
  city: string;
  /** Codigo de provincia de Correo Argentino (`B`, `C`, `X`, …). */
  provinceCode: string;
  postalCode: string;
}

/**
 * El paquete a despachar.
 *
 * =============================================================================
 * ⚠️ HOY NO HAY DE DONDE SACAR ESTOS DATOS
 * =============================================================================
 *
 * `listings` **no tiene peso ni dimensiones**, y el ERD no los modela en ningun
 * lado: `shipments.package_info` existe pero es del envio, o sea despues de la
 * venta. Sin peso no se puede cotizar, y `SH-011`/`BS-070` piden el costo **en
 * el checkout**.
 *
 * Las salidas posibles son tres y **ninguna se decide desde el codigo**:
 *  - pedirselos al vendedor al publicar → columnas nuevas en `listings`, o sea
 *    un cambio ARQUITECTONICO (CLAUDE.md §5);
 *  - un paquete por defecto por categoria, ⚙️ configurable (§12) — una camiseta
 *    tiene un peso bastante predecible, pero el VALOR es de negocio;
 *  - no cotizar y cobrar una tarifa plana, que es el modelo de costos 🟡 de
 *    `shipping.md` §5.b.
 *
 * El puerto los recibe explicitamente **a proposito**: sea cual sea la salida,
 * quien llama tiene que haberlos resuelto antes. Que la interfaz los exija hace
 * visible el hueco en vez de esconderlo detras de un valor inventado.
 */
export interface PackageInfo {
  /** Gramos. El proveedor topea en 25.000 (25 kg). */
  weightGrams: number;
  /** Centimetros. */
  heightCm: number;
  widthCm: number;
  lengthCm: number;
}

export interface QuoteInput {
  originPostalCode: string;
  destinationPostalCode: string;
  package: PackageInfo;
  /** Si se omite, se piden todas las modalidades disponibles. */
  mode?: DeliveryMode;
}

/** Una tarifa concreta ofrecida por el proveedor. */
export interface ShippingRate {
  mode: DeliveryMode;
  /** Codigo del producto del proveedor (`CP`, …). Crudo a proposito. */
  productCode: string;
  /** Nombre legible del producto ("Paq.ar Clásico"). */
  productName: string;
  /**
   * Costo en CENTAVOS.
   *
   * ⚠️ El proveedor devuelve decimal (`498.06`) y el ERD exige `bigint` en
   * centavos (§1). La conversion es responsabilidad del ADAPTADOR: si el float
   * cruzara esta frontera, el redondeo terminaria ocurriendo en cualquier lado.
   */
  priceAmount: bigint;
  currency: string;
  /**
   * Hasta cuando vale la cotizacion.
   *
   * ⚠️ LAS COTIZACIONES VENCEN (`validTo` en la respuesta real). Importa por
   * DEC-030: la orden congela su `shipping_amount` al crearse, y que hacer si
   * el checkout se completa despues de esta fecha es una decision de negocio
   * que todavia nadie tomo. El puerto la EXPONE para que se pueda tomar; no la
   * resuelve.
   */
  validUntil: Date;
}

export interface CreateShipmentInput {
  /** Id de la orden de Offside. Viaja al proveedor como referencia externa. */
  orderId: string;
  mode: DeliveryMode;
  /**
   * Codigo de sucursal de destino. Obligatorio si `mode === 'agency'`; el
   * proveedor rechaza el alta sin el.
   */
  agencyCode?: string;
  origin: ShippingAddress;
  destination: ShippingAddress;
  recipientName: string;
  recipientEmail: string;
  recipientPhone?: string;
  package: PackageInfo;
  /** Valor declarado en CENTAVOS. El adaptador convierte. */
  declaredValueAmount: bigint;
  currency: string;
}

export interface CreatedShipment {
  /**
   * ⚠️ PUEDE SER `null`, Y NO ES UN DESCUIDO. `POST /shipping/import` de
   * MiCorreo responde solo `{ "createdAt": … }`: **no devuelve numero de
   * seguimiento**. PAQ.AR si lo devuelve. Como el puerto tiene que servir a los
   * dos, el tipo lo admite y quien llama decide que hacer —tipicamente,
   * quedarse sin poder trackear hasta obtenerlo por otra via—.
   */
  trackingNumber: string | null;
  /** Referencia opaca para pedir el rotulo despues. */
  labelRef: string | null;
  /** Lo que dijo el proveedor, crudo. Mismo criterio que DEC-035 con MP. */
  raw: unknown;
}

export interface ShippingLabel {
  /** Bytes del rotulo listo para imprimir. */
  content: Buffer;
  contentType: string;
  /** Formato pedido (`10x15`, …). */
  format: string;
}

/** Un movimiento del envio, ya normalizado. */
export interface TrackingEvent {
  status: ShipmentStatus;
  /**
   * Codigo CRUDO del proveedor (`PRE`, `CAN`, …).
   *
   * ⚠️ SE CONSERVA SIEMPRE, aunque ya lo hayamos mapeado. Es lo que permite
   * entender que paso cuando el mapeo este mal —y va a estarlo, porque el
   * vocabulario no esta documentado y se va a descubrir a los golpes—. El ERD
   * ya reservo la columna: `shipment_tracking_events.provider_status` 🌐.
   */
  providerStatus: string;
  description: string;
  occurredAt: Date;
  raw: unknown;
}

export interface TrackingResult {
  trackingNumber: string;
  /** Ordenados del mas viejo al mas nuevo. */
  events: TrackingEvent[];
}

/** Una sucursal donde el comprador puede retirar. */
export interface Agency {
  code: string;
  name: string;
  address: ShippingAddress;
  latitude: string | null;
  longitude: string | null;
}

/**
 * Categorias de fallo. Gruesas a proposito, como en los puertos de email y
 * storage.
 *
 * `unsupported` es especifico de este puerto y sale del relevamiento: **las dos
 * APIs de Correo Argentino cubren operaciones distintas** —cotizar vive en
 * MiCorreo, rotulo y tracking en PAQ.AR—, asi que un adaptador puede
 * legitimamente no poder hacer algo. Es preferible que lo diga a que devuelva
 * un valor inventado.
 */
export type ShippingFailure = 'rejected' | 'unreachable' | 'not_configured' | 'unsupported';

export class ShippingError extends Error {
  readonly failure: ShippingFailure;

  constructor(failure: ShippingFailure, message: string) {
    super(message);
    this.name = 'ShippingError';
    this.failure = failure;
  }
}

/**
 * ⚠️ NO INCLUYE CANCELAR, aunque PAQ.AR ofrezca
 * `PATCH /v1/orders/{tn}/cancel`. No hay ningun flujo documentado que lo
 * necesite: cancelar un envio depende de la politica de cancelacion y refunds,
 * que sigue 🟡 (DEC-031). Sumar la operacion despues cuesta poco; inventarle
 * ahora la semantica —¿que pasa con la orden?, ¿y con el pago?— seria decidir
 * negocio desde una interfaz.
 */
export interface ShippingPort {
  /** Nombre del adaptador, para poder leerlo en los logs. */
  readonly name: string;

  /** Tarifas disponibles para un trayecto y un paquete. Puede devolver varias. */
  quote(input: QuoteInput): Promise<ShippingRate[]>;

  createShipment(input: CreateShipmentInput): Promise<CreatedShipment>;

  getLabel(labelRef: string): Promise<ShippingLabel>;

  /**
   * Estado y movimientos de VARIOS envios.
   *
   * ⚠️ POR LOTE, no de a uno. El proveedor acepta N numeros por llamada y esto
   * lo va a consumir un job que barre todos los envios abiertos: pedirlos de a
   * uno serian cientos de requests contra un tercero, cada una con su latencia
   * y su posibilidad de fallar.
   */
  getTracking(trackingNumbers: string[]): Promise<TrackingResult[]>;

  /**
   * Sucursales de una provincia.
   *
   * ⚠️ ES POR PROVINCIA porque el proveedor no ofrece un listado global, y la
   * cobertura **depende de la cuenta**: "no todos tienen todas las sucursales
   * habilitadas". No se puede cachear una lista universal.
   */
  listAgencies(provinceCode: string): Promise<Agency[]>;
}
