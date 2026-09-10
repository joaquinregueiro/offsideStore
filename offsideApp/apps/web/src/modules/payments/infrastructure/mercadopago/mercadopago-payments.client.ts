import { requestAsSeller } from '../../../sellers/services/mercadopago-connection.service';

/**
 * Adapter de PAGOS de Mercado Pago.
 *
 * UNICO lugar de `payments` que conoce endpoints, nombres de campo y formatos
 * de Mercado Pago (CLAUDE.md §11).
 *
 * ⚠️ NO MANEJA CREDENCIALES. Delega en `sellers.requestAsSeller`, que descifra
 * el token del vendedor, lo usa y lo descarta. Este archivo nunca ve un token,
 * no conoce `TOKEN_ENCRYPTION_KEY` y no reimplementa OAuth
 * (mercadopago-payments-spec.md §4.1, MP-PAY-001).
 *
 * ⚠️ NO LOGUEA cuerpos de request ni de response.
 */

/** Categorias de fallo. Gruesas a proposito: los codigos de MP siguen 🔵. */
export type MercadoPagoPaymentFailure = 'rejected' | 'unreachable' | 'invalid_response';

export class MercadoPagoPaymentError extends Error {
  readonly failure: MercadoPagoPaymentFailure;
  readonly httpStatus?: number;

  constructor(failure: MercadoPagoPaymentFailure, message: string, httpStatus?: number) {
    super(message);
    this.name = 'MercadoPagoPaymentError';
    this.failure = failure;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }
}

/* -------------------------------------------------------------------------- */
/* Conversion de importes                                                      */
/* -------------------------------------------------------------------------- */

/**
 * El ERD guarda **centavos en `bigint`** (ERD §1); Mercado Pago trabaja con
 * unidades decimales. La conversion ocurre SOLO acá (MP-PAY-007): ningun
 * importe decimal cruza hacia el dominio.
 *
 * Se construye el decimal desde strings, sin `float` intermedio: `12345 / 100`
 * en punto flotante puede dar `123.44999999999999`.
 */
export function centsToUnits(cents: bigint): number {
  const negativo = cents < 0n;
  const abs = negativo ? -cents : cents;
  const entero = abs / 100n;
  const resto = abs % 100n;
  const texto = `${entero}.${resto.toString().padStart(2, '0')}`;

  return Number(negativo ? `-${texto}` : texto);
}

/** Inversa de `centsToUnits`. Redondea al centavo mas cercano. */
export function unitsToCents(units: number): bigint {
  return BigInt(Math.round(units * 100));
}

/* -------------------------------------------------------------------------- */
/* Preferencia de Checkout Pro                                                 */
/* -------------------------------------------------------------------------- */

export interface PreferenceItem {
  id: string;
  title: string;
  quantity: number;
  unitPriceCents: bigint;
  currency: string;
}

export interface CreatePreferenceInput {
  sellerId: string;
  orderId: string;
  items: PreferenceItem[];
  /** Comision de Offside en centavos. Es `orders.commission_amount` (DEC-043). */
  marketplaceFeeCents: bigint;
  notificationUrl: string;
  backUrls: { success: string; pending: string; failure: string };
  /** Vencimiento de la preferencia, derivado de `orders.payment_deadline`. */
  expiresAt: Date | null;
  idempotencyKey: string;
}

export interface CreatedPreference {
  preferenceId: string;
  initPoint: string;
  /** `collector_id` informado por MP: debe coincidir con el `mp_user_id`. */
  collectorId: string | null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function readId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Crea la preferencia de Checkout Pro sobre la cuenta del vendedor.
 *
 * `marketplace_fee` va **sin ajustes**: es el 6% de Offside tal cual (DEC-043,
 * MP-PAY-012). No se estima ni se descuenta el costo de Mercado Pago.
 */
export async function createPreference(input: CreatePreferenceInput): Promise<CreatedPreference> {
  const body: Record<string, unknown> = {
    items: input.items.map((item) => ({
      id: item.id,
      title: item.title,
      quantity: item.quantity,
      currency_id: item.currency,
      unit_price: centsToUnits(item.unitPriceCents),
    })),
    marketplace_fee: centsToUnits(input.marketplaceFeeCents),
    external_reference: input.orderId,
    notification_url: input.notificationUrl,
    back_urls: input.backUrls,
    auto_return: 'approved',
  };

  if (input.expiresAt !== null) {
    body.expires = true;
    body.expiration_date_to = input.expiresAt.toISOString();
  }

  const response = await requestAsSeller(input.sellerId, {
    path: '/checkout/preferences',
    method: 'POST',
    body,
    idempotencyKey: input.idempotencyKey,
  });

  if (!response.ok) {
    // ⚠️ El cuerpo del error NO se propaga: los codigos exactos de MP siguen 🔵
    // y el payload puede arrastrar datos de la request.
    throw new MercadoPagoPaymentError(
      'rejected',
      'Mercado Pago rechazo la creacion de la preferencia',
      response.status,
    );
  }

  const payload = (response.body ?? {}) as Record<string, unknown>;
  const preferenceId = readId(payload.id);
  const initPoint = readString(payload.init_point);

  if (preferenceId === null || initPoint === null) {
    throw new MercadoPagoPaymentError(
      'invalid_response',
      'La respuesta de Mercado Pago no incluye id o init_point',
      response.status,
    );
  }

  return { preferenceId, initPoint, collectorId: readId(payload.collector_id) };
}

/* -------------------------------------------------------------------------- */
/* Consulta del pago                                                           */
/* -------------------------------------------------------------------------- */

/** Lo que Offside necesita saber de un pago. Nombres propios, no de MP. */
export interface FetchedPayment {
  mpPaymentId: string;
  /** Estado CRUDO de MP. El normalizado lo decide el mapper. */
  mpStatus: string | null;
  mpStatusDetail: string | null;
  /** `external_reference`: el `orders.id` que Offside envio. */
  externalReference: string | null;
  amountCents: bigint | null;
  currency: string | null;
  paymentMethod: string | null;
  installments: number | null;
  approvedAt: Date | null;
  /** Neto que recibio el vendedor, si MP lo informa. */
  netReceivedAmountCents: bigint | null;
  /** Payload completo, para `payments.raw` (DEC-035). */
  raw: unknown;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null;
  const fecha = new Date(value);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * Reconsulta el pago a Mercado Pago.
 *
 * **Siempre se reconsulta** (PC-041 / MP-PAY-006): el webhook sólo trae un id y
 * su cuerpo no es fuente de verdad.
 */
export async function fetchPayment(sellerId: string, mpPaymentId: string): Promise<FetchedPayment> {
  const response = await requestAsSeller(sellerId, {
    path: `/v1/payments/${encodeURIComponent(mpPaymentId)}`,
    method: 'GET',
  });

  if (!response.ok) {
    throw new MercadoPagoPaymentError(
      'rejected',
      'Mercado Pago no devolvio el pago consultado',
      response.status,
    );
  }

  const payload = (response.body ?? {}) as Record<string, unknown>;
  const id = readId(payload.id);

  if (id === null) {
    throw new MercadoPagoPaymentError(
      'invalid_response',
      'La respuesta de Mercado Pago no incluye el id del pago',
      response.status,
    );
  }

  const detalles = (payload.transaction_details ?? {}) as Record<string, unknown>;
  const monto = readNumber(payload.transaction_amount);
  const neto = readNumber(detalles.net_received_amount);

  return {
    mpPaymentId: id,
    mpStatus: readString(payload.status),
    mpStatusDetail: readString(payload.status_detail),
    externalReference: readString(payload.external_reference),
    amountCents: monto === null ? null : unitsToCents(monto),
    currency: readString(payload.currency_id),
    paymentMethod: readString(payload.payment_method_id),
    installments: readNumber(payload.installments),
    approvedAt: readDate(payload.date_approved),
    netReceivedAmountCents: neto === null ? null : unitsToCents(neto),
    raw: payload,
  };
}

/* -------------------------------------------------------------------------- */
/* Reembolsos                                                                  */
/* -------------------------------------------------------------------------- */

export interface CreateRefundInput {
  sellerId: string;
  mpPaymentId: string;
  /** `null` = reembolso TOTAL. Con importe = reembolso parcial. */
  amountCents: bigint | null;
  idempotencyKey: string;
}

export interface CreatedRefund {
  mpRefundId: string | null;
  status: string | null;
  raw: unknown;
}

/**
 * Crea el reembolso.
 *
 * 🔴 Sin `amount` MP devuelve el total; con `amount`, un parcial. El header de
 * idempotencia es **obligatorio** en esta API.
 */
export async function createRefund(input: CreateRefundInput): Promise<CreatedRefund> {
  const response = await requestAsSeller(input.sellerId, {
    path: `/v1/payments/${encodeURIComponent(input.mpPaymentId)}/refunds`,
    method: 'POST',
    body: input.amountCents === null ? {} : { amount: centsToUnits(input.amountCents) },
    idempotencyKey: input.idempotencyKey,
  });

  if (!response.ok) {
    throw new MercadoPagoPaymentError(
      'rejected',
      'Mercado Pago rechazo el reembolso',
      response.status,
    );
  }

  const payload = (response.body ?? {}) as Record<string, unknown>;

  return {
    mpRefundId: readId(payload.id),
    status: readString(payload.status),
    raw: payload,
  };
}
