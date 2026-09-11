import * as errors from '../addresses.errors';

/**
 * Validacion de una direccion de envio argentina. FUNCIONES PURAS: sin base,
 * sin sesion. Es lo que se testea unitario.
 *
 * Alcance: Argentina. `user_addresses.country_id` es FK a `countries` con
 * "default AR" (ERD §6.1) y el envio del MVP es Correo Argentino (DEC-006), asi
 * que una direccion fuera del pais no se puede despachar. Cuando exista otro
 * pais, esto se parametriza; hoy seria inventar un caso que nadie pidio.
 */

/**
 * Las 24 jurisdicciones de primer orden de la Argentina: 23 provincias mas la
 * Ciudad Autonoma de Buenos Aires.
 *
 * `codigo` es la letra de ISO 3166-2:AR, que es estable y corta: es lo que
 * viaja en el `<select>` del formulario. `nombre` es lo que se GUARDA en
 * `user_addresses.province` (text, ERD §6.1) y lo que se copia al snapshot de
 * la orden: una letra suelta en una etiqueta de envio no la entiende nadie.
 */
export const PROVINCIAS = [
  { codigo: 'C', nombre: 'Ciudad Autónoma de Buenos Aires' },
  { codigo: 'B', nombre: 'Buenos Aires' },
  { codigo: 'K', nombre: 'Catamarca' },
  { codigo: 'H', nombre: 'Chaco' },
  { codigo: 'U', nombre: 'Chubut' },
  { codigo: 'X', nombre: 'Córdoba' },
  { codigo: 'W', nombre: 'Corrientes' },
  { codigo: 'E', nombre: 'Entre Ríos' },
  { codigo: 'P', nombre: 'Formosa' },
  { codigo: 'Y', nombre: 'Jujuy' },
  { codigo: 'L', nombre: 'La Pampa' },
  { codigo: 'F', nombre: 'La Rioja' },
  { codigo: 'M', nombre: 'Mendoza' },
  { codigo: 'N', nombre: 'Misiones' },
  { codigo: 'Q', nombre: 'Neuquén' },
  { codigo: 'R', nombre: 'Río Negro' },
  { codigo: 'A', nombre: 'Salta' },
  { codigo: 'J', nombre: 'San Juan' },
  { codigo: 'D', nombre: 'San Luis' },
  { codigo: 'Z', nombre: 'Santa Cruz' },
  { codigo: 'S', nombre: 'Santa Fe' },
  { codigo: 'G', nombre: 'Santiago del Estero' },
  { codigo: 'V', nombre: 'Tierra del Fuego, Antártida e Islas del Atlántico Sur' },
  { codigo: 'T', nombre: 'Tucumán' },
] as const;

export type Provincia = (typeof PROVINCIAS)[number];
export type CodigoDeProvincia = Provincia['codigo'];

/** Sin tildes ni mayusculas, para comparar lo que tipeo una persona. */
function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Resuelve una provincia por su codigo O por su nombre.
 *
 * Acepta las dos cosas porque el formulario manda el codigo del `<select>`,
 * pero la API y los datos que ya existen —la direccion que el checkout pedia
 * en texto libre— traen el nombre. "cordoba", "Córdoba" y "X" son la misma.
 * "CABA" y "Capital Federal" se aceptan como alias porque es como se la nombra.
 */
export function resolverProvincia(valor: string): Provincia | undefined {
  const buscado = normalizarTexto(valor);
  if (buscado === '') return undefined;

  if (buscado === 'caba' || buscado === 'capital federal' || buscado === 'capital') {
    return PROVINCIAS[0];
  }

  if (buscado.length === 1) {
    return PROVINCIAS.find((p) => p.codigo.toLowerCase() === buscado);
  }

  return PROVINCIAS.find((p) => normalizarTexto(p.nombre) === buscado);
}

export function provinciaPorCodigo(codigo: string): Provincia | undefined {
  return PROVINCIAS.find((p) => p.codigo === codigo);
}

/**
 * Codigo postal argentino, normalizado.
 *
 * Dos formas validas:
 *   - las 4 cifras historicas (`1425`), que Correo Argentino sigue aceptando;
 *   - el CPA de 8 caracteres: una letra de provincia, 4 cifras y 3 letras
 *     (`C1425ABC`).
 *
 * Se devuelve en mayusculas y sin espacios. Cualquier otra cosa es
 * `undefined`: no se "arregla" un codigo postal, porque es la clave con la que
 * se cotiza y se despacha el envio (ERD §6.1).
 */
export function normalizarCodigoPostal(valor: string): string | undefined {
  const limpio = valor.replace(/\s+/g, '').toUpperCase();

  if (/^\d{4}$/.test(limpio)) return limpio;
  if (/^[A-Z]\d{4}[A-Z]{3}$/.test(limpio)) return limpio;

  return undefined;
}

/**
 * Telefono, normalizado a cifras (con `+` opcional adelante).
 *
 * Se aceptan espacios, guiones, puntos y parentesis porque es como la gente
 * escribe un telefono; se guardan solo las cifras para que el vendedor pueda
 * marcarlo o pegarlo en WhatsApp sin editarlo. Entre 8 y 15 cifras: 8 es el
 * minimo de un fijo argentino con caracteristica; 15 es el maximo de E.164.
 */
export function normalizarTelefono(valor: string): string | undefined {
  const sinFormato = valor.replace(/[\s().-]/g, '');
  if (!/^\+?\d{8,15}$/.test(sinFormato)) return undefined;

  return sinFormato;
}

/** Lo que llega del formulario o de la API. Todo string crudo. */
export interface AddressInput {
  /** "Casa", "Trabajo". Opcional. */
  etiqueta?: string | null | undefined;
  /** A nombre de quien va el envio. */
  nombre: string;
  telefono?: string | null | undefined;
  calle: string;
  numero?: string | null | undefined;
  departamento?: string | null | undefined;
  ciudad: string;
  /** Codigo ISO (`X`) o nombre (`Córdoba`). */
  provincia: string;
  codigoPostal: string;
}

/** La direccion ya validada y normalizada, lista para guardar. */
export interface ValidatedAddress {
  label: string | null;
  recipientName: string;
  phone: string | null;
  street: string;
  number: string | null;
  apartment: string | null;
  city: string;
  /** Nombre completo de la jurisdiccion, no el codigo. */
  province: string;
  postalCode: string;
}

/** Techos de largo. Son limites de sanidad para la etiqueta de envio, no reglas de negocio. */
const LARGOS = {
  etiqueta: 40,
  nombre: 120,
  calle: 200,
  numero: 20,
  departamento: 50,
  ciudad: 120,
} as const;

function texto(valor: string | null | undefined): string {
  return (valor ?? '').trim();
}

function opcional(valor: string | null | undefined, campo: string, maximo: number): string | null {
  const limpio = texto(valor);
  if (limpio === '') return null;
  if (limpio.length > maximo) {
    throw errors.addressInvalid(`${campo} no puede superar los ${maximo} caracteres`);
  }

  return limpio;
}

function obligatorio(valor: string, campo: string, minimo: number, maximo: number): string {
  const limpio = texto(valor);
  if (limpio.length < minimo) {
    throw errors.addressInvalid(`${campo} es obligatorio (al menos ${minimo} caracteres)`);
  }
  if (limpio.length > maximo) {
    throw errors.addressInvalid(`${campo} no puede superar los ${maximo} caracteres`);
  }

  return limpio;
}

/**
 * Valida y normaliza una direccion. Lanza `VALIDATION_FAILED` con un mensaje
 * que nombra el campo; el primero que falla, en el orden del formulario.
 */
export function validateAddressInput(input: AddressInput): ValidatedAddress {
  const label = opcional(input.etiqueta, 'La etiqueta', LARGOS.etiqueta);
  const recipientName = obligatorio(input.nombre, 'El nombre de quien recibe', 2, LARGOS.nombre);

  const telefonoCrudo = texto(input.telefono);
  let phone: string | null = null;
  if (telefonoCrudo !== '') {
    const normalizado = normalizarTelefono(telefonoCrudo);
    if (normalizado === undefined) {
      throw errors.addressInvalid('El teléfono tiene que tener entre 8 y 15 cifras');
    }
    phone = normalizado;
  }

  const street = obligatorio(input.calle, 'La calle', 2, LARGOS.calle);
  const number = opcional(input.numero, 'El número', LARGOS.numero);
  const apartment = opcional(input.departamento, 'El piso/departamento', LARGOS.departamento);
  const city = obligatorio(input.ciudad, 'La localidad', 2, LARGOS.ciudad);

  const provincia = resolverProvincia(input.provincia);
  if (provincia === undefined) {
    throw errors.addressInvalid('Elegí una provincia de la lista');
  }

  const postalCode = normalizarCodigoPostal(texto(input.codigoPostal));
  if (postalCode === undefined) {
    throw errors.addressInvalid(
      'El código postal tiene que ser de 4 cifras o el CPA de 8 caracteres (por ejemplo C1425ABC)',
    );
  }

  return {
    label,
    recipientName,
    phone,
    street,
    number,
    apartment,
    city,
    province: provincia.nombre,
    postalCode,
  };
}
