import type { Database } from '@offside/database';

import * as configErrors from '../../config/config.errors';
import * as settingRepo from '../../config/repositories/app-setting.repository';
import { isShippingMode, type ShippingSettings } from './shipping-declaration';

/**
 * Parametros ⚙️ del Config Store que gobiernan promociones, envio declarado y
 * el orden de la vitrina (`configuration-registry.md` §9 y §10; delta al ERD
 * del 2026-09-10 §5 y §15).
 *
 * =============================================================================
 * ⚠️ ESTE ARCHIVO IMPORTA EL REPOSITORIO DE OTRO MODULO, Y ES UNA DEUDA
 * =============================================================================
 *
 * `modules/README.md` lo prohibe: un modulo habla con el SERVICE del otro.
 * `config` hoy solo expone getters para la comision, las imagenes y los pesos
 * de busqueda; los siete parametros de aca no tienen getter y el modulo
 * `config` no es de este paquete. La alternativa era duplicar la consulta de
 * "version vigente" contra `schema.appSettings`, que es peor: este modulo
 * pasaria a conocer el versionado de la tabla. Cuando `config` exponga
 * `getSetting(key)` o getters tipados, este archivo se reduce a llamarlos.
 *
 * ⚠️ SIN VALOR POR DEFECTO EN CODIGO, mismo criterio que la comision: un
 * fallback seria una segunda fuente de verdad. Si la clave falta, se lanza.
 * Los VALORES sembrados (x3, 7 dias, boost 1, `to_agree`, retiro habilitado)
 * son ASUMIDOS y pendientes de confirmacion del owner (delta §7 y §16).
 */

export const PROMOTION_COMMISSION_MULTIPLIER_KEY = 'promotion_commission_multiplier';
export const PROMOTION_DURATION_DAYS_KEY = 'promotion_duration_days';
export const PROMOTION_RANK_BOOST_KEY = 'promotion_rank_boost';
export const FEATURE_PROMOTIONS_KEY = 'feature_promotions';
export const PROMOTED_FIRST_IN_SEARCH_KEY = 'promoted_first_in_search';
export const SHIPPING_DEFAULT_MODE_KEY = 'shipping_default_mode';
export const SHIPPING_PICKUP_ALLOWED_KEY = 'shipping_pickup_allowed';
/**
 * ⚠️ NO ESTA SEMBRADA NI EN EL REGISTRO DE `config` (2026-09-11). Se lee
 * igual, y si no existe vale `false`: es la unica clave de este archivo con
 * fallback, porque un fallback a `false` no habilita nada —cierra— y porque
 * el modo por defecto sigue siendo valido aunque sea `to_agree` (ver
 * `allowedShippingModes`). Cuando `config` la registre, esto no cambia.
 */
export const SHIPPING_TO_AGREE_ALLOWED_KEY = 'shipping_to_agree_allowed';

async function valorDe(key: string, db?: Database): Promise<unknown> {
  const fila = await settingRepo.findCurrent(key, db);
  if (fila === undefined) throw configErrors.settingNotConfigured(key);

  return fila.value;
}

/** Como `valorDe`, pero una clave ausente devuelve `undefined` en vez de lanzar. */
async function valorOpcionalDe(key: string, db?: Database): Promise<unknown> {
  const fila = await settingRepo.findCurrent(key, db);

  return fila?.value;
}

function comoBool(key: string, valor: unknown): boolean {
  if (typeof valor !== 'boolean') {
    throw configErrors.settingInvalid(key, 'debe ser true o false');
  }

  return valor;
}

function comoEnteroPositivo(key: string, valor: unknown, maximo: number): number {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1) {
    throw configErrors.settingInvalid(key, 'debe ser un entero mayor o igual a 1');
  }

  if (valor > maximo) {
    throw configErrors.settingInvalid(key, `no puede superar ${maximo}`);
  }

  return valor;
}

export interface PromotionSettings {
  /** Cuanto se multiplica la comision durante la promocion. `3` = el triple. */
  commissionMultiplier: number;
  /** Duracion en dias corridos. */
  durationDays: number;
}

/**
 * Multiplicador y duracion, leidos juntos: se usan en la misma operacion.
 *
 * El multiplicador se acota a `(0, 100]` y la duracion a un año. No son reglas
 * de negocio: son techos de cordura para que un cero de mas no convierta una
 * promocion en una comision del 30000% o en una que no vence nunca.
 */
export async function getPromotionSettings(db?: Database): Promise<PromotionSettings> {
  const [multiplicador, duracion] = await Promise.all([
    valorDe(PROMOTION_COMMISSION_MULTIPLIER_KEY, db),
    valorDe(PROMOTION_DURATION_DAYS_KEY, db),
  ]);

  if (
    typeof multiplicador !== 'number' ||
    !Number.isFinite(multiplicador) ||
    multiplicador <= 0 ||
    multiplicador > 100
  ) {
    throw configErrors.settingInvalid(
      PROMOTION_COMMISSION_MULTIPLIER_KEY,
      'debe ser un número mayor a 0 y hasta 100',
    );
  }

  return {
    commissionMultiplier: multiplicador,
    durationDays: comoEnteroPositivo(PROMOTION_DURATION_DAYS_KEY, duracion, 366),
  };
}

/** `feature_promotions`: la perilla para apagar la funcionalidad desde Admin. */
export async function arePromotionsEnabled(db?: Database): Promise<boolean> {
  return comoBool(FEATURE_PROMOTIONS_KEY, await valorDe(FEATURE_PROMOTIONS_KEY, db));
}

export interface RankingSettings {
  /**
   * Sumando al `ts_rank` de una publicacion promocionada (PS-021 ⚙️). El
   * delta §8 dejo la escala a criterio de la busqueda: se SUMA, porque
   * `ts_rank` sin normalizar rara vez pasa de 1 y un sumando de 1 pone a las
   * promocionadas por encima sin borrar el orden entre ellas.
   */
  promotionRankBoost: number;
  /** Promocionadas ANTES que el resto en cualquier orden, no solo en relevancia. */
  promotedFirst: boolean;
}

export async function getRankingSettings(db?: Database): Promise<RankingSettings> {
  const [boost, primero] = await Promise.all([
    valorDe(PROMOTION_RANK_BOOST_KEY, db),
    valorDe(PROMOTED_FIRST_IN_SEARCH_KEY, db),
  ]);

  if (typeof boost !== 'number' || !Number.isFinite(boost) || boost < 0 || boost > 100) {
    throw configErrors.settingInvalid(PROMOTION_RANK_BOOST_KEY, 'debe ser un número entre 0 y 100');
  }

  return {
    promotionRankBoost: boost,
    promotedFirst: comoBool(PROMOTED_FIRST_IN_SEARCH_KEY, primero),
  };
}

/** Modo por defecto y si se admite retiro en persona (`configuration-registry.md` §10). */
export async function getShippingSettings(db?: Database): Promise<ShippingSettings> {
  const [modo, retiro, convenir] = await Promise.all([
    valorDe(SHIPPING_DEFAULT_MODE_KEY, db),
    valorDe(SHIPPING_PICKUP_ALLOWED_KEY, db),
    valorOpcionalDe(SHIPPING_TO_AGREE_ALLOWED_KEY, db),
  ]);

  if (!isShippingMode(modo)) {
    throw configErrors.settingInvalid(
      SHIPPING_DEFAULT_MODE_KEY,
      'debe ser included, buyer_pays, to_agree o pickup',
    );
  }

  return {
    defaultMode: modo,
    pickupAllowed: comoBool(SHIPPING_PICKUP_ALLOWED_KEY, retiro),
    // Ausente => false. Presente pero mal cargada => error, como las demas.
    toAgreeAllowed:
      convenir === undefined ? false : comoBool(SHIPPING_TO_AGREE_ALLOWED_KEY, convenir),
  };
}
