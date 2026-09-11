import { getDatabase, type Database } from '@offside/database';

import type { PublicUser } from '../../auth/services/auth.service';
import * as errors from '../addresses.errors';
import * as addressRepo from '../repositories/address.repository';
import { validateAddressInput, type AddressInput } from './address-validation';

/**
 * Libreta de direcciones (BS-020, BS-070; ERD §6.1).
 *
 * ⚠️ SIEMPRE SOBRE `user.id`. Ninguna funcion recibe un usuario por parametro
 * que no sea el autenticado: no hay id de usuario que manipular, y el
 * repositorio ademas lleva `user_id` en cada WHERE.
 *
 * ⚠️ LA ORDEN NO REFERENCIA ESTA TABLA. `orders.shipping_address` es un
 * SNAPSHOT jsonb (ERD §6.1 y §20.2): editar o borrar una direccion de la
 * libreta no puede alterar una orden ya creada. `toShippingSnapshot()` es lo
 * que se le pasa a `createOrder`; la libreta solo sirve para no tipearla cada
 * vez.
 */

export { PROVINCIAS, type Provincia, type CodigoDeProvincia } from './address-validation';
export type { AddressInput } from './address-validation';

/**
 * Cuantas direcciones puede guardar una persona.
 *
 * ⚠️ NO ES UNA REGLA DE NEGOCIO NI UN VALOR DEL CONFIG STORE, y por eso es
 * una constante: `configuration-registry.md` no lista un cupo de direcciones
 * y BS-020 no fija ninguno. Es un techo de SANIDAD —nadie despacha a mas de
 * diez lugares— para que una cuenta no pueda llenar la tabla en bucle. Si
 * algun dia se vuelve configurable, se mueve a `app_settings` y esta
 * constante desaparece.
 */
export const MAX_ADDRESSES_PER_USER = 10;

export interface PublicAddress {
  id: string;
  etiqueta: string | null;
  nombre: string;
  telefono: string | null;
  calle: string;
  numero: string | null;
  departamento: string | null;
  ciudad: string;
  provincia: string;
  codigoPostal: string;
  esPredeterminada: boolean;
  createdAt: string;
}

export function toPublicAddress(row: addressRepo.AddressRow): PublicAddress {
  return {
    id: row.id,
    etiqueta: row.label,
    nombre: row.recipientName,
    telefono: row.phone,
    calle: row.street,
    numero: row.number,
    departamento: row.apartment,
    ciudad: row.city,
    provincia: row.province,
    codigoPostal: row.postalCode,
    esPredeterminada: row.isDefault,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * La direccion tal como se CONGELA en `orders.shipping_address`.
 *
 * Es la misma forma que ya mandaba el formulario del checkout (`nombre`,
 * `calle`, `ciudad`, `provincia`, `codigoPostal`, `telefono`) mas los campos
 * que la libreta separa (`numero`, `departamento`, `etiqueta`): asi una orden
 * hecha desde la libreta y una tipeada a mano se leen igual.
 *
 * ⚠️ NO LLEVA EL `id` DE LA DIRECCION A PROPOSITO: el snapshot no debe poder
 * volver a la libreta. Si la persona edita la direccion despues, la orden
 * sigue diciendo a donde se despacho.
 */
export interface ShippingAddressSnapshot {
  nombre: string;
  calle: string;
  numero: string | null;
  departamento: string | null;
  ciudad: string;
  provincia: string;
  codigoPostal: string;
  telefono: string | null;
  etiqueta: string | null;
  [clave: string]: unknown;
}

export function toShippingSnapshot(address: PublicAddress): ShippingAddressSnapshot {
  return {
    nombre: address.nombre,
    calle: address.calle,
    numero: address.numero,
    departamento: address.departamento,
    ciudad: address.ciudad,
    provincia: address.provincia,
    codigoPostal: address.codigoPostal,
    telefono: address.telefono,
    etiqueta: address.etiqueta,
  };
}

export async function listAddresses(user: PublicUser): Promise<PublicAddress[]> {
  const rows = await addressRepo.findByUserId(user.id);

  return rows.map(toPublicAddress);
}

/** Una direccion del usuario. Lanza si no existe o es de otro. */
export async function getAddress(user: PublicUser, addressId: string): Promise<PublicAddress> {
  const row = await addressRepo.findByIdForUser(addressId, user.id);
  if (row === undefined) throw errors.addressNotFound();

  return toPublicAddress(row);
}

/**
 * La predeterminada, para precargar el checkout. `null` si no tiene ninguna.
 *
 * Si por algun motivo no hay ninguna marcada pero si hay direcciones, se
 * devuelve la mas nueva: precargar algo es mejor que un formulario vacio, y
 * la persona puede cambiarla.
 */
export async function getDefaultAddress(user: PublicUser): Promise<PublicAddress | null> {
  const predeterminada = await addressRepo.findDefaultByUserId(user.id);
  if (predeterminada !== undefined) return toPublicAddress(predeterminada);

  const [primera] = await addressRepo.findByUserId(user.id);

  return primera === undefined ? null : toPublicAddress(primera);
}

export interface CreateAddressInput extends AddressInput {
  /** Marcarla como predeterminada. La primera que se guarda lo es siempre. */
  predeterminada?: boolean | undefined;
}

/**
 * Guarda una direccion nueva.
 *
 * LA PRIMERA ES PREDETERMINADA AUNQUE NO SE PIDA: una libreta con una sola
 * direccion y ninguna elegida obligaria a elegir en cada compra lo unico que
 * hay. Las siguientes solo si se pide, y entonces se desmarca la anterior en
 * la MISMA transaccion: nunca hay dos predeterminadas.
 */
export async function createAddress(
  user: PublicUser,
  input: CreateAddressInput,
): Promise<PublicAddress> {
  const validada = validateAddressInput(input);

  const countryId = await addressRepo.findArgentinaCountryId();
  if (countryId === undefined) throw errors.countryNotSeeded();

  const row = await getDatabase().transaction(async (tx) => {
    // El cupo se cuenta ADENTRO de la transaccion: dos altas simultaneas que
    // leyeran "9" afuera terminarian en 11.
    const cantidad = await addressRepo.countByUserId(user.id, tx);
    if (cantidad >= MAX_ADDRESSES_PER_USER) {
      throw errors.addressLimitReached(MAX_ADDRESSES_PER_USER);
    }

    const esPredeterminada = cantidad === 0 || input.predeterminada === true;
    if (esPredeterminada) await addressRepo.clearDefault(user.id, tx);

    return addressRepo.insert(
      { ...validada, userId: user.id, countryId, isDefault: esPredeterminada },
      tx,
    );
  });

  return toPublicAddress(row);
}

/**
 * Edita una direccion. Todos los campos se reemplazan: es un formulario
 * completo, no un parche.
 *
 * Cambiar cual es la predeterminada NO pasa por aca: es `setDefaultAddress`,
 * que tiene su propia transaccion.
 */
export async function updateAddress(
  user: PublicUser,
  addressId: string,
  input: AddressInput,
): Promise<PublicAddress> {
  const validada = validateAddressInput(input);

  const row = await addressRepo.update(addressId, user.id, validada);
  if (row === undefined) throw errors.addressNotFound();

  return toPublicAddress(row);
}

/**
 * Borra una direccion. Es BORRADO FISICO: la libreta es efimera (ERD §20.10,
 * "efimeras se borran") y la orden ya tiene su snapshot.
 *
 * Si era la predeterminada, la mas nueva de las que quedan pasa a serlo:
 * mientras haya direcciones, siempre hay una predeterminada. ASUMIDO —la doc
 * no lo dice—, elegido porque la alternativa deja el checkout sin precarga
 * hasta que la persona entre a la libreta a elegir.
 */
export async function deleteAddress(user: PublicUser, addressId: string): Promise<void> {
  await getDatabase().transaction(async (tx) => {
    const borrada = await addressRepo.remove(addressId, user.id, tx);
    if (borrada === undefined) throw errors.addressNotFound();

    if (!borrada.isDefault) return;

    const [siguiente] = await addressRepo.findByUserId(user.id, tx);
    if (siguiente !== undefined) await addressRepo.setDefault(siguiente.id, user.id, tx);
  });
}

/** Marca una direccion como predeterminada y desmarca la anterior, atomicamente. */
export async function setDefaultAddress(
  user: PublicUser,
  addressId: string,
): Promise<PublicAddress> {
  const row = await getDatabase().transaction(async (tx: Database) => {
    const existe = await addressRepo.findByIdForUser(addressId, user.id, tx);
    if (existe === undefined) throw errors.addressNotFound();

    await addressRepo.clearDefault(user.id, tx);

    return addressRepo.setDefault(addressId, user.id, tx);
  });

  if (row === undefined) throw errors.addressNotFound();

  return toPublicAddress(row);
}
