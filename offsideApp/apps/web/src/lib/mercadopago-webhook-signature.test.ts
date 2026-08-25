import { createHmac } from 'node:crypto';

import { resetEnvCache } from '@offside/config';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildManifest,
  isValidWebhookSignature,
  readSignatureHeaders,
} from './mercadopago-webhook-signature';

/**
 * Validacion de la firma de los webhooks de Mercado Pago.
 *
 * ⚠️ El secreto de este archivo es inventado y local. No es una credencial real.
 */

const SECRETO = 'secreto-de-webhook-solo-para-tests';

beforeAll(() => {
  // Mismo patron que `rate-limit.test.ts`: `getEnv()` valida el objeto completo.
  process.env.DATABASE_URL ??= 'postgresql://unit:unit@localhost:5432/unit';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO;

  resetEnvCache();
});

/** Firma valida, construida igual que la construiria Mercado Pago. */
function firmar(dataId: string, requestId: string, ts: string): string {
  const manifest = buildManifest({ dataId, requestId, ts });
  const v1 = createHmac('sha256', SECRETO).update(manifest).digest('hex');

  return `ts=${ts},v1=${v1}`;
}

const DATA_ID = '1234567890';
const REQUEST_ID = 'req-de-prueba';
const TS = '1700000000';

describe('isValidWebhookSignature', () => {
  it('acepta una firma valida', () => {
    expect(
      isValidWebhookSignature({
        xSignature: firmar(DATA_ID, REQUEST_ID, TS),
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toBe(true);
  });

  it('acepta el header con espacios alrededor de las partes', () => {
    const valida = firmar(DATA_ID, REQUEST_ID, TS);
    const conEspacios = valida.replace(',', ' , ');

    expect(
      isValidWebhookSignature({
        xSignature: conEspacios,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toBe(true);
  });

  it('RECHAZA una firma de otro secreto', () => {
    const ajena = `ts=${TS},v1=${createHmac('sha256', 'otro-secreto')
      .update(buildManifest({ dataId: DATA_ID, requestId: REQUEST_ID, ts: TS }))
      .digest('hex')}`;

    expect(
      isValidWebhookSignature({ xSignature: ajena, xRequestId: REQUEST_ID, dataId: DATA_ID }),
    ).toBe(false);
  });

  it('RECHAZA si cambia el data.id: la firma esta atada al recurso', () => {
    expect(
      isValidWebhookSignature({
        xSignature: firmar(DATA_ID, REQUEST_ID, TS),
        xRequestId: REQUEST_ID,
        dataId: '9999999999',
      }),
    ).toBe(false);
  });

  it('RECHAZA si cambia el x-request-id', () => {
    expect(
      isValidWebhookSignature({
        xSignature: firmar(DATA_ID, REQUEST_ID, TS),
        xRequestId: 'otro-request-id',
        dataId: DATA_ID,
      }),
    ).toBe(false);
  });

  it('RECHAZA si cambia el ts', () => {
    const valida = firmar(DATA_ID, REQUEST_ID, TS);
    const alterada = valida.replace(`ts=${TS}`, 'ts=1700000001');

    expect(
      isValidWebhookSignature({ xSignature: alterada, xRequestId: REQUEST_ID, dataId: DATA_ID }),
    ).toBe(false);
  });

  it.each([
    ['sin x-signature', { xSignature: null, xRequestId: REQUEST_ID, dataId: DATA_ID }],
    [
      'sin x-request-id',
      { xSignature: firmar(DATA_ID, REQUEST_ID, TS), xRequestId: null, dataId: DATA_ID },
    ],
    [
      'sin data.id',
      { xSignature: firmar(DATA_ID, REQUEST_ID, TS), xRequestId: REQUEST_ID, dataId: null },
    ],
  ])('FALLA CERRADO %s', (_caso, headers) => {
    expect(isValidWebhookSignature(headers)).toBe(false);
  });

  it.each(['', 'basura', 'ts=1700000000', 'v1=abc'])(
    'FALLA CERRADO ante un header con formato invalido: %s',
    (header) => {
      expect(
        isValidWebhookSignature({ xSignature: header, xRequestId: REQUEST_ID, dataId: DATA_ID }),
      ).toBe(false);
    },
  );
});

describe('readSignatureHeaders', () => {
  it('extrae los tres insumos de la request', () => {
    const request = new Request('https://offside.test/api/webhooks/mercadopago/payments', {
      method: 'POST',
      headers: { 'x-signature': 'ts=1,v1=abc', 'x-request-id': 'req-1' },
    });

    expect(readSignatureHeaders(request, DATA_ID)).toEqual({
      xSignature: 'ts=1,v1=abc',
      xRequestId: 'req-1',
      dataId: DATA_ID,
    });
  });
});
