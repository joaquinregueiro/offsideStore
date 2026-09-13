import type { MetadataRoute } from 'next';

import {
  catalogoDeLaVitrina,
  listPublicCatalog,
} from '@/modules/listings/services/listing.service';

/**
 * Mapa del sitio.
 *
 * ⚠️ NO EXISTIA, Y SIN EL LAS PANTALLAS DE CATALOGO NO SIRVEN PARA NADA. Un
 * buscador llega a una pagina siguiendo un enlace o leyendo un sitemap; recien
 * creadas, `/club/[slug]` y `/marca/[slug]` no tienen todavia enlaces entrantes
 * desde afuera. Esto es lo que las pone en la cola de indexacion.
 *
 * ⚠️ SE LEE `process.env.APP_URL` DIRECTO Y NO `getEnv()`, por la misma razon que
 * `app/layout.tsx` y la ficha: `getEnv()` valida el entorno ENTERO y tira si
 * falta cualquier variable. Un sitemap no deberia romperse porque no este
 * configurado Mercado Pago.
 *
 * ⚠️ SOLO ENTRA LO QUE UN ANONIMO PUEDE VER. Nada de `/cuenta`, `/vendedor`,
 * `/admin`, `/carrito` ni `/checkout`: son privadas, y ademas `robots.ts` las
 * bloquea. Un sitemap que lista lo que redirige al login gasta presupuesto de
 * rastreo y le enseña al buscador que el sitio devuelve basura.
 */

const BASE = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Tope de publicaciones en el sitemap.
 *
 * ⚠️ EL DEFAULT DE `listPublicCatalog` ES 60 —el de la vitrina— y acá seria un
 * error: dejaria fuera del indice todo lo que no entra en la portada, que es
 * justo lo que mas necesita que lo encuentren. El limite del formato son 50.000
 * URLs; 5.000 es holgado para el catalogo de hoy y evita armar un XML enorme si
 * alguien publica en masa.
 */
const TOPE_DE_PUBLICACIONES = 5000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  /*
   * ⚠️ NINGUNA DE LAS DOS PUEDE VOLTEAR EL SITEMAP. Si la base falla, es mejor
   * entregar las fijas —que siempre existen— que devolver un 500: un sitemap
   * roto le dice al buscador que el sitio no es confiable.
   */
  const [catalogo, listings] = await Promise.all([
    catalogoDeLaVitrina().catch((error: unknown) => {
      console.error('[sitemap] no se pudo leer el catalogo', error);

      return null;
    }),
    listPublicCatalog(TOPE_DE_PUBLICACIONES).catch((error: unknown) => {
      console.error('[sitemap] no se pudieron leer las publicaciones', error);

      return [];
    }),
  ]);

  const fijas: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE}/buscar`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/como-funciona`, changeFrequency: 'monthly', priority: 0.5 },
  ];

  const clubes: MetadataRoute.Sitemap = (catalogo?.clubes ?? []).map((entrada) => ({
    url: `${BASE}/club/${entrada.slug}`,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  const marcas: MetadataRoute.Sitemap = (catalogo?.marcas ?? []).map((entrada) => ({
    url: `${BASE}/marca/${entrada.slug}`,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  /*
   * ⚠️ LA FICHA ES LA PAGINA QUE MAS SE COMPARTE, asi que va con la prioridad mas
   * alta despues de la portada. No lleva `lastModified`: `CatalogListing` no trae
   * fecha, e inventar una —`new Date()` en cada build— le enseña al buscador que
   * el dato no significa nada.
   */
  const fichas: MetadataRoute.Sitemap = listings.map((listing) => ({
    url: `${BASE}/p/${listing.id}`,
    changeFrequency: 'daily',
    priority: 0.9,
  }));

  return [...fijas, ...clubes, ...marcas, ...fichas];
}
