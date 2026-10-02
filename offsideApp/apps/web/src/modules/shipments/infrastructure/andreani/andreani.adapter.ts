import type {
  Agency,
  CreateShipmentInput,
  CreatedShipment,
  QuoteInput,
  ShipmentLookup,
  ShipmentQuery,
  ShippingLabel,
  ShippingPort,
  ShippingRate,
  TrackingResult,
} from '../shipping/shipping.port';
import { ShippingError } from '../shipping/shipping.port';
import { crearClienteAndreani, type ClienteAndreani } from './andreani.client';
import {
  cuerpoDeAlta,
  cuerpoDeCotizacion,
  leerAlta,
  leerBusqueda,
  leerTarifas,
} from './andreani.mapper';

/**
 * Adaptador de envios sobre la API PyME de Andreani.
 *
 * ⚠️ EN LA CUENTA PYME EL ENVIO NO SALE SOLO, y es lo primero que hay que saber.
 * El alta crea un pedido "por pagar": recien cuando la cuenta lo PAGA en el
 * portal de Andreani PyMEs (pymes.andreani.com/ver-envios) Andreani le asigna
 * numero de seguimiento y el paquete se puede despachar. El plugin oficial tiene
 * un boton "Pagar" que lleva a ese portal por la misma razon: la API no cobra.
 * Lo que este adaptador automatiza es todo lo demas —cotizar, dar de alta con
 * los datos de la compra, enterarse del numero cuando aparece, seguir el estado
 * y bajar la etiqueta—.
 *
 * ⚠️ EL ESTADO SE CONSULTA POR REFERENCIA, NO POR NUMERO. Como el alta no
 * devuelve seguimiento, `getTracking` no sirve hasta que el envio se pague; el
 * camino es `lookupShipments`, que pregunta por el `remito` con que se dio de
 * alta y trae numero y estado juntos.
 */
export function createAndreaniShipping(
  credencial: string,
  cliente: ClienteAndreani = crearClienteAndreani(credencial),
): ShippingPort {
  return {
    name: 'andreani',

    async quote(input: QuoteInput): Promise<ShippingRate[]> {
      const { json } = await cliente.pedir('POST', '/api/v1/Pyme/rates', cuerpoDeCotizacion(input));

      return leerTarifas(json, new Date(), input.mode);
    },

    async createShipment(input: CreateShipmentInput): Promise<CreatedShipment> {
      const sesion = await cliente.sesion();
      const cuerpo = cuerpoDeAlta(input, sesion, input.senderEmail ?? input.recipientEmail);
      const { json } = await cliente.pedir('POST', '/api/v1/Pyme/ShippingRegistration', cuerpo);
      const { pedidoId, numeroInterno } = leerAlta(json);

      return {
        trackingNumber: null,
        labelRef: input.reference,
        raw: { pedidoId, numeroInterno, respuesta: json },
      };
    },

    async getLabel(trackingNumber: string): Promise<ShippingLabel> {
      const { bytes } = await cliente.pedir(
        'POST',
        '/api/v1/Pyme/ticket',
        { trackingNumbers: [trackingNumber] },
        { binario: true },
      );

      if (bytes === null || bytes.length === 0) {
        throw new ShippingError('rejected', 'Andreani no devolvió la etiqueta.');
      }

      return { content: bytes, contentType: 'application/pdf', format: 'pdf' };
    },

    getTracking(): Promise<TrackingResult[]> {
      // No hay un endpoint de trazas por numero en la API PyME publica del plugin.
      return Promise.reject(
        new ShippingError(
          'unsupported',
          'Andreani PyME se sigue por referencia: usá lookupShipments.',
        ),
      );
    },

    async lookupShipments(consultas: ShipmentQuery[]): Promise<ShipmentLookup[]> {
      // Se busca por referencia: en la cuenta PyME el numero no existe hasta
      // que se paga el envio.
      const references = consultas.map((c) => c.reference);
      const resultado: ShipmentLookup[] = [];

      // La API acepta hasta 100 referencias por pedido (`MAX_BULK_IDENTIFIERS`).
      for (let i = 0; i < references.length; i += 100) {
        const lote = references.slice(i, i + 100);
        const { json } = await cliente.pedir('POST', '/api/v1/Shipments/ByOrderNumbers', {
          salesOrderNumbers: lote,
        });
        resultado.push(...leerBusqueda(json, lote));
      }

      return resultado;
    },

    listAgencies(): Promise<Agency[]> {
      // La API PyME busca sucursales por codigo postal, no por provincia: el
      // envio a sucursal llega cuando el checkout ofrezca elegir una.
      return Promise.reject(
        new ShippingError(
          'unsupported',
          'La búsqueda de sucursales de Andreani va por código postal.',
        ),
      );
    },
  };
}
