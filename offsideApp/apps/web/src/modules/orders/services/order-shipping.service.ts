import type { PublicUser } from '../../auth/services/auth.service';
import {
  getDefaultAddress,
  toShippingSnapshot,
  type ShippingAddressSnapshot,
} from '../../addresses/services/address.service';
import { requireOwnSellerProfile } from '../../sellers/services/seller.service';
import {
  createShipping,
  envioAutomaticoDisponible,
  proveedorActivo,
  ShippingError,
  type PackageInfo,
  type ShipmentStatus,
  type ShippingAddress,
} from '../../shipments/infrastructure/shipping';
import * as shipmentRepo from '../../shipments/repositories/shipment.repository';
import * as shipmentErrors from '../../shipments/shipments.errors';
import * as errors from '../orders.errors';
import * as orderRepo from '../repositories/order.repository';
import { registrarMovimientoDelTransportista } from './order.service';

/**
 * DESPACHO AUTOMATICO — el vendedor declara el paquete y Offside da de alta el
 * envio en el transportista con los datos de la compra.
 *
 * ⚠️ VIVE EN `orders` Y NO EN `shipments`, por la direccion de las
 * dependencias: necesita la orden, el vendedor y la maquina de estados, y
 * `orders` ya depende de `shipments` (el despacho manual). Si `shipments`
 * importara `orders` habria un ciclo.
 *
 * ⚠️ LA CUENTA DEL TRANSPORTISTA ES LA DE OFFSIDE. Con Andreani PyME, cada
 * alta queda "por pagar" en el portal de Andreani PyMEs de esa cuenta, y el
 * numero de seguimiento aparece recien cuando se paga. Lo que pago el comprador
 * por el envio, en cambio, le llega al VENDEDOR por el split de Mercado Pago.
 * Esa diferencia es una decision de negocio pendiente y no se resuelve aca.
 */

/** Paquete por defecto: una camiseta doblada en una bolsa de envio. */
export const PAQUETE_SUGERIDO: PackageInfo = {
  weightGrams: 500,
  heightCm: 5,
  widthCm: 25,
  lengthCm: 35,
};

/**
 * Limites del servicio comun de Andreani. Arriba de esto es "Bigger", que
 * necesita otro contrato. Salen del plugin oficial (`Andreani_Api_Config`).
 */
const PESO_MAXIMO_GRAMOS = 50_000;
const LADO_MAXIMO_CM = 165;
const SUMA_MAXIMA_CM = 300;

/**
 * ISO 3166-2:AR. Es el mismo codigo de una letra que usa Correo Argentino, y
 * el que el puerto de envios espera. La libreta guarda el NOMBRE.
 */
const PROVINCIAS: Record<string, string> = {
  'buenos aires': 'B',
  'ciudad autonoma de buenos aires': 'C',
  caba: 'C',
  'capital federal': 'C',
  catamarca: 'K',
  chaco: 'H',
  chubut: 'U',
  cordoba: 'X',
  corrientes: 'W',
  'entre rios': 'E',
  formosa: 'P',
  jujuy: 'Y',
  'la pampa': 'L',
  'la rioja': 'F',
  mendoza: 'M',
  misiones: 'N',
  neuquen: 'Q',
  'rio negro': 'R',
  salta: 'A',
  'san juan': 'J',
  'san luis': 'D',
  'santa cruz': 'Z',
  'santa fe': 'S',
  'santiago del estero': 'G',
  'tierra del fuego': 'V',
  tucuman: 'T',
};

function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function aDireccion(snapshot: ShippingAddressSnapshot): ShippingAddress {
  return {
    streetName: snapshot.calle,
    // La API exige altura. "S/N" es como lo escribe el propio correo.
    streetNumber: snapshot.numero ?? 'S/N',
    ...(snapshot.departamento === null ? {} : { apartment: snapshot.departamento }),
    city: snapshot.ciudad,
    provinceCode: PROVINCIAS[sinAcentos(snapshot.provincia)] ?? '',
    postalCode: snapshot.codigoPostal,
  };
}

/**
 * Valida el paquete ANTES de llamar al transportista. Un rechazo remoto cuesta
 * un viaje y deja un mensaje peor que este.
 */
export function validarPaquete(paquete: PackageInfo): void {
  const lados = [paquete.heightCm, paquete.widthCm, paquete.lengthCm];

  if (!Number.isFinite(paquete.weightGrams) || paquete.weightGrams < 1) {
    throw shipmentErrors.packageOutOfRange('Indicá el peso del paquete.');
  }
  if (paquete.weightGrams > PESO_MAXIMO_GRAMOS) {
    throw shipmentErrors.packageOutOfRange('El paquete no puede pesar más de 50 kg.');
  }
  if (lados.some((cm) => !Number.isFinite(cm) || cm < 1)) {
    throw shipmentErrors.packageOutOfRange(
      'Indicá alto, ancho y largo del paquete, en centímetros.',
    );
  }
  if (lados.some((cm) => cm > LADO_MAXIMO_CM)) {
    throw shipmentErrors.packageOutOfRange('Ningún lado del paquete puede superar 165 cm.');
  }
  if (lados.reduce((a, b) => a + b, 0) > SUMA_MAXIMA_CM) {
    throw shipmentErrors.packageOutOfRange(
      'La suma de alto, ancho y largo no puede superar 300 cm.',
    );
  }
}

function descripcionDeAlta(proveedor: string, conSeguimiento: boolean): string {
  if (proveedor !== 'andreani') return 'Envío generado (simulado)';

  return conSeguimiento
    ? 'Envío generado en Andreani'
    : 'Envío generado en Andreani. Pendiente de pago en la cuenta de Offside';
}

/**
 * Da de alta el envio de una venta en el transportista.
 *
 * ⚠️ LA FILA SE RESERVA ANTES DE LLAMAR. El indice unico de `shipments` por
 * orden es lo que impide que un doble clic de de alta DOS envios reales: el
 * segundo choca contra la reserva del primero. Si el transportista rechaza el
 * pedido, la reserva se libera para poder corregir y reintentar.
 *
 * ⚠️ SI NO HAY RESPUESTA, LA RESERVA QUEDA. Un timeout no dice que el alta no
 * se hizo: el envio puede existir en Andreani. Borrar la reserva invitaria a
 * reintentar y duplicarlo; dejarla hace que la sincronizacion lo encuentre por
 * su referencia. Es lo mismo que hace el plugin oficial: sin reintento
 * automatico del alta.
 */
export async function despacharAutomatico(
  user: PublicUser,
  orderId: string,
  paquete: PackageInfo,
): Promise<shipmentRepo.ShipmentRow> {
  if (!envioAutomaticoDisponible()) throw shipmentErrors.automaticShippingUnavailable();

  const seller = await requireOwnSellerProfile(user);
  const order = await orderRepo.findById(orderId);
  if (order?.sellerId !== seller.id) throw errors.orderNotFound();
  if (order.status !== 'PROCESSING') throw errors.orderInvalidTransition('generar el envío de');

  validarPaquete(paquete);

  if ((await shipmentRepo.findByOrderId(order.id)) !== undefined) {
    throw shipmentErrors.shipmentAlreadyExists();
  }

  const origen = await getDefaultAddress(user);
  if (origen === null) throw shipmentErrors.originMissing();

  const destino = order.shippingAddress as ShippingAddressSnapshot;
  const comprador = await orderRepo.findBuyerContact(order.buyerId);
  const proveedor = proveedorActivo();

  let reserva: shipmentRepo.ShipmentRow;
  try {
    reserva = await shipmentRepo.insert({
      orderId: order.id,
      provider: proveedor,
      status: 'created',
      trackingNumber: null,
      labelRef: order.orderNumber,
      origin: toShippingSnapshot(origen),
      destination: order.shippingAddress,
      packageInfo: paquete,
      currency: order.currency,
      raw: { estado: 'solicitando' },
      dispatchedAt: null,
    });
  } catch {
    // Otro pedido gano la carrera por el indice unico: ya hay un envio.
    throw shipmentErrors.shipmentAlreadyExists();
  }

  try {
    const alta = await createShipping().createShipment({
      orderId: order.id,
      reference: order.orderNumber,
      mode: 'home',
      origin: aDireccion(toShippingSnapshot(origen)),
      destination: aDireccion(destino),
      recipientName: destino.nombre,
      recipientEmail: comprador?.email ?? '',
      recipientPhone: destino.telefono ?? comprador?.phone ?? '',
      package: paquete,
      declaredValueAmount: order.productAmount,
      shippingChargedAmount: order.shippingAmount ?? 0n,
      senderEmail: user.email,
      currency: order.currency,
    });

    const actualizado = await shipmentRepo.updateFromProvider(reserva.id, {
      trackingNumber: alta.trackingNumber,
      labelRef: alta.labelRef ?? order.orderNumber,
      raw: { estado: 'creado', proveedor: alta.raw },
    });

    await shipmentRepo.appendTrackingEvent({
      shipmentId: reserva.id,
      status: 'created',
      providerStatus: null,
      description: descripcionDeAlta(proveedor, alta.trackingNumber !== null),
      occurredAt: new Date(),
      raw: null,
    });

    return actualizado ?? reserva;
  } catch (error) {
    if (error instanceof ShippingError && error.failure === 'unreachable') {
      await shipmentRepo.updateFromProvider(reserva.id, {
        raw: { estado: 'incierto', motivo: error.message },
      });
      throw shipmentErrors.providerRejected(
        'Andreani no respondió a tiempo. Puede que el envío se haya generado igual: lo vamos a verificar solos en unos minutos. No lo vuelvas a generar.',
      );
    }

    await shipmentRepo.deleteReservation(reserva.id);

    if (error instanceof ShippingError) throw shipmentErrors.providerRejected(error.message);
    throw error;
  }
}

/** Que estados del transportista significan que el paquete ya salio. */
const EN_CAMINO: readonly ShipmentStatus[] = [
  'dispatched',
  'in_transit',
  'delivery_issue',
  'delivered',
  'returned',
];

/**
 * Trae del transportista el numero y el estado de los envios automaticos que
 * todavia pueden cambiar, y mueve las ordenes en consecuencia.
 *
 * ⚠️ NUNCA LANZA. Corre en un job: un fallo de red con Andreani no puede
 * romper el worker ni frenar los otros jobs. Se loguea y se reintenta en la
 * proxima vuelta, que es exactamente lo que hace falta.
 *
 * `soloOrdenes` acota el barrido a esas ordenes. ⚠️ Lo usan los tests de
 * integracion, que corren contra la base del `.env`: sin acotarlo, un barrido
 * con el reloj adelantado movia las ventas de desarrollo y les escribia fechas
 * en el futuro.
 *
 * @returns cuantos envios cambiaron.
 */
export async function sincronizarEnvios({
  limite = 200,
  soloOrdenes,
}: { limite?: number; soloOrdenes?: string[] } = {}): Promise<number> {
  if (!envioAutomaticoDisponible()) return 0;

  const proveedor = proveedorActivo();
  const pendientes = await shipmentRepo.findForSync(proveedor, limite, soloOrdenes);
  if (pendientes.length === 0) return 0;

  /*
   * ⚠️ SE BUSCA POR EL NUMERO DE ORDEN, NO POR `labelRef`. El numero de orden es
   * la referencia que se mando en el alta; `labelRef` es lo que cada proveedor
   * necesita para imprimir, y no tiene por que coincidir. Coincidia en Andreani
   * y no en el simulado —ahi es el numero de seguimiento—, asi que el barrido
   * no encontraba nunca un envio simulado y nadie lo veia fallar.
   */
  const referencias = await orderRepo.findOrderNumbers(pendientes.map((envio) => envio.orderId));

  let resultados;
  try {
    resultados = await createShipping().lookupShipments(
      pendientes.flatMap((envio) => {
        const reference = referencias.get(envio.orderId);

        return reference === undefined ? [] : [{ reference, trackingNumber: envio.trackingNumber }];
      }),
    );
  } catch (error) {
    console.error(
      '[envios] no se pudo consultar al transportista:',
      error instanceof Error ? error.message : String(error),
    );

    return 0;
  }

  let cambiados = 0;

  for (const envio of pendientes) {
    const dato = resultados.find((r) => r.reference === referencias.get(envio.orderId));
    if (dato === undefined) continue;

    const nuevoNumero = dato.trackingNumber ?? envio.trackingNumber;
    const cambioNumero = nuevoNumero !== envio.trackingNumber;
    const cambioEstado = dato.status !== envio.status;
    if (!cambioNumero && !cambioEstado) continue;

    try {
      const ahora = new Date();

      await shipmentRepo.updateFromProvider(envio.id, {
        trackingNumber: nuevoNumero,
        status: dato.status,
        ...(EN_CAMINO.includes(dato.status) && envio.dispatchedAt === null
          ? { dispatchedAt: ahora }
          : {}),
        ...(dato.status === 'delivered' && envio.deliveredAt === null
          ? { deliveredAt: ahora }
          : {}),
      });

      await shipmentRepo.appendTrackingEvent({
        shipmentId: envio.id,
        status: dato.status,
        providerStatus: dato.providerStatus,
        description:
          cambioNumero && !cambioEstado
            ? `Andreani asignó el número de seguimiento ${nuevoNumero ?? ''}`
            : (dato.providerStatus ?? 'Actualización del transportista'),
        occurredAt: ahora,
        raw: dato.raw === null ? null : { proveedor: dato.raw },
      });

      // Primero se despacha y despues se entrega: si el primer dato que llega
      // ya es "Entregado", la orden pasa por los dos estados en orden.
      if (EN_CAMINO.includes(dato.status)) {
        await registrarMovimientoDelTransportista(
          envio.orderId,
          'SHIPPED',
          `En camino con Andreani, seguimiento ${nuevoNumero ?? 'pendiente'}`,
          ahora,
        );
      }
      if (dato.status === 'delivered') {
        await registrarMovimientoDelTransportista(
          envio.orderId,
          'DELIVERED',
          'Andreani informó la entrega',
          ahora,
        );
      }

      cambiados += 1;
    } catch (error) {
      console.error(
        `[envios] no se pudo actualizar el envio ${envio.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return cambiados;
}
