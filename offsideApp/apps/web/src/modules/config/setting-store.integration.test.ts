import { randomUUID } from 'node:crypto';

import { getDatabase, schema } from '@offside/database';
import { and, eq, gt, inArray, like, ne } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type * as AuthService from '../auth/services/auth.service';
import type * as SettingRepo from './repositories/app-setting.repository';
import type * as Store from './services/setting-store.service';
import type * as Registry from './services/settings-registry';
import type * as SettingsService from './services/settings.service';

/**
 * Config Store ampliado — integracion contra PostgreSQL REAL
 * (`offside_test_config`, migrada).
 *
 * Lo que se fija aca y no puede fijar un test unitario:
 *
 *   - que TODAS las claves sembradas se leen y pasan su schema (si una
 *     migracion escribiera un valor que el registro rechaza, se ve aca);
 *   - que escribir inserta una VERSION y la lectura siguiente la ve (no hay
 *     cache que esconda el cambio);
 *   - la PRECEDENCIA por ambito con filas reales en la tabla;
 *   - que el default transitorio rige solo mientras no haya fila.
 *
 * Sufijo de usuarios: `@cfgstore.offside`.
 */

const SUFIJO = '@cfgstore.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';

let store: typeof Store;
let registry: typeof Registry;
let settingsService: typeof SettingsService;
let settingRepo: typeof SettingRepo;
let authService: typeof AuthService;
let closeRedis: () => Promise<void>;

/** El tier INICIAL que siembra la migracion 0010. */
let tierId: string;
/** La categoria `camiseta` que siembra la migracion 0004. */
let categoriaId: string;

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');
  loadRootEnv(import.meta.dirname);
  resetEnvCache();

  store = await import('./services/setting-store.service');
  registry = await import('./services/settings-registry');
  settingsService = await import('./services/settings.service');
  settingRepo = await import('./repositories/app-setting.repository');
  authService = await import('../auth/services/auth.service');
  ({ closeRedisConnections: closeRedis } = await import('@offside/jobs'));

  const db = getDatabase();

  const [tier] = await db
    .select({ id: schema.sellerTiers.id })
    .from(schema.sellerTiers)
    .where(eq(schema.sellerTiers.code, 'INICIAL'))
    .limit(1);
  if (!tier) throw new Error('Falta el tier INICIAL: corre las migraciones (0010 lo siembra).');
  tierId = tier.id;

  const [categoria] = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(eq(schema.categories.code, 'camiseta'))
    .limit(1);
  if (!categoria) throw new Error('Falta la categoria camiseta: corre las migraciones (0004).');
  categoriaId = categoria.id;

  await limpiarUsuarios();
  await restaurar();
});

beforeEach(async () => {
  await restaurar();
});

afterAll(async () => {
  await restaurar();
  await limpiarUsuarios();

  const { closeDatabase } = await import('@offside/database');
  await closeDatabase();
  await closeRedis();
});

/**
 * Deja `app_settings` como la dejaron las migraciones: solo versiones 1,
 * solo globales, y sin las cuatro claves que todavia no tienen semilla.
 *
 * Se borra en vez de "agregar una version mas" para que cada test arranque
 * del mismo estado sin depender del orden de los otros.
 */
async function restaurar(): Promise<void> {
  const db = getDatabase();

  await db.delete(schema.appSettings).where(gt(schema.appSettings.version, 1));
  await db.delete(schema.appSettings).where(ne(schema.appSettings.scope, 'global'));
  await db
    .delete(schema.appSettings)
    .where(
      inArray(schema.appSettings.key, [
        'shipping_carriers',
        'shipping_to_agree_allowed',
        'dispute_window_days',
        'reconciliation_window_days',
      ]),
    );
}

async function limpiarUsuarios(): Promise<void> {
  const db = getDatabase();
  const usuarios = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(like(schema.users.email, `%${SUFIJO}`));
  if (usuarios.length === 0) return;
  const ids = usuarios.map((u) => u.id);

  // `app_settings.updated_by` es FK a `users`: hay que soltarla antes de borrar.
  await db
    .update(schema.appSettings)
    .set({ updatedBy: null })
    .where(inArray(schema.appSettings.updatedBy, ids));

  await db.delete(schema.auditLog).where(inArray(schema.auditLog.actorId, ids));
  await db.delete(schema.userHistoryEvents).where(inArray(schema.userHistoryEvents.userId, ids));
  await db.delete(schema.sessions).where(inArray(schema.sessions.userId, ids));
  await db
    .delete(schema.emailVerificationTokens)
    .where(inArray(schema.emailVerificationTokens.userId, ids));
  await db.delete(schema.users).where(inArray(schema.users.id, ids));
}

async function administrador(nombre: string): Promise<string> {
  const { emailVerificationToken } = await authService.register({
    email: email(nombre),
    password: PASSWORD,
    acceptedTerms: true,
  });
  const user = await authService.verifyEmail(emailVerificationToken);

  return user.id;
}

/** Cuantas filas tiene una clave en la global. */
async function versionesGlobales(key: string): Promise<number[]> {
  const filas = await getDatabase()
    .select({ version: schema.appSettings.version })
    .from(schema.appSettings)
    .where(and(eq(schema.appSettings.key, key), eq(schema.appSettings.scope, 'global')));

  return filas.map((f) => f.version).sort((a, b) => a - b);
}

/* -------------------------------------------------------------------------- */

describe('lectura tipada de todas las claves sembradas', () => {
  it('cada clave del registro se lee y pasa su schema', async () => {
    for (const key of registry.SETTING_KEYS) {
      // Las cuatro sin semilla resuelven por default; el resto, por fila.
      await expect(store.getSetting(key), key).resolves.not.toBeUndefined();
    }
  });

  it('los lectores devuelven los valores de la migracion 0010', async () => {
    expect(await store.getPaymentWindowMinutes()).toBe(2_880);
    expect(await store.getDispatchDeadlineHours()).toBe(72);
    expect(await store.getBuyerProtectionDays()).toBe(7);
    expect(await store.getReviewWindowDays()).toBe(30);
    expect(await store.getDisputeSellerResponseDays()).toBe(3);
  });

  it('promociones: multiplicador, duracion, boost y primero-en-busqueda', async () => {
    expect(await store.getPromotionSettings()).toEqual({
      multiplier: 3,
      durationDays: 7,
      rankBoost: 1,
      promotedFirstInSearch: true,
    });
  });

  it('tiers: evaluacion, ventana y automatismos', async () => {
    expect(await store.getSellerTierEvaluation()).toEqual({
      countsOnly: 'COMPLETED',
      excludesRefunded: true,
    });
    expect(await store.getSellerTierSettings()).toEqual({
      evaluation: { countsOnly: 'COMPLETED', excludesRefunded: true },
      salesWindowDays: 365,
      autoAssign: true,
      autoDowngrade: false,
    });
  });

  it('niveles y reputacion', async () => {
    expect(await store.getUserLevelThresholds()).toEqual({
      CONFIABLE: 5,
      DESTACADO: 10,
      COLECCIONISTA: 20,
    });

    const pesos = await store.getReputationScoreWeights();
    expect(Object.values(pesos).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(pesos.rating).toBe(0.4);
  });

  it('feature flags: los cuatro encendidos, por nombre y todos juntos', async () => {
    for (const name of registry.FEATURE_NAMES) {
      expect(await store.isFeatureEnabled(name), name).toBe(true);
    }
    expect(await store.getFeatureFlags()).toEqual({
      promotions: true,
      reviews: true,
      questions: true,
      cart: true,
    });
  });

  it('preguntas y favoritos', async () => {
    expect(await store.getQuestionSettings()).toEqual({ maxOpenPerUser: 20, maxLength: 500 });
    expect(await store.getFavoritesSettings()).toEqual({ priceDropMinPercent: 10 });
  });

  it('la comision se lee por el lector generico con el mismo valor que el viejo', async () => {
    expect(await store.getSetting('commission_rate_default')).toBe(
      await settingsService.getCommissionRateBasisPoints(),
    );
  });
});

describe('defaults transitorios (claves sin semilla todavia)', () => {
  it('rigen mientras no haya fila, y se dice que son default', async () => {
    const resuelto = await store.resolveSetting('dispute_window_days');

    expect(resuelto).toEqual({
      key: 'dispute_window_days',
      value: 7,
      source: 'default',
      scopeId: null,
      version: null,
      updatedAt: null,
    });

    expect(await store.getDisputeWindowDays()).toBe(7);
    expect(await store.getReconciliationWindowDays()).toBe(30);

    const envio = await store.getShippingSettings();
    expect(envio.defaultMode).toBe('to_agree');
    expect(envio.pickupAllowed).toBe(true);
    expect(envio.toAgreeAllowed).toBe(false);
    expect(envio.carriers.map((c) => c.code)).toEqual([
      'correo_argentino',
      'andreani',
      'oca',
      'otro',
    ]);
    expect(await store.findShippingCarrier('andreani')).toMatchObject({ name: 'Andreani' });
    expect(await store.findShippingCarrier('fedex')).toBeUndefined();
  });

  it('⚠️ en cuanto existe la fila, la fila manda y el default desaparece', async () => {
    await store.setSetting('dispute_window_days', 10);

    const resuelto = await store.resolveSetting('dispute_window_days');
    expect(resuelto.value).toBe(10);
    expect(resuelto.source).toBe('global');
    expect(resuelto.version).toBe(1);
    expect(await store.getDisputeWindowDays()).toBe(10);
  });

  it('una clave sin fila y sin default lanza SETTING_NOT_CONFIGURED', async () => {
    await getDatabase()
      .delete(schema.appSettings)
      .where(eq(schema.appSettings.key, 'questions_max_length'));

    await expect(store.getSetting('questions_max_length')).rejects.toMatchObject({
      code: 'SETTING_NOT_CONFIGURED',
    });

    // Se repone para los demas tests: la migracion es idempotente pero no se
    // vuelve a correr desde aca.
    await settingRepo.insertNextVersion({
      key: 'questions_max_length',
      value: 500,
      valueType: 'number',
    });
  });
});

describe('escritura versionada', () => {
  it('setSetting inserta la version siguiente y la lectura siguiente la ve (sin cache)', async () => {
    expect(await store.getPaymentWindowMinutes()).toBe(2_880);

    const primero = await store.setSetting('payment_window_minutes', 1_440);
    expect(primero).toMatchObject({
      key: 'payment_window_minutes',
      value: 1_440,
      scope: 'global',
      scopeId: null,
      version: 2,
      updatedBy: null,
    });
    expect(await store.getPaymentWindowMinutes()).toBe(1_440);

    const segundo = await store.setSetting('payment_window_minutes', 60);
    expect(segundo.version).toBe(3);
    expect(await store.getPaymentWindowMinutes()).toBe(60);

    expect(await versionesGlobales('payment_window_minutes')).toEqual([1, 2, 3]);
  });

  it('registra al administrador que hizo el cambio', async () => {
    const adminId = await administrador('autor');

    const resultado = await store.setSetting('review_window_days', 45, adminId);
    expect(resultado.updatedBy).toBe(adminId);

    const [historia] = await store.getSettingHistory('review_window_days');
    expect(historia?.updatedBy).toBe(adminId);
    expect(historia?.version).toBe(2);
  });

  it('escribe json con forma y lo devuelve validado', async () => {
    const umbrales = { CONFIABLE: 3, DESTACADO: 8, COLECCIONISTA: 15 };
    await store.setSetting('user_level_thresholds', umbrales);

    expect(await store.getUserLevelThresholds()).toEqual(umbrales);
  });

  it('comparte la serie con el camino viejo de la comision, en los dos sentidos', async () => {
    await store.setSetting('commission_rate_default', 700);
    expect(await settingsService.getCommissionRateBasisPoints()).toBe(700);

    await settingsService.setCommissionRateBasisPoints(650);
    expect(await store.getSetting('commission_rate_default')).toBe(650);

    expect(await versionesGlobales('commission_rate_default')).toEqual([1, 2, 3]);
  });

  it('acepta una transaccion y respeta su rollback', async () => {
    await expect(
      getDatabase().transaction(async (tx) => {
        await store.setSetting('buyer_protection_days', 14, null, tx);
        expect(await store.getBuyerProtectionDays(tx)).toBe(14);
        throw new Error('rollback a proposito');
      }),
    ).rejects.toThrow('rollback a proposito');

    expect(await store.getBuyerProtectionDays()).toBe(7);
  });
});

describe('validacion al escribir: error del cliente y NADA queda en la base', () => {
  it('valor fuera de rango o de tipo -> VALIDATION_FAILED', async () => {
    for (const valor of [0, -1, 1.5, '2880', null, 30 * 24 * 60 + 1]) {
      await expect(store.setSetting('payment_window_minutes', valor)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }

    expect(await versionesGlobales('payment_window_minutes')).toEqual([1]);
    expect(await store.getPaymentWindowMinutes()).toBe(2_880);
  });

  it('json con forma invalida -> VALIDATION_FAILED con el detalle', async () => {
    await expect(
      store.setSetting('user_level_thresholds', { CONFIABLE: 10, DESTACADO: 5, COLECCIONISTA: 20 }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('crecientes'),
    });

    await expect(
      store.setSetting('reputation_score_weights', {
        rating: 1,
        sales: 1,
        dispatch: 0,
        cancellations: 0,
        claims: 0,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(
      store.setSetting('shipping_carriers', [
        { code: 'oca', name: 'OCA', trackingUrlTemplate: null },
        { code: 'oca', name: 'OCA otra vez', trackingUrlTemplate: null },
      ]),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('clave desconocida -> VALIDATION_FAILED', async () => {
    await expect(
      store.setSetting('no_existe' as unknown as 'payment_window_minutes', 1),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('ambito que la clave no admite -> VALIDATION_FAILED', async () => {
    await expect(
      store.setSetting('payment_window_minutes', 60, null, undefined, {
        scope: 'seller_tier',
        scopeId: tierId,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('ambito'),
    });

    await expect(
      store.setSetting('dispatch_deadline_hours', 48, null, undefined, {
        scope: 'category',
        scopeId: categoriaId,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('⚠️ scope_id que no apunta a nada -> VALIDATION_FAILED (la FK logica del ERD)', async () => {
    await expect(
      store.setSetting('dispatch_deadline_hours', 48, null, undefined, {
        scope: 'seller_tier',
        scopeId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(
      store.setSetting('listing_max_images', 12, null, undefined, {
        scope: 'category',
        scopeId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const noGlobales = await getDatabase()
      .select({ id: schema.appSettings.id })
      .from(schema.appSettings)
      .where(ne(schema.appSettings.scope, 'global'));
    expect(noGlobales).toHaveLength(0);
  });
});

describe('precedencia por ambito: seller_tier > category > global', () => {
  it('un override por tier rige para ese tier y para nadie mas', async () => {
    const escrito = await store.setSetting('dispatch_deadline_hours', 48, null, undefined, {
      scope: 'seller_tier',
      scopeId: tierId,
    });
    expect(escrito).toMatchObject({ scope: 'seller_tier', scopeId: tierId, version: 1 });

    expect(await store.resolve('dispatch_deadline_hours', { sellerTierId: tierId })).toBe(48);
    expect(await store.getDispatchDeadlineHours(undefined, { sellerTierId: tierId })).toBe(48);

    // Sin tier, con otro tier, o con solo categoria: la global.
    expect(await store.resolve('dispatch_deadline_hours')).toBe(72);
    expect(await store.resolve('dispatch_deadline_hours', { sellerTierId: randomUUID() })).toBe(72);
    expect(await store.resolve('dispatch_deadline_hours', { categoryId: categoriaId })).toBe(72);
    expect(await store.getDispatchDeadlineHours()).toBe(72);
  });

  it('resolveSetting dice de donde salio el valor', async () => {
    await store.setSetting('dispatch_deadline_hours', 48, null, undefined, {
      scope: 'seller_tier',
      scopeId: tierId,
    });

    const conTier = await store.resolveSetting('dispatch_deadline_hours', { sellerTierId: tierId });
    expect(conTier).toMatchObject({
      value: 48,
      source: 'seller_tier',
      scopeId: tierId,
      version: 1,
    });

    const global = await store.resolveSetting('dispatch_deadline_hours');
    expect(global).toMatchObject({ value: 72, source: 'global', scopeId: null, version: 1 });
  });

  it('un override por categoria rige para esa categoria', async () => {
    await store.setSetting('listing_max_images', 12, null, undefined, {
      scope: 'category',
      scopeId: categoriaId,
    });

    expect(await store.resolve('listing_max_images', { categoryId: categoriaId })).toBe(12);
    expect(await store.resolve('listing_max_images')).toBe(8);
    expect(await store.resolve('listing_max_images', { categoryId: randomUUID() })).toBe(8);
  });

  it('con tier Y categoria, gana el tier', async () => {
    await store.setSetting('listing_max_images', 10, null, undefined, {
      scope: 'seller_tier',
      scopeId: tierId,
    });
    await store.setSetting('listing_max_images', 12, null, undefined, {
      scope: 'category',
      scopeId: categoriaId,
    });

    const ambos = await store.resolveSetting('listing_max_images', {
      sellerTierId: tierId,
      categoryId: categoriaId,
    });
    expect(ambos).toMatchObject({ value: 10, source: 'seller_tier' });

    expect(await store.resolve('listing_max_images', { categoryId: categoriaId })).toBe(12);
    expect(await store.resolve('listing_max_images', { sellerTierId: tierId })).toBe(10);
    expect(await store.resolve('listing_max_images')).toBe(8);
  });

  it('⚠️ una fila de tier colada a mano en una clave global NO cambia la lectura', async () => {
    // El repository no valida (es del Service): se simula un INSERT a mano.
    await settingRepo.insertNextVersion({
      key: 'payment_window_minutes',
      value: 1,
      valueType: 'number',
      scope: { scope: 'seller_tier', scopeId: tierId },
    });

    expect(await store.resolve('payment_window_minutes', { sellerTierId: tierId })).toBe(2_880);
  });

  it('las series de versiones son independientes por ambito', async () => {
    await store.setSetting('dispatch_deadline_hours', 48, null, undefined, {
      scope: 'seller_tier',
      scopeId: tierId,
    });
    const segunda = await store.setSetting('dispatch_deadline_hours', 24, null, undefined, {
      scope: 'seller_tier',
      scopeId: tierId,
    });
    expect(segunda.version).toBe(2);

    expect(await versionesGlobales('dispatch_deadline_hours')).toEqual([1]);
    expect(await store.resolve('dispatch_deadline_hours', { sellerTierId: tierId })).toBe(24);
    expect(await store.resolve('dispatch_deadline_hours')).toBe(72);
  });

  it('⚠️ un override corrupto rompe la lectura con SETTING_INVALID, no cae a la global', async () => {
    await settingRepo.insertNextVersion({
      key: 'dispatch_deadline_hours',
      value: 'tres dias',
      valueType: 'number',
      scope: { scope: 'seller_tier', scopeId: tierId },
    });

    await expect(
      store.resolve('dispatch_deadline_hours', { sellerTierId: tierId }),
    ).rejects.toMatchObject({
      code: 'SETTING_INVALID',
      message: expect.stringContaining('dispatch_deadline_hours'),
    });

    // Para quien no es de ese tier sigue funcionando.
    expect(await store.resolve('dispatch_deadline_hours')).toBe(72);
  });

  it('las claves de un grupo se resuelven cada una con su ambito', async () => {
    // El multiplicador admite tier; el boost de ranking no.
    await store.setSetting('promotion_commission_multiplier', 2, null, undefined, {
      scope: 'seller_tier',
      scopeId: tierId,
    });

    expect(await store.getPromotionSettings(undefined, { sellerTierId: tierId })).toEqual({
      multiplier: 2,
      durationDays: 7,
      rankBoost: 1,
      promotedFirstInSearch: true,
    });
    expect((await store.getPromotionSettings()).multiplier).toBe(3);

    await store.setSetting('questions_max_open_per_user', 5, null, undefined, {
      scope: 'seller_tier',
      scopeId: tierId,
    });
    expect(await store.getQuestionSettings(undefined, { sellerTierId: tierId })).toEqual({
      maxOpenPerUser: 5,
      maxLength: 500,
    });
  });
});

describe('historial', () => {
  it('devuelve las versiones de la mas nueva a la mas vieja, por ambito', async () => {
    await store.setSetting('review_window_days', 45);
    await store.setSetting('review_window_days', 60);

    const global = await store.getSettingHistory('review_window_days');
    expect(global.map((f) => [f.version, f.value])).toEqual([
      [3, 60],
      [2, 45],
      [1, 30],
    ]);

    expect(await store.getSettingHistory('review_window_days', undefined, 2)).toHaveLength(2);
  });

  it('el historial de un tier es el de ese tier, no el global', async () => {
    await store.setSetting('dispatch_deadline_hours', 48, null, undefined, {
      scope: 'seller_tier',
      scopeId: tierId,
    });

    const delTier = await store.getSettingHistory('dispatch_deadline_hours', {
      scope: 'seller_tier',
      scopeId: tierId,
    });
    expect(delTier.map((f) => [f.version, f.value, f.scopeId])).toEqual([[1, 48, tierId]]);

    const global = await store.getSettingHistory('dispatch_deadline_hours');
    expect(global.map((f) => [f.version, f.value])).toEqual([[1, 72]]);
  });

  it('pedir el historial en un ambito que la clave no admite es error del cliente', async () => {
    await expect(
      store.getSettingHistory('payment_window_minutes', { scope: 'seller_tier', scopeId: tierId }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('listSettings (back-office)', () => {
  it('lista todas las claves del registro con valor, version y definicion', async () => {
    const lista = await store.listSettings();

    expect(lista.map((e) => e.key)).toEqual([...registry.SETTING_KEYS]);

    const pago = lista.find((e) => e.key === 'payment_window_minutes');
    expect(pago).toMatchObject({
      value: 2_880,
      source: 'global',
      version: 1,
      valueType: 'number',
      problem: null,
      overrides: [],
    });
    expect(pago?.descripcion.length).toBeGreaterThan(5);
    expect(pago?.scopes).toEqual(['global']);
    expect(pago?.updatedAt).toBeInstanceOf(Date);
  });

  it('marca las claves que rigen por default, y deja de marcarlas al escribirlas', async () => {
    const antes = (await store.listSettings()).find((e) => e.key === 'reconciliation_window_days');
    expect(antes).toMatchObject({ value: 30, source: 'default', version: null });

    await store.setSetting('reconciliation_window_days', 45);

    const despues = (await store.listSettings()).find(
      (e) => e.key === 'reconciliation_window_days',
    );
    expect(despues).toMatchObject({ value: 45, source: 'global', version: 1 });
  });

  it('muestra los overrides vigentes de cada clave', async () => {
    await store.setSetting('dispatch_deadline_hours', 48, null, undefined, {
      scope: 'seller_tier',
      scopeId: tierId,
    });
    await store.setSetting('dispatch_deadline_hours', 24, null, undefined, {
      scope: 'seller_tier',
      scopeId: tierId,
    });

    const entrada = (await store.listSettings()).find((e) => e.key === 'dispatch_deadline_hours');
    expect(entrada?.value).toBe(72);
    expect(entrada?.overrides).toEqual([
      expect.objectContaining({ scope: 'seller_tier', scopeId: tierId, value: 24, version: 2 }),
    ]);
  });

  it('⚠️ un valor global corrupto se LISTA con su problema en vez de romper la pantalla', async () => {
    await settingRepo.insertNextVersion({
      key: 'buyer_protection_days',
      value: -5,
      valueType: 'number',
    });

    const lista = await store.listSettings();
    const roto = lista.find((e) => e.key === 'buyer_protection_days');
    expect(roto).toMatchObject({ value: -5, source: 'global', version: 2 });
    expect(roto?.problem).toEqual(expect.any(String));

    // El resto de la lista no se ve afectado.
    expect(lista.find((e) => e.key === 'payment_window_minutes')?.problem).toBeNull();

    // Y la lectura tipada si lanza: nadie opera con un plazo negativo.
    await expect(store.getBuyerProtectionDays()).rejects.toMatchObject({ code: 'SETTING_INVALID' });
  });

  it('una clave que no esta en el registro no aparece', async () => {
    await settingRepo.insertNextVersion({
      key: 'clave_vieja_sin_registro',
      value: 1,
      valueType: 'number',
    });

    const lista = await store.listSettings();
    expect(lista.some((e) => (e.key as string) === 'clave_vieja_sin_registro')).toBe(false);

    await getDatabase()
      .delete(schema.appSettings)
      .where(eq(schema.appSettings.key, 'clave_vieja_sin_registro'));
  });
});
