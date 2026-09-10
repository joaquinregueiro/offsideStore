-- Carga la configuracion de imagenes de publicaciones en el Config Store.
--
-- `configuration-registry.md` §8 lista "cantidad maxima de fotos", "tamaño
-- maximo de archivo" y "formatos permitidos" como configuracion administrativa
-- (⚙️ DEC-013), con sus valores 🟡 SIN DEFINIR. Los de aca son una decision de
-- implementacion del owner (2026-09-02) tomada bajo DEC-032 —"simple por
-- defecto, configurable cuando sea necesario"—, no una decision documentada en
-- `docs/`.
--
-- POR QUE UNA MIGRACION Y NO UN DEFAULT EN CODIGO: mismo criterio que 0003. Un
-- fallback en codigo seria una segunda fuente de verdad, y el dia que alguien
-- cambie el setting nadie sabria cual rigio. Cargarlo por migracion garantiza
-- que la clave existe en toda base que corrio las migraciones.
--
-- LOS VALORES, y por que:
--   * 8 fotos     — alcanza para frente, dorso, etiqueta y detalles con margen.
--                   PS-010 exige >=1; PS-011 recomienda la etiqueta en usadas.
--   * 5 MB        — entra cualquier foto de celular sin que el vendedor tenga
--                   que recortarla, y sigue siendo procesable en memoria.
--   * JPEG/PNG/WebP — los tres que el procesador sabe tratar.
--
-- ⚠️ SVG NO ESTA Y NO PUEDE ESTAR: un SVG es un documento que puede ejecutar
-- JavaScript. Servido desde nuestro dominio seria XSS almacenado, robando la
-- sesion de quien mire la publicacion. El Service ademas lo rechaza aunque
-- alguien lo cargue a mano en esta tabla.
--
-- IDEMPOTENTE: si una clave ya existe no se toca. No pisa un valor configurado.
INSERT INTO app_settings (scope, scope_id, key, value, value_type, version)
SELECT 'global', NULL, nuevas.key, nuevas.value::jsonb, nuevas.value_type, 1
FROM (VALUES
  ('listing_max_images',         '8',                                          'number'),
  ('listing_max_image_bytes',    '5242880',                                    'number'),
  ('listing_allowed_image_types','["image/jpeg","image/png","image/webp"]',    'json')
) AS nuevas(key, value, value_type)
WHERE NOT EXISTS (
  SELECT 1 FROM app_settings
   WHERE app_settings.scope = 'global'
     AND app_settings.scope_id IS NULL
     AND app_settings.key = nuevas.key
);
