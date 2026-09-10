-- Carga la comision por defecto en el Config Store.
--
-- DEC-007 (✅ 6%) + DEC-043. La tasa dejo de ser una constante en el codigo:
-- vive en `app_settings` y se puede cambiar sin redesplegar.
--
-- POR QUE UNA MIGRACION Y NO UN VALOR POR DEFECTO EN CODIGO: un fallback seria
-- una segunda fuente de verdad. El dia que alguien cambie el setting y el
-- codigo siga teniendo su propio numero, nadie sabria cual rigio. Cargarlo por
-- migracion garantiza que la clave existe en toda base que corrio las
-- migraciones, que es la unica via autorizada para tocar el esquema.
--
-- UNIDAD: basis points enteros. 600 = 6%. La documentacion fija la clave y su
-- `value_type` pero no la unidad; el porcentaje en punto flotante no sobrevive
-- el viaje por JSON (`0.06` no es representable en binario).
--
-- IDEMPOTENTE: si la clave ya existe —por una carga manual previa— no hace
-- nada. No pisa una tasa que alguien haya configurado.
INSERT INTO app_settings (scope, scope_id, key, value, value_type, version)
SELECT 'global', NULL, 'commission_rate_default', '600'::jsonb, 'rate', 1
WHERE NOT EXISTS (
  SELECT 1 FROM app_settings
   WHERE scope = 'global' AND scope_id IS NULL AND key = 'commission_rate_default'
);
