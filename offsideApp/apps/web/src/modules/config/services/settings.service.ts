import type { Database } from '@offside/database';

import * as errors from '../config.errors';
import * as settingRepo from '../repositories/app-setting.repository';

/**
 * Config Store (DEC-013 / DEC-038, `configuration-registry.md`).
 *
 * Parametros de NEGOCIO operables sin tocar codigo ni redesplegar. No confundir
 * con `@offside/config`, que valida el ENTORNO (URLs, secretos): eso es
 * infraestructura y cambiarlo sí exige deploy.
 *
 * ⚠️ ALCANCE MINIMO, deliberado. Hay UNA clave —la comision— porque es la unica
 * que hoy esta hardcodeada y bloqueando. Lo que **no** tiene y por que:
 *
 *  - **Sin cache.** Es una consulta por indice, una vez por orden creada.
 *    Cachear introduce invalidacion, que es el problema dificil, para ahorrar
 *    algo que todavia no se midio.
 *  - **Sin panel de administracion** (frontend). Si hay API: la comision se
 *    lee y se cambia por `/api/admin/settings/commission`, protegida por la
 *    capacidad `system_config:manage` (DEC-023 ✅).
 *  - **Sin overrides por tier ni por categoria.** El ERD los contempla
 *    (`scope`), pero sus valores siguen 🟡 y no se inventa la politica.
 *  - **Sin auditoria propia.** `app_settings` ya es versionada: cada cambio deja
 *    su fila con `updated_by`. Duplicar eso en `audit_log` no agrega nada.
 */

/**
 * Comision de Offside por defecto (DEC-007 ✅ 6%, DEC-043).
 *
 * El nombre de la clave lo fija la documentacion: el ERD §21.1 y DEC-007 la
 * llaman `commission_rate_default`.
 */
export const COMMISSION_RATE_KEY = 'commission_rate_default';

/** Total de basis points. 600 bp = 6%. */
export const BASIS_POINTS_TOTAL = 10_000;

/**
 * DECISION DE IMPLEMENTACION — la tasa se guarda en **basis points enteros**.
 *
 * La documentacion fija la clave y su `value_type` (`rate`) pero **no la
 * unidad**. Se eligio basis points porque un porcentaje en punto flotante no
 * sobrevive el viaje por JSON: `0.06` no es representable en binario y
 * `total * 0.06` puede caer del lado equivocado del centavo. Con enteros, el
 * calculo es `total * bp / 10000` en `bigint` y no hay redondeo intermedio.
 *
 * 600 = 6%. El maximo es 10000 (100%): una comision mayor que el total haria
 * que `marketplace_fee > transaction_amount`, cosa que Mercado Pago rechaza.
 */
export function assertValidRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw errors.settingInvalid(COMMISSION_RATE_KEY, 'debe ser un entero en basis points');
  }

  if (value < 0) {
    throw errors.settingInvalid(COMMISSION_RATE_KEY, 'no puede ser negativa');
  }

  if (value > BASIS_POINTS_TOTAL) {
    throw errors.settingInvalid(COMMISSION_RATE_KEY, 'no puede superar el 100% (10000 bp)');
  }

  return value;
}

/**
 * Tasa de comision vigente, en basis points.
 *
 * ⚠️ SOLO PARA CREAR UNA ORDEN. Una vez creada, la tasa vive en el snapshot de
 * la orden y **nunca** se vuelve a leer de acá (DEC-030): cambiar la
 * configuracion no puede alterar lo que ya se cobro.
 *
 * Lanza si la clave no esta cargada. No hay valor por defecto en codigo a
 * proposito: ver `config.errors.ts`.
 */
export async function getCommissionRateBasisPoints(db?: Database): Promise<number> {
  const row = await settingRepo.findCurrent(COMMISSION_RATE_KEY, db);
  if (row === undefined) throw errors.settingNotConfigured(COMMISSION_RATE_KEY);

  return assertValidRate(row.value);
}

/**
 * Cambia la tasa. Inserta una version nueva; la anterior queda en la tabla.
 *
 * Lo llama `PUT /api/admin/settings/commission`, protegido por la capacidad
 * `system_config:manage` (DEC-023). Es el UNICO camino validado para cambiar la
 * tasa: cualquier otra via seria un INSERT a mano sin validacion.
 *
 * ⚠️ `updatedBy` es el id del ADMINISTRADOR AUTENTICADO. El controller lo toma
 * de la sesion, nunca del cuerpo del request.
 */
export async function setCommissionRateBasisPoints(
  basisPoints: number,
  updatedBy: string | null = null,
  db?: Database,
): Promise<number> {
  const validado = assertValidRate(basisPoints);

  await settingRepo.insertNextVersion(
    {
      key: COMMISSION_RATE_KEY,
      value: validado,
      valueType: 'rate',
      updatedBy,
    },
    db,
  );

  return validado;
}

/** Fila vigente de la comision, para exponer version y fecha. */
export async function findCurrentCommissionSetting(
  db?: Database,
): Promise<settingRepo.AppSettingRow | undefined> {
  return settingRepo.findCurrent(COMMISSION_RATE_KEY, db);
}

/**
 * La tasa en porcentaje legible: 600 -> `'6%'`, 650 -> `'6.5%'`.
 *
 * DERIVADO, para mostrar. No se persiste: la fuente sigue siendo el entero en
 * basis points. Se construye con enteros, sin dividir en punto flotante.
 */
export function basisPointsToPercent(basisPoints: number): string {
  const entero = Math.trunc(basisPoints / 100);
  const decimales = basisPoints % 100;

  if (decimales === 0) return `${entero}%`;

  return `${entero}.${decimales.toString().padStart(2, '0').replace(/0$/, '')}%`;
}

/**
 * La tasa como la espera `orders.commission_rate_at_transaction`
 * (`numeric(6,4)`): 600 bp -> `'0.0600'`.
 *
 * Se construye con strings, sin dividir en punto flotante.
 */
export function basisPointsToRateSnapshot(basisPoints: number): string {
  const entero = Math.trunc(basisPoints / BASIS_POINTS_TOTAL);
  const resto = basisPoints % BASIS_POINTS_TOTAL;

  return `${entero}.${resto.toString().padStart(4, '0')}`;
}

/**
 * Historial de la comision, de la mas nueva a la mas vieja.
 *
 * ⚠️ NO AUTORIZA. Es lectura del back-office: quien llama tiene que haber
 * verificado `system_config:manage` antes, igual que el resto de la consola.
 */
export async function findCommissionHistory(limite = 10): Promise<settingRepo.AppSettingRow[]> {
  return settingRepo.findHistory(COMMISSION_RATE_KEY, limite);
}
