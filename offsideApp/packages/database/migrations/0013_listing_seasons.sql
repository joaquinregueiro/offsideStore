-- Temporadas de una publicacion: de UNA a VARIAS (hasta 3).
--
-- ⚠️ DELTA AL ERD v1.3, AUTORIZADO POR EL OWNER EL 2026-11-10 (CLAUDE.md §5).
-- El ERD modela la temporada como una sola FK en `listings.season_id` y esa
-- forma no alcanza: el kit de un club se repite dos o tres temporadas seguidas,
-- y quien publica tenia que elegir una y callarse las otras.
--
-- ⚠️ `listings.season_id` NO SE BORRA. Borrar una columna es irreversible y hoy
-- la leen la busqueda, las facetas y los filtros. Esta migracion COPIA lo que
-- haya ahi a la tabla nueva; de ahora en mas la verdad vive en
-- `listing_seasons` y la columna queda quieta hasta que el owner la de de baja
-- en el ERD.
--
-- ⚠️ `listing_id` CASCADE y `season_id` RESTRICT (ERD §20.10): la fila es un
-- hijo dependiente de la publicacion, pero la temporada es catalogo compartido
-- y borrar "2015" no puede arrastrar publicaciones ajenas.

CREATE TABLE "listing_seasons" (
	"listing_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_seasons_listing_id_season_id_pk" PRIMARY KEY("listing_id","season_id")
);
--> statement-breakpoint
ALTER TABLE "listing_seasons" ADD CONSTRAINT "listing_seasons_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_seasons" ADD CONSTRAINT "listing_seasons_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_seasons_season_id_idx" ON "listing_seasons" USING btree ("season_id");
--> statement-breakpoint
-- Backfill: lo que ya estaba elegido no se pierde.
--
-- Idempotente por la PK compuesta: correrla dos veces no duplica. Se omiten las
-- publicaciones sin temporada, que son la mayoria.
INSERT INTO listing_seasons (listing_id, season_id)
SELECT id, season_id
  FROM listings
 WHERE season_id IS NOT NULL
ON CONFLICT (listing_id, season_id) DO NOTHING;
