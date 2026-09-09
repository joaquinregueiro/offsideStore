import type { Database } from '@offside/database';

import { getSearchRankWeights } from '../../config/services/image-settings.service';
import type * as listingRepo from '../repositories/listing.repository';
import * as imageRepo from '../repositories/listing-image.repository';
import * as searchRepo from '../repositories/search.repository';
import { createStorage } from '../infrastructure/storage/index';

/**
 * Busqueda de publicaciones (PS-020 … PS-023, DEC-042).
 *
 * ⚠️ ALCANCE DE ESTA FASE, decidido con el owner (2026-09-08): texto libre mas
 * las facetas que **existen en los datos**. Las que `product-specification.md`
 * §5.1 lista sobre catalogo —club, seleccion, marca, competicion, temporada,
 * jugador— **no se pueden construir todavia**: las seis tablas de catalogo
 * estan vacias y el formulario de publicar no pide esos campos, asi que cada
 * publicacion tiene NULL ahi. No es un problema del motor: es que el dato no
 * existe.
 *
 * Lo que SI se cumple: PS-020 (full-text + filtros combinables), PS-020.b
 * (typos, via trigramas) y PS-022 (conteos por faceta).
 * Lo que queda pendiente: PS-023 sobre catalogo y PS-024 (alias).
 */

export interface SearchResult {
  id: string;
  title: string;
  priceAmount: string;
  currency: string;
  sizeValue: string;
  /** Tipado como el enum del ERD: la vitrina y la busqueda pintan lo mismo. */
  condition: listingRepo.ListingRow['condition'];
  sellerDisplayName: string;
  coverUrl: string | null;
}

export interface Faceta {
  valor: string;
  /** Como se muestra. Para categoria es el nombre; para el resto, el valor. */
  etiqueta: string;
  cantidad: number;
}

export interface SearchResponse {
  resultados: SearchResult[];
  total: number;
  facetas: {
    categoria: Faceta[];
    talle: Faceta[];
    condicion: Faceta[];
    tipoDeCamiseta: Faceta[];
    manga: Faceta[];
  };
}

export interface SearchQuery {
  texto?: string;
  categoryId?: string;
  sizeValue?: string;
  condition?: string;
  kitType?: string;
  sleeve?: string;
  precioMin?: bigint;
  precioMax?: bigint;
  orden?: searchRepo.SearchOrder;
  pagina?: number;
}

/** Tamaño de pagina. No es configuracion de negocio: es una constante de UI. */
const POR_PAGINA = 24;

/**
 * Busca publicaciones.
 *
 * ⚠️ NO EXIGE SESION. Buscar es parte de la vitrina: cualquiera tiene que poder
 * hacerlo sin registrarse, igual que ver el catalogo.
 *
 * ⚠️ EL TEXTO VACIO NO ES UNA BUSQUEDA DE TEXTO. Se trata como ausente, para
 * que `/buscar` sin query sea simplemente el catalogo con facetas y no una
 * consulta de texto contra la cadena vacia.
 */
export async function searchListings(query: SearchQuery): Promise<SearchResponse> {
  const texto = query.texto?.trim();
  const filtros: searchRepo.SearchFilters = {
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    ...(query.sizeValue === undefined ? {} : { sizeValue: query.sizeValue }),
    ...(query.condition === undefined ? {} : { condition: query.condition }),
    ...(query.kitType === undefined ? {} : { kitType: query.kitType }),
    ...(query.sleeve === undefined ? {} : { sleeve: query.sleeve }),
    ...(query.precioMin === undefined ? {} : { precioMin: query.precioMin }),
    ...(query.precioMax === undefined ? {} : { precioMax: query.precioMax }),
  };

  const base = { ...(texto === undefined || texto === '' ? {} : { texto }), filtros };
  const pesos = await getSearchRankWeights();
  const pagina = Math.max(1, query.pagina ?? 1);

  // Resultados, total y las cinco facetas salen juntos: son consultas
  // independientes contra la misma base y no tiene sentido encadenarlas.
  const [filas, total, categoria, talle, condicion, tipoDeCamiseta, manga] = await Promise.all([
    searchRepo.search({
      ...base,
      orden: query.orden ?? (texto === undefined ? 'recientes' : 'relevancia'),
      pesos,
      limite: POR_PAGINA,
      offset: (pagina - 1) * POR_PAGINA,
    }),
    searchRepo.countResults(base),
    searchRepo.facetCounts('categoryId', base),
    searchRepo.facetCounts('sizeValue', base),
    searchRepo.facetCounts('condition', base),
    searchRepo.facetCounts('kitType', base),
    searchRepo.facetCounts('sleeve', base),
  ]);

  const nombres = await searchRepo.categoryNames(categoria.map((f) => f.valor));

  return {
    resultados: await conPortadas(filas),
    total,
    facetas: {
      categoria: categoria.map((f) => ({
        valor: f.valor,
        etiqueta: nombres.get(f.valor) ?? f.valor,
        cantidad: f.cantidad,
      })),
      talle: talle.map(comoFaceta),
      condicion: condicion.map(comoFaceta),
      tipoDeCamiseta: tipoDeCamiseta.map(comoFaceta),
      manga: manga.map(comoFaceta),
    },
  };
}

function comoFaceta(f: searchRepo.FacetCount): Faceta {
  return { valor: f.valor, etiqueta: f.valor, cantidad: f.cantidad };
}

/**
 * Agrega la portada de cada resultado.
 *
 * Una sola consulta para toda la pagina, igual que en la vitrina: pedirlas de a
 * una seria el problema N+1.
 */
async function conPortadas(filas: searchRepo.SearchRow[]): Promise<SearchResult[]> {
  const imagenes = await imageRepo.findByListingIds(filas.map((f) => f.id));
  const storage = createStorage();
  const portadas = new Map<string, string>();

  for (const imagen of imagenes) {
    if (portadas.has(imagen.listingId)) continue;

    const variants =
      imagen.variants !== null && typeof imagen.variants === 'object'
        ? (imagen.variants as Record<string, string>)
        : {};
    const guardado = variants.medium ?? imagen.storageKey;

    if (guardado !== undefined && guardado !== '') {
      portadas.set(
        imagen.listingId,
        /^https?:\/\//.test(guardado) ? guardado : storage.publicUrl(guardado),
      );
    }
  }

  return filas.map((fila) => ({
    id: fila.id,
    title: fila.title,
    priceAmount: fila.priceAmount.toString(),
    currency: fila.currency,
    sizeValue: fila.sizeValue,
    condition: fila.condition as listingRepo.ListingRow['condition'],
    sellerDisplayName: fila.sellerDisplayName,
    coverUrl: portadas.get(fila.id) ?? null,
  }));
}

/**
 * Reindexa una publicacion. Lo llama `listings` al publicar y al editar.
 *
 * ⚠️ NO SE PROPAGA EL FALLO. Que el indice quede desactualizado hace que la
 * publicacion no aparezca en la busqueda; abortar por eso la publicacion
 * entera, o el cambio de precio, seria mucho peor. Se registra.
 */
export async function reindex(listingId: string, db?: Database): Promise<void> {
  try {
    await searchRepo.reindexListing(listingId, db);
  } catch (error) {
    console.error(
      `[search] no se pudo reindexar la publicacion ${listingId}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}
