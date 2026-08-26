import { createHmac, timingSafeEqual } from 'node:crypto';

import { getEnv, requireEnv } from '@offside/config';

/**
 * Validacion de la firma de los webhooks de Mercado Pago.
 *
 * VIVE EN `lib/` Y NO EN UN MODULO A PROPOSITO: lo usan `payments` (topic
 * `payment`) y lo va a usar `sellers` (topic `mp-connect`). Una sola
 * implementacion, no una por modulo (mercadopago-payments-spec.md §11.2,
 * MP-PAY-009). Mismo criterio que `rate-limit.ts`: infraestructura de la app,
 * no dominio.
 *
 * MECANISMO 🔴 (documentado por Mercado Pago):
 *   - header `x-signature` con formato `ts=<timestamp>,v1=<hmac>`;
 *   - header `x-request-id`;
 *   - el `data.id` de la notificacion;
 *   - HMAC-SHA256 con el secreto de la aplicacion (`MERCADOPAGO_WEBHOOK_SECRET`).
 *
 * ✅ PLANTILLA VERIFICADA CONTRA MERCADO PAGO REAL (2026-08-26). Mercado Pago
 * no la publica —remite a sus SDK—, asi que se implemento la de uso corriente
 * y se dejo AISLADA en `buildManifest()` para poder corregirla sin tocar nada
 * mas. La primera notificacion real (`payment.created`, pago 175705424980)
 * valido a la primera: `payment_webhook_events.signature_valid = true`.
 * No hizo falta ajustarla.
 *
 * 🔴 Lo que si esta documentado, y se respeta: el `data.id` que se firma es el
 * que viaja como QUERY PARAMETER (`?data.id=...`), no el del cuerpo. El SDK
 * oficial lee `req.query['data.id']`.
 */

/** Solo los digitos del `data.id` cuando es numerico; MP lo envia en minuscula. */
function normalizeDataId(dataId: string): string {
  return dataId.toLowerCase();
}

/**
 * Arma el string que se firma.
 *
 * Verificado contra una notificacion real el 2026-08-26. Sigue siendo el UNICO
 * punto a ajustar si Mercado Pago cambiara la plantilla.
 */
export function buildManifest(params: { dataId: string; requestId: string; ts: string }): string {
  return `id:${normalizeDataId(params.dataId)};request-id:${params.requestId};ts:${params.ts};`;
}

export interface SignatureHeaders {
  /** Contenido crudo del header `x-signature`. */
  xSignature: string | null;
  /** Contenido crudo del header `x-request-id`. */
  xRequestId: string | null;
  /** `data.id` de la notificacion. */
  dataId: string | null;
}

/** Parsea `ts=...,v1=...`. Devuelve `null` si el header no tiene ese formato. */
function parseSignature(xSignature: string): { ts: string; v1: string } | null {
  let ts: string | undefined;
  let v1: string | undefined;

  for (const parte of xSignature.split(',')) {
    const [clave, valor] = parte.split('=', 2).map((x) => x.trim());
    if (clave === 'ts' && valor !== undefined && valor !== '') ts = valor;
    if (clave === 'v1' && valor !== undefined && valor !== '') v1 = valor;
  }

  return ts !== undefined && v1 !== undefined ? { ts, v1 } : null;
}

/** Comparacion en tiempo constante de dos firmas en hexadecimal. */
function firmasCoinciden(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Valida la firma de una notificacion.
 *
 * FALLA CERRADO: si falta un header, el formato no es el esperado o el HMAC no
 * coincide, devuelve `false`. A diferencia del rate limiting —que falla
 * abierto—, acá un fallo abierto dejaria entrar webhooks falsificados, que es
 * exactamente la amenaza que este control existe para frenar.
 *
 * ⚠️ NUNCA loguea el secreto, la firma recibida ni el manifest.
 */
export function isValidWebhookSignature(headers: SignatureHeaders): boolean {
  const { xSignature, xRequestId, dataId } = headers;

  if (xSignature === null || xRequestId === null || dataId === null) return false;

  const firma = parseSignature(xSignature);
  if (firma === null) return false;

  const secret = requireEnv(getEnv(), 'MERCADOPAGO_WEBHOOK_SECRET');
  const manifest = buildManifest({ dataId, requestId: xRequestId, ts: firma.ts });
  const esperado = createHmac('sha256', secret).update(manifest).digest('hex');

  return firmasCoinciden(esperado, firma.v1);
}

/** Extrae los tres insumos de la firma desde una `Request`. */
export function readSignatureHeaders(request: Request, dataId: string | null): SignatureHeaders {
  return {
    xSignature: request.headers.get('x-signature'),
    xRequestId: request.headers.get('x-request-id'),
    dataId,
  };
}
