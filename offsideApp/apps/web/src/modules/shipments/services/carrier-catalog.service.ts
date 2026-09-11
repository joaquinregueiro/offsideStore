import { z } from 'zod';

import * as configErrors from '../../config/config.errors';
import * as shipmentRepo from '../repositories/shipment.repository';
import * as errors from '../shipments.errors';

/**
 * Catalogo de transportistas para el despacho MANUAL (SH-010 sin Correo
 * Argentino: el vendedor despacha por su cuenta y declara con quien).
 *
 * ⚠️ ES ⚙️ CONFIGURACION, NO UNA CONSTANTE: la lista vive en
 * `app_settings.shipping_carriers` (json: `[{ code, name, trackingUrlTemplate }]`)
 * y se lee de ahi cuando existe. El DEFAULT de abajo se usa SOLO mientras la
 * clave no este sembrada —ninguna migracion la carga todavia— y es la unica
 * excepcion documentada al principio de "sin defaults en codigo"
 * (`config.errors.ts`): sin lista, nadie puede despachar, y bloquear todas las
 * ventas por una clave que falta es peor que arrancar con cuatro nombres.
 * ASUMIDO, confirmar: los cuatro codigos y que la clave se siembre por
 * migracion (`config` la tiene que agregar a `settings-registry.ts`).
 *
 * ⚠️ `trackingUrlTemplate` es `null` en los cuatro por defecto, A PROPOSITO:
 * el formato de la pagina publica de seguimiento de cada correo es un
 * contrato de un tercero y no se inventa (CLAUDE.md §11). El administrador lo
 * carga cuando lo verifique; hasta entonces la pantalla muestra el numero sin
 * enlace, que es exacto y no manda a nadie a una URL rota.
 */

export const SHIPPING_CARRIERS_KEY = 'shipping_carriers';

export interface Carrier {
  /** Identificador estable: es lo que se guarda en `shipments.raw.carrier`. */
  code: string;
  /** Nombre visible. Con tildes si las lleva. */
  name: string;
  /** URL publica de seguimiento con `{tracking}` como marcador, o null. */
  trackingUrlTemplate: string | null;
}

/** Marcador que el template tiene que contener para poder armar el enlace. */
export const TRACKING_PLACEHOLDER = '{tracking}';

export const DEFAULT_CARRIERS: readonly Carrier[] = [
  { code: 'correo_argentino', name: 'Correo Argentino', trackingUrlTemplate: null },
  { code: 'andreani', name: 'Andreani', trackingUrlTemplate: null },
  { code: 'oca', name: 'OCA', trackingUrlTemplate: null },
  { code: 'otro', name: 'Otro', trackingUrlTemplate: null },
];

const carrierSchema = z.strictObject({
  code: z.string().regex(/^[a-z0-9_]{2,32}$/, 'code: minusculas, digitos y guion bajo'),
  name: z.string().trim().min(1).max(64),
  trackingUrlTemplate: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), 'debe ser https')
    .refine((u) => u.includes(TRACKING_PLACEHOLDER), `debe contener ${TRACKING_PLACEHOLDER}`)
    .nullable()
    .optional(),
});

const carriersSchema = z
  .array(carrierSchema)
  .min(1)
  .refine((lista) => new Set(lista.map((c) => c.code)).size === lista.length, 'codigos repetidos');

/**
 * Valida la lista tal como sale de `app_settings`. Lanza `SETTING_INVALID`
 * (500) si esta corrupta: un valor mal cargado se detecta al leer, no cuando
 * un vendedor intenta despachar y recibe "transportista desconocido".
 */
export function parseCarriers(raw: unknown): Carrier[] {
  const resultado = carriersSchema.safeParse(raw);

  if (!resultado.success) {
    const motivo = resultado.error.issues
      .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');

    throw configErrors.settingInvalid(SHIPPING_CARRIERS_KEY, motivo);
  }

  return resultado.data.map((c) => ({
    code: c.code,
    name: c.name,
    trackingUrlTemplate: c.trackingUrlTemplate ?? null,
  }));
}

/** Los transportistas ofrecidos hoy. Para el formulario de despacho. */
export async function getCarriers(): Promise<Carrier[]> {
  const raw = await shipmentRepo.findGlobalSettingValue(SHIPPING_CARRIERS_KEY);
  if (raw === undefined) return [...DEFAULT_CARRIERS];

  return parseCarriers(raw);
}

/** El transportista por su codigo, o `VALIDATION_FAILED` si no esta en la lista. */
export async function requireCarrier(code: string): Promise<Carrier> {
  const carrier = (await getCarriers()).find((c) => c.code === code);
  if (carrier === undefined) throw errors.carrierUnknown();

  return carrier;
}

/**
 * Enlace publico de seguimiento, o null si el transportista no tiene template.
 * El numero va codificado: viene de un formulario y termina en una URL.
 */
export function trackingUrlFor(carrier: Carrier, trackingNumber: string): string | null {
  if (carrier.trackingUrlTemplate === null) return null;

  return carrier.trackingUrlTemplate.replace(
    TRACKING_PLACEHOLDER,
    encodeURIComponent(trackingNumber),
  );
}
