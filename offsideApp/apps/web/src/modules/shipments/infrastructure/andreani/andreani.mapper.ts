/**
 * Traduccion entre el dominio de Offside y la API PyME de Andreani.
 *
 * ⚠️ DE DONDE SALE ESTE CONTRATO. Andreani tiene dos APIs. La corporativa
 * (developers.andreani.com) esta documentada pero sus credenciales las da un
 * ejecutivo comercial. La PyME es la que usa el plugin OFICIAL de Andreani para
 * WooCommerce (wordpress.org/plugins/andreani-shipping, codigo GPL publico), y
 * se habilita sola desde andreani.com > Integraciones. Los nombres de campos,
 * los endpoints y el envoltorio `{ response: … }` de aca estan copiados de ese
 * plugin, version 1.6.4: no hay otra documentacion. Si Andreani cambia el
 * backend del plugin, cambia esto.
 *
 * ⚠️ TODO ES PURO: nada de red ni de reloj. La red vive en `andreani.client.ts`
 * y el reloj lo pasa quien llama. Asi cada regla se prueba con un objeto.
 */
import type {
  CreateShipmentInput,
  DeliveryMode,
  PackageInfo,
  QuoteInput,
  ShipmentLookup,
  ShipmentStatus,
  ShippingRate,
} from '../shipping/shipping.port';
import { ShippingError } from '../shipping/shipping.port';

/** Un contrato de la cuenta, tal como lo devuelve el login. */
export interface ContratoAndreani {
  id: string;
  modo: DeliveryMode;
  /** Nombre crudo ("A domicilio", "A sucursal"). Se conserva para mostrar. */
  nombre: string;
}

export interface SesionAndreani {
  accessToken: string;
  contratos: ContratoAndreani[];
}

/** Lo que el plugin manda en `products`: un bulto por elemento. */
interface ProductoAndreani {
  price: number;
  quantity: number;
  kgrams: number;
  width: number;
  depth: number;
  height: number;
}

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function texto(valor: unknown): string | null {
  if (typeof valor === 'string') return valor.trim() === '' ? null : valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);

  return null;
}

/**
 * Saca el cuerpo util de una respuesta.
 *
 * ⚠️ LA API ENVUELVE TODO EN `{ response: … }`, y no siempre: la busqueda de
 * envios a veces devuelve el arreglo pelado. El plugin hace exactamente esto
 * —"si trae `response`, ese; si no, el cuerpo"— y se copia tal cual.
 */
export function desenvolver(cuerpo: unknown): unknown {
  const o = objeto(cuerpo);

  return o !== null && 'response' in o ? o.response : cuerpo;
}

/** Centavos → pesos con dos decimales, que es lo que espera la API. */
export function aPesos(centavos: bigint): number {
  return Number(centavos) / 100;
}

/**
 * Pesos → centavos.
 *
 * ⚠️ EL FLOAT NO CRUZA ESTA FUNCION. La API devuelve `total` decimal (a veces
 * como string) y el dominio guarda `bigint` en centavos (ERD §1). El redondeo
 * se hace una sola vez, aca, sobre el valor ya multiplicado.
 */
export function aCentavos(pesos: unknown): bigint {
  const n = typeof pesos === 'string' ? Number(pesos.replace(',', '.')) : Number(pesos);
  if (!Number.isFinite(n) || n < 0) {
    throw new ShippingError(
      'rejected',
      `Andreani devolvio un importe que no es un numero: ${String(pesos)}`,
    );
  }

  return BigInt(Math.round(n * 100));
}

/**
 * El modo de entrega de un contrato.
 *
 * ⚠️ "LLEGA HOY" Y "BIGGER" QUEDAN AFUERA A PROPOSITO. "Llega hoy" es un
 * servicio de AMBA con hora de corte —despachando antes de las 12— que una
 * camiseta vendida a las 15 no puede cumplir; y "Bigger" es para bultos de mas
 * de 50 kg. Ofrecerlos seria prometer lo que el vendedor no va a poder hacer.
 */
export function modoDeContrato(nombre: string, tipoDeEnvio: string | null): DeliveryMode | null {
  if ((tipoDeEnvio ?? '').toLowerCase() === 'bigger') return null;

  const n = nombre.toLowerCase();
  if (n.includes('llega hoy')) return null;
  if (n.includes('sucursal')) return 'agency';
  if (n.includes('domicilio') || n.includes('estándar') || n.includes('estandar')) return 'home';

  return null;
}

/** El login: token y contratos utilizables. */
export function leerSesion(cuerpo: unknown): SesionAndreani {
  const datos = objeto(desenvolver(cuerpo));
  const accessToken = texto(datos?.accessToken);

  if (datos === null || accessToken === null) {
    throw new ShippingError(
      'not_configured',
      'Andreani no devolvio una sesion. Revisa que la credencial sea la de Integraciones > WooCommerce.',
    );
  }

  const crudos = Array.isArray(datos.contratos) ? datos.contratos : [];
  const contratos: ContratoAndreani[] = [];

  for (const crudo of crudos) {
    const c = objeto(crudo);
    const id = texto(c?.id);
    const nombre = texto(c?.modoDeEntregaNombre);
    if (c === null || id === null || nombre === null) continue;

    const modo = modoDeContrato(nombre, texto(c.tipoDeEnvioNombre));
    if (modo !== null) contratos.push({ id, modo, nombre });
  }

  return { accessToken, contratos };
}

export function contratoPara(sesion: SesionAndreani, modo: DeliveryMode): ContratoAndreani {
  const contrato = sesion.contratos.find((c) => c.modo === modo);

  if (contrato === undefined) {
    throw new ShippingError(
      'unsupported',
      modo === 'agency'
        ? 'La cuenta de Andreani no tiene habilitado el envio a sucursal.'
        : 'La cuenta de Andreani no tiene habilitado el envio a domicilio.',
    );
  }

  return contrato;
}

/**
 * El paquete como lo pide la API: un solo bulto, en kilos y centimetros.
 *
 * ⚠️ `depth` ES EL LARGO. El plugin manda `width`, `depth` y `height`; nuestro
 * paquete dice ancho, largo y alto. Cruzarlos no rompe nada visible y cotiza
 * otro volumen, asi que la correspondencia queda escrita aca y en un test.
 */
export function aProductos(paquete: PackageInfo, valorDeclarado: bigint): ProductoAndreani[] {
  return [
    {
      price: aPesos(valorDeclarado),
      quantity: 1,
      kgrams: paquete.weightGrams / 1000,
      width: paquete.widthCm,
      depth: paquete.lengthCm,
      height: paquete.heightCm,
    },
  ];
}

/** Solo digitos: la API rechaza los CP con letras del formato CPA ("C1425ABC"). */
export function normalizarCodigoPostal(cp: string): string {
  const cuatro = /\d{4}/.exec(cp);

  return cuatro === null ? cp.trim() : cuatro[0];
}

export function cuerpoDeCotizacion(input: QuoteInput) {
  return {
    postal_code_origin: normalizarCodigoPostal(input.originPostalCode),
    postal_code_destination: normalizarCodigoPostal(input.destinationPostalCode),
    products: aProductos(input.package, input.declaredValueAmount ?? 0n),
  };
}

/**
 * Las tarifas de la respuesta.
 *
 * ⚠️ `validUntil` ES NUESTRO, NO DE ANDREANI. La API PyME no dice hasta cuando
 * vale el precio. Se le da una hora: alcanza para que el vendedor confirme el
 * envio que acaba de cotizar, y es corto como para no prometer una tarifa vieja.
 */
export function leerTarifas(cuerpo: unknown, ahora: Date, modo?: DeliveryMode): ShippingRate[] {
  const datos = objeto(desenvolver(cuerpo));
  const crudas = Array.isArray(datos?.rates) ? datos.rates : [];
  const validUntil = new Date(ahora.getTime() + 60 * 60_000);
  const tarifas: ShippingRate[] = [];

  for (const cruda of crudas) {
    const r = objeto(cruda);
    const codigo = texto(r?.code);
    if (r === null || codigo === null || r.total === undefined) continue;

    const modoTarifa = modoDeContrato(codigo, null);
    if (modoTarifa === null || (modo !== undefined && modoTarifa !== modo)) continue;

    tarifas.push({
      mode: modoTarifa,
      productCode: codigo,
      productName: `Andreani ${codigo}`,
      priceAmount: aCentavos(r.total),
      currency: 'ARS',
      validUntil,
    });
  }

  return tarifas;
}

/**
 * Parte "Juan Martin Perez" en nombre y apellido.
 *
 * ⚠️ EL APELLIDO ES LA ULTIMA PALABRA, y no hay una regla mejor sin preguntar.
 * La API los pide separados y la libreta de direcciones los guarda juntos. Con
 * una sola palabra se rechaza: la etiqueta sale con lo que se mande, y un
 * destinatario sin apellido es un envio que la sucursal puede no entregar.
 */
export function partirNombre(completo: string): { nombre: string; apellido: string } {
  const partes = completo.trim().split(/\s+/).filter(Boolean);

  if (partes.length < 2) {
    throw new ShippingError(
      'rejected',
      'El destinatario necesita nombre y apellido. La dirección de la compra tiene uno solo.',
    );
  }

  return { nombre: partes.slice(0, -1).join(' '), apellido: partes.at(-1)! };
}

export function cuerpoDeAlta(
  input: CreateShipmentInput,
  sesion: SesionAndreani,
  emailDelVendedor: string,
) {
  const contrato = contratoPara(sesion, input.mode);
  const { nombre, apellido } = partirNombre(input.recipientName);
  const telefono = (input.recipientPhone ?? '').replace(/[^\d+]/g, '');

  if (telefono.length < 6) {
    throw new ShippingError(
      'rejected',
      'Andreani exige un teléfono del destinatario y la compra no tiene uno válido.',
    );
  }

  if (input.mode === 'agency' && (input.agencyCode ?? '') === '') {
    throw new ShippingError('rejected', 'Un envío a sucursal necesita la sucursal de destino.');
  }

  const piso = [input.destination.floor, input.destination.apartment].filter(Boolean).join(' ');

  return {
    contract: { id_contract: contrato.id },
    price_shipment: aPesos(input.shippingChargedAmount ?? 0n),
    origin: { postal_code: normalizarCodigoPostal(input.origin.postalCode) },
    destination: {
      street: input.destination.streetName,
      number: input.destination.streetNumber,
      floor: piso,
      postal_code: normalizarCodigoPostal(input.destination.postalCode),
      locality: input.destination.city,
      code_branch: input.mode === 'agency' ? input.agencyCode : '',
    },
    recipient: {
      name: nombre,
      last_name: apellido,
      phone_number: telefono,
      dni: (input.recipientDocument ?? '').replace(/\D/g, ''),
      email: input.recipientEmail,
    },
    products: aProductos(input.package, input.declaredValueAmount),
    email_merchant: emailDelVendedor,
    remito: input.reference,
  };
}

/** El id de pedido que devuelve el alta. En PyME NO es el numero de seguimiento. */
export function leerAlta(cuerpo: unknown): { pedidoId: string; numeroInterno: string | null } {
  const datos = objeto(desenvolver(cuerpo));
  const pedidoId = texto(datos?.pedidoId);

  if (datos === null || pedidoId === null) {
    throw new ShippingError('rejected', 'Andreani aceptó el pedido pero no devolvió su número.');
  }

  return { pedidoId, numeroInterno: texto(datos.numeroInterno) };
}

/**
 * El estado de Offside que corresponde a un estado crudo de Andreani.
 *
 * ⚠️ EL VOCABULARIO NO ESTA DOCUMENTADO. Lo unico seguro, por el plugin, es
 * que "Entregado" es terminal y que "No entregado" NO lo es —puede volver a
 * "Entregado" en otra visita—. Lo demas se infiere por palabras y por eso el
 * crudo se guarda SIEMPRE: cuando el mapeo se equivoque, la evidencia queda.
 *
 * ⚠️ SIN NUMERO DE SEGUIMIENTO ES `created` SIEMPRE, diga lo que diga el
 * estado. En la cuenta PyME el numero aparece cuando se PAGA el envio; antes de
 * eso no hay paquete en ningun lado y nada puede estar "en camino".
 */
export function estadoDeOffside(crudo: string | null, conSeguimiento: boolean): ShipmentStatus {
  if (!conSeguimiento) return 'created';

  const e = (crudo ?? '').toLowerCase();
  if (e === '') return 'created';
  if (/no\s+entregad/.test(e) || /siniestr|extravi|robad/.test(e)) return 'delivery_issue';
  if (e.includes('entregad')) return 'delivered';
  if (/devuel|devoluci|retorn/.test(e)) return 'returned';
  if (/pendiente|por\s+ingresar|generad|cread|pago|preimpos/.test(e)) return 'created';

  return 'in_transit';
}

/** La busqueda por referencias (`remito`), con el estado ya traducido. */
export function leerBusqueda(cuerpo: unknown, referencias: string[]): ShipmentLookup[] {
  const datos = desenvolver(cuerpo);
  const lista = Array.isArray(datos) ? datos : [];
  const porReferencia = new Map<string, Record<string, unknown>>();

  for (const item of lista) {
    const o = objeto(item);
    const ref = texto(o?.salesOrderNumber);
    if (o !== null && ref !== null) porReferencia.set(ref, o);
  }

  return referencias.map((reference) => {
    const o = porReferencia.get(reference);
    const trackingNumber = texto(o?.trackingNumber);
    const providerStatus = texto(o?.trackingStatus);

    return {
      reference,
      trackingNumber,
      providerStatus,
      status: estadoDeOffside(providerStatus, trackingNumber !== null),
      raw: o ?? null,
    };
  });
}

/** El mensaje de error de una respuesta fallida, como lo extrae el plugin. */
export function mensajeDeError(cuerpo: unknown): string | null {
  const o = objeto(cuerpo);
  if (o === null) return null;

  return texto(o.message) ?? texto(objeto(o.error)?.message) ?? texto(o.title) ?? null;
}
