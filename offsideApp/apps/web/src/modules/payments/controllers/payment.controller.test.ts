import { createHmac } from 'node:crypto';

import { resetEnvCache } from '@offside/config';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildManifest } from '@/lib/mercadopago-webhook-signature';

/**
 * Webhook: autenticacion por firma.
 *
 * Lo que se verifica es que el endpoint **falle cerrado** y que firme sobre el
 * `data.id` correcto. El procesamiento en si vive en la integracion.
 *
 * ⚠️ El secreto es inventado y local. No es una credencial real.
 */

const handleNotification = vi.hoisted(() => vi.fn());

vi.mock('../services/payment-webhook.service', () => ({
  handleNotification,
}));

const SECRETO = 'secreto-de-webhook-solo-para-tests';
const DATA_ID = '555000111';
const REQUEST_ID = 'req-de-prueba';
const TS = '1700000000';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgresql://unit:unit@localhost:5432/unit';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.AUTH_SESSION_SECRET ??= 'pepper-solo-para-tests';
  process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO;

  resetEnvCache();
});

afterEach(() => {
  handleNotification.mockReset();
});

function firmar(dataId: string): string {
  const v1 = createHmac('sha256', SECRETO)
    .update(buildManifest({ dataId, requestId: REQUEST_ID, ts: TS }))
    .digest('hex');

  return `ts=${TS},v1=${v1}`;
}

/** Notificacion tal como la manda Mercado Pago: `data.id` en la QUERY. */
function notificacion(
  opciones: { queryDataId?: string; firma?: string; bodyDataId?: string } = {},
) {
  const url = new URL('https://offside.test/api/webhooks/mercadopago/payments');
  if (opciones.queryDataId !== undefined) url.searchParams.set('data.id', opciones.queryDataId);

  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': REQUEST_ID,
      ...(opciones.firma === undefined ? {} : { 'x-signature': opciones.firma }),
    },
    body: JSON.stringify({
      id: 12_345,
      type: 'payment',
      action: 'payment.updated',
      user_id: 100_000_777,
      data: { id: opciones.bodyDataId ?? DATA_ID },
    }),
  });
}

async function controller() {
  return import('./payment.controller');
}

describe('webhook', () => {
  it('acepta una notificacion firmada con el data.id de la QUERY', async () => {
    // 🔴 Mercado Pago firma el `data.id` que viaja en la URL, no el del cuerpo.
    handleNotification.mockResolvedValue('processed');
    const { webhook } = await controller();

    const respuesta = await webhook(notificacion({ queryDataId: DATA_ID, firma: firmar(DATA_ID) }));

    expect(respuesta.status).toBe(200);
    expect(handleNotification).toHaveBeenCalledOnce();
  });

  it('RECHAZA una firma calculada sobre otro data.id', async () => {
    const { webhook } = await controller();

    const respuesta = await webhook(
      notificacion({ queryDataId: DATA_ID, firma: firmar('999999999') }),
    );

    expect(respuesta.status).toBe(401);
    expect(handleNotification).not.toHaveBeenCalled();
  });

  it('RECHAZA una notificacion sin firma y no la procesa', async () => {
    const { webhook } = await controller();

    const respuesta = await webhook(notificacion({ queryDataId: DATA_ID }));

    expect(respuesta.status).toBe(401);
    expect(handleNotification).not.toHaveBeenCalled();
  });

  it('cae al data.id del cuerpo cuando no viene en la URL', async () => {
    // Tolerancia para variantes que no traen query string. La firma se calcula
    // sobre el mismo valor, asi que sigue siendo verificable.
    handleNotification.mockResolvedValue('processed');
    const { webhook } = await controller();

    const respuesta = await webhook(notificacion({ firma: firmar(DATA_ID) }));

    expect(respuesta.status).toBe(200);
  });

  it('responde 200 aunque el evento no tenga efecto', async () => {
    // Un 500 haria que Mercado Pago reintente para siempre un evento que nunca
    // va a poder aplicarse.
    handleNotification.mockResolvedValue('unknown_payment');
    const { webhook } = await controller();

    const respuesta = await webhook(notificacion({ queryDataId: DATA_ID, firma: firmar(DATA_ID) }));

    expect(respuesta.status).toBe(200);
  });
});
