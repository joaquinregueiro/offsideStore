-- Configuracion de la busqueda en el Config Store, y backfill del indice.
--
-- === 1. PESOS DEL RANKING ===
--
-- DEC-042 lo pide con estas palabras: "Los pesos de ranking permanecen
-- configurables desde la aplicacion (`app_settings`), nunca hardcodeados".
-- PS-021 los marca ⚙️ CONFIGURABLE.
--
-- El valor es el arreglo que PostgreSQL le pasa a `ts_rank`, en su orden:
-- {D, C, B, A}. Las etiquetas A..D son ESTRUCTURA —que campo pesa en que
-- categoria— y viven en el codigo; estos numeros son POLITICA —cuanto pesa
-- cada categoria— y viven aca.
--
--   A = titulo        (1.0)  lo que el vendedor eligio para nombrar la prenda
--   B = jugador/modelo(0.4)  datos especificos, todavia sin cargar
--   C = descripcion   (0.2)  texto largo: aporta, pero no manda
--   D = sin uso       (0.1)
--
-- Los valores iniciales son una decision de implementacion bajo DEC-032
-- ("simple por defecto, configurable cuando sea necesario"): la documentacion
-- exige que el mecanismo exista y que se puedan cambiar, no fija los numeros.
INSERT INTO app_settings (scope, scope_id, key, value, value_type, version)
SELECT 'global', NULL, 'search_rank_weights', '[0.1, 0.2, 0.4, 1.0]'::jsonb, 'json', 1
WHERE NOT EXISTS (
  SELECT 1 FROM app_settings
   WHERE scope = 'global' AND scope_id IS NULL AND key = 'search_rank_weights'
);

-- === 2. BACKFILL DE `search_vector` ===
--
-- La columna existe desde la migracion inicial y nunca se lleno: las
-- publicaciones creadas hasta hoy son invisibles para la busqueda.
--
-- ⚠️ ESTO NO CONVIERTE AL SQL EN LA FUENTE DE VERDAD. DEC-042 es explicito en
-- que `search_vector` lo puebla el **Service**, no un trigger ni una columna
-- generada, porque el vector tiene que poder leer los `aliases` de los
-- catalogos (PS-024) y esa logica no entra en PL/pgSQL. Esto es un backfill de
-- una sola vez para las filas que quedaron atras; de aca en mas lo mantiene el
-- Service al publicar y al editar.
--
-- ⚠️ `unaccent` se aplica a proposito: DEC-042 lo exige para que "peñarol"
-- encuentre "penarol" y al reves.
UPDATE listings
   SET search_vector =
         setweight(to_tsvector('spanish', unaccent(coalesce(title, ''))), 'A')
      || setweight(to_tsvector('spanish', unaccent(coalesce(player_name, '') || ' ' || coalesce(model, ''))), 'B')
      || setweight(to_tsvector('spanish', unaccent(coalesce(description, ''))), 'C')
 WHERE search_vector IS NULL;
