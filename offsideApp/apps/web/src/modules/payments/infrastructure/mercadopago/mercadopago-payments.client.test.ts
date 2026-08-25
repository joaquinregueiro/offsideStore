import { afterEach, describe, expect, it, vi } from 'vitest';

import { centsToUnits, unitsToCents } from './mercadopago-payments.client';

/**
 * Adapter de pagos: lo que se le manda a Mercado Pago.
 *
 * `requestAsSeller` se reemplaza por un doble: este test NO sale a la red y
 * **no toca credenciales**, que es justamente lo que garantiza la frontera.
 */

const requestAsSeller = vi.hoisted(() => vi.fn());

vi.mock('../../../sellers/services/mercadopago-connection.service', () => ({
  requestAsSeller,
}));

afterEach(() => {
  requestAsSeller.mockReset();
});

/** Importa el cliente ya con el mock puesto. */
async function cliente() {
  return import('./mercadopago-payments.client');
}

describe('conversion de importes', () => {
  it('convierte centavos a unidades decimales sin float intermedio', () => {
    expect(centsToUnits(10_000_000n)).toBe(100_000);
    expect(centsToUnits(600_000n)).toBe(6_000);
    expect(centsToUnits(7_576n)).toBe(75.76);
    expect(centsToUnits(5n)).toBe(0.05);
    expect(centsToUnits(0n)).toBe(0);
  });

  it('es reversible', () => {
    for (const centavos of [1n, 99n, 100n, 12_345n, 999_999_999n]) {
      expect(unitsToCents(centsToUnits(centavos))).toBe(centavos);
    }
  });

  it('no pierde el centavo por redondeo binario', () => {
    // 123.45 en float puede dar 123.44999999999999.
    expect(centsToUnits(12_345n)).toBe(123.45);
    expect(unitsToCents(123.45)).toBe(12_345n);
  });
});

describe('createPreference', () => {
  const input = {
    sellerId: 'seller-1',
    orderId: 'order-1',
    items: [
      {
        id: 'item-1',
        title: 'Camiseta',
        quantity: 2,
        unitPriceCents: 5_000_000n,
        currency: 'ARS',
      },
    ],
    marketplaceFeeCents: 600_000n,
    notificationUrl: 'https://offside.test/api/webhooks/mercadopago/payments',
    backUrls: {
      success: 'https://offside.test/ok',
      pending: 'https://offside.test/pending',
      failure: 'https://offside.test/fail',
    },
    expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    idempotencyKey: 'clave-idempotente',
  };

  function respuestaOk(): void {
    requestAsSeller.mockResolvedValue({
      ok: true,
      status: 201,
      body: {
        id: 'pref-123',
        init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123',
        collector_id: 100_000_001,
      },
    });
  }

  it('crea la preferencia con el vendedor y la clave de idempotencia', async () => {
    respuestaOk();
    const mp = await cliente();

    await mp.createPreference(input);

    expect(requestAsSeller).toHaveBeenCalledOnce();
    const [sellerId, request] = requestAsSeller.mock.calls[0] as [string, Record<string, unknown>];

    expect(sellerId).toBe('seller-1');
    expect(request.path).toBe('/checkout/preferences');
    expect(request.method).toBe('POST');
    expect(request.idempotencyKey).toBe('clave-idempotente');
  });

  it('MANDA marketplace_fee = la comision de Offside, sin ajustes (DEC-043)', async () => {
    respuestaOk();
    const mp = await cliente();

    await mp.createPreference(input);

    const body = (requestAsSeller.mock.calls[0] as [string, { body: Record<string, unknown> }])[1]
      .body;

    // 600.000 centavos = $6.000 = el 6% de $100.000. Ni estimado ni reducido.
    expect(body.marketplace_fee).toBe(6_000);
  });

  it('usa el orders.id como external_reference', async () => {
    respuestaOk();
    const mp = await cliente();

    await mp.createPreference(input);

    const body = (requestAsSeller.mock.calls[0] as [string, { body: Record<string, unknown> }])[1]
      .body;

    expect(body.external_reference).toBe('order-1');
    expect(body.notification_url).toBe(input.notificationUrl);
    expect(body.auto_return).toBe('approved');
  });

  it('convierte los items a unidades decimales', async () => {
    respuestaOk();
    const mp = await cliente();

    await mp.createPreference(input);

    const body = (requestAsSeller.mock.calls[0] as [string, { body: Record<string, unknown> }])[1]
      .body;

    expect(body.items).toEqual([
      { id: 'item-1', title: 'Camiseta', quantity: 2, currency_id: 'ARS', unit_price: 50_000 },
    ]);
  });

  it('propaga el vencimiento cuando la orden tiene ventana de pago', async () => {
    respuestaOk();
    const mp = await cliente();

    await mp.createPreference(input);

    const body = (requestAsSeller.mock.calls[0] as [string, { body: Record<string, unknown> }])[1]
      .body;

    expect(body.expires).toBe(true);
    expect(body.expiration_date_to).toBe('2026-09-01T00:00:00.000Z');
  });

  it('omite el vencimiento si la orden no tiene ventana', async () => {
    respuestaOk();
    const mp = await cliente();

    await mp.createPreference({ ...input, expiresAt: null });

    const body = (requestAsSeller.mock.calls[0] as [string, { body: Record<string, unknown> }])[1]
      .body;

    expect(body.expires).toBeUndefined();
  });

  it('devuelve el init_point y el collector_id', async () => {
    respuestaOk();
    const mp = await cliente();

    const creada = await mp.createPreference(input);

    expect(creada.preferenceId).toBe('pref-123');
    expect(creada.initPoint).toContain('mercadopago');
    expect(creada.collectorId).toBe('100000001');
  });

  it('clasifica un rechazo de Mercado Pago sin leer el cuerpo del error', async () => {
    requestAsSeller.mockResolvedValue({ ok: false, status: 400, body: { message: 'invalid' } });
    const mp = await cliente();

    await expect(mp.createPreference(input)).rejects.toMatchObject({
      name: 'MercadoPagoPaymentError',
      failure: 'rejected',
      httpStatus: 400,
    });
  });

  it('rechaza una respuesta sin init_point en vez de inventarlo', async () => {
    requestAsSeller.mockResolvedValue({ ok: true, status: 201, body: { id: 'pref-1' } });
    const mp = await cliente();

    await expect(mp.createPreference(input)).rejects.toMatchObject({
      failure: 'invalid_response',
    });
  });
});

describe('fetchPayment', () => {
  it('consulta el pago con el token del vendedor', async () => {
    requestAsSeller.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        id: 987_654_321,
        status: 'approved',
        status_detail: 'accredited',
        external_reference: 'order-1',
        transaction_amount: 100_000,
        currency_id: 'ARS',
        payment_method_id: 'visa',
        installments: 1,
        date_approved: '2026-08-24T12:00:00.000Z',
        transaction_details: { net_received_amount: 89_000 },
      },
    });
    const mp = await cliente();

    const pago = await mp.fetchPayment('seller-1', '987654321');

    expect(requestAsSeller).toHaveBeenCalledWith('seller-1', {
      path: '/v1/payments/987654321',
      method: 'GET',
    });
    expect(pago.mpPaymentId).toBe('987654321');
    expect(pago.mpStatus).toBe('approved');
    expect(pago.externalReference).toBe('order-1');
    expect(pago.amountCents).toBe(10_000_000n);
    expect(pago.netReceivedAmountCents).toBe(8_900_000n);
    expect(pago.approvedAt).toEqual(new Date('2026-08-24T12:00:00.000Z'));
  });

  it('rechaza una respuesta sin id', async () => {
    requestAsSeller.mockResolvedValue({ ok: true, status: 200, body: { status: 'approved' } });
    const mp = await cliente();

    await expect(mp.fetchPayment('seller-1', '1')).rejects.toMatchObject({
      failure: 'invalid_response',
    });
  });
});

describe('createRefund', () => {
  it('un reembolso TOTAL va sin amount', async () => {
    requestAsSeller.mockResolvedValue({
      ok: true,
      status: 201,
      body: { id: 1, status: 'approved' },
    });
    const mp = await cliente();

    await mp.createRefund({
      sellerId: 'seller-1',
      mpPaymentId: '123',
      amountCents: null,
      idempotencyKey: 'refund-1',
    });

    const [, request] = requestAsSeller.mock.calls[0] as [string, Record<string, unknown>];
    expect(request.path).toBe('/v1/payments/123/refunds');
    expect(request.body).toEqual({});
    expect(request.idempotencyKey).toBe('refund-1');
  });

  it('un reembolso PARCIAL manda el importe en unidades', async () => {
    requestAsSeller.mockResolvedValue({
      ok: true,
      status: 201,
      body: { id: 2, status: 'approved' },
    });
    const mp = await cliente();

    await mp.createRefund({
      sellerId: 'seller-1',
      mpPaymentId: '123',
      amountCents: 250_000n,
      idempotencyKey: 'refund-2',
    });

    const [, request] = requestAsSeller.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(request.body).toEqual({ amount: 2_500 });
  });

  it('propaga el rechazo de Mercado Pago', async () => {
    requestAsSeller.mockResolvedValue({ ok: false, status: 400, body: { error: 4296 } });
    const mp = await cliente();

    await expect(
      mp.createRefund({
        sellerId: 'seller-1',
        mpPaymentId: '123',
        amountCents: null,
        idempotencyKey: 'refund-3',
      }),
    ).rejects.toMatchObject({ failure: 'rejected', httpStatus: 400 });
  });
});
