import { describe, expect, it } from 'vitest';

import {
  FEATURE_NAMES,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  SHIPPING_MODES,
  TRACKING_PLACEHOLDER,
  allowsScope,
  assertSettingKey,
  definitionOf,
  hasDefaultUntilSeeded,
  isSettingKey,
  parseSettingValue,
  safeParseSettingValue,
  type SettingKey,
} from './settings-registry';

/**
 * El registro es la validacion del Config Store a la ida y a la vuelta. Si
 * acepta de mas, la base termina con un plazo de -3 dias; si acepta de menos,
 * un administrador no puede cargar un valor legitimo. Sin base: puro.
 */

/** Lo que siembran las migraciones 0003, 0005, 0006, 0010 y 0011, a mano. */
const CLAVES_SEMBRADAS = [
  'commission_rate_default',
  'listing_max_images',
  'listing_max_image_bytes',
  'listing_allowed_image_types',
  'search_rank_weights',
  'payment_window_minutes',
  'dispatch_deadline_hours',
  'buyer_protection_days',
  'review_window_days',
  'promotion_commission_multiplier',
  'promotion_duration_days',
  'promotion_rank_boost',
  'seller_tier_evaluation',
  'user_level_thresholds',
  'reputation_score_weights',
  'dispute_seller_response_days',
  'feature_promotions',
  'feature_reviews',
  'feature_questions',
  'feature_cart',
  'shipping_default_mode',
  'shipping_pickup_allowed',
  'questions_max_open_per_user',
  'questions_max_length',
  'favorites_price_drop_min_percent',
  'seller_tier_sales_window_days',
  'seller_tier_auto_assign',
  'seller_tier_auto_downgrade',
  'promoted_first_in_search',
] as const;

/** Las que se registraron ANTES de su migracion de datos (2026-09-11). */
const CLAVES_CON_DEFAULT = [
  'shipping_carriers',
  'shipping_to_agree_allowed',
  'dispute_window_days',
  'reconciliation_window_days',
] as const;

const ok = (key: SettingKey, raw: unknown) => expect(safeParseSettingValue(key, raw).ok).toBe(true);
const rechaza = (key: SettingKey, raw: unknown) =>
  expect(safeParseSettingValue(key, raw).ok).toBe(false);

describe('cobertura del registro', () => {
  it('registra TODAS las claves que siembran las migraciones', () => {
    for (const key of CLAVES_SEMBRADAS) expect(isSettingKey(key)).toBe(true);
  });

  it('registra las cuatro claves nuevas, y son exactamente las que tienen default transitorio', () => {
    for (const key of SETTING_KEYS) {
      const esperado = (CLAVES_CON_DEFAULT as readonly string[]).includes(key);
      expect(hasDefaultUntilSeeded(key), key).toBe(esperado);
    }
  });

  it('no hay claves de mas: sembradas + nuevas = registro', () => {
    expect(SETTING_KEYS.length).toBe(CLAVES_SEMBRADAS.length + CLAVES_CON_DEFAULT.length);
  });

  it('⚠️ cada default transitorio pasa el schema de su propia clave', () => {
    // Un default que la lectura rechazaria seria peor que no tenerlo: la
    // clave fallaria con SETTING_INVALID en vez de con "no configurada".
    for (const key of CLAVES_CON_DEFAULT) {
      expect(safeParseSettingValue(key, SETTING_DEFINITIONS[key].defaultUntilSeeded)).toEqual({
        ok: true,
        value: SETTING_DEFINITIONS[key].defaultUntilSeeded,
      });
    }
  });

  it('toda clave admite el ambito global, y global es el primero', () => {
    for (const key of SETTING_KEYS) {
      expect(definitionOf(key).scopes[0], key).toBe('global');
      expect(allowsScope(key, 'global')).toBe(true);
    }
  });

  it('toda clave tiene descripcion visible', () => {
    for (const key of SETTING_KEYS) expect(definitionOf(key).descripcion.length).toBeGreaterThan(5);
  });

  it('los feature flags del registro son los de FEATURE_NAMES', () => {
    for (const name of FEATURE_NAMES) expect(isSettingKey(`feature_${name}`)).toBe(true);
  });

  it('isSettingKey no se deja engañar por el prototipo', () => {
    expect(isSettingKey('constructor')).toBe(false);
    expect(isSettingKey('__proto__')).toBe(false);
    expect(isSettingKey('')).toBe(false);
  });

  it('assertSettingKey lanza VALIDATION_FAILED para una clave desconocida', () => {
    expect(() => assertSettingKey('no_existe')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    expect(assertSettingKey('payment_window_minutes')).toBe('payment_window_minutes');
  });
});

describe('ambitos', () => {
  it('los plazos que un tier puede comprometer admiten seller_tier; los de plataforma no', () => {
    expect(allowsScope('dispatch_deadline_hours', 'seller_tier')).toBe(true);
    expect(allowsScope('promotion_commission_multiplier', 'seller_tier')).toBe(true);
    expect(allowsScope('questions_max_open_per_user', 'seller_tier')).toBe(true);

    expect(allowsScope('payment_window_minutes', 'seller_tier')).toBe(false);
    expect(allowsScope('feature_cart', 'seller_tier')).toBe(false);
    expect(allowsScope('user_level_thresholds', 'seller_tier')).toBe(false);
    expect(allowsScope('search_rank_weights', 'seller_tier')).toBe(false);
  });

  it('el maximo de fotos es la unica clave con ambito por categoria', () => {
    const conCategoria = SETTING_KEYS.filter((key) => allowsScope(key, 'category'));
    expect(conCategoria).toEqual(['listing_max_images']);
  });
});

describe('enteros y rangos', () => {
  it('los plazos son enteros desde 1', () => {
    for (const key of [
      'payment_window_minutes',
      'dispatch_deadline_hours',
      'buyer_protection_days',
      'review_window_days',
      'dispute_seller_response_days',
      'dispute_window_days',
      'reconciliation_window_days',
      'promotion_duration_days',
      'seller_tier_sales_window_days',
      'questions_max_open_per_user',
      'questions_max_length',
      'listing_max_images',
    ] as const) {
      ok(key, 1);
      rechaza(key, 0);
      rechaza(key, -1);
      rechaza(key, 1.5);
      rechaza(key, '7');
      rechaza(key, null);
      rechaza(key, true);
    }
  });

  it('los techos de cordura frenan un cero de mas', () => {
    ok('payment_window_minutes', 30 * 24 * 60);
    rechaza('payment_window_minutes', 30 * 24 * 60 + 1);

    ok('dispatch_deadline_hours', 720);
    rechaza('dispatch_deadline_hours', 721);

    ok('buyer_protection_days', 90);
    rechaza('buyer_protection_days', 91);

    ok('dispute_window_days', 90);
    rechaza('dispute_window_days', 91);

    ok('reconciliation_window_days', 365);
    rechaza('reconciliation_window_days', 366);

    ok('listing_max_images', 50);
    rechaza('listing_max_images', 51);
  });

  it('la comision va en basis points enteros entre 0 y 10000', () => {
    ok('commission_rate_default', 0);
    ok('commission_rate_default', 600);
    ok('commission_rate_default', 10_000);
    rechaza('commission_rate_default', 10_001);
    rechaza('commission_rate_default', -1);
    rechaza('commission_rate_default', 6.5);
  });

  it('el multiplicador de promocion es positivo con hasta tres decimales', () => {
    ok('promotion_commission_multiplier', 3);
    ok('promotion_commission_multiplier', 1.5);
    ok('promotion_commission_multiplier', 1.125);
    rechaza('promotion_commission_multiplier', 0);
    rechaza('promotion_commission_multiplier', -2);
    rechaza('promotion_commission_multiplier', 1.0001);
    rechaza('promotion_commission_multiplier', 1_000);
  });

  it('el boost de ranking y el porcentaje de baja de precio admiten decimales acotados', () => {
    ok('promotion_rank_boost', 0);
    ok('promotion_rank_boost', 0.5);
    rechaza('promotion_rank_boost', -0.1);
    rechaza('promotion_rank_boost', 1_001);

    ok('favorites_price_drop_min_percent', 0);
    ok('favorites_price_drop_min_percent', 12.5);
    ok('favorites_price_drop_min_percent', 100);
    rechaza('favorites_price_drop_min_percent', 101);
  });
});

describe('booleanos y enums', () => {
  it('un flag es true o false, no un string que se le parezca', () => {
    for (const key of [
      'feature_promotions',
      'feature_reviews',
      'feature_questions',
      'feature_cart',
      'shipping_pickup_allowed',
      'shipping_to_agree_allowed',
      'seller_tier_auto_assign',
      'seller_tier_auto_downgrade',
      'promoted_first_in_search',
    ] as const) {
      ok(key, true);
      ok(key, false);
      rechaza(key, 'true');
      rechaza(key, 1);
      rechaza(key, null);
    }
  });

  it('el modo de envio por defecto es uno de los cuatro del CHECK', () => {
    for (const modo of SHIPPING_MODES) ok('shipping_default_mode', modo);
    rechaza('shipping_default_mode', 'gratis');
    rechaza('shipping_default_mode', '');
    rechaza('shipping_default_mode', null);
  });

  it('los formatos de imagen son un subconjunto no vacio de lo que el procesador sabe tratar', () => {
    ok('listing_allowed_image_types', ['image/jpeg']);
    ok('listing_allowed_image_types', ['image/jpeg', 'image/png', 'image/webp']);
    rechaza('listing_allowed_image_types', []);
    // SVG es un documento que ejecuta JavaScript: no puede entrar nunca.
    rechaza('listing_allowed_image_types', ['image/svg+xml']);
    rechaza('listing_allowed_image_types', 'image/jpeg');
  });
});

describe('json con forma', () => {
  it('los pesos de busqueda son exactamente cuatro, entre 0 y 1', () => {
    ok('search_rank_weights', [0.1, 0.2, 0.4, 1]);
    rechaza('search_rank_weights', [0.1, 0.2, 0.4]);
    rechaza('search_rank_weights', [0.1, 0.2, 0.4, 1, 1]);
    rechaza('search_rank_weights', [0.1, 0.2, 0.4, 1.5]);
  });

  it('la evaluacion del tier solo admite la regla decidida (BR-051)', () => {
    ok('seller_tier_evaluation', { countsOnly: 'COMPLETED', excludesRefunded: true });
    rechaza('seller_tier_evaluation', { countsOnly: 'PAID', excludesRefunded: true });
    rechaza('seller_tier_evaluation', { countsOnly: 'COMPLETED', excludesRefunded: false });
    rechaza('seller_tier_evaluation', {
      countsOnly: 'COMPLETED',
      excludesRefunded: true,
      extra: 1,
    });
  });

  it('los umbrales de nivel son enteros CRECIENTES', () => {
    ok('user_level_thresholds', { CONFIABLE: 5, DESTACADO: 10, COLECCIONISTA: 20 });
    rechaza('user_level_thresholds', { CONFIABLE: 10, DESTACADO: 10, COLECCIONISTA: 20 });
    rechaza('user_level_thresholds', { CONFIABLE: 5, DESTACADO: 30, COLECCIONISTA: 20 });
    rechaza('user_level_thresholds', { CONFIABLE: 0, DESTACADO: 10, COLECCIONISTA: 20 });
    rechaza('user_level_thresholds', { CONFIABLE: 5, DESTACADO: 10 });
    rechaza('user_level_thresholds', {
      CONFIABLE: 5,
      DESTACADO: 10,
      COLECCIONISTA: 20,
      TIENDA: 50,
    });
  });

  it('los pesos de reputacion suman 1, con tolerancia de punto flotante', () => {
    ok('reputation_score_weights', {
      rating: 0.4,
      sales: 0.2,
      dispatch: 0.2,
      cancellations: 0.1,
      claims: 0.1,
    });
    rechaza('reputation_score_weights', {
      rating: 0.5,
      sales: 0.2,
      dispatch: 0.2,
      cancellations: 0.1,
      claims: 0.1,
    });
    rechaza('reputation_score_weights', { rating: 1, sales: 0, dispatch: 0, cancellations: 0 });
  });

  it('safeParse junta TODOS los problemas en el motivo, no solo el primero', () => {
    const resultado = safeParseSettingValue('reputation_score_weights', {
      rating: -1,
      sales: 2,
      dispatch: 0.2,
      cancellations: 0.1,
      claims: 0.1,
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;

    expect(resultado.motivo).toContain('rating');
    expect(resultado.motivo).toContain('sales');
    expect(resultado.motivo.split('; ').length).toBeGreaterThanOrEqual(2);
  });

  it('parseSettingValue lanza SETTING_INVALID (dato leido corrupto) con la clave en el mensaje', () => {
    expect(() => parseSettingValue('payment_window_minutes', 'dos dias')).toThrow(
      expect.objectContaining({
        code: 'SETTING_INVALID',
        message: expect.stringContaining('payment_window_minutes'),
      }),
    );
  });
});

describe('transportistas', () => {
  const correo = { code: 'correo_argentino', name: 'Correo Argentino', trackingUrlTemplate: null };

  it('acepta la lista por defecto y una plantilla https con el marcador', () => {
    ok('shipping_carriers', [correo]);
    ok('shipping_carriers', [
      { ...correo, trackingUrlTemplate: `https://seguimiento.test/envio/${TRACKING_PLACEHOLDER}` },
    ]);
  });

  it('rechaza lista vacia, codigos repetidos y codigos con mayusculas o espacios', () => {
    rechaza('shipping_carriers', []);
    rechaza('shipping_carriers', [correo, { ...correo, name: 'Otro nombre' }]);
    rechaza('shipping_carriers', [{ ...correo, code: 'Correo Argentino' }]);
    rechaza('shipping_carriers', [{ ...correo, code: '1oca' }]);
  });

  it('rechaza una plantilla sin {tracking}, sin https o con espacios', () => {
    rechaza('shipping_carriers', [{ ...correo, trackingUrlTemplate: 'https://seguimiento.test/' }]);
    rechaza('shipping_carriers', [
      { ...correo, trackingUrlTemplate: `http://seguimiento.test/${TRACKING_PLACEHOLDER}` },
    ]);
    rechaza('shipping_carriers', [
      { ...correo, trackingUrlTemplate: `https://seguimiento.test/ ${TRACKING_PLACEHOLDER}` },
    ]);
  });

  it('rechaza campos de mas y nombre vacio', () => {
    rechaza('shipping_carriers', [{ ...correo, telefono: '11' }]);
    rechaza('shipping_carriers', [{ ...correo, name: '   ' }]);
  });
});
