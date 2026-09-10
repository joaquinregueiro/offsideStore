/* eslint-disable @typescript-eslint/require-await --
 * Los metodos son `async` AUNQUE NO ESPEREN NADA, y es deliberado.
 *
 * El puerto los tipa devolviendo `Promise`. Un metodo asi que lance de forma
 * SINCRONICA es una trampa: `shipping.quote(...).catch(...)` no atrapa el
 * error, porque nunca llega a haber una promesa. Con `async`, todo fallo sale
 * por el mismo canal y quien llama no necesita `try/catch` **y** `.catch`.
 *
 * El adaptador real si va a esperar (HTTP), asi que esto es una particularidad
 * del falso, no del diseño. Lo detecto un test: `rejects.toThrow` fallaba.
 */

import { createHash } from 'node:crypto';

import {
  ShippingError,
  type Agency,
  type CreateShipmentInput,
  type CreatedShipment,
  type QuoteInput,
  type ShipmentStatus,
  type ShippingLabel,
  type ShippingPort,
  type ShippingRate,
  type TrackingEvent,
  type TrackingResult,
} from './shipping.port';

/**
 * Adaptador FALSO de envios.
 *
 * =============================================================================
 * POR QUE EXISTE
 * =============================================================================
 *
 * Porque el adaptador real **no se puede escribir todavia**. Las credenciales de
 * Correo Argentino salen de un acuerdo comercial y el vocabulario de estados de
 * tracking no esta documentado en ningun manual: se descubre contra el ambiente
 * de test. Escribir el adaptador real ahora seria inventar el contrato.
 *
 * No es una concesion: `shipping.md` §3.2 lo pide con todas las letras —"poder
 * testear con un proveedor **fake** en el MVP"— y OQ-J1 recomienda arrancar
 * contra sandbox. Con esto el flujo llega a `DELIVERED`, que es donde hoy se
 * corta, sin depender de un tramite.
 *
 * =============================================================================
 * ⚠️ NUNCA EN PRODUCCION
 * =============================================================================
 *
 * Un envio falso que informa "entregado" es peor que no tener envios: cierra
 * ordenes que nunca se despacharon y destruye la evidencia con la que SH-002
 * resuelve las disputas de "producto no recibido". La fabrica (`index.ts`) lo
 * impide; este archivo ademas grita en cada operacion.
 */

/** Se escribe en todos los datos que produce, para que no se confundan. */
const MARCA = 'SIMULADO';

/**
 * Tarifas fijas.
 *
 * ⚠️ SON INVENTADAS Y ESTAN MARCADAS COMO TALES. Podrian aproximarse a las
 * reales, y seria peor: alguien las tomaria por buenas. Un numero redondo y un
 * `productName` que dice SIMULADO no engañan a nadie.
 */
const TARIFAS: { mode: 'home' | 'agency'; priceAmount: bigint }[] = [
  { mode: 'home', priceAmount: 500_000n },
  { mode: 'agency', priceAmount: 350_000n },
];

/** Cuanto vale una cotizacion. El proveedor real tambien las vence. */
const VALIDEZ_MINUTOS = 30;

/**
 * Cuanto tarda el envio simulado en pasar de una etapa a la siguiente.
 *
 * Corto a proposito: en desarrollo hay que poder ver una orden llegar a
 * `DELIVERED` sin esperar tres dias.
 */
const MINUTOS_POR_ETAPA = 2;

const ETAPAS: { status: ShipmentStatus; providerStatus: string; description: string }[] = [
  { status: 'created', providerStatus: 'PRE', description: `Envio registrado (${MARCA})` },
  { status: 'dispatched', providerStatus: 'IMP', description: `Despachado (${MARCA})` },
  { status: 'in_transit', providerStatus: 'TRA', description: `En transito (${MARCA})` },
  { status: 'delivered', providerStatus: 'ENT', description: `Entregado (${MARCA})` },
];

/**
 * El numero de seguimiento LLEVA ADENTRO el momento de creacion.
 *
 * ⚠️ ES LO QUE HACE AL FALSO UTIL Y DETERMINISTA A LA VEZ. `getTracking` es una
 * funcion pura de (numero, ahora): no necesita estado en memoria —que no
 * sobreviviria a un reinicio ni se compartiria entre procesos— ni una tabla
 * propia. Un test puede fabricar un numero con fecha pasada y observar el envio
 * ya entregado, sin esperar ni simular relojes.
 *
 * Formato: `SIM-<epoch ms en base36>-<6 hex del orderId>`.
 */
function numeroDeSeguimiento(orderId: string, creadoEn: Date): string {
  const sufijo = createHash('sha256').update(orderId).digest('hex').slice(0, 6).toUpperCase();

  return `SIM-${creadoEn.getTime().toString(36).toUpperCase()}-${sufijo}`;
}

/** Devuelve el momento de creacion escondido en el numero, o `null`. */
function creacionDe(trackingNumber: string): Date | null {
  const partes = trackingNumber.split('-');
  if (partes.length !== 3 || partes[0] !== 'SIM') return null;

  const ms = Number.parseInt(partes[1]!, 36);

  return Number.isNaN(ms) ? null : new Date(ms);
}

function aviso(operacion: string): void {
  console.warn(
    `[shipping] ⚠️ adaptador SIMULADO: "${operacion}" no toca Correo Argentino. ` +
      'Los datos son inventados.',
  );
}

export function createFakeShipping(): ShippingPort {
  return {
    name: 'fake',

    async quote(input: QuoteInput): Promise<ShippingRate[]> {
      aviso('quote');

      // Se validan los limites REALES del proveedor aunque no haya proveedor.
      // Si el falso aceptara cualquier cosa, el dia que entre el adaptador real
      // aparecerian rechazos que en desarrollo nunca se vieron.
      if (input.package.weightGrams < 1 || input.package.weightGrams > 25_000) {
        throw new ShippingError(
          'rejected',
          `Peso fuera de rango: ${input.package.weightGrams}g. El maximo es 25000g.`,
        );
      }

      const excedida = [input.package.heightCm, input.package.widthCm, input.package.lengthCm].some(
        (cm) => cm > 150 || cm <= 0,
      );

      if (excedida) {
        throw new ShippingError('rejected', 'Cada dimension tiene que estar entre 1 y 150 cm.');
      }

      const validUntil = new Date(Date.now() + VALIDEZ_MINUTOS * 60_000);

      return TARIFAS.filter((t) => input.mode === undefined || t.mode === input.mode).map(
        (tarifa) => ({
          mode: tarifa.mode,
          productCode: 'CP',
          productName: `Paq.ar Clásico (${MARCA})`,
          priceAmount: tarifa.priceAmount,
          currency: 'ARS',
          validUntil,
        }),
      );
    },

    async createShipment(input: CreateShipmentInput): Promise<CreatedShipment> {
      aviso('createShipment');

      if (input.mode === 'agency' && (input.agencyCode ?? '') === '') {
        // El proveedor real tambien lo rechaza: "Verifique la sucursal de
        // destino". Reproducirlo evita que el error aparezca recien en produccion.
        throw new ShippingError(
          'rejected',
          'Un envio a sucursal necesita el codigo de sucursal de destino.',
        );
      }

      const creadoEn = new Date();
      const trackingNumber = numeroDeSeguimiento(input.orderId, creadoEn);

      return {
        trackingNumber,
        labelRef: trackingNumber,
        raw: { simulado: true, creadoEn: creadoEn.toISOString(), orderId: input.orderId },
      };
    },

    async getLabel(labelRef: string): Promise<ShippingLabel> {
      aviso('getLabel');

      // Texto plano, no un PDF falso: un archivo que se abre como etiqueta y no
      // sirve para despachar es mas confuso que uno que dice lo que es.
      const contenido =
        `ROTULO ${MARCA}\n` +
        `Seguimiento: ${labelRef}\n\n` +
        'Este rotulo NO sirve para despachar. Lo genero el adaptador simulado ' +
        'porque todavia no hay integracion con Correo Argentino.\n';

      return {
        content: Buffer.from(contenido, 'utf8'),
        contentType: 'text/plain; charset=utf-8',
        format: '10x15',
      };
    },

    async getTracking(trackingNumbers: string[]): Promise<TrackingResult[]> {
      aviso('getTracking');

      const ahora = Date.now();

      return trackingNumbers.map((trackingNumber) => {
        const creadoEn = creacionDe(trackingNumber);

        // Un numero que no genero este adaptador no tiene historia. Devolver
        // eventos inventados para el seria peor que devolver ninguno.
        if (creadoEn === null) return { trackingNumber, events: [] };

        const transcurridos = (ahora - creadoEn.getTime()) / 60_000;
        const alcanzadas = Math.min(
          ETAPAS.length,
          Math.floor(transcurridos / MINUTOS_POR_ETAPA) + 1,
        );

        const events: TrackingEvent[] = ETAPAS.slice(0, Math.max(1, alcanzadas)).map(
          (etapa, i) => ({
            status: etapa.status,
            providerStatus: etapa.providerStatus,
            description: etapa.description,
            occurredAt: new Date(creadoEn.getTime() + i * MINUTOS_POR_ETAPA * 60_000),
            raw: { simulado: true, etapa: i },
          }),
        );

        return { trackingNumber, events };
      });
    },

    async listAgencies(provinceCode: string): Promise<Agency[]> {
      aviso('listAgencies');

      return [
        {
          code: `${provinceCode}0001`,
          name: `Sucursal ${MARCA} ${provinceCode}`,
          address: {
            streetName: 'Calle Simulada',
            streetNumber: '100',
            city: 'Ciudad Simulada',
            provinceCode,
            postalCode: '1000',
          },
          latitude: null,
          longitude: null,
        },
      ];
    },
  };
}

/** Sólo para tests: arma un numero con una fecha de creacion elegida. */
export function _numeroSimuladoDe(orderId: string, creadoEn: Date): string {
  return numeroDeSeguimiento(orderId, creadoEn);
}
