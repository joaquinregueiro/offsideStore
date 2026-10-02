import { describe, expect, it } from 'vitest';

import { ShippingError, type CreateShipmentInput } from '../shipping/shipping.port';
import {
  aCentavos,
  aProductos,
  cuerpoDeAlta,
  estadoDeOffside,
  leerAlta,
  leerBusqueda,
  leerSesion,
  leerTarifas,
  normalizarCodigoPostal,
  partirNombre,
  type SesionAndreani,
} from './andreani.mapper';

/** Respuesta de login con la forma que guarda el plugin (`andreani_pyme_info`). */
const LOGIN = {
  response: {
    accessToken: 'token-de-prueba',
    contratos: [
      { id: 'C-DOM', modoDeEntregaNombre: 'A domicilio', tipoDeEnvioNombre: 'Paquetería' },
      { id: 'C-SUC', modoDeEntregaNombre: 'A sucursal', tipoDeEnvioNombre: 'Paquetería' },
      { id: 'C-HOY', modoDeEntregaNombre: 'Llega hoy', tipoDeEnvioNombre: 'Paquetería' },
      { id: 'C-BIG', modoDeEntregaNombre: 'A domicilio', tipoDeEnvioNombre: 'Bigger' },
    ],
  },
};

const SESION: SesionAndreani = leerSesion(LOGIN);

const ENVIO: CreateShipmentInput = {
  orderId: '11111111-1111-4111-8111-111111111111',
  reference: 'OFS-000123',
  mode: 'home',
  origin: {
    streetName: 'Origen',
    streetNumber: '1',
    city: 'CABA',
    provinceCode: 'C',
    postalCode: 'C1425ABC',
  },
  destination: {
    streetName: 'Av. Siempre Viva',
    streetNumber: '742',
    floor: '3',
    apartment: 'B',
    city: 'Rosario',
    provinceCode: 'S',
    postalCode: '2000',
  },
  recipientName: 'Juan Martín Pérez',
  recipientEmail: 'juan@offside.test',
  recipientPhone: '+54 9 341 555-1234',
  package: { weightGrams: 500, heightCm: 5, widthCm: 25, lengthCm: 35 },
  declaredValueAmount: 8_500_000n,
  shippingChargedAmount: 750_000n,
  currency: 'ARS',
};

describe('sesion', () => {
  it('toma el token y solo los contratos utilizables', () => {
    expect(SESION.accessToken).toBe('token-de-prueba');
    expect(SESION.contratos.map((c) => [c.id, c.modo])).toEqual([
      ['C-DOM', 'home'],
      ['C-SUC', 'agency'],
    ]);
  });

  /**
   * ⚠️ "LLEGA HOY" Y "BIGGER" SE DESCARTAN: el primero exige despachar antes del
   * mediodia y el segundo es para bultos de mas de 50 kg. Ninguno sirve para
   * una camiseta vendida a cualquier hora.
   */
  it('descarta Llega hoy y Bigger', () => {
    expect(SESION.contratos.some((c) => c.id === 'C-HOY' || c.id === 'C-BIG')).toBe(false);
  });

  it('sin token es un error de configuracion, no una caida', () => {
    expect(() => leerSesion({ response: {} })).toThrow(ShippingError);
  });
});

describe('dinero', () => {
  /**
   * ⚠️ EL FLOAT SE QUEDA EN LA FRONTERA. 0.1 + 0.2 no es 0.3 en coma flotante:
   * sin redondear, un "7041.21" podria guardarse como 704120 centavos.
   */
  it('convierte pesos a centavos redondeando, tambien desde texto', () => {
    expect(aCentavos(7041.21)).toBe(704_121n);
    expect(aCentavos('5819.18')).toBe(581_918n);
    expect(aCentavos('12,5')).toBe(1_250n);
  });

  it('rechaza un importe que no es un numero', () => {
    expect(() => aCentavos('gratis')).toThrow(ShippingError);
  });
});

describe('paquete', () => {
  /** ⚠️ `depth` ES EL LARGO: cruzarlo cotiza otro volumen sin que nada falle. */
  it('manda kilos y pone el largo en depth', () => {
    expect(aProductos(ENVIO.package, 8_500_000n)).toEqual([
      { price: 85_000, quantity: 1, kgrams: 0.5, width: 25, depth: 35, height: 5 },
    ]);
  });

  it('reduce un CP en formato CPA a sus cuatro digitos', () => {
    expect(normalizarCodigoPostal('C1425ABC')).toBe('1425');
    expect(normalizarCodigoPostal(' 2000 ')).toBe('2000');
  });
});

describe('tarifas', () => {
  const RESPUESTA = {
    response: {
      rates: [
        { code: 'A domicilio', total: '7041.21' },
        { code: 'A sucursal', total: 5819.18 },
        { code: 'Llega hoy', total: 9000 },
      ],
    },
  };
  const ahora = new Date('2026-10-02T12:00:00Z');

  it('traduce cada tarifa a su modo, en centavos, y descarta Llega hoy', () => {
    const tarifas = leerTarifas(RESPUESTA, ahora);

    expect(tarifas.map((t) => [t.mode, t.priceAmount])).toEqual([
      ['home', 704_121n],
      ['agency', 581_918n],
    ]);
  });

  it('filtra por modo cuando se pide uno', () => {
    expect(leerTarifas(RESPUESTA, ahora, 'agency')).toHaveLength(1);
  });

  it('le da una hora de validez, porque la API no la informa', () => {
    expect(leerTarifas(RESPUESTA, ahora)[0]?.validUntil).toEqual(new Date('2026-10-02T13:00:00Z'));
  });
});

describe('alta', () => {
  it('arma el cuerpo como el plugin oficial', () => {
    const cuerpo = cuerpoDeAlta(ENVIO, SESION, 'vendedor@offside.test');

    expect(cuerpo).toEqual({
      contract: { id_contract: 'C-DOM' },
      price_shipment: 7_500,
      origin: { postal_code: '1425' },
      destination: {
        street: 'Av. Siempre Viva',
        number: '742',
        floor: '3 B',
        postal_code: '2000',
        locality: 'Rosario',
        code_branch: '',
      },
      recipient: {
        name: 'Juan Martín',
        last_name: 'Pérez',
        phone_number: '+5493415551234',
        dni: '',
        email: 'juan@offside.test',
      },
      products: [{ price: 85_000, quantity: 1, kgrams: 0.5, width: 25, depth: 35, height: 5 }],
      email_merchant: 'vendedor@offside.test',
      remito: 'OFS-000123',
    });
  });

  it('separa el apellido como la ultima palabra', () => {
    expect(partirNombre('  Ana   López ')).toEqual({ nombre: 'Ana', apellido: 'López' });
  });

  /**
   * ⚠️ SE RECHAZA ANTES DE LLAMAR, NO DESPUES. Un destinatario sin apellido o
   * sin telefono es un envio que la sucursal puede no entregar, y descubrirlo
   * con un rechazo de Andreani le cuesta al vendedor un intento perdido.
   */
  it('rechaza un nombre de una sola palabra', () => {
    expect(() => cuerpoDeAlta({ ...ENVIO, recipientName: 'Juan' }, SESION, 'v@o.test')).toThrow(
      /nombre y apellido/,
    );
  });

  it('rechaza un envio sin telefono del destinatario', () => {
    const { recipientPhone: _sinTelefono, ...sinTelefono } = ENVIO;

    expect(() => cuerpoDeAlta(sinTelefono, SESION, 'v@o.test')).toThrow(/teléfono/);
  });

  it('rechaza un envio a sucursal sin sucursal', () => {
    expect(() => cuerpoDeAlta({ ...ENVIO, mode: 'agency' }, SESION, 'v@o.test')).toThrow(
      /sucursal/,
    );
  });

  it('rechaza un modo que la cuenta no tiene contratado', () => {
    const soloSucursal: SesionAndreani = { ...SESION, contratos: SESION.contratos.slice(1) };

    expect(() => cuerpoDeAlta(ENVIO, soloSucursal, 'v@o.test')).toThrow(/domicilio/);
  });

  it('lee el id de pedido de la respuesta', () => {
    expect(leerAlta({ response: { pedidoId: 'P-9', numeroInterno: 'N-1' } })).toEqual({
      pedidoId: 'P-9',
      numeroInterno: 'N-1',
    });
  });
});

describe('estado', () => {
  /**
   * ⚠️ SIN NUMERO ES `created` SIEMPRE: en la cuenta PyME el numero aparece al
   * PAGAR el envio, y antes de eso no hay paquete en camino a ningun lado.
   */
  it('sin numero de seguimiento es created, diga lo que diga', () => {
    expect(estadoDeOffside('En distribución', false)).toBe('created');
  });

  /** ⚠️ "No entregado" se evalua ANTES que "entregado", que es una subcadena suya. */
  it.each([
    ['Entregado', 'delivered'],
    ['No entregado', 'delivery_issue'],
    ['En devolución', 'returned'],
    ['Pendiente de ingreso', 'created'],
    ['En distribución', 'in_transit'],
    ['Ingresado en sucursal', 'in_transit'],
  ])('%s → %s', (crudo, esperado) => {
    expect(estadoDeOffside(crudo, true)).toBe(esperado);
  });

  it('busca por referencia y deja sin numero lo que no vino', () => {
    const respuesta = {
      response: [
        {
          salesOrderNumber: 'OFS-1',
          trackingNumber: '360000101651699',
          trackingStatus: 'Entregado',
        },
      ],
    };

    expect(leerBusqueda(respuesta, ['OFS-1', 'OFS-2'])).toEqual([
      expect.objectContaining({
        reference: 'OFS-1',
        trackingNumber: '360000101651699',
        status: 'delivered',
      }),
      expect.objectContaining({
        reference: 'OFS-2',
        trackingNumber: null,
        providerStatus: null,
        status: 'created',
      }),
    ]);
  });

  it('acepta la respuesta sin envoltorio', () => {
    const pelada = [
      { salesOrderNumber: 'OFS-1', trackingNumber: '1', trackingStatus: 'En camino' },
    ];

    expect(leerBusqueda(pelada, ['OFS-1'])[0]?.status).toBe('in_transit');
  });
});
