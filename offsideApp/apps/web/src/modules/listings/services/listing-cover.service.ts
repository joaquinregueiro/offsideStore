import { createStorage } from '../infrastructure/storage/index';
import { VARIANTES } from '../infrastructure/storage/image-processor';
import * as imageRepo from '../repositories/listing-image.repository';

/**
 * Portadas de publicaciones y sus tamaños.
 *
 * ⚠️ ESTE MODULO EXISTE POR UN CICLO DE IMPORTS, NO POR GUSTO. `listing.service`
 * importa `reindex` de `search.service`, asi que `search.service` no puede
 * importar de `listing.service`: el resultado seria un ciclo. Y las dos
 * necesitan exactamente lo mismo —la portada de una fila y sus variantes—, tanto
 * que `search.service` tenia la resolucion COPIADA. Con la copia, agregarle
 * `srcset` a la vitrina dejaba la busqueda sirviendo siempre 800px, y nada
 * fallaba: simplemente la misma camiseta pesaba distinto segun por donde se
 * llegara.
 *
 * Depende solo del repositorio de imagenes y del almacenamiento, asi que no
 * puede cerrar un ciclo con nadie.
 */

/** Una portada con sus tamaños, lista para un `<img>`. */
export interface Portada {
  /** La variante `medium`. Es el `src` de respaldo: siempre existe. */
  url: string;
  /** Las variantes disponibles como `srcset`, o `null` si no se pudo armar. */
  srcSet: string | null;
}

/**
 * URL de una variante.
 *
 * ⚠️ `variants` guarda CLAVES, no URLs: el dominio publico es configuracion y
 * puede cambiar, asi que la direccion se compone al leer. Un valor que ya sea
 * absoluto se devuelve tal cual —las primeras filas guardaron URLs completas—.
 */
export function urlDeVariante(imagen: imageRepo.ListingImageRow, variante: string): string | null {
  const guardado = variantesDe(imagen)[variante] ?? imagen.storageKey;
  if (guardado === undefined || guardado === '') return imagen.url ?? null;

  return absoluta(guardado);
}

/**
 * Las variantes de una imagen como `srcset`.
 *
 * ⚠️ SE DESCRIBE EL ANCHO REAL DEL ARCHIVO (`400w`), NO UN MULTIPLICADOR
 * (`2x`). Con `w` el navegador combina el ancho declarado en `sizes` con la
 * densidad de la pantalla y elige solo; con `x` habria que saber de antemano a
 * que tamaño se va a pintar, que es justo lo que cambia entre la vitrina, la
 * busqueda, la tienda de un vendedor y la galeria de la ficha.
 *
 * ⚠️ SOLO ENTRAN LAS VARIANTES QUE EXISTEN DE VERDAD. `procesarImagen` NO
 * agranda una foto chica (`withoutEnlargement`), asi que de una imagen de 500px
 * puede no haber `large`: declarar `1600w` sobre un archivo que no existe —o que
 * en realidad mide 500— hace que el navegador descarte opciones buenas creyendo
 * que son grandes.
 *
 * ⚠️ CON UNA SOLA VARIANTE DEVUELVE `null`. Un `srcset` de un elemento no le da
 * a elegir nada al navegador y solo agrega bytes al HTML.
 */
export function srcSetDe(imagen: imageRepo.ListingImageRow): string | null {
  const variants = variantesDe(imagen);
  const partes: string[] = [];

  for (const [nombre, ancho] of Object.entries(VARIANTES)) {
    const guardado = variants[nombre];
    if (guardado === undefined || guardado === '') continue;

    partes.push(`${absoluta(guardado)} ${ancho}w`);
  }

  return partes.length > 1 ? partes.join(', ') : null;
}

/**
 * Portadas con sus tamaños, en UNA consulta para toda la pagina.
 *
 * Pedirlas de a una seria el problema N+1 en la pantalla mas visitada.
 */
export async function coverImages(listingIds: string[]): Promise<Map<string, Portada>> {
  const imagenes = await imageRepo.findByListingIds(listingIds);
  const portadas = new Map<string, Portada>();

  for (const imagen of imagenes) {
    // Vienen ordenadas por posicion: la primera de cada listing es la portada.
    if (portadas.has(imagen.listingId)) continue;

    const url = urlDeVariante(imagen, 'medium');
    if (url !== null) portadas.set(imagen.listingId, { url, srcSet: srcSetDe(imagen) });
  }

  return portadas;
}

function variantesDe(imagen: imageRepo.ListingImageRow): Record<string, string> {
  return imagen.variants !== null && typeof imagen.variants === 'object'
    ? (imagen.variants as Record<string, string>)
    : {};
}

/** Una clave de almacenamiento se compone contra el dominio publico; una URL ya lo es. */
function absoluta(guardado: string): string {
  return /^https?:\/\//.test(guardado) ? guardado : createStorage().publicUrl(guardado);
}
