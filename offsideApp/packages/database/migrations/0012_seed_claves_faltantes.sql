-- Siembra las cuatro claves del Config Store que el codigo estaba resolviendo
-- con un default propio.
--
-- ⚠️ POR QUE IMPORTA Y NO ES COSMETICO. Las cuatro estan marcadas ⚙️
-- CONFIGURABLE (CLAUDE.md §12): el MECANISMO es obligatorio y el VALOR no se
-- hardcodea. Mientras la fila no existe, el lector tipado de `config` cae a un
-- default escrito en TypeScript: la aplicacion funciona, pero
-- `/admin/configuracion` las muestra como ausentes y **no se pueden cambiar sin
-- un deploy**, que es exactamente lo que el Config Store existe para evitar.
--
-- ⚠️ LOS VALORES SON LOS MISMOS QUE EL CODIGO YA USABA. Sembrarlos no cambia
-- el comportamiento de nada: mueve la decision de donde no se puede tocar a
-- donde si. Todos siguen ASUMIDOS y pendientes de confirmacion del owner.
--
-- ⚠️ `shipping_carriers` VA CON `trackingUrlTemplate` EN NULL, A PROPOSITO. Las
-- URLs de seguimiento de cada correo son 🌐 dependencia externa: no se inventan.
-- Sin plantilla, la pantalla muestra el numero de seguimiento como texto y no
-- promete un enlace que puede no existir.
--
-- Idempotente como las anteriores: el `WHERE NOT EXISTS` deja pasar una
-- migracion repetida sin pisar un valor que Admin ya haya cambiado.

INSERT INTO app_settings (scope, scope_id, key, value, value_type, version)
SELECT 'global', NULL, nuevas.key, nuevas.value::jsonb, nuevas.value_type, 1
FROM (VALUES
  -- Transportistas que el vendedor puede elegir al despachar. Sin Correo
  -- Argentino integrado, el envio lo declara quien vende.
  ('shipping_carriers',
   '[{"code":"correo_argentino","name":"Correo Argentino","trackingUrlTemplate":null},{"code":"andreani","name":"Andreani","trackingUrlTemplate":null},{"code":"oca","name":"OCA","trackingUrlTemplate":null},{"code":"otro","name":"Otro","trackingUrlTemplate":null}]',
   'json'),
  -- "A convenir" apagado: implica pagar el envio por fuera de Mercado Pago,
  -- o sea fuera de toda trazabilidad y de cualquier reclamo.
  ('shipping_to_agree_allowed',   'false', 'bool'),
  -- Plazo para abrir un reclamo, contado desde la entrega (DEC-034).
  ('dispute_window_days',         '7',     'number'),
  -- Ventana que reconsulta el barrido de conciliacion contra Mercado Pago.
  ('reconciliation_window_days',  '30',    'number')
) AS nuevas(key, value, value_type)
WHERE NOT EXISTS (
  SELECT 1 FROM app_settings
   WHERE app_settings.scope = 'global'
     AND app_settings.scope_id IS NULL
     AND app_settings.key = nuevas.key
);
