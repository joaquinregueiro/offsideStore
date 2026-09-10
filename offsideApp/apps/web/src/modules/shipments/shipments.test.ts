import { resetEnvCache } from '@offside/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFakeShipping,
  _numeroSimuladoDe,
} from './infrastructure/shipping/fake-shipping.adapter';
import { createShipping } from './infrastructure/shipping/index';
import { ShippingError, type PackageInfo } from './infrastructure/shipping/shipping.port';

/**
 * Tests del puerto de envios y su adaptador simulado.
 *
 * Lo que mas vale acá no es que el falso "funcione" —inventa datos, difícil
 * fallar— sino dos cosas concretas: que **no se pueda usar en produccion**, y
 * que **rechace lo mismo que rechazaría el proveedor real**. Un falso más
 * permisivo que el real es una trampa: todo anda en desarrollo y explota al
 * integrar.
 */

/** Camiseta típica: liviana y chica. Bien dentro de los límites. */
const PAQUETE: PackageInfo = { weightGrams: 400, heightCm: 5, widthCm: 25, lengthCm: 30 };

const DIRECCION = {
  streetName: 'Corrientes',
  streetNumber: '1234',
  city: 'CABA',
  provinceCode: 'C',
  postalCode: '1043',
};

beforeEach(() => {
  process.env.DATABASE_URL ??= 'postgresql://unit:unit@localhost:5432/unit';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.AUTH_SESSION_SECRET ??= 'pepper-solo-para-tests';

  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetEnvCache();
});

describe('eleccion del adaptador', () => {
  it('⚠️ en produccion NO devuelve el simulado: lanza', () => {
    // ES EL TEST MAS IMPORTANTE DEL ARCHIVO. Un envio simulado informa
    // "entregado": cerraria ordenes que nunca se despacharon, liberaria la
    // plata del vendedor y borraria la evidencia con la que SH-002 resuelve las
    // disputas de "producto no recibido".
    process.env.APP_ENV = 'production';
    resetEnvCache();

    expect(() => createShipping()).toThrow(/simulado NO puede usarse en produccion/i);
  });

  it('fuera de produccion devuelve el simulado', () => {
    process.env.APP_ENV = 'development';
    resetEnvCache();

    expect(createShipping().name).toBe('fake');
  });
});

describe('cotizar', () => {
  const shipping = createFakeShipping();

  it('devuelve VARIAS tarifas, no un numero', async () => {
    // El contrato real devuelve una lista por modalidad y producto. Si el
    // puerto hubiera prometido un solo precio, el adaptador real no entraria.
    const tarifas = await shipping.quote({
      originPostalCode: '1757',
      destinationPostalCode: '5000',
      package: PAQUETE,
    });

    expect(tarifas.length).toBeGreaterThan(1);
    expect(tarifas.map((t) => t.mode)).toEqual(expect.arrayContaining(['home', 'agency']));
  });

  it('filtra por modalidad cuando se pide una', async () => {
    const tarifas = await shipping.quote({
      originPostalCode: '1757',
      destinationPostalCode: '5000',
      package: PAQUETE,
      mode: 'agency',
    });

    expect(tarifas).toHaveLength(1);
    expect(tarifas[0]?.mode).toBe('agency');
  });

  it('⚠️ el precio es bigint en centavos, no un float', async () => {
    // El proveedor devuelve `498.06`. Si ese float cruzara el puerto, el
    // redondeo terminaria ocurriendo en cualquier lado del sistema.
    const [tarifa] = await shipping.quote({
      originPostalCode: '1757',
      destinationPostalCode: '5000',
      package: PAQUETE,
    });

    expect(typeof tarifa?.priceAmount).toBe('bigint');
  });

  it('la cotizacion vence', async () => {
    // `validTo` existe en la respuesta real y hay que poder leerlo: la orden
    // congela el costo (DEC-030) y alguien tiene que decidir que pasa despues.
    const [tarifa] = await shipping.quote({
      originPostalCode: '1757',
      destinationPostalCode: '5000',
      package: PAQUETE,
    });

    expect(tarifa?.validUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it('⚠️ rechaza lo que rechazaria el proveedor real', async () => {
    // El falso valida los limites REALES (25 kg, 150 cm). Si aceptara
    // cualquier cosa, el dia que entre el adaptador real aparecerian rechazos
    // que en desarrollo nunca se vieron.
    const pesado = { ...PAQUETE, weightGrams: 30_000 };

    await expect(
      shipping.quote({ originPostalCode: '1', destinationPostalCode: '2', package: pesado }),
    ).rejects.toThrow(ShippingError);

    const grande = { ...PAQUETE, lengthCm: 200 };

    await expect(
      shipping.quote({ originPostalCode: '1', destinationPostalCode: '2', package: grande }),
    ).rejects.toThrow(/entre 1 y 150 cm/);
  });
});

describe('crear envio', () => {
  const shipping = createFakeShipping();

  const base = {
    orderId: '11111111-1111-4111-8111-111111111111',
    origin: DIRECCION,
    destination: DIRECCION,
    recipientName: 'Comprador',
    recipientEmail: 'comprador@offside.test',
    package: PAQUETE,
    declaredValueAmount: 8_500_000n,
    currency: 'ARS',
  };

  it('devuelve numero de seguimiento y referencia de rotulo', async () => {
    const envio = await shipping.createShipment({ ...base, mode: 'home' });

    expect(envio.trackingNumber).toMatch(/^SIM-/);
    expect(envio.labelRef).not.toBeNull();
  });

  it('⚠️ a sucursal SIN codigo de sucursal, rechaza', async () => {
    // El proveedor real responde "Verifique la sucursal de destino". Que el
    // falso lo reproduzca evita descubrirlo en produccion.
    await expect(shipping.createShipment({ ...base, mode: 'agency' })).rejects.toThrow(
      /codigo de sucursal/i,
    );
  });

  it('conserva el payload crudo del proveedor', async () => {
    const envio = await shipping.createShipment({ ...base, mode: 'home' });

    expect(envio.raw).toMatchObject({ simulado: true });
  });
});

describe('seguimiento', () => {
  const shipping = createFakeShipping();
  const ORDEN = '22222222-2222-4222-8222-222222222222';

  it('⚠️ se consulta POR LOTE', async () => {
    // El proveedor acepta N numeros por llamada, y esto lo va a consumir un job
    // que barre todos los envios abiertos. De a uno serian cientos de requests.
    const uno = _numeroSimuladoDe(ORDEN, new Date());
    const otro = _numeroSimuladoDe('33333333-3333-4333-8333-333333333333', new Date());

    const resultados = await shipping.getTracking([uno, otro]);

    expect(resultados).toHaveLength(2);
    expect(resultados.map((r) => r.trackingNumber)).toEqual([uno, otro]);
  });

  it('un envio recien creado esta en `created`', async () => {
    const [resultado] = await shipping.getTracking([_numeroSimuladoDe(ORDEN, new Date())]);

    expect(resultado?.events).toHaveLength(1);
    expect(resultado?.events[0]?.status).toBe('created');
  });

  it('avanza con el tiempo hasta `delivered`', async () => {
    // El momento de creacion viaja DENTRO del numero, asi que el seguimiento es
    // una funcion pura de (numero, ahora): un test puede fabricar un envio
    // viejo y verlo entregado, sin esperar ni simular relojes.
    const viejo = _numeroSimuladoDe(ORDEN, new Date(Date.now() - 60 * 60_000));

    const [resultado] = await shipping.getTracking([viejo]);
    const estados = resultado?.events.map((e) => e.status);

    expect(estados).toEqual(['created', 'dispatched', 'in_transit', 'delivered']);
  });

  it('los eventos vienen del mas viejo al mas nuevo', async () => {
    const viejo = _numeroSimuladoDe(ORDEN, new Date(Date.now() - 60 * 60_000));
    const [resultado] = await shipping.getTracking([viejo]);

    const fechas = resultado!.events.map((e) => e.occurredAt.getTime());

    expect(fechas).toEqual([...fechas].sort((a, b) => a - b));
  });

  it('⚠️ conserva el codigo CRUDO del proveedor junto al estado mapeado', async () => {
    // El mapeo va a estar mal —el vocabulario no esta documentado y se descubre
    // a los golpes—, y el codigo crudo es lo unico que permite entender que
    // paso. El ERD ya reservo la columna: `provider_status` 🌐.
    const [resultado] = await shipping.getTracking([_numeroSimuladoDe(ORDEN, new Date())]);

    expect(resultado?.events[0]?.providerStatus).toBe('PRE');
  });

  it('un numero ajeno no inventa historia: devuelve vacio', async () => {
    const [resultado] = await shipping.getTracking(['12345MASIVO0005901']);

    expect(resultado?.events).toEqual([]);
  });
});

describe('rotulo y sucursales', () => {
  const shipping = createFakeShipping();

  it('⚠️ el rotulo dice que no sirve para despachar', async () => {
    // Un PDF falso con pinta de etiqueta real es peor que un texto que avisa.
    const rotulo = await shipping.getLabel('SIM-ABC-123456');

    expect(rotulo.content.toString('utf8')).toMatch(/NO sirve para despachar/);
  });

  it('las sucursales se piden por provincia', async () => {
    // El proveedor no ofrece listado global y la cobertura depende de la cuenta.
    const sucursales = await shipping.listAgencies('B');

    expect(sucursales[0]?.address.provinceCode).toBe('B');
  });
});
