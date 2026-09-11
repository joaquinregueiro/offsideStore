-- Siembra los niveles de vendedor y los parametros del ciclo de vida posterior
-- a PAID, para que los modulos que vienen (tiers, promociones, reputacion,
-- ciclo de orden, disputas, preguntas, carrito) arranquen con el Config Store
-- cargado y NO con constantes en el codigo (CLAUDE.md §12).
--
-- ⚠️ TODOS LOS VALORES DE ESTA MIGRACION SON ASUMIDOS. La documentacion fija
-- que cada uno de estos parametros existe y es ⚙️ CONFIGURABLE (DEC-013 /
-- DEC-038, `configuration-registry.md`), pero deja el VALOR 🟡 pendiente. Los
-- numeros de aca son una decision de implementacion bajo DEC-032 ("simple por
-- defecto, configurable cuando sea necesario") y estan PENDIENTES DE
-- CONFIRMACION DEL OWNER. Se cambian desde Admin insertando una version nueva
-- (`app_settings` es versionada) o editando la fila del tier; nunca a mano.
--
-- POR QUE UNA MIGRACION Y NO UN DEFAULT EN CODIGO: mismo criterio que 0003 a
-- 0007. Un fallback en codigo seria una segunda fuente de verdad, y el dia que
-- alguien cambie el setting nadie sabria cual rigio. Cargarlo por migracion
-- garantiza que la clave existe en toda base que corrio las migraciones.
--
-- IDEMPOTENTE: cada fila se inserta solo si no existe (por `code` en los tiers,
-- por `key` en los settings). No pisa nada que alguien haya configurado.

-- =============================================================================
-- 1. SELLER TIERS (DEC-015 / DEC-037, SS-014)
-- =============================================================================
--
-- ERD §7.1 dice "no se seedean valores hasta definir DEC-037 (🟦)". El owner
-- pidio niveles de vendedor con comision DECRECIENTE el 2026-09-10: eso es la
-- definicion que faltaba, y por eso se siembran ahora. Los CODES no salen de la
-- doc —DEC-015 solo da ejemplos "conceptuales, no definitivos"
-- (SELLER_STANDARD / VERIFIED / FEATURED / STORE)— y se eligieron INICIAL /
-- AVANZADO / PROFESIONAL porque describen una PROGRESION por volumen de
-- ventas, que es lo que pidio el owner, y no una verificacion o un tipo de
-- cuenta. ⚠️ SS-015: esto NO es el USER LEVEL (NUEVO/CONFIABLE/...) ni el
-- estado de riesgo. Son tres ejes distintos.
--
-- UNIDAD DE `commission_rate`: la columna es numeric(6,4), o sea una FRACCION
-- (0.0600 = 6%), igual que `orders.commission_rate_at_transaction`. NO son
-- basis points como `app_settings.commission_rate_default` (600): en
-- numeric(6,4) el maximo es 99.9999 y 600 no entra. Quien lea el tier y
-- necesite basis points hace round(rate * 10000); quien escriba el snapshot de
-- la orden copia la fraccion tal cual. `basisPointsToRateSnapshot()` en
-- `modules/config/services/settings.service.ts` hace la conversion inversa.
--
-- LAS TASAS: 6% / 5% / 4%. El 6% del tier inicial coincide con
-- `commission_rate_default` (DEC-007 / DEC-043) a proposito: un vendedor sin
-- tier y uno en INICIAL pagan lo mismo, asi que asignar el tier no cambia
-- nada hasta que sube. Los otros dos son ASUMIDOS.
--
-- `limits.minCompletedSales`: cuantas ordenes COMPLETED hacen falta para
-- alcanzar el tier (0 / 10 / 50, ASUMIDOS). Solo cuentan COMPLETED y no
-- PAID porque la venta recien "existe" cuando termino sin reclamo (BR-033), y
-- porque contar ventas reembolsadas seria un incentivo a inflar el volumen
-- (BR-051). El detalle de que cuenta esta en `seller_tier_evaluation`.
--
-- ⚠️ Esto NO asigna tiers a nadie: `seller_profiles.seller_tier_id` sigue NULL
-- hasta que el modulo de tiers lo escriba. Null = sin tier (DEC-037), y el
-- sistema sigue cobrando `commission_rate_default`.
INSERT INTO seller_tiers (code, name, commission_rate, limits, benefits, is_active)
SELECT nuevos.code, nuevos.name, nuevos.commission_rate, nuevos.limits::jsonb, nuevos.benefits::jsonb, true
FROM (VALUES
  ('INICIAL',     'Vendedor inicial',     0.0600::numeric(6,4),
     '{"minCompletedSales": 0}',
     '{"description": "Comision estandar de la plataforma. Es el punto de partida de todo vendedor."}'),
  ('AVANZADO',    'Vendedor avanzado',    0.0500::numeric(6,4),
     '{"minCompletedSales": 10}',
     '{"description": "Un punto menos de comision a partir de 10 ventas completadas sin reclamo."}'),
  ('PROFESIONAL', 'Vendedor profesional', 0.0400::numeric(6,4),
     '{"minCompletedSales": 50}',
     '{"description": "La comision mas baja de la plataforma a partir de 50 ventas completadas."}')
) AS nuevos(code, name, commission_rate, limits, benefits)
WHERE NOT EXISTS (SELECT 1 FROM seller_tiers t WHERE t.code = nuevos.code);

-- =============================================================================
-- 2. APP SETTINGS (scope global)
-- =============================================================================
--
-- `value_type` sigue la convencion que YA usa el codigo, no la lista de
-- ejemplos del ERD §17.1 ('int'/'duration'): las claves existentes usan
-- 'rate', 'number' y 'json' (migraciones 0003/0005/0006) y los Services
-- validan el valor con `typeof`, no con `value_type`. Se agrega 'bool' para
-- los feature flags, que es el unico tipo nuevo.
--
-- Plazos en la UNIDAD que dice la clave (minutos / horas / dias). Se elige la
-- unidad natural de cada plazo en vez de normalizar todo a segundos para que
-- un administrador lea "72" y entienda "tres dias" sin calculadora.
--
-- LOS VALORES, y de donde sale cada uno:
--
--   payment_window_minutes = 2880 (48 h)
--     Ventana para pagar antes de que `PENDING_PAYMENT` venza (DEC-033,
--     marketplace-flow §6.1: valor 🟡). Dos dias cubren un pago por Rapipago
--     o Pago Facil, que se acredita al dia siguiente; con menos, el comprador
--     que eligio efectivo pierde la orden antes de que el pago llegue.
--     `orders.payment_deadline` guarda el instante YA calculado (ERD §11.1).
--
--   dispatch_deadline_hours = 72
--     Plazo de despacho tras el pago (BR-032: "🟡 p. ej. 3 dias habiles").
--     Se toman 72 horas corridas: el sistema no tiene calendario de feriados
--     y "habiles" seria prometer una cuenta que nadie hace.
--
--   buyer_protection_days = 7
--     Dias desde DELIVERED para que la orden pase sola a COMPLETED si no hay
--     reclamo (BR-033 / BR-034: 🟡). Una semana es lo que tarda alguien en
--     abrir el paquete, probarse la camiseta y decidir si es la que compro.
--
--   review_window_days = 30
--     Hasta cuando se puede calificar despues de COMPLETED. Reviews: "solo
--     sobre ordenes COMPLETED" (ERD §15). Un mes evita reviews sobre compras
--     que ya nadie recuerda y que pesan igual en `seller_reputations`.
--
--   promotion_commission_multiplier = 3
--     El owner dijo "el triple" (2026-09-10). La comision de una publicacion
--     promocionada = tasa del vendedor x este numero, y la orden lo snapshotea
--     en `promotion_multiplier_at_transaction` (DEC-030).
--
--   promotion_duration_days = 7
--     Cuanto dura una promocion: `listings.promoted_until = now() + esto`.
--
--   promotion_rank_boost = 1
--     Peso de "destacadas" en el ranking (PS-021 ⚙️). Es un sumando al
--     score de busqueda, no un multiplicador; con 0 las promocionadas no
--     suben. La escala concreta la define el modulo de busqueda.
--
--   seller_tier_evaluation
--     Que cuenta como "venta" al evaluar el tier: solo COMPLETED y sin las
--     reembolsadas (BR-051). Es json y no dos claves sueltas porque describe
--     UNA regla y se lee de una vez.
--
--   user_level_thresholds = CONFIABLE 5 / DESTACADO 10 / COLECCIONISTA 20
--     Son los umbrales PRELIMINARES de DEC-020, copiados tal cual. TIENDA no
--     esta porque DEC-020 la define como "otorgada por Offside", no por
--     umbral. ⚠️ Que cuenta como "compras y ventas" sigue 🟡 en DEC-020.
--
--   reputation_score_weights
--     Pesos de la formula de reputacion (OQ-D4, 🟡). Suman 1. `score` es
--     DERIVADO y sin autoridad (DEC-036): si cambia la formula se recalcula
--     desde `user_history_events`, asi que este valor puede corregirse sin
--     romper nada historico.
--
--   dispute_seller_response_days = 3
--     Plazo del vendedor para responder una disputa (TS-052 / OQ-D1, 🟡).
--     `disputes.seller_response_due_at` guarda el instante calculado.
--
--   feature_* = true
--     Flags de MVP (configuration-registry §3). Arrancan encendidos porque
--     los modulos se construyen para usarse; la perilla existe para APAGAR
--     uno sin redesplegar si sale mal.
INSERT INTO app_settings (scope, scope_id, key, value, value_type, version)
SELECT 'global', NULL, nuevas.key, nuevas.value::jsonb, nuevas.value_type, 1
FROM (VALUES
  ('payment_window_minutes',           '2880',  'number'),
  ('dispatch_deadline_hours',          '72',    'number'),
  ('buyer_protection_days',            '7',     'number'),
  ('review_window_days',               '30',    'number'),
  ('promotion_commission_multiplier',  '3',     'number'),
  ('promotion_duration_days',          '7',     'number'),
  ('promotion_rank_boost',             '1',     'number'),
  ('seller_tier_evaluation',           '{"countsOnly":"COMPLETED","excludesRefunded":true}',                          'json'),
  ('user_level_thresholds',            '{"CONFIABLE":5,"DESTACADO":10,"COLECCIONISTA":20}',                          'json'),
  ('reputation_score_weights',         '{"rating":0.4,"sales":0.2,"dispatch":0.2,"cancellations":0.1,"claims":0.1}', 'json'),
  ('dispute_seller_response_days',     '3',     'number'),
  ('feature_promotions',               'true',  'bool'),
  ('feature_reviews',                  'true',  'bool'),
  ('feature_questions',                'true',  'bool'),
  ('feature_cart',                     'true',  'bool')
) AS nuevas(key, value, value_type)
WHERE NOT EXISTS (
  SELECT 1 FROM app_settings
   WHERE app_settings.scope = 'global'
     AND app_settings.scope_id IS NULL
     AND app_settings.key = nuevas.key
);
