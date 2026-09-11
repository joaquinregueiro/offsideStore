import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireCapability } from '@/lib/auth-guard';
import { handleError, ok, readJson } from '@/lib/http';
import { CAPABILITIES } from '@/lib/permissions';
import { consumeUserLimit, type RateLimitScope } from '@/lib/rate-limit';
import { rateLimited } from '@/modules/auth/auth.errors';

import { GLOBAL_SCOPE, type SettingScopeRef } from '../repositories/app-setting.repository';
import * as settingStore from '../services/setting-store.service';
import { assertSettingKey } from '../services/settings-registry';
import * as settingsService from '../services/settings.service';

/**
 * Consume una unidad del limite POR USUARIO o lanza `RATE_LIMITED`.
 *
 * ⚠️ ES EL MISMO CONTADOR QUE CONSUME LA SERVER ACTION equivalente. Si contaran
 * aparte, bloquear un camino no serviria de nada: el otro seguiria abierto. Es
 * exactamente el agujero que tenia el login antes de `rate-limit-actions.ts`.
 *
 * ⚠️ TENER LA CAPACIDAD NO VUELVE INOFENSIVA LA REPETICION: cada cambio inserta
 * una fila NUEVA de configuracion —`app_settings` es versionada—, asi que un
 * bucle escribe historial sin fin. Es ademas el techo que queda si una sesion
 * de admin se filtra.
 */
async function enforceUserLimit(scope: RateLimitScope, userId: string): Promise<void> {
  const decision = await consumeUserLimit(scope, userId);
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
}

/**
 * Controller del Config Store. Sin reglas de negocio.
 *
 * Dos familias de handlers:
 *
 *   - los de la COMISION (`getCommission` / `updateCommission`), que siguen
 *     tal cual: `/admin/comision` y su ruta los usan;
 *   - los GENERICOS (`listSettings` / `updateSetting`, 2026-09-11), para que
 *     el back-office edite ventanas, multiplicadores, umbrales y flags sin un
 *     endpoint por clave.
 *
 * ⚠️ "GENERICO" NO ES "LA TABLA ENTERA". Este archivo decia que un `GET
 * /api/admin/settings` seria una fuga el dia que alguien guarde una clave
 * sensible en `app_settings`, y el argumento sigue valiendo: por eso el
 * listado sale de `listSettings()`, que recorre el REGISTRO
 * (`settings-registry.ts`) y no la tabla. Una fila cuya clave no este
 * registrada no se devuelve, y en el registro solo entran parametros de
 * negocio: un secreto no tiene schema ahi ni lo va a tener.
 */

/**
 * Cuerpo del cambio de comision.
 *
 * ⚠️ `.strict()` A PROPOSITO. Sin el, un cliente podria mandar `updatedBy` y Zod
 * lo descartaria en silencio; con el, recibe un 400 y queda claro que ese campo
 * no se acepta. El autor del cambio sale SIEMPRE de la sesion.
 */
const updateCommissionSchema = z
  .object({
    /**
     * Entero en basis points. 600 = 6%.
     *
     * El rango se valida ACA ademas de en el Service, y no es duplicacion: son
     * dos errores distintos. Un administrador que manda 20000 comete un error
     * de CLIENTE y merece un 422 que lo explique; un valor fuera de rango
     * LEIDO de `app_settings` es data corrupta y merece un 500. Sin esta
     * validacion, el primer caso devolvia 500 y parecia un bug del servidor.
     *
     * El tope de 100% no es un limite comercial —DEC-014 dice "sin minimo ni
     * maximo"— sino tecnico: una tasa mayor haria `marketplace_fee` mayor que
     * el total, y Mercado Pago rechaza la preferencia.
     */
    basisPoints: z
      .number()
      .int('La comision se expresa en basis points enteros (600 = 6%)')
      .min(0, 'La comision no puede ser negativa')
      .max(10_000, 'La comision no puede superar el 100% (10000 basis points)'),
  })
  .strict();

/** Vista publica de la comision vigente. */
interface PublicCommissionSetting {
  key: string;
  basisPoints: number;
  /** Derivado, para leerlo sin hacer la cuenta. No se persiste. */
  percent: string;
  /** Version vigente en `app_settings`. Sube con cada cambio. */
  version: number;
  updatedAt: string | null;
}

/**
 * `GET /api/admin/settings/commission` — comision vigente.
 *
 * Requiere `system_config:manage`, igual que el PUT: quien no puede cambiarla
 * tampoco necesita verla desde el back-office.
 */
export async function getCommission(request: Request): Promise<NextResponse> {
  try {
    await requireCapability(request, CAPABILITIES.SYSTEM_CONFIG_MANAGE);

    const basisPoints = await settingsService.getCommissionRateBasisPoints();
    const row = await settingsService.findCurrentCommissionSetting();

    const vista: PublicCommissionSetting = {
      key: settingsService.COMMISSION_RATE_KEY,
      basisPoints,
      percent: settingsService.basisPointsToPercent(basisPoints),
      version: row?.version ?? 1,
      updatedAt: (row?.updatedAt ?? row?.createdAt)?.toISOString() ?? null,
    };

    return ok({ commission: vista });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * `PUT /api/admin/settings/commission` — cambia la comision.
 *
 * ⚠️ NO AFECTA A LAS ORDENES YA CREADAS. Cada orden congela su tasa al nacer
 * (DEC-030); esto solo cambia lo que van a usar las ordenes NUEVAS.
 *
 * ⚠️ `updatedBy` SALE DE LA SESION, nunca del cuerpo. Es lo unico que hace
 * confiable el historial de `app_settings`: si el cliente pudiera declarar el
 * autor, el registro no probaria nada.
 *
 * No se audita aparte: `app_settings` ya es versionada y cada cambio deja su
 * fila con `updated_by`. Una segunda auditoria seria el mismo hecho contado dos
 * veces, con el riesgo de que se desincronicen.
 */
export async function updateCommission(request: Request): Promise<NextResponse> {
  try {
    const admin = await requireCapability(request, CAPABILITIES.SYSTEM_CONFIG_MANAGE);
    await enforceUserLimit('system-config', admin.id);

    const input = updateCommissionSchema.parse(await readJson(request));

    const basisPoints = await settingsService.setCommissionRateBasisPoints(
      input.basisPoints,
      admin.id,
    );

    const row = await settingsService.findCurrentCommissionSetting();

    const vista: PublicCommissionSetting = {
      key: settingsService.COMMISSION_RATE_KEY,
      basisPoints,
      percent: settingsService.basisPointsToPercent(basisPoints),
      version: row?.version ?? 1,
      updatedAt: (row?.updatedAt ?? row?.createdAt)?.toISOString() ?? null,
    };

    return ok({ commission: vista });
  } catch (error) {
    return handleError(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Handlers genericos (todas las claves del registro)                          */
/* -------------------------------------------------------------------------- */

/** Fechas a ISO: es lo unico del listado que no viaja tal cual por JSON. */
function toPublicEntry(entry: settingStore.SettingListEntry) {
  return {
    ...entry,
    updatedAt: entry.updatedAt?.toISOString() ?? null,
    overrides: entry.overrides.map((o) => ({ ...o, updatedAt: o.updatedAt.toISOString() })),
  };
}

/**
 * `GET /api/admin/settings` — todas las claves del registro con su valor
 * vigente, version, definicion y overrides. Requiere `system_config:manage`.
 */
export async function listSettings(request: Request): Promise<NextResponse> {
  try {
    await requireCapability(request, CAPABILITIES.SYSTEM_CONFIG_MANAGE);

    const settings = await settingStore.listSettings();

    return ok({ settings: settings.map(toPublicEntry) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Cuerpo del cambio generico.
 *
 * ⚠️ `.strict()` por el mismo motivo que la comision: `updatedBy` en el cuerpo
 * es un 422, no un campo ignorado. El autor sale SIEMPRE de la sesion.
 *
 * `value` es `z.json()` y no `z.unknown()`: lo que se guarda es `jsonb`, y un
 * `undefined` o una funcion no tienen forma de llegar ahi. La validacion de
 * FORMA por clave (rango, tipo, json con estructura) la hace el Service
 * contra el registro y devuelve `VALIDATION_FAILED`, que `handleError`
 * traduce a 422: el administrador que manda un plazo negativo recibe el
 * motivo, no un 500.
 *
 * `scope` + `scopeId` viajan sueltos porque asi los manda un formulario; el
 * `superRefine` reconstruye la union discriminada que el repositorio exige
 * (global SIN id, los otros CON id) antes de que el Service la vea.
 */
const updateSettingSchema = z
  .object({
    key: z.string().min(1).max(100),
    value: z.json(),
    scope: z.enum(['global', 'seller_tier', 'category']).default('global'),
    scopeId: z.uuid().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.scope === 'global' && body.scopeId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['scopeId'],
        message: 'el ambito global no lleva scopeId',
      });
    }

    if (body.scope !== 'global' && body.scopeId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['scopeId'],
        message: `el ambito ${body.scope} exige scopeId`,
      });
    }
  });

/**
 * `PUT /api/admin/settings` — cambia UNA clave en UN ambito. Inserta una
 * version nueva; la anterior queda como historial (DEC-030).
 *
 * ⚠️ NO AFECTA TRANSACCIONES YA CREADAS: cada orden congela lo que uso.
 * Comparte el contador de rate limit con el cambio de comision: es la misma
 * familia de operacion y bloquear una sin la otra no serviria de nada.
 */
export async function updateSetting(request: Request): Promise<NextResponse> {
  try {
    const admin = await requireCapability(request, CAPABILITIES.SYSTEM_CONFIG_MANAGE);
    await enforceUserLimit('system-config', admin.id);

    const input = updateSettingSchema.parse(await readJson(request));
    const key = assertSettingKey(input.key);

    // El `superRefine` ya garantizo la pareja scope/scopeId; esto solo la tipa.
    const scope: SettingScopeRef =
      input.scope === 'global' || input.scopeId === undefined
        ? GLOBAL_SCOPE
        : { scope: input.scope, scopeId: input.scopeId };

    const resultado = await settingStore.setSetting(key, input.value, admin.id, undefined, scope);

    return ok({
      setting: { ...resultado, createdAt: resultado.createdAt.toISOString() },
    });
  } catch (error) {
    return handleError(error);
  }
}
