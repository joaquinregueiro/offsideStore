import { getDatabase, type Database } from '@offside/database';
import { z } from 'zod';

import * as audit from '../../audit/services/audit.service';
import * as configErrors from '../../config/config.errors';
import * as settingRepo from '../../config/repositories/app-setting.repository';
import * as settingsService from '../../config/services/settings.service';
import * as orderEmails from '../../notifications/services/order-emails.service';
import * as tierRepo from '../repositories/seller-tier.repository';
import * as sellerErrors from '../seller.errors';
import * as errors from '../seller-tier.errors';

/**
 * SELLER_TIER — categoria comercial del vendedor con comision decreciente
 * (SS-014 / DEC-015 / DEC-037).
 *
 * QUE ES Y QUE NO ES (SS-015): el tier es la categoria COMERCIAL. No es el
 * USER LEVEL (NUEVO/CONFIABLE/... , DEC-020) ni el estado de riesgo (DEC-021).
 * Son tres ejes distintos y este modulo solo toca el primero. Por eso un
 * cambio de tier NO se emite en `user_history_events`: ese historial es la
 * fuente de verdad de la CONFIANZA (DEC-036), y el tier no es un hecho de
 * confianza, es una condicion comercial. Ademas `history_event_type` es un
 * enum sin valor para esto y agregarle uno es un cambio de ERD (CLAUDE.md §5).
 * Queda en `audit_log`, que es donde el ERD §7.2 manda los cambios de
 * `seller_tier_id`.
 *
 * DE DONDE SALEN LOS VALORES (⚙️ CONFIGURABLE, nunca hardcodeados):
 *
 *   seller_tiers                       las filas: code, tasa, umbral en `limits`
 *   seller_tier_evaluation             que cuenta como venta (solo COMPLETED,
 *                                      sin reembolsadas — BR-033 / BR-051)
 *   seller_tier_sales_window_days      ventana movil hacia atras
 *   seller_tier_auto_assign            si el sistema asigna solo
 *   seller_tier_auto_downgrade         si tambien baja solo
 *
 * Todos ASUMIDOS y editables desde admin (`erd-delta-2026-09-10.md`).
 *
 * ⚠️ UNIDAD. `seller_tiers.commission_rate` es una FRACCION en `numeric(6,4)`
 * (`'0.0600'` = 6%), igual que el snapshot de la orden;
 * `app_settings.commission_rate_default` esta en BASIS POINTS (600). Este
 * Service devuelve SIEMPRE basis points, que es la unidad con la que `orders`
 * calcula la comision, y la conversion se hace con strings, sin punto
 * flotante.
 *
 * ⚠️ SNAPSHOT (DEC-030). Nada de lo que devuelve este Service se guarda como
 * referencia: `orders` copia la tasa y el `code` a
 * `commission_rate_at_transaction` / `seller_tier_code_at_transaction` al crear
 * la orden y nunca vuelve a preguntar. Cambiar el tier de un vendedor no toca
 * una sola orden historica (ERD §7.2, CASO 8).
 */

/* -------------------------------------------------------------------------- */
/* Claves del Config Store                                                     */
/* -------------------------------------------------------------------------- */

export const TIER_SETTING_KEYS = {
  EVALUATION: 'seller_tier_evaluation',
  SALES_WINDOW_DAYS: 'seller_tier_sales_window_days',
  AUTO_ASSIGN: 'seller_tier_auto_assign',
  AUTO_DOWNGRADE: 'seller_tier_auto_downgrade',
} as const;

/** Accion que queda en `audit_log` ante cualquier cambio de tier (ERD §7.2). */
export const AUDIT_ACTION_TIER_CHANGED = 'SELLER_TIER_CHANGED';

const ENTITY_TYPE = 'seller_profile';

/**
 * `countsOnly` es un LITERAL a proposito: que solo cuenten las COMPLETED es
 * BR-033 + BR-051, no una preferencia. La clave existe para que la regla quede
 * escrita donde se lee la configuracion, no para habilitar `PAID`. Si algun dia
 * se decide otra cosa, se amplia aca con la decision documentada.
 */
const evaluationSchema = z.object({
  countsOnly: z.literal('COMPLETED'),
  excludesRefunded: z.boolean(),
});

/** 0 = sin ventana: cuentan todas las ventas de la historia. */
const windowDaysSchema = z.number().int().nonnegative();

const boolSchema = z.boolean();

export interface TierSettings {
  autoAssign: boolean;
  autoDowngrade: boolean;
  /** `null` = sin ventana. */
  windowDays: number | null;
  excludeRefunded: boolean;
}

/**
 * Lee una clave y valida su FORMA con Zod, no con `value_type`: `value_type`
 * es una etiqueta que escribio quien cargo la fila, y lo que importa es que el
 * valor sirva para lo que este Service hace con el.
 *
 * ⚠️ Lee `app_settings` por el repository de `config` y no por su Service
 * porque `settings.service` hoy solo expone la comision. Lo correcto es un
 * `getSetting(key)` generico en ese Service; hasta que exista, este es el
 * unico punto del modulo que cruza esa frontera (anotado en el reporte).
 */
async function leerSetting<T>(key: string, forma: z.ZodType<T>, db?: Database): Promise<T> {
  const row = await settingRepo.findCurrent(key, db);
  if (row === undefined) throw configErrors.settingNotConfigured(key);

  const parsed = forma.safeParse(row.value);
  if (!parsed.success) {
    throw errors.tierSettingInvalid(key, parsed.error.issues[0]?.message ?? 'forma inesperada');
  }

  return parsed.data;
}

export async function loadTierSettings(db?: Database): Promise<TierSettings> {
  const [autoAssign, autoDowngrade, windowDays, evaluation] = await Promise.all([
    leerSetting(TIER_SETTING_KEYS.AUTO_ASSIGN, boolSchema, db),
    leerSetting(TIER_SETTING_KEYS.AUTO_DOWNGRADE, boolSchema, db),
    leerSetting(TIER_SETTING_KEYS.SALES_WINDOW_DAYS, windowDaysSchema, db),
    leerSetting(TIER_SETTING_KEYS.EVALUATION, evaluationSchema, db),
  ]);

  return {
    autoAssign,
    autoDowngrade,
    windowDays: windowDays === 0 ? null : windowDays,
    excludeRefunded: evaluation.excludesRefunded,
  };
}

/* -------------------------------------------------------------------------- */
/* Definicion de tier (forma validada de una fila)                             */
/* -------------------------------------------------------------------------- */

export interface TierDefinition {
  id: string;
  code: string;
  name: string;
  /**
   * Tasa del tier en basis points. `null` = el tier NO pisa la tasa: rige la
   * global (`commission_rate_default`). El ERD §7.1 deja `commission_rate`
   * nullable y esa es la unica lectura que no inventa un numero.
   */
  basisPoints: number | null;
  /** Ordenes COMPLETED que hacen falta para alcanzarlo (`limits.minCompletedSales`). */
  minCompletedSales: number;
  isActive: boolean;
}

const limitsSchema = z.object({ minCompletedSales: z.number().int().nonnegative() });

/**
 * `'0.0600'` -> 600. `undefined` si el string no es un `numeric` con hasta
 * cuatro decimales o si se sale de [0, 10000].
 *
 * Con strings y enteros: `Number('0.0600') * 10000` puede dar 599.9999999 y
 * eso, redondeado o truncado, es una comision distinta de la configurada.
 */
export function rateToBasisPoints(rate: string): number | undefined {
  const m = /^(\d+)(?:\.(\d{0,4}))?$/.exec(rate.trim());
  if (m === null) return undefined;

  const entero = Number(m[1]);
  const decimales = (m[2] ?? '').padEnd(4, '0');
  const bp = entero * settingsService.BASIS_POINTS_TOTAL + Number(decimales);

  if (!Number.isSafeInteger(bp) || bp > settingsService.BASIS_POINTS_TOTAL) return undefined;

  return bp;
}

/** Valida la forma de una fila. Lanza `tierInvalid` si no sirve para operar. */
export function toTierDefinition(row: tierRepo.SellerTierRow): TierDefinition {
  const limits = limitsSchema.safeParse(row.limits);
  if (!limits.success) {
    throw errors.tierInvalid(row.code, '`limits.minCompletedSales` tiene que ser un entero >= 0');
  }

  let basisPoints: number | null = null;
  if (row.commissionRate !== null) {
    const bp = rateToBasisPoints(row.commissionRate);
    if (bp === undefined) {
      throw errors.tierInvalid(row.code, 'la tasa tiene que ser una fracción entre 0 y 1');
    }
    basisPoints = bp;
  }

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    basisPoints,
    minCompletedSales: limits.data.minCompletedSales,
    isActive: row.isActive,
  };
}

/* -------------------------------------------------------------------------- */
/* Reglas puras: eleccion por umbral y decision de cambio                      */
/* -------------------------------------------------------------------------- */

function porUmbralYCodigo(a: TierDefinition, b: TierDefinition): number {
  return a.minCompletedSales - b.minCompletedSales || a.code.localeCompare(b.code);
}

/**
 * El tier de MAYOR umbral alcanzado con `completedSales` ventas.
 *
 * No depende del orden de entrada. Empate de umbral: gana el ultimo por
 * `code`, que es determinista; un empate real seria una configuracion
 * ambigua que conviene no tener.
 */
export function pickTierForSales(
  tiers: readonly TierDefinition[],
  completedSales: number,
): TierDefinition | undefined {
  let elegido: TierDefinition | undefined;

  for (const tier of [...tiers].sort(porUmbralYCodigo)) {
    if (tier.minCompletedSales <= completedSales) elegido = tier;
  }

  return elegido;
}

export type TierChangeKind = 'assign' | 'upgrade' | 'downgrade';

export type TierChange =
  | { kind: 'none'; reason: 'no_candidate' | 'same_tier' | 'downgrade_disabled' }
  | { kind: TierChangeKind; to: TierDefinition };

/**
 * Que hacer con el tier actual dado el que corresponde por ventas.
 *
 * ⚠️ POR DEFECTO NUNCA BAJA. Bajar de tier es cobrarle mas a alguien, y la
 * documentacion no dice que pase solo: `seller_tier_auto_downgrade` arranca
 * apagada y mientras siga asi el tier solo sube. Con dos tiers de igual umbral
 * tampoco se salta de uno al otro: no seria ni subir ni bajar.
 */
export function decideTierChange(
  current: TierDefinition | null,
  candidate: TierDefinition | undefined,
  autoDowngrade: boolean,
): TierChange {
  if (candidate === undefined) return { kind: 'none', reason: 'no_candidate' };
  if (current === null) return { kind: 'assign', to: candidate };
  if (current.id === candidate.id) return { kind: 'none', reason: 'same_tier' };

  if (candidate.minCompletedSales > current.minCompletedSales) {
    return { kind: 'upgrade', to: candidate };
  }

  if (candidate.minCompletedSales < current.minCompletedSales) {
    return autoDowngrade
      ? { kind: 'downgrade', to: candidate }
      : { kind: 'none', reason: 'downgrade_disabled' };
  }

  return { kind: 'none', reason: 'same_tier' };
}

/* -------------------------------------------------------------------------- */
/* Comision efectiva                                                           */
/* -------------------------------------------------------------------------- */

export interface ResolvedCommission {
  /** Tasa a aplicar, en basis points. */
  basisPoints: number;
  /** `code` del tier del vendedor, para `seller_tier_code_at_transaction`. */
  tierCode: string | null;
  /**
   * De donde salio la tasa, en los terminos de `orders.commission_source`:
   * `seller_tier` si la fijo el tier, `default` si rigio la global (sin tier,
   * tier inactivo o tier sin tasa propia). `promoted` lo decide `orders` si
   * despues multiplica por una promocion.
   */
  source: 'default' | 'seller_tier';
}

/**
 * La tasa que le corresponde HOY al vendedor: la de su tier, o la global si
 * no tiene tier (DEC-007 / DEC-043).
 *
 * ⚠️ SOLO PARA CREAR UNA ORDEN. `orders` la llama una vez, congela el
 * resultado en el snapshot y no vuelve a preguntar (DEC-030).
 *
 * Un tier INACTIVO no aplica: desactivarlo desde Admin tiene que dejar de
 * cobrarlo en el acto, aunque los perfiles sigan apuntandolo hasta la proxima
 * evaluacion. Un tier sin tasa propia tampoco pisa la global, pero si deja su
 * `code` en el snapshot: el vendedor ESTABA en ese tier.
 */
export async function resolveCommissionBasisPoints(
  sellerId: string,
  db?: Database,
): Promise<ResolvedCommission> {
  const seller = await tierRepo.findSellerWithTier(sellerId, db);
  if (seller === undefined) throw sellerErrors.sellerProfileNotFound();

  const global = () => settingsService.getCommissionRateBasisPoints(db);

  if (!seller.tier?.isActive) {
    return { basisPoints: await global(), tierCode: null, source: 'default' };
  }

  const tier = toTierDefinition(seller.tier);

  if (tier.basisPoints === null) {
    return { basisPoints: await global(), tierCode: tier.code, source: 'default' };
  }

  return { basisPoints: tier.basisPoints, tierCode: tier.code, source: 'seller_tier' };
}

/* -------------------------------------------------------------------------- */
/* Evaluacion y asignacion                                                     */
/* -------------------------------------------------------------------------- */

export type TierEvaluationReason =
  | 'assigned'
  | 'upgraded'
  | 'downgraded'
  | 'unchanged'
  | 'below_all_thresholds'
  | 'downgrade_disabled'
  | 'auto_assign_disabled'
  | 'concurrent_change';

export interface TierEvaluation {
  sellerId: string;
  /** Ventas que contaron, ya con la ventana y sin reembolsadas. */
  completedSales: number;
  windowDays: number | null;
  previousTierCode: string | null;
  tierCode: string | null;
  changed: boolean;
  reason: TierEvaluationReason;
  /**
   * El tier al que se PASO, solo cuando `changed`. Es lo que necesita
   * `notifyTierChange()`: quien evalua dentro de su propia transaccion lo
   * llama con esto DESPUES de commitear.
   */
  tier: TierDefinition | null;
}

function desde(windowDays: number | null, ahora: Date): Date | null {
  if (windowDays === null) return null;

  return new Date(ahora.getTime() - windowDays * 86_400_000);
}

async function tiersActivos(db: Database): Promise<TierDefinition[]> {
  const filas = await tierRepo.findActiveTiers(db);
  if (filas.length === 0) throw errors.noActiveTiers();

  return filas.map(toTierDefinition);
}

/**
 * Aplica un cambio de tier y lo audita en la MISMA transaccion.
 *
 * Devuelve `false` si otra evaluacion se adelanto (el WHERE del repository
 * no encontro el tier previo): en ese caso no hay nada que auditar, porque
 * no cambio nada desde aca.
 */
async function aplicarCambio(
  tx: Database,
  seller: { sellerId: string; sellerTierId: string | null; tierCode: string | null },
  to: TierDefinition,
  actor: { actorType: audit.AuditActorType; actorId?: string | undefined },
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const cambiado = await tierRepo.assignTier(
    seller.sellerId,
    { fromTierId: seller.sellerTierId, toTierId: to.id },
    tx,
  );

  if (cambiado === undefined) return false;

  await audit.record(
    {
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: AUDIT_ACTION_TIER_CHANGED,
      entityType: ENTITY_TYPE,
      entityId: seller.sellerId,
      before: { sellerTierCode: seller.tierCode },
      after: { sellerTierCode: to.code },
      metadata,
    },
    tx,
  );

  return true;
}

/**
 * Recalcula el tier del vendedor a partir de sus ventas COMPLETED y, si
 * corresponde, lo asigna. Idempotente: evaluar dos veces seguidas no cambia
 * nada la segunda ni audita de mas.
 *
 * Quien deberia llamarla: `orders`, cuando una orden pasa a COMPLETED (es el
 * unico hecho que puede subir un tier), y un refund COMPLETED si
 * `auto_downgrade` estuviera encendido. Un job de barrido tambien sirve.
 *
 * Con `seller_tier_auto_assign` apagado NO escribe: devuelve lo que
 * corresponderia y deja la asignacion a una persona (`assignTierManually`).
 */
export async function evaluateSellerTier(sellerId: string, db?: Database): Promise<TierEvaluation> {
  const ejecutar = async (tx: Database): Promise<TierEvaluation> => {
    const settings = await loadTierSettings(tx);

    const seller = await tierRepo.findSellerWithTier(sellerId, tx);
    if (seller === undefined) throw sellerErrors.sellerProfileNotFound();

    const tiers = await tiersActivos(tx);
    const completedSales = await tierRepo.countCompletedSales(
      sellerId,
      { since: desde(settings.windowDays, new Date()), excludeRefunded: settings.excludeRefunded },
      tx,
    );

    // El tier actual puede estar inactivo o mal formado; para DECIDIR alcanza
    // con saber su umbral, y si esta roto, tratarlo como "sin tier" deja que la
    // evaluacion lo reemplace por uno sano en vez de trabarse.
    const actual = seller.tier === null ? null : definicionOSinTier(seller.tier);
    const base = {
      sellerId,
      completedSales,
      windowDays: settings.windowDays,
      previousTierCode: seller.tier?.code ?? null,
    };

    const candidato = pickTierForSales(tiers, completedSales);
    const sinCambio = (reason: TierEvaluationReason): TierEvaluation => ({
      ...base,
      tierCode: base.previousTierCode,
      changed: false,
      reason,
      tier: null,
    });

    if (!settings.autoAssign) return sinCambio('auto_assign_disabled');

    const cambio = decideTierChange(actual, candidato, settings.autoDowngrade);

    if (cambio.kind === 'none') {
      return sinCambio(
        cambio.reason === 'no_candidate'
          ? 'below_all_thresholds'
          : cambio.reason === 'downgrade_disabled'
            ? 'downgrade_disabled'
            : 'unchanged',
      );
    }

    const aplicado = await aplicarCambio(
      tx,
      { sellerId, sellerTierId: seller.sellerTierId, tierCode: base.previousTierCode },
      cambio.to,
      { actorType: 'system' },
      { completedSales, windowDays: settings.windowDays, kind: cambio.kind },
    );

    if (!aplicado) return sinCambio('concurrent_change');

    const reason: TierEvaluationReason =
      cambio.kind === 'assign' ? 'assigned' : cambio.kind === 'upgrade' ? 'upgraded' : 'downgraded';

    return { ...base, tierCode: cambio.to.code, changed: true, reason, tier: cambio.to };
  };

  if (db !== undefined) return ejecutar(db);

  // Transaccion propia: se avisa recien DESPUES de commitear (ver
  // `notifyTierChange`). Con un `db` ajeno no se sabe cuando commitea, y el
  // aviso queda a cargo de quien llamo.
  const resultado = await getDatabase().transaction(ejecutar);
  if (resultado.changed && resultado.tier !== null) {
    await notifyTierChange(sellerId, resultado.tier);
  }

  return resultado;
}

/**
 * Le avisa al vendedor por email que cambio de tier
 * (`nivelDeVendedorActualizado`, `notifications-and-engagement.md` §2.1).
 *
 * ⚠️ SE LLAMA DESPUES DE COMMITEAR, nunca adentro de la transaccion que cambia
 * el tier: encolar adentro mandaria "tu nivel cambio" de un cambio que
 * todavia puede revertirse. `evaluateSellerTier` y `assignTierManually` lo
 * hacen solos cuando la transaccion es propia; si recibieron un `db` ajeno, el
 * que lo pasa llama esto con `resultado.tier` una vez commiteado.
 *
 * ⚠️ NO LANZA. Que no se pueda avisar no deshace un cambio de tier que ya
 * esta escrito y auditado. Devuelve el id del job, o `null` si no se encolo.
 *
 * El email lleva la tasa PROPIA del tier (`null` si el tier no la define): el
 * email no inventa un numero, y la global se puede cambiar despues.
 */
export async function notifyTierChange(
  sellerId: string,
  tier: Pick<TierDefinition, 'code' | 'name' | 'basisPoints'>,
  db?: Database,
): Promise<string | null> {
  try {
    const contacto = await tierRepo.findSellerContact(sellerId, db);
    if (contacto === undefined) return null;

    return await orderEmails.nivelDeVendedorActualizado(contacto, {
      codigo: tier.code,
      nombre: tier.name,
      comisionBasisPoints: tier.basisPoints,
    });
  } catch (error) {
    console.error(
      `[sellers] no se pudo avisar el cambio de tier del vendedor ${sellerId}:`,
      error instanceof Error ? error.message : String(error),
    );

    return null;
  }
}

function definicionOSinTier(row: tierRepo.SellerTierRow): TierDefinition | null {
  try {
    return toTierDefinition(row);
  } catch {
    // Fila mal configurada: se decide como si no tuviera tier. El error real
    // aparece igual cuando alguien intente cobrar con ese tier
    // (`resolveCommissionBasisPoints`), que es donde importa.
    return null;
  }
}

export interface InitialTierAssignment {
  tierCode: string | null;
  /** `true` solo si ESTA llamada escribio el tier. */
  assigned: boolean;
}

/**
 * Le da al vendedor recien aprobado el tier de menor umbral (TS-010 → SS-014).
 *
 * Lo llama `seller-approval.service` justo despues de aprobar. Idempotente: si
 * ya tiene tier no lo toca, sea cual sea. El tier inicial cobra lo mismo que
 * la global a proposito (`0010`), asi que asignarlo no cambia lo que paga
 * nadie: solo deja explicito desde donde arranca la progresion.
 *
 * ASUMIDO: respeta `seller_tier_auto_assign`. Con la perilla apagada el
 * sistema no asigna nada, ni siquiera el inicial, y el vendedor paga la global
 * hasta que una persona lo ubique. Es la lectura literal de "lo asigna una
 * persona desde Admin".
 */
export async function assignInitialTier(
  sellerId: string,
  db?: Database,
): Promise<InitialTierAssignment> {
  const ejecutar = async (tx: Database): Promise<InitialTierAssignment> => {
    const seller = await tierRepo.findSellerWithTier(sellerId, tx);
    if (seller === undefined) throw sellerErrors.sellerProfileNotFound();

    if (seller.tier !== null) return { tierCode: seller.tier.code, assigned: false };

    const autoAssign = await leerSetting(TIER_SETTING_KEYS.AUTO_ASSIGN, boolSchema, tx);
    if (!autoAssign) return { tierCode: null, assigned: false };

    const [inicial] = [...(await tiersActivos(tx))].sort(porUmbralYCodigo);
    if (inicial === undefined) throw errors.noActiveTiers();

    const aplicado = await aplicarCambio(
      tx,
      { sellerId, sellerTierId: null, tierCode: null },
      inicial,
      { actorType: 'system' },
      { kind: 'assign', reason: 'initial' },
    );

    if (!aplicado) {
      // Otra llamada lo asigno entre la lectura y el UPDATE. Se informa lo que
      // quedo, que es lo que el llamador quiere saber.
      const ahora = await tierRepo.findSellerWithTier(sellerId, tx);
      return { tierCode: ahora?.tier?.code ?? null, assigned: false };
    }

    return { tierCode: inicial.code, assigned: true };
  };

  return db === undefined ? getDatabase().transaction(ejecutar) : ejecutar(db);
}

/**
 * Asignacion MANUAL por una persona del back-office.
 *
 * ⚠️ NO AUTORIZA. Quien llama tiene que haber exigido la capacidad que
 * corresponda (`lib/permissions.ts`, DEC-023) antes; hoy no existe una para
 * tiers y agregarla es decision del owner. `actorId` es el id del
 * administrador autenticado, tomado de la sesion, nunca del cuerpo.
 *
 * Acepta bajar: la decision la tomo una persona y queda auditada con su id,
 * que es exactamente lo que `auto_downgrade` apagado exige (BR-052).
 */
/**
 * ⚠️ EL MOTIVO ES OBLIGATORIO Y VA A LA AUDITORIA. Cambiarle el nivel a un
 * vendedor a mano le cambia la comision que se le cobra: sin el motivo, dentro
 * de seis meses `audit_log` dice quien lo hizo y cuando, y nadie puede
 * responder por que. Es la misma exigencia que ya tienen terminar una
 * promocion y otorgar el nivel TIENDA.
 */
export async function assignTierManually(
  sellerId: string,
  tierCode: string,
  actorId: string,
  motivo: string,
  db?: Database,
): Promise<ManualTierAssignment> {
  const razon = motivo.trim();
  if (razon.length === 0) throw errors.tierReasonRequired();

  const ejecutar = async (tx: Database): Promise<ManualTierAssignment> => {
    const fila = await tierRepo.findByCode(tierCode, tx);
    if (!fila?.isActive) throw errors.tierNotFound(tierCode);
    const destino = toTierDefinition(fila);

    const seller = await tierRepo.findSellerWithTier(sellerId, tx);
    if (seller === undefined) throw sellerErrors.sellerProfileNotFound();

    const previo = seller.tier?.code ?? null;
    if (seller.sellerTierId === destino.id) {
      return { previousTierCode: previo, tierCode: destino.code, changed: false, tier: destino };
    }

    const aplicado = await aplicarCambio(
      tx,
      { sellerId, sellerTierId: seller.sellerTierId, tierCode: previo },
      destino,
      { actorType: 'admin', actorId },
      { kind: 'manual', motivo: razon },
    );

    return { previousTierCode: previo, tierCode: destino.code, changed: aplicado, tier: destino };
  };

  if (db !== undefined) return ejecutar(db);

  const resultado = await getDatabase().transaction(ejecutar);
  if (resultado.changed) await notifyTierChange(sellerId, resultado.tier);

  return resultado;
}

export interface ManualTierAssignment {
  previousTierCode: string | null;
  tierCode: string;
  changed: boolean;
  /** El tier destino, para `notifyTierChange()` si la transaccion era ajena. */
  tier: TierDefinition;
}

/* -------------------------------------------------------------------------- */
/* Progreso, para el panel del vendedor                                        */
/* -------------------------------------------------------------------------- */

export interface TierSummary {
  code: string;
  name: string;
  /** Tasa efectiva del tier: la propia o, si no tiene, la global. */
  basisPoints: number;
  /** La misma tasa, legible: `'6%'`, `'5.5%'`. */
  rateLabel: string;
  /** `true` si el tier no fija tasa propia y rige la global. */
  usesGlobalRate: boolean;
  minCompletedSales: number;
  /** `benefits.description` si esta cargada; texto libre para la pantalla. */
  description: string | null;
}

export interface TierProgress {
  currentTier: TierSummary | null;
  /** Lo que paga hoy: la del tier o la global. Para mostrar, no para cobrar. */
  currentBasisPoints: number;
  /** `currentBasisPoints`, legible. */
  currentRateLabel: string;
  completedSales: number;
  windowDays: number | null;
  /** Siguiente escalon por umbral, o `null` si ya esta en el mas alto. */
  nextTier: (TierSummary & { remainingSales: number }) | null;
  /** Todos los tiers activos, del umbral mas bajo al mas alto. */
  tiers: TierSummary[];
  /** Si el sistema asigna solo o hay que esperar a una persona. */
  autoAssign: boolean;
}

function resumir(t: TierDefinition, global: number, descripcion: string | null): TierSummary {
  const basisPoints = t.basisPoints ?? global;

  return {
    code: t.code,
    name: t.name,
    basisPoints,
    rateLabel: settingsService.basisPointsToPercent(basisPoints),
    usesGlobalRate: t.basisPoints === null,
    minCompletedSales: t.minCompletedSales,
    description: descripcion,
  };
}

/** `benefits.description` es JSON libre (ERD §7.1): solo se toma si es texto. */
function descripcionDe(row: tierRepo.SellerTierRow): string | null {
  const benefits = row.benefits;
  if (typeof benefits !== 'object' || benefits === null || !('description' in benefits)) {
    return null;
  }
  const { description } = benefits;

  return typeof description === 'string' && description.trim() !== '' ? description : null;
}

/**
 * Los tiers activos, del umbral mas bajo al mas alto, con su tasa legible.
 * Para `/como-funciona` y `/vendedor/nivel`: SOLO LECTURA.
 *
 * Un tier sin tasa propia muestra la global y lo dice (`usesGlobalRate`):
 * la pantalla no tiene que adivinar que significa un `null`.
 */
export async function listTiers(db?: Database): Promise<TierSummary[]> {
  const [filas, global] = await Promise.all([
    tierRepo.findActiveTiers(db),
    settingsService.getCommissionRateBasisPoints(db),
  ]);
  if (filas.length === 0) throw errors.noActiveTiers();

  return filas
    .map((fila) => ({ def: toTierDefinition(fila), descripcion: descripcionDe(fila) }))
    .sort((a, b) => porUmbralYCodigo(a.def, b.def))
    .map(({ def, descripcion }) => resumir(def, global, descripcion));
}

/**
 * Tier actual, ventas que cuentan, cuantas faltan para el proximo y las dos
 * tasas. SOLO LECTURA: no evalua ni asigna, para que refrescar el panel no
 * escriba nada.
 *
 * "Proximo" es el siguiente por UMBRAL respecto del tier actual, no respecto
 * de las ventas: si el vendedor tiene 12 ventas y sigue en INICIAL porque
 * nadie evaluo todavia, el proximo es AVANZADO (faltan 0), no PROFESIONAL.
 * Mostrar otra cosa seria prometer un salto que la evaluacion no da.
 */
export async function getTierProgress(sellerId: string, db?: Database): Promise<TierProgress> {
  const seller = await tierRepo.findSellerWithTier(sellerId, db);
  if (seller === undefined) throw sellerErrors.sellerProfileNotFound();

  const [settings, filas, global] = await Promise.all([
    loadTierSettings(db),
    tierRepo.findActiveTiers(db),
    settingsService.getCommissionRateBasisPoints(db),
  ]);
  if (filas.length === 0) throw errors.noActiveTiers();

  const completedSales = await tierRepo.countCompletedSales(
    sellerId,
    { since: desde(settings.windowDays, new Date()), excludeRefunded: settings.excludeRefunded },
    db,
  );

  const descripciones = new Map(filas.map((f) => [f.id, descripcionDe(f)]));
  const resumen = (t: TierDefinition): TierSummary =>
    resumir(t, global, descripciones.get(t.id) ?? null);

  const ordenados = filas.map(toTierDefinition).sort(porUmbralYCodigo);
  const actual = !seller.tier?.isActive ? null : definicionOSinTier(seller.tier);
  const umbralActual = actual?.minCompletedSales ?? -1;
  const siguiente = ordenados.find((t) => t.minCompletedSales > umbralActual);
  const currentBasisPoints = actual?.basisPoints ?? global;

  return {
    currentTier: actual === null ? null : resumen(actual),
    currentBasisPoints,
    currentRateLabel: settingsService.basisPointsToPercent(currentBasisPoints),
    completedSales,
    windowDays: settings.windowDays,
    nextTier:
      siguiente === undefined
        ? null
        : {
            ...resumen(siguiente),
            remainingSales: Math.max(0, siguiente.minCompletedSales - completedSales),
          },
    tiers: ordenados.map(resumen),
    autoAssign: settings.autoAssign,
  };
}
