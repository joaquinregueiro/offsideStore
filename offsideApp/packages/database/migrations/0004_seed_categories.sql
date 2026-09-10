-- Carga las categorias de prenda.
--
-- POR QUE HACE FALTA: `listings.category_id` es FK NOT NULL contra
-- `categories`, y la tabla nacia VACIA. Sin filas aca, publicar es imposible:
-- no hay un solo `category_id` valido que el vendedor pueda elegir. Es el dato
-- que faltaba para que el modulo `listings` sirviera para algo.
--
-- POR QUE NO ES INVENTAR NEGOCIO: `database-design.md` §5 dice que `categories`
-- "es un conjunto fijo respaldado por el enum `garment_category` y no se
-- propone" —es la unica tabla de catalogo excluida de `catalog_change_requests`
-- (DEC-041)-. Las seis filas son exactamente los seis valores del enum, ni una
-- mas. Los nombres y slugs son la forma en castellano de esos mismos valores.
--
-- POR QUE UNA MIGRACION: es la unica via autorizada para tocar la base
-- (CLAUDE.md §6), y garantiza que toda base que corrio las migraciones puede
-- publicar. Mismo criterio que 0003.
--
-- ⚠️ `required_attributes` QUEDA NULL A PROPOSITO. Es 🟦 OQ-F1: estructura
-- definida, semantica PENDIENTE. Llenarlo seria inventar el contrato de un
-- campo que la documentacion todavia no define. Mientras tanto la obligacion
-- de `kit_type`/`sleeve` para camiseta vive en el Service, que es donde el ERD
-- §9.1 la pone ("validado en la app y no por un CHECK").
--
-- ⚠️ `aliases` tambien queda NULL: alimenta la busqueda (DEC-042), que no
-- existe. Se carga cuando exista el modulo que la usa.
--
-- IDEMPOTENTE por `code`, que es UNIQUE: si una fila ya esta, no se toca.
INSERT INTO categories (name, slug, code)
SELECT * FROM (VALUES
  ('Camisetas',    'camisetas',    'camiseta'::garment_category),
  ('Shorts',       'shorts',       'short'::garment_category),
  ('Buzos',        'buzos',        'buzo'::garment_category),
  ('Camperas',     'camperas',     'campera'::garment_category),
  ('Conjuntos',    'conjuntos',    'conjunto'::garment_category),
  ('Entrenamiento','entrenamiento','entrenamiento'::garment_category)
) AS nuevas(name, slug, code)
WHERE NOT EXISTS (
  SELECT 1 FROM categories WHERE categories.code = nuevas.code
);
