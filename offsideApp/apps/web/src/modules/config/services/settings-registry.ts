import { z } from 'zod';

import * as errors from '../config.errors';
import type { SettingScope } from '../repositories/app-setting.repository';
import { FORMATOS_SOPORTADOS } from './image-settings.service';

/**
 * REGISTRO de claves del Config Store (`app_settings`, ERD §17.1).
 *
 * Es la contraparte en codigo de `configuration-registry.md`: UNA definicion
 * por clave —tipo, forma valida, ambitos que admite— y nada mas. La usan los
 * dos lados del store:
 *
 *   - la LECTURA (`setting-store.service.ts`) valida lo que sale de la base
 *     contra el schema, asi un valor corrupto o mal cargado se detecta al leer
 *     y no tres modulos mas abajo, convertido en un plazo de NaN dias;
 *   - la ESCRITURA (`setSetting`) valida lo que entra con el MISMO schema, asi
 *     nunca queda en la base algo que la lectura vaya a rechazar.
 *
 * ⚠️ ACA NO HAY VALORES POR DEFECTO, y no es un olvido. Cada clave la carga
 * una migracion (0003, 0005, 0006, 0010, 0011) y se cambia desde Admin. Un
 * default en codigo seria una segunda fuente de verdad: el dia que alguien
 * cambie el setting nadie sabria cual rigio (`config.errors.ts`).
 *
 * ⚠️ LA UNICA EXCEPCION ES `defaultUntilSeeded`, y es TRANSITORIA. Cuatro
 * claves (`shipping_carriers`, `shipping_to_agree_allowed`,
 * `dispute_window_days`, `reconciliation_window_days`) se registraron el
 * 2026-09-11 ANTES de que exista la migracion que las siembra —la escribe otro
 * paquete—. Hasta que esa migracion corra, el lector devuelve el default del
 * registro, lo marca como `source: 'default'` y lo anota en el log. En cuanto
 * la fila exista, la fila manda: el default nunca pisa a la base. Cuando la
 * migracion este aplicada en produccion, el campo se borra de esas cuatro
 * claves y vuelven a la regla general (cambio MENOR).
 *
 * ⚠️ LOS RANGOS SON TECHOS DE CORDURA, NO REGLAS DE NEGOCIO. Que la ventana
 * de pago no supere 30 dias no es una politica comercial: es evitar que un
 * cero de mas deje ordenes abiertas un año. El valor dentro del rango lo
 * decide el administrador (⚙️ DEC-013) y sigue 🟡 pendiente de confirmacion
 * (ver la migracion `0010`). Si un rango molesta, se cambia aca y es un
 * cambio MENOR; lo que no se hace es sacar el rango.
 *
 * ⚠️ `valueType` es INFORMATIVO. Lo que valida es el `schema`: `value_type`
 * en la base es `text` sin constraint y los Services nunca confiaron en el
 * (migracion `0010`). Se conserva para que la fila diga que es sin abrir el
 * codigo.
 */

/** Los `value_type` que usan las migraciones. Informativo (ver arriba). */
export type SettingValueType = 'number' | 'rate' | 'bool' | 'string' | 'json';

export interface SettingDefinition<S extends z.ZodType = z.ZodType> {
  valueType: SettingValueType;
  /** Forma valida del valor. Es LA validacion, a la ida y a la vuelta. */
  schema: S;
  /**
   * Ambitos en los que la clave puede tener una fila. `global` siempre esta.
   *
   * Los overrides por tier siguen siendo 🟦 en valores (DEC-038), asi que la
   * lista de claves que los admiten es una DECISION DE IMPLEMENTACION,
   * ASUMIDA: se habilitan los parametros que `configuration-registry.md` §2
   * describe como propios de la "categoria comercial del vendedor" —limites y
   * condiciones de operacion— y ninguno de los que describen a la plataforma
   * entera (feature flags, pesos de busqueda, umbrales de nivel de usuario).
   * Ampliar la lista es un cambio MENOR; el mecanismo ya existe.
   */
  scopes: readonly SettingScope[];
  /** Para el back-office. Texto visible: con tildes. */
  descripcion: string;
  /**
   * Valor que rige MIENTRAS la fila no exista en `app_settings`. Solo para
   * claves cuya migracion de datos todavia no corrio (ver el encabezado). Se
   * valida contra el `schema` de la clave en los tests: un default que la
   * lectura rechazaria seria peor que no tenerlo.
   */
  defaultUntilSeeded?: z.output<S>;
}

const GLOBAL = ['global'] as const satisfies readonly SettingScope[];
const GLOBAL_Y_TIER = ['global', 'seller_tier'] as const satisfies readonly SettingScope[];
/**
 * `category` es el tercer nivel de `configuration-registry.md` §2 ("por
 * categoria de producto, donde aplique"). Hoy lo admite UNA clave —el maximo
 * de fotos, que es el ejemplo literal de §1 de "configuracion" frente a "datos
 * del listing"— para que la precedencia de tres niveles exista y este probada.
 * Habilitarlo en otra clave es un cambio MENOR; el valor sigue siendo del
 * administrador.
 */
const GLOBAL_TIER_Y_CATEGORIA = [
  'global',
  'seller_tier',
  'category',
] as const satisfies readonly SettingScope[];

/** Solo para que TypeScript infiera el schema concreto de cada clave. */
const def = <S extends z.ZodType>(d: SettingDefinition<S>): SettingDefinition<S> => d;

/**
 * Un multiplicador como lo guarda `numeric(6,3)`: positivo y con hasta tres
 * decimales. Se chequea sobre el TEXTO del numero y no con `v * 1000 % 1`,
 * porque `1.1 * 1000` en punto flotante da `1100.0000000000002`.
 */
const tresDecimales = (v: number): boolean => /^\d+(\.\d{1,3})?$/.test(String(v));

/** Suma de pesos con tolerancia: `0.4 + 0.2 + 0.2 + 0.1 + 0.1` no da 1 exacto en binario. */
const sumaUno = (pesos: Record<string, number>): boolean =>
  Math.abs(Object.values(pesos).reduce((a, b) => a + b, 0) - 1) < 1e-6;

const dias = (max: number) => z.number().int().min(1).max(max);

/** Los nombres de los feature flags de MVP (`configuration-registry.md` §3). */
export const FEATURE_NAMES = ['promotions', 'reviews', 'questions', 'cart'] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

/** Modos de envio de `listings.shipping_mode` (CHECK de la migracion `0011`). */
export const SHIPPING_MODES = ['included', 'buyer_pays', 'to_agree', 'pickup'] as const;
export type ShippingMode = (typeof SHIPPING_MODES)[number];

/** Marcador que la plantilla de seguimiento reemplaza por el numero de envio. */
export const TRACKING_PLACEHOLDER = '{tracking}';

/**
 * Un transportista que el vendedor puede declarar al despachar (el despacho es
 * manual: `shipments.provider = 'manual'`, con transportista y numero
 * obligatorios). `code` es el identificador estable que se guarda en el envio;
 * `name` es lo que se muestra.
 *
 * `trackingUrlTemplate` es la URL publica de seguimiento con `{tracking}`
 * donde va el numero, o `null` si no se conoce. Solo `https://`: el enlace se
 * le muestra al comprador y se abre desde nuestro sitio. ⚠️ Las URLs de
 * seguimiento de cada empresa son 🌐 y NO se inventan desde el codigo: el
 * default las deja en `null` y el administrador las completa.
 */
const shippingCarrierSchema = z.strictObject({
  code: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'código en minúsculas, sin espacios (a-z, 0-9, _)'),
  name: z.string().trim().min(1).max(80),
  trackingUrlTemplate: z
    .string()
    .max(500)
    .regex(/^https:\/\/\S+$/, 'debe ser una URL https:// sin espacios')
    .refine((t) => t.includes(TRACKING_PLACEHOLDER), `debe contener ${TRACKING_PLACEHOLDER}`)
    .nullable(),
});

export type ShippingCarrier = z.output<typeof shippingCarrierSchema>;

/** Los codigos no pueden repetirse: `shipments` guarda el codigo, no el indice. */
const codigosUnicos = (carriers: readonly { code: string }[]): boolean =>
  new Set(carriers.map((c) => c.code)).size === carriers.length;

/**
 * Transportistas por defecto hasta que corra la migracion de datos. Son los
 * cuatro que pidio el owner el 2026-09-11; "Otro" existe porque obligar a
 * elegir uno de tres dejaria afuera a quien despacha por una mensajeria local.
 */
const DEFAULT_SHIPPING_CARRIERS: readonly ShippingCarrier[] = [
  { code: 'correo_argentino', name: 'Correo Argentino', trackingUrlTemplate: null },
  { code: 'andreani', name: 'Andreani', trackingUrlTemplate: null },
  { code: 'oca', name: 'OCA', trackingUrlTemplate: null },
  { code: 'otro', name: 'Otro', trackingUrlTemplate: null },
];

export const SETTING_DEFINITIONS = {
  /* ------------------------------------------------ pagos (0003) ---------- */

  /**
   * En BASIS POINTS enteros (600 = 6%). El tope de 100% es tecnico: una tasa
   * mayor haria `marketplace_fee > total` y Mercado Pago rechaza la
   * preferencia (DEC-014, aclaracion 2026-08-27). Misma regla que
   * `assertValidRate()` en `settings.service.ts`; ese sigue siendo el camino
   * de la comision y este registro no lo reemplaza.
   */
  commission_rate_default: def({
    valueType: 'rate',
    schema: z.number().int().min(0).max(10_000),
    scopes: GLOBAL,
    descripcion: 'Comisión de Offside por defecto, en basis points (600 = 6%)',
  }),

  /* ------------------------------------------- publicaciones (0005) ------- */

  // Mismos techos que `image-settings.service.ts`: 50 fotos y 50 MB. Por
  // encima, el procesamiento en memoria deja de proteger en un VPS chico.
  listing_max_images: def({
    valueType: 'number',
    schema: z.number().int().min(1).max(50),
    scopes: GLOBAL_TIER_Y_CATEGORIA,
    descripcion: 'Cantidad máxima de fotos por publicación',
  }),
  listing_max_image_bytes: def({
    valueType: 'number',
    schema: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
    scopes: GLOBAL_Y_TIER,
    descripcion: 'Tamaño máximo de cada foto, en bytes',
  }),
  /**
   * Subconjunto de lo que el procesador sabe tratar: el administrador puede
   * permitir MENOS formatos, nunca otros (ver `FORMATOS_SOPORTADOS`).
   */
  listing_allowed_image_types: def({
    valueType: 'json',
    schema: z.array(z.enum(FORMATOS_SOPORTADOS)).min(1),
    scopes: GLOBAL,
    descripcion: 'Formatos de imagen permitidos',
  }),

  /* ------------------------------------------------ busqueda (0006) ------- */

  /** Cuatro pesos {D, C, B, A} entre 0 y 1, en el orden que espera `ts_rank`. */
  search_rank_weights: def({
    valueType: 'json',
    schema: z.tuple([
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
    ]),
    scopes: GLOBAL,
    descripcion: 'Pesos del ranking de búsqueda {D, C, B, A}',
  }),

  /* ------------------------------------ ciclo de la orden (0010) ---------- */

  /** 30 dias de techo. `orders.payment_deadline` guarda el instante calculado. */
  payment_window_minutes: def({
    valueType: 'number',
    schema: z
      .number()
      .int()
      .min(1)
      .max(30 * 24 * 60),
    scopes: GLOBAL,
    descripcion: 'Minutos para pagar antes de que la orden venza (DEC-033)',
  }),
  /** BR-032. Por tier: un tier puede comprometer un plazo distinto. */
  dispatch_deadline_hours: def({
    valueType: 'number',
    schema: z
      .number()
      .int()
      .min(1)
      .max(30 * 24),
    scopes: GLOBAL_Y_TIER,
    descripcion: 'Horas desde el pago para despachar (BR-032)',
  }),
  buyer_protection_days: def({
    valueType: 'number',
    schema: dias(90),
    scopes: GLOBAL,
    descripcion: 'Días desde la entrega para que la orden se complete sola sin reclamo',
  }),
  review_window_days: def({
    valueType: 'number',
    schema: dias(365),
    scopes: GLOBAL,
    descripcion: 'Días desde que la orden se completa para poder calificar',
  }),
  dispute_seller_response_days: def({
    valueType: 'number',
    schema: dias(30),
    scopes: GLOBAL,
    descripcion: 'Días que tiene el vendedor para responder una disputa',
  }),
  /**
   * Plazo del COMPRADOR para abrir una disputa desde la entrega (BR-034
   * "plazo de reclamo", 🟡). Es distinto de `buyer_protection_days`, que es
   * cuando la orden se completa sola: los dos se siembran iguales (7) y el
   * dia que difieran, el que cierra la orden y el que admite el reclamo
   * tienen que leer cada uno el suyo.
   *
   * ⚠️ `defaultUntilSeeded`: la migracion que siembra esta clave la escribe
   * otro paquete (ver el encabezado). 7 es ASUMIDO, igual que el resto de 0010.
   */
  dispute_window_days: def({
    valueType: 'number',
    schema: dias(90),
    scopes: GLOBAL,
    descripcion: 'Días desde la entrega en los que el comprador puede abrir una disputa',
    defaultUntilSeeded: 7,
  }),
  /**
   * Cuantos dias hacia atras abarca cada conciliacion contra Mercado Pago
   * (OR-031/OR-033: los reportes de MP son la fuente de verdad contable). Es
   * una ventana operativa, no un plazo de negocio. ⚠️ `defaultUntilSeeded`,
   * mismo motivo que arriba; 30 es ASUMIDO.
   */
  reconciliation_window_days: def({
    valueType: 'number',
    schema: dias(365),
    scopes: GLOBAL,
    descripcion: 'Días hacia atrás que abarca la conciliación con Mercado Pago',
    defaultUntilSeeded: 30,
  }),

  /* ------------------------------------------- promociones (0010/0011) ---- */

  /**
   * Como lo guarda `orders.promotion_multiplier_at_transaction`
   * (`numeric(6,3)`): positivo, hasta 999.999, tres decimales. El CHECK de
   * `listing_promotions` exige `> 0`; se replica aca para rechazarlo ANTES de
   * que una promocion falle al crearse.
   */
  promotion_commission_multiplier: def({
    valueType: 'number',
    schema: z.number().positive().max(999.999).refine(tresDecimales, 'admite hasta tres decimales'),
    scopes: GLOBAL_Y_TIER,
    descripcion: 'Por cuánto se multiplica la comisión de una publicación promocionada',
  }),
  promotion_duration_days: def({
    valueType: 'number',
    schema: dias(365),
    scopes: GLOBAL_Y_TIER,
    descripcion: 'Días que dura una promoción',
  }),
  /** Sumando al score de busqueda; con 0 las promocionadas no suben. Escala 🟡. */
  promotion_rank_boost: def({
    valueType: 'number',
    schema: z.number().min(0).max(1_000),
    scopes: GLOBAL,
    descripcion: 'Peso de las publicaciones promocionadas en el ranking de búsqueda',
  }),
  promoted_first_in_search: def({
    valueType: 'bool',
    schema: z.boolean(),
    scopes: GLOBAL,
    descripcion: 'Si las promocionadas se muestran antes que el resto',
  }),

  /* ---------------------------------------- tiers de vendedor (0010/0011) - */

  /**
   * ⚠️ LOS DOS VALORES SON LITERALES A PROPOSITO. Que solo cuenten las ventas
   * COMPLETED y nunca las reembolsadas NO es configuracion: es BR-051 y BR-033,
   * decididas. La clave existe para que la regla se vea desde Admin y para que
   * una decision futura la abra ampliando este schema; mientras tanto el
   * registro impide que la configuracion contradiga a la documentacion.
   */
  seller_tier_evaluation: def({
    valueType: 'json',
    schema: z.strictObject({
      countsOnly: z.literal('COMPLETED'),
      excludesRefunded: z.literal(true),
    }),
    scopes: GLOBAL,
    descripcion: 'Qué cuenta como venta al evaluar el tier (BR-051)',
  }),
  seller_tier_sales_window_days: def({
    valueType: 'number',
    schema: dias(3_650),
    scopes: GLOBAL,
    descripcion: 'Ventana hacia atrás, en días, que cuenta ventas para el tier',
  }),
  seller_tier_auto_assign: def({
    valueType: 'bool',
    schema: z.boolean(),
    scopes: GLOBAL,
    descripcion: 'Si el tier se asigna solo al alcanzar el umbral',
  }),
  seller_tier_auto_downgrade: def({
    valueType: 'bool',
    schema: z.boolean(),
    scopes: GLOBAL,
    descripcion: 'Si el tier baja solo al caer debajo del umbral',
  }),

  /* ------------------------------------ niveles y reputacion (0010) ------- */

  /**
   * DEC-020: CONFIABLE +5, DESTACADO +10, COLECCIONISTA +20. TIENDA no esta:
   * la otorga Offside, no un umbral. Se exige orden creciente porque un nivel
   * mas alto con umbral mas bajo haria inalcanzable al de abajo.
   */
  user_level_thresholds: def({
    valueType: 'json',
    schema: z
      .strictObject({
        CONFIABLE: z.number().int().min(1),
        DESTACADO: z.number().int().min(1),
        COLECCIONISTA: z.number().int().min(1),
      })
      .refine(
        (u) => u.CONFIABLE < u.DESTACADO && u.DESTACADO < u.COLECCIONISTA,
        'los umbrales deben ser crecientes: CONFIABLE < DESTACADO < COLECCIONISTA',
      ),
    scopes: GLOBAL,
    descripcion: 'Operaciones completadas para alcanzar cada nivel de usuario (DEC-020)',
  }),
  /**
   * Suman 1. Si no sumaran, el score dejaria de estar en [0, 1] y dos
   * vendedores con la misma historia tendrian numeros distintos segun cuando
   * se recalculo cada uno.
   */
  reputation_score_weights: def({
    valueType: 'json',
    schema: z
      .strictObject({
        rating: z.number().min(0).max(1),
        sales: z.number().min(0).max(1),
        dispatch: z.number().min(0).max(1),
        cancellations: z.number().min(0).max(1),
        claims: z.number().min(0).max(1),
      })
      .refine(sumaUno, 'los pesos deben sumar 1'),
    scopes: GLOBAL,
    descripcion: 'Pesos de la fórmula de reputación',
  }),

  /* ------------------------------------------------- envios (0011) -------- */

  shipping_default_mode: def({
    valueType: 'string',
    schema: z.enum(SHIPPING_MODES),
    scopes: GLOBAL,
    descripcion: 'Modo de envío con el que arranca el formulario de publicar',
  }),
  shipping_pickup_allowed: def({
    valueType: 'bool',
    schema: z.boolean(),
    scopes: GLOBAL,
    descripcion: 'Si un vendedor puede ofrecer retiro en persona',
  }),
  /**
   * Si un vendedor puede publicar con envio "a convenir". Arranca en `false`
   * por pedido del owner (2026-09-11): un comprador que no sabe cuanto va a
   * pagar de envio antes de comprar es una disputa esperando.
   *
   * ⚠️ TENSION CONOCIDA, anotada en el reporte: `shipping_default_mode` se
   * sembro en `"to_agree"` (0011) y `listings.shipping_mode` tiene ese DEFAULT.
   * Este registro no impone reglas ENTRE claves —cada una se valida sola—;
   * quien valide la declaracion de envio (`listings`) tiene que leer las dos y
   * decidir que hacer cuando el default no esta permitido.
   *
   * ⚠️ `defaultUntilSeeded`: ver el encabezado.
   */
  shipping_to_agree_allowed: def({
    valueType: 'bool',
    schema: z.boolean(),
    scopes: GLOBAL,
    descripcion: 'Si un vendedor puede publicar con envío "a convenir"',
    defaultUntilSeeded: false,
  }),
  /** Lista de transportistas para el despacho manual. ⚠️ `defaultUntilSeeded`: ver el encabezado. */
  shipping_carriers: def({
    valueType: 'json',
    schema: z
      .array(shippingCarrierSchema)
      .min(1)
      .refine(codigosUnicos, 'los códigos de transportista no pueden repetirse'),
    scopes: GLOBAL,
    descripcion: 'Transportistas que un vendedor puede declarar al despachar',
    defaultUntilSeeded: [...DEFAULT_SHIPPING_CARRIERS],
  }),

  /* ---------------------------------------------- preguntas (0011) -------- */

  questions_max_open_per_user: def({
    valueType: 'number',
    schema: z.number().int().min(1).max(1_000),
    scopes: GLOBAL_Y_TIER,
    descripcion: 'Preguntas sin responder que una cuenta puede tener abiertas a la vez',
  }),
  questions_max_length: def({
    valueType: 'number',
    schema: z.number().int().min(1).max(5_000),
    scopes: GLOBAL,
    descripcion: 'Largo máximo de una pregunta y de su respuesta, en caracteres',
  }),

  /* ---------------------------------------------- favoritos (0011) -------- */

  favorites_price_drop_min_percent: def({
    valueType: 'number',
    schema: z.number().min(0).max(100),
    scopes: GLOBAL,
    descripcion:
      'Baja de precio mínima, en %, para avisar a quien tiene la publicación en favoritos',
  }),

  /* ------------------------------------------- feature flags (0010) ------- */

  feature_promotions: def({
    valueType: 'bool',
    schema: z.boolean(),
    scopes: GLOBAL,
    descripcion: 'Promociones de publicaciones habilitadas',
  }),
  feature_reviews: def({
    valueType: 'bool',
    schema: z.boolean(),
    scopes: GLOBAL,
    descripcion: 'Calificaciones habilitadas',
  }),
  feature_questions: def({
    valueType: 'bool',
    schema: z.boolean(),
    scopes: GLOBAL,
    descripcion: 'Preguntas en las publicaciones habilitadas',
  }),
  feature_cart: def({
    valueType: 'bool',
    schema: z.boolean(),
    scopes: GLOBAL,
    descripcion: 'Carrito habilitado',
  }),
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

/** El tipo del valor de una clave, derivado de su schema. */
export type SettingValue<K extends SettingKey> = z.output<
  (typeof SETTING_DEFINITIONS)[K]['schema']
>;

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as readonly SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_DEFINITIONS, key);
}

export function definitionOf<K extends SettingKey>(key: K): (typeof SETTING_DEFINITIONS)[K] {
  return SETTING_DEFINITIONS[key];
}

/** Lanza `VALIDATION_FAILED` si la clave no esta en el registro. */
export function assertSettingKey(key: string): SettingKey {
  if (!isSettingKey(key)) throw errors.settingUnknown(key);

  return key;
}

export function allowsScope(key: SettingKey, scope: SettingScope): boolean {
  return SETTING_DEFINITIONS[key].scopes.includes(scope);
}

/**
 * Las claves que hoy rigen por default del registro y no por fila (ver el
 * encabezado). Para el back-office y para el test que exige que sus defaults
 * pasen su propio schema.
 */
export function hasDefaultUntilSeeded(key: SettingKey): boolean {
  return SETTING_DEFINITIONS[key].defaultUntilSeeded !== undefined;
}

export type SettingParseResult<K extends SettingKey> =
  { ok: true; value: SettingValue<K> } | { ok: false; motivo: string };

/**
 * Valida un valor contra el schema de su clave SIN lanzar.
 *
 * El motivo junta TODOS los problemas, no solo el primero: un administrador
 * que manda pesos que no suman 1 y ademas uno negativo tiene que enterarse de
 * las dos cosas de una vez. Es la unica validacion; la lectura y la escritura
 * la envuelven en errores distintos porque la culpa es distinta (un valor
 * corrupto en la base es un 500, uno rechazado al escribir es un 422).
 */
export function safeParseSettingValue<K extends SettingKey>(
  key: K,
  raw: unknown,
): SettingParseResult<K> {
  const resultado = SETTING_DEFINITIONS[key].schema.safeParse(raw);

  if (resultado.success) return { ok: true, value: resultado.data as SettingValue<K> };

  const motivo = resultado.error.issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ');

  return { ok: false, motivo };
}

/**
 * Valida un valor LEIDO de la base. Lanza `SETTING_INVALID` (500): si esta mal
 * formado es data corrupta o una migracion mal escrita, no culpa del cliente.
 */
export function parseSettingValue<K extends SettingKey>(key: K, raw: unknown): SettingValue<K> {
  const resultado = safeParseSettingValue(key, raw);
  if (!resultado.ok) throw errors.settingInvalid(key, resultado.motivo);

  return resultado.value;
}
