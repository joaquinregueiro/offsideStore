import type { Database } from '@offside/database';

import * as errors from '../config.errors';
import * as settingRepo from '../repositories/app-setting.repository';
import {
  GLOBAL_SCOPE,
  type AppSettingRow,
  type SettingScope,
  type SettingScopeRef,
} from '../repositories/app-setting.repository';
import { categoryExists } from '../repositories/category-scope.repository';
import { findTierById } from '../repositories/seller-tier.repository';
import {
  SETTING_KEYS,
  TRACKING_PLACEHOLDER,
  allowsScope,
  assertSettingKey,
  definitionOf,
  isSettingKey,
  parseSettingValue,
  safeParseSettingValue,
  type FeatureName,
  type SettingKey,
  type SettingValue,
  type SettingValueType,
  type ShippingCarrier,
  type ShippingMode,
} from './settings-registry';

/**
 * CONFIG STORE — lectura tipada, precedencia por ambito, escritura versionada
 * e historial de TODAS las claves del registro (DEC-013 / DEC-038 / DEC-039,
 * `configuration-registry.md`, ERD §17.1).
 *
 * Es la generalizacion de `settings.service.ts` (la comision) y de
 * `image-settings.service.ts` (fotos y pesos de busqueda), que siguen
 * existiendo con sus firmas intactas: `orders`, `listings` y el back-office
 * los importan y no hay motivo para moverlos. Comparten la MISMA tabla y las
 * MISMAS series de versiones, asi que `setSetting('commission_rate_default')`
 * y `setCommissionRateBasisPoints()` escriben exactamente lo mismo.
 *
 * COMO SE LEE, en orden de preferencia:
 *
 *   getPaymentWindowMinutes(db?)            lector tipado por clave o por grupo.
 *   getSetting('payment_window_minutes')    generico, tipado por la clave; global.
 *   resolve(key, { sellerTierId, ... })     con precedencia por ambito.
 *   resolveSetting(key, ctx)                lo mismo, diciendo DE DONDE salio.
 *
 * ⚠️ SIN CACHE, a proposito y documentado: cada lectura es una consulta por
 * indice (`app_settings_scope_key_idx`), que cuesta menos que la invalidacion
 * que exigiria un cache cuando un administrador cambia un valor. Es ademas lo
 * que permite que un test cambie una clave y la vea en la lectura siguiente.
 * Si algun dia una pantalla lee veinte claves por request, el lugar para
 * agruparlas es `listSettings()` (una consulta), no un cache.
 *
 * ⚠️ SNAPSHOT (DEC-030). Nada de lo que devuelve este Service se guarda como
 * referencia: lo que afecta una transaccion se COPIA a la transaccion al
 * crearla y nunca se vuelve a leer de aca. Este modulo no sabe de ordenes.
 *
 * ⚠️ NO AUTORIZA. `setSetting` y `getSettingHistory` son del back-office:
 * quien llama tiene que haber exigido `system_config:manage` (DEC-023) antes,
 * como hace el controller de la comision. `updatedBy` es el id del
 * administrador AUTENTICADO y sale de la sesion, nunca de un formulario.
 *
 * ⚠️ NO ESCRIBE `audit_log`, mismo criterio que la comision: `app_settings`
 * es versionada y cada cambio deja su fila con `updated_by` y `created_at`.
 * Una segunda auditoria seria el mismo hecho contado dos veces.
 */

/* -------------------------------------------------------------------------- */
/* Precedencia por ambito                                                      */
/* -------------------------------------------------------------------------- */

/**
 * De mas especifico a mas general. `global` va SIEMPRE ultimo: es el piso.
 *
 * ⚠️ ORDEN ASUMIDO. `configuration-registry.md` §2 y §13 dejan el "orden
 * fino" 🟡/🟦 y dan como EJEMPLO `publicacion > categoria > seller_tier >
 * global`; la instruccion de implementacion del 2026-09-11 pidio
 * `seller_tier > categoria > global`, que es lo que rige aca. Si el owner
 * confirma el otro orden, se cambia ESTA constante y nada mas: la resolucion
 * la recorre. `publicacion` no es un ambito de `app_settings` (ERD §17.1):
 * son datos del listing, no configuracion.
 */
export const SCOPE_PRECEDENCE = [
  'seller_tier',
  'category',
  'global',
] as const satisfies readonly SettingScope[];

/**
 * Para QUIEN se resuelve una clave. Todo opcional: sin contexto, rige la
 * global. Se admite `null` porque `seller_profiles.seller_tier_id` es
 * nullable y pasarlo tal cual evita un `?? undefined` en cada llamada.
 */
export interface ResolutionContext {
  sellerTierId?: string | null | undefined;
  categoryId?: string | null | undefined;
}

/** De donde salio el valor: un ambito de la tabla, o el default transitorio del registro. */
export type SettingSource = SettingScope | 'default';

export interface ResolvedSetting<K extends SettingKey = SettingKey> {
  key: K;
  value: SettingValue<K>;
  source: SettingSource;
  /** `null` para global y para default. */
  scopeId: string | null;
  /** `null` cuando rige el default del registro: no hay fila. */
  version: number | null;
  updatedAt: Date | null;
}

/**
 * Que ambitos hay que consultar para una clave en un contexto. PURA.
 *
 * Un ambito entra solo si el contexto trae su id Y la clave lo admite
 * (`allowsScope`): pedir `dispatch_deadline_hours` para un tier consulta el
 * tier y la global; pedir `payment_window_minutes` para el mismo tier consulta
 * SOLO la global, aunque alguien haya colado una fila de tier a mano.
 */
export function scopesToQuery(key: SettingKey, ctx: ResolutionContext): SettingScopeRef[] {
  const refs: SettingScopeRef[] = [];

  if (typeof ctx.sellerTierId === 'string' && allowsScope(key, 'seller_tier')) {
    refs.push({ scope: 'seller_tier', scopeId: ctx.sellerTierId });
  }

  if (typeof ctx.categoryId === 'string' && allowsScope(key, 'category')) {
    refs.push({ scope: 'category', scopeId: ctx.categoryId });
  }

  refs.push(GLOBAL_SCOPE);

  return refs;
}

/** La fila que gana entre las vigentes de cada ambito, segun `SCOPE_PRECEDENCE`. PURA. */
export function pickByPrecedence(
  vigentes: ReadonlyMap<SettingScope, AppSettingRow>,
): AppSettingRow | undefined {
  for (const scope of SCOPE_PRECEDENCE) {
    const fila = vigentes.get(scope);
    if (fila !== undefined) return fila;
  }

  return undefined;
}

/**
 * Claves que ya se anotaron en el log por regir por default. Una vez por
 * proceso y por clave: el aviso existe para que el despliegue se entere de que
 * falta correr la migracion, no para llenar el log en cada request.
 */
const defaultsAnotados = new Set<SettingKey>();

function anotarDefault(key: SettingKey): void {
  if (defaultsAnotados.has(key)) return;
  defaultsAnotados.add(key);

  console.warn(
    `[config] "${key}" no esta cargada en app_settings: rige el default del registro hasta que corra la migracion de datos`,
  );
}

/**
 * Resuelve una clave para un contexto y dice DE DONDE salio.
 *
 * Una sola consulta (todos los ambitos candidatos juntos), el valor validado
 * contra el schema de la clave —un override corrupto en un tier rompe la
 * lectura con `SETTING_INVALID`, no la degrada en silencio a la global— y, si
 * no hay fila en ningun ambito, el default transitorio del registro o
 * `SETTING_NOT_CONFIGURED`.
 */
export async function resolveSetting<K extends SettingKey>(
  key: K,
  ctx: ResolutionContext = {},
  db?: Database,
): Promise<ResolvedSetting<K>> {
  assertSettingKey(key);

  const vigentes = await settingRepo.findCurrentInScopes(key, scopesToQuery(key, ctx), db);
  const fila = pickByPrecedence(vigentes);

  if (fila !== undefined) {
    return {
      key,
      value: parseSettingValue(key, fila.value),
      source: fila.scope,
      scopeId: fila.scopeId,
      version: fila.version,
      updatedAt: fila.updatedAt ?? fila.createdAt,
    };
  }

  const porDefecto = definitionOf(key).defaultUntilSeeded;

  if (porDefecto !== undefined) {
    anotarDefault(key);

    return {
      key,
      value: porDefecto as SettingValue<K>,
      source: 'default',
      scopeId: null,
      version: null,
      updatedAt: null,
    };
  }

  throw errors.settingNotConfigured(key);
}

/** El valor resuelto para un contexto, sin el detalle de origen. */
export async function resolve<K extends SettingKey>(
  key: K,
  ctx: ResolutionContext = {},
  db?: Database,
): Promise<SettingValue<K>> {
  return (await resolveSetting(key, ctx, db)).value;
}

/**
 * Lector generico tipado por la clave, en ambito GLOBAL.
 *
 * `getSetting('payment_window_minutes')` devuelve `number`;
 * `getSetting('shipping_carriers')` devuelve `ShippingCarrier[]`. El tipo sale
 * del schema del registro, asi que no hay `as` en ningun consumidor.
 */
export async function getSetting<K extends SettingKey>(
  key: K,
  db?: Database,
): Promise<SettingValue<K>> {
  return resolve(key, {}, db);
}

/* -------------------------------------------------------------------------- */
/* Lectores tipados por clave o por grupo                                      */
/* -------------------------------------------------------------------------- */
/*
 * Cada lector es `(db?)` —global— o `(db?, ctx?)` cuando alguna de sus
 * claves admite override por tier o categoria. `db` va primero porque es lo
 * que todo consumidor pasa (la transaccion); `ctx` es el agregado opcional.
 * Un grupo lee sus claves EN PARALELO: son consultas independientes.
 */

/* ---- ciclo de la orden (DEC-029 / DEC-033 / BR-032 / BR-033 / BR-034) ---- */

/** Minutos para pagar antes de que `PENDING_PAYMENT` venza (DEC-033). */
export async function getPaymentWindowMinutes(db?: Database): Promise<number> {
  return getSetting('payment_window_minutes', db);
}

/** Horas desde el pago para despachar (BR-032). Admite override por tier. */
export async function getDispatchDeadlineHours(
  db?: Database,
  ctx: ResolutionContext = {},
): Promise<number> {
  return resolve('dispatch_deadline_hours', ctx, db);
}

/** Dias desde DELIVERED para que la orden pase sola a COMPLETED sin reclamo. */
export async function getBuyerProtectionDays(db?: Database): Promise<number> {
  return getSetting('buyer_protection_days', db);
}

/** Dias desde COMPLETED para poder calificar. */
export async function getReviewWindowDays(db?: Database): Promise<number> {
  return getSetting('review_window_days', db);
}

/* ---- disputas y conciliacion ------------------------------------------- */

/** Dias que tiene el vendedor para responder una disputa (TS-052). */
export async function getDisputeSellerResponseDays(db?: Database): Promise<number> {
  return getSetting('dispute_seller_response_days', db);
}

/** Dias desde la entrega en los que el comprador puede abrir una disputa (BR-034). */
export async function getDisputeWindowDays(db?: Database): Promise<number> {
  return getSetting('dispute_window_days', db);
}

/** Dias hacia atras que abarca cada conciliacion con Mercado Pago (OR-031). */
export async function getReconciliationWindowDays(db?: Database): Promise<number> {
  return getSetting('reconciliation_window_days', db);
}

/* ---- promociones (PS-021, delta 2026-09-10 §1/§9) ------------------------ */

export interface PromotionSettings {
  /** Por cuanto se multiplica la comision de una venta promocionada. `3` = el triple. */
  multiplier: number;
  /** Duracion en dias corridos. */
  durationDays: number;
  /** Sumando al score de busqueda; `0` = no suben. */
  rankBoost: number;
  /** Promocionadas ANTES que el resto, en cualquier orden. */
  promotedFirstInSearch: boolean;
}

/** Multiplicador y duracion admiten override por tier; el ranking es global. */
export async function getPromotionSettings(
  db?: Database,
  ctx: ResolutionContext = {},
): Promise<PromotionSettings> {
  const [multiplier, durationDays, rankBoost, promotedFirstInSearch] = await Promise.all([
    resolve('promotion_commission_multiplier', ctx, db),
    resolve('promotion_duration_days', ctx, db),
    getSetting('promotion_rank_boost', db),
    getSetting('promoted_first_in_search', db),
  ]);

  return { multiplier, durationDays, rankBoost, promotedFirstInSearch };
}

/* ---- tiers de vendedor (DEC-037, BR-051) --------------------------------- */

export type SellerTierEvaluation = SettingValue<'seller_tier_evaluation'>;

/** Que cuenta como venta al evaluar el tier: solo COMPLETED, sin reembolsadas. */
export async function getSellerTierEvaluation(db?: Database): Promise<SellerTierEvaluation> {
  return getSetting('seller_tier_evaluation', db);
}

export interface SellerTierSettings {
  evaluation: SellerTierEvaluation;
  /** Ventana movil hacia atras, en dias. */
  salesWindowDays: number;
  autoAssign: boolean;
  autoDowngrade: boolean;
}

export async function getSellerTierSettings(db?: Database): Promise<SellerTierSettings> {
  const [evaluation, salesWindowDays, autoAssign, autoDowngrade] = await Promise.all([
    getSetting('seller_tier_evaluation', db),
    getSetting('seller_tier_sales_window_days', db),
    getSetting('seller_tier_auto_assign', db),
    getSetting('seller_tier_auto_downgrade', db),
  ]);

  return { evaluation, salesWindowDays, autoAssign, autoDowngrade };
}

/* ---- niveles y reputacion (DEC-020, OQ-D4) ------------------------------- */

export type UserLevelThresholds = SettingValue<'user_level_thresholds'>;
export type ReputationScoreWeights = SettingValue<'reputation_score_weights'>;

/** Operaciones completadas para alcanzar cada nivel; crecientes por schema. */
export async function getUserLevelThresholds(db?: Database): Promise<UserLevelThresholds> {
  return getSetting('user_level_thresholds', db);
}

/** Los cinco pesos de la formula de reputacion; suman 1 por schema. */
export async function getReputationScoreWeights(db?: Database): Promise<ReputationScoreWeights> {
  return getSetting('reputation_score_weights', db);
}

/* ---- feature flags (configuration-registry §3) --------------------------- */

/** La clave de `app_settings` de cada flag. `FEATURE_NAMES` es lo que se muestra. */
export function featureKey(name: FeatureName): `feature_${FeatureName}` {
  return `feature_${name}`;
}

/** `isFeatureEnabled('promotions')` lee `feature_promotions`. */
export async function isFeatureEnabled(name: FeatureName, db?: Database): Promise<boolean> {
  return getSetting(featureKey(name), db);
}

/** Los cuatro flags de una vez, para el back-office y la navegacion. */
export async function getFeatureFlags(db?: Database): Promise<Record<FeatureName, boolean>> {
  const [promotions, reviews, questions, cart] = await Promise.all([
    getSetting('feature_promotions', db),
    getSetting('feature_reviews', db),
    getSetting('feature_questions', db),
    getSetting('feature_cart', db),
  ]);

  return { promotions, reviews, questions, cart };
}

/* ---- envios (configuration-registry §10) --------------------------------- */

export interface ShippingSettings {
  /** Modo con el que arranca el formulario de publicar. */
  defaultMode: ShippingMode;
  pickupAllowed: boolean;
  toAgreeAllowed: boolean;
  carriers: ShippingCarrier[];
}

export async function getShippingSettings(db?: Database): Promise<ShippingSettings> {
  const [defaultMode, pickupAllowed, toAgreeAllowed, carriers] = await Promise.all([
    getSetting('shipping_default_mode', db),
    getSetting('shipping_pickup_allowed', db),
    getSetting('shipping_to_agree_allowed', db),
    getSetting('shipping_carriers', db),
  ]);

  return { defaultMode, pickupAllowed, toAgreeAllowed, carriers };
}

export async function getShippingCarriers(db?: Database): Promise<ShippingCarrier[]> {
  return getSetting('shipping_carriers', db);
}

/**
 * Un transportista por su codigo, o `undefined` si no esta en la lista
 * vigente. Para validar lo que el vendedor declara al despachar.
 */
export async function findShippingCarrier(
  code: string,
  db?: Database,
): Promise<ShippingCarrier | undefined> {
  return (await getShippingCarriers(db)).find((carrier) => carrier.code === code);
}

/**
 * La URL de seguimiento de un envio, o `null` si el transportista no tiene
 * plantilla. PURA. El numero va codificado: es texto que escribio el vendedor
 * y termina dentro de un `href`.
 */
export function trackingUrlFor(carrier: ShippingCarrier, trackingNumber: string): string | null {
  if (carrier.trackingUrlTemplate === null) return null;

  return carrier.trackingUrlTemplate.replaceAll(
    TRACKING_PLACEHOLDER,
    encodeURIComponent(trackingNumber.trim()),
  );
}

/* ---- preguntas y favoritos (delta 2026-09-10 §13/§14) -------------------- */

export interface QuestionSettings {
  /** Preguntas sin responder que una cuenta puede tener abiertas a la vez. Override por tier. */
  maxOpenPerUser: number;
  /** Largo maximo de pregunta y respuesta, en caracteres. */
  maxLength: number;
}

export async function getQuestionSettings(
  db?: Database,
  ctx: ResolutionContext = {},
): Promise<QuestionSettings> {
  const [maxOpenPerUser, maxLength] = await Promise.all([
    resolve('questions_max_open_per_user', ctx, db),
    getSetting('questions_max_length', db),
  ]);

  return { maxOpenPerUser, maxLength };
}

export interface FavoritesSettings {
  /** Baja de precio minima, en %, para avisar a quien tiene la publicacion en favoritos. */
  priceDropMinPercent: number;
}

export async function getFavoritesSettings(db?: Database): Promise<FavoritesSettings> {
  return { priceDropMinPercent: await getSetting('favorites_price_drop_min_percent', db) };
}

/* -------------------------------------------------------------------------- */
/* Escritura versionada                                                        */
/* -------------------------------------------------------------------------- */

export interface SettingWriteResult<K extends SettingKey = SettingKey> {
  key: K;
  /** El valor tal como quedo guardado, ya validado. */
  value: SettingValue<K>;
  scope: SettingScope;
  scopeId: string | null;
  /** La version nueva dentro de su serie (scope, scope_id, key). */
  version: number;
  updatedBy: string | null;
  createdAt: Date;
}

/**
 * Verifica que la clave admita el ambito y que el `scope_id` apunte a algo.
 *
 * `scope_id` es FK LOGICA (ERD §17.1): PostgreSQL no puede exigir que un id
 * de tier sea un tier porque la tabla destino depende de `scope`. Esta es la
 * validacion en app que el ERD delega, y el motivo de que `config` tenga dos
 * repositorios de solo lectura sobre tablas de otros modulos.
 */
async function assertScopeWritable(
  key: SettingKey,
  ref: SettingScopeRef,
  db?: Database,
): Promise<void> {
  if (!allowsScope(key, ref.scope)) {
    throw errors.settingScopeInvalid(
      key,
      `solo admite ${definitionOf(key).scopes.join(', ')}; se pidio ${ref.scope}`,
    );
  }

  if (ref.scope === 'seller_tier' && (await findTierById(ref.scopeId, db)) === undefined) {
    throw errors.settingScopeInvalid(key, `no existe el tier ${ref.scopeId}`);
  }

  if (ref.scope === 'category' && !(await categoryExists(ref.scopeId, db))) {
    throw errors.settingScopeInvalid(key, `no existe la categoria ${ref.scopeId}`);
  }
}

/**
 * Cambia el valor de una clave en un ambito: inserta la VERSION SIGUIENTE de
 * esa serie. La anterior queda en la tabla (historial, DEC-030).
 *
 * Valida en este orden, y todo ANTES de tocar la base: que la clave exista en
 * el registro, que admita el ambito, que el `scope_id` apunte a algo, y que el
 * valor pase el schema de la clave. Cualquier rechazo es `VALIDATION_FAILED`
 * (422): es un administrador que se equivoco, no un bug del servidor.
 *
 * ⚠️ `updatedBy` es el id del ADMINISTRADOR AUTENTICADO. El controller o la
 * Server Action lo toman de la sesion, nunca del cuerpo. `null` esta admitido
 * solo para cargas sin persona detras (scripts, migraciones de datos).
 *
 * `scope` va despues de `db` para que la firma que pidio la instruccion
 * —`setSetting(key, value, updatedBy, db?)`— siga valiendo tal cual para el
 * caso comun (global) y el override sea el agregado.
 */
export async function setSetting<K extends SettingKey>(
  key: K,
  value: unknown,
  updatedBy: string | null = null,
  db?: Database,
  scope: SettingScopeRef = GLOBAL_SCOPE,
): Promise<SettingWriteResult<K>> {
  assertSettingKey(key);
  await assertScopeWritable(key, scope, db);

  const validado = safeParseSettingValue(key, value);
  if (!validado.ok) throw errors.settingValueRejected(key, validado.motivo);

  const fila = await settingRepo.insertNextVersion(
    {
      key,
      value: validado.value,
      valueType: definitionOf(key).valueType,
      updatedBy,
      scope,
    },
    db,
  );

  return {
    key,
    value: validado.value,
    scope: fila.scope,
    scopeId: fila.scopeId,
    version: fila.version,
    updatedBy: fila.updatedBy,
    createdAt: fila.createdAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Listado e historial (back-office)                                           */
/* -------------------------------------------------------------------------- */

/** Un override vigente por tier o categoria, tal como esta en la tabla. */
export interface SettingOverride {
  scope: Exclude<SettingScope, 'global'>;
  scopeId: string;
  /** Crudo: un override corrupto se muestra, no se esconde. */
  value: unknown;
  version: number;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface SettingListEntry {
  key: SettingKey;
  descripcion: string;
  valueType: SettingValueType;
  scopes: readonly SettingScope[];
  /**
   * El valor global vigente, CRUDO. Si `problem` no es `null`, no paso el
   * schema del registro y hay que corregirlo desde la misma pantalla; por eso
   * el listado no lanza donde `getSetting()` lanzaria.
   */
  value: unknown;
  /** `'global'` si hay fila, `'default'` si rige el registro, `'missing'` si no hay nada. */
  source: 'global' | 'default' | 'missing';
  version: number | null;
  updatedAt: Date | null;
  updatedBy: string | null;
  problem: string | null;
  overrides: SettingOverride[];
}

/**
 * Todas las claves del registro con su valor global vigente, su version, su
 * definicion y sus overrides. UNA consulta.
 *
 * ⚠️ Es lectura del back-office: no autoriza. Y no es "la tabla entera": una
 * fila con una clave que no este en el registro no aparece —no hay forma de
 * mostrarla con sentido—, aunque queda en la tabla y en `getSettingHistory`.
 */
export async function listSettings(db?: Database): Promise<SettingListEntry[]> {
  const filas = await settingRepo.findAllCurrent(db);

  const globales = new Map<SettingKey, AppSettingRow>();
  const overrides = new Map<SettingKey, SettingOverride[]>();

  for (const fila of filas) {
    if (!isSettingKey(fila.key)) continue;

    if (fila.scope === 'global') {
      globales.set(fila.key, fila);
      continue;
    }

    // Una fila no global sin `scope_id` no es de nadie: no se lista.
    if (fila.scopeId === null) continue;

    const lista = overrides.get(fila.key) ?? [];
    lista.push({
      scope: fila.scope,
      scopeId: fila.scopeId,
      value: fila.value,
      version: fila.version,
      updatedAt: fila.updatedAt ?? fila.createdAt,
      updatedBy: fila.updatedBy,
    });
    overrides.set(fila.key, lista);
  }

  return SETTING_KEYS.map((key) => {
    const def = definitionOf(key);
    const base = {
      key,
      descripcion: def.descripcion,
      valueType: def.valueType,
      scopes: def.scopes,
      overrides: overrides.get(key) ?? [],
    };

    const fila = globales.get(key);

    if (fila !== undefined) {
      const validado = safeParseSettingValue(key, fila.value);

      return {
        ...base,
        value: fila.value,
        source: 'global' as const,
        version: fila.version,
        updatedAt: fila.updatedAt ?? fila.createdAt,
        updatedBy: fila.updatedBy,
        problem: validado.ok ? null : validado.motivo,
      };
    }

    const porDefecto = def.defaultUntilSeeded;

    return {
      ...base,
      value: porDefecto ?? null,
      source: porDefecto === undefined ? ('missing' as const) : ('default' as const),
      version: null,
      updatedAt: null,
      updatedBy: null,
      problem: null,
    };
  });
}

/**
 * Historial de una clave en un ambito, de la mas nueva a la mas vieja. Es la
 * generalizacion de `findCommissionHistory()`.
 *
 * Devuelve las filas CRUDAS: un valor historico puede no pasar el schema de
 * hoy (el rango se ajusto despues) y sigue siendo lo que rigio entonces.
 * Pedir un ambito que la clave no admite es error del cliente (422).
 */
export async function getSettingHistory(
  key: SettingKey,
  scope: SettingScopeRef = GLOBAL_SCOPE,
  limite = 10,
  db?: Database,
): Promise<AppSettingRow[]> {
  assertSettingKey(key);

  if (!allowsScope(key, scope.scope)) {
    throw errors.settingScopeInvalid(
      key,
      `solo admite ${definitionOf(key).scopes.join(', ')}; se pidio ${scope.scope}`,
    );
  }

  return settingRepo.findHistory(key, limite, db, scope);
}
