import type { Database } from '@offside/database';

import * as errors from '../config.errors';
import * as settingRepo from '../repositories/app-setting.repository';

/**
 * Configuracion de imagenes de publicaciones (⚙️ DEC-013 / DEC-038).
 *
 * `configuration-registry.md` §8 lista "cantidad maxima de fotos", "tamaño
 * maximo de archivo" y "formatos permitidos" como **configuracion
 * administrativa**, y sus valores como 🟡 sin definir. Los que carga la
 * migracion son una **decision de implementacion del owner (2026-09-02)**,
 * tomada bajo DEC-032 ("simple por defecto, configurable cuando sea
 * necesario"): 8 fotos, 5 MB, JPEG/PNG/WebP.
 *
 * ⚠️ NO SE HARDCODEAN (CLAUDE.md §12). Viven en `app_settings` y se leen en
 * cada subida. Que hoy nadie los haya cambiado no los vuelve constantes.
 *
 * ⚠️ SIN VALOR POR DEFECTO EN CODIGO, mismo criterio que la comision: un
 * fallback seria una segunda fuente de verdad, y el dia que alguien cambie el
 * setting nadie sabria cual rigio. Si la clave falta, se lanza.
 */

export const MAX_IMAGES_KEY = 'listing_max_images';
export const MAX_IMAGE_BYTES_KEY = 'listing_max_image_bytes';
export const ALLOWED_IMAGE_TYPES_KEY = 'listing_allowed_image_types';

/**
 * Formatos que el sistema sabe procesar.
 *
 * ⚠️ ES UN TECHO TECNICO, NO LA CONFIGURACION. El administrador puede permitir
 * MENOS formatos que estos, nunca otros: aceptar uno que el procesador no sabe
 * tratar terminaria guardando un archivo sin validar. En particular **SVG no
 * esta ni puede estar**: un SVG es un documento que ejecuta JavaScript, y
 * servido desde nuestro dominio seria XSS almacenado.
 */
export const FORMATOS_SOPORTADOS = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type FormatoSoportado = (typeof FORMATOS_SOPORTADOS)[number];

export interface ImageSettings {
  maxImages: number;
  maxBytes: number;
  allowedTypes: FormatoSoportado[];
}

function assertMaxImages(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw errors.settingInvalid(MAX_IMAGES_KEY, 'debe ser un entero mayor o igual a 1');
  }

  // Techo de cordura: no es una regla de negocio, es evitar que un cero de mas
  // convierta una publicacion en un ataque de almacenamiento.
  if (value > 50) {
    throw errors.settingInvalid(MAX_IMAGES_KEY, 'no puede superar 50');
  }

  return value;
}

function assertMaxBytes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw errors.settingInvalid(MAX_IMAGE_BYTES_KEY, 'debe ser un entero de bytes mayor a cero');
  }

  // 50 MB. Por encima, el procesamiento en memoria deja de ser razonable en un
  // VPS chico y el limite deja de proteger.
  if (value > 50 * 1024 * 1024) {
    throw errors.settingInvalid(MAX_IMAGE_BYTES_KEY, 'no puede superar 50 MB');
  }

  return value;
}

function assertAllowedTypes(value: unknown): FormatoSoportado[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw errors.settingInvalid(ALLOWED_IMAGE_TYPES_KEY, 'debe ser una lista no vacia');
  }

  const soportados = new Set<string>(FORMATOS_SOPORTADOS);

  for (const tipo of value) {
    if (typeof tipo !== 'string' || !soportados.has(tipo)) {
      throw errors.settingInvalid(
        ALLOWED_IMAGE_TYPES_KEY,
        `"${String(tipo)}" no es un formato que el sistema sepa procesar`,
      );
    }
  }

  return value as FormatoSoportado[];
}

/** Los tres valores vigentes, leidos juntos. */
export async function getImageSettings(db?: Database): Promise<ImageSettings> {
  const [maxImages, maxBytes, allowedTypes] = await Promise.all([
    settingRepo.findCurrent(MAX_IMAGES_KEY, db),
    settingRepo.findCurrent(MAX_IMAGE_BYTES_KEY, db),
    settingRepo.findCurrent(ALLOWED_IMAGE_TYPES_KEY, db),
  ]);

  if (maxImages === undefined) throw errors.settingNotConfigured(MAX_IMAGES_KEY);
  if (maxBytes === undefined) throw errors.settingNotConfigured(MAX_IMAGE_BYTES_KEY);
  if (allowedTypes === undefined) throw errors.settingNotConfigured(ALLOWED_IMAGE_TYPES_KEY);

  return {
    maxImages: assertMaxImages(maxImages.value),
    maxBytes: assertMaxBytes(maxBytes.value),
    allowedTypes: assertAllowedTypes(allowedTypes.value),
  };
}

/* ------------------------------------------ busqueda (PS-021 / DEC-042) -- */

export const SEARCH_RANK_WEIGHTS_KEY = 'search_rank_weights';

/**
 * Pesos del ranking de busqueda, en el orden que espera `ts_rank`: {D, C, B, A}.
 *
 * ⚠️ NO SE HARDCODEAN. DEC-042 lo dice con estas palabras: "los pesos de
 * ranking permanecen configurables desde la aplicacion (`app_settings`), nunca
 * hardcodeados", y PS-021 los marca como configuracion administrativa.
 *
 * Son cuatro numeros entre 0 y 1. Fuera de ese rango PostgreSQL no falla: da
 * resultados sin sentido, que es peor.
 */
export async function getSearchRankWeights(db?: Database): Promise<number[]> {
  const fila = await settingRepo.findCurrent(SEARCH_RANK_WEIGHTS_KEY, db);
  if (fila === undefined) throw errors.settingNotConfigured(SEARCH_RANK_WEIGHTS_KEY);

  const valor = fila.value;

  if (!Array.isArray(valor) || valor.length !== 4) {
    throw errors.settingInvalid(SEARCH_RANK_WEIGHTS_KEY, 'deben ser cuatro pesos {D, C, B, A}');
  }

  return valor.map((peso) => {
    if (typeof peso !== 'number' || !Number.isFinite(peso) || peso < 0 || peso > 1) {
      throw errors.settingInvalid(SEARCH_RANK_WEIGHTS_KEY, 'cada peso debe estar entre 0 y 1');
    }

    return peso;
  });
}
