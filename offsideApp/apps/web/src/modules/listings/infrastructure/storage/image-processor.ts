import { createHash } from 'node:crypto';

import sharp from 'sharp';

import type { FormatoSoportado } from '../../../config/services/image-settings.service';

/**
 * Procesamiento de imagenes subidas.
 *
 * =============================================================================
 * ESTE ARCHIVO ES LA FRONTERA DE SEGURIDAD DE LA SUBIDA
 * =============================================================================
 *
 * Hasta acá, todo lo que entra al sistema es texto validado con Zod. Un archivo
 * subido por un usuario es la primera entrada binaria, y trae cuatro problemas
 * que se resuelven todos en este modulo:
 *
 *  1. **El tipo declarado miente.** El `Content-Type` lo pone el cliente. No se
 *     mira: se DECODIFICA el archivo y se cree lo que sharp diga que es.
 *  2. **Bombas de descompresion.** Un PNG de pocos MB puede expandirse a varios
 *     GB al decodificarse y tumbar el proceso. Se acota con `limitInputPixels`.
 *  3. **Metadatos con GPS.** Una foto de celular sacada en la casa del vendedor
 *     lleva SUS COORDENADAS. Publicarla tal cual filtra el domicilio de quien
 *     vende. Se borran todos los metadatos.
 *  4. **Contenido activo.** Un SVG ejecuta JavaScript; servido desde nuestro
 *     dominio seria XSS almacenado. No esta en los formatos soportados, y
 *     ademas nunca se guarda el archivo original.
 *
 * ⚠️ NUNCA SE ALMACENAN LOS BYTES ORIGINALES. Todo se re-codifica a WebP. Es la
 * garantia mas fuerte de las cuatro: lo que termina en el bucket es lo que
 * produjo el codificador, no lo que mando el cliente. Cualquier carga util
 * escondida en el archivo de entrada no sobrevive la decodificacion.
 */

/** Techo de pixeles decodificados. 50 MP entra cualquier camara real. */
const MAX_PIXELES = 50_000_000;

/**
 * Variantes que se generan (ERD §9.2 anticipa `variants jsonb`).
 *
 * El ancho es el limite; el alto sale de la proporcion original. Nunca se
 * agranda una imagen chica —`withoutEnlargement`—: estirarla sólo agrega peso
 * sin agregar detalle.
 */
export const VARIANTES = {
  thumb: 400,
  medium: 800,
  large: 1600,
} as const;

export type NombreDeVariante = keyof typeof VARIANTES;

/** Formato de salida. Ver `procesarImagen`. */
export const FORMATO_DE_SALIDA = 'image/webp' as const;

export interface VarianteProcesada {
  nombre: NombreDeVariante;
  buffer: Buffer;
  width: number;
  height: number;
}

export interface ImagenProcesada {
  /** SHA-256 del archivo ORIGINAL. Identifica la foto, no su codificacion. */
  hash: string;
  width: number;
  height: number;
  variantes: VarianteProcesada[];
}

export class ImagenInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImagenInvalidaError';
  }
}

/**
 * Decodifica y valida el archivo. Devuelve el formato REAL.
 *
 * ⚠️ NO MIRA el `Content-Type` que declaro el cliente: lo decodifica. Un `.jpg`
 * que en realidad es otra cosa se rechaza acá.
 */
async function formatoReal(bytes: Buffer, permitidos: FormatoSoportado[]): Promise<string> {
  let metadata;

  try {
    metadata = await sharp(bytes, { limitInputPixels: MAX_PIXELES }).metadata();
  } catch {
    // No se propaga el error de la libreria: puede traer detalles del archivo.
    throw new ImagenInvalidaError('El archivo no es una imagen que podamos procesar');
  }

  const mime = metadata.format === undefined ? undefined : `image/${metadata.format}`;
  const normalizado = mime === 'image/jpg' ? 'image/jpeg' : mime;

  if (normalizado === undefined || !permitidos.includes(normalizado as FormatoSoportado)) {
    throw new ImagenInvalidaError('Ese tipo de archivo no está permitido. Subí JPG, PNG o WebP');
  }

  if (metadata.width === undefined || metadata.height === undefined) {
    throw new ImagenInvalidaError('No pudimos leer las dimensiones de la imagen');
  }

  return normalizado;
}

/**
 * Valida, normaliza y genera las variantes.
 *
 * ⚠️ LA SALIDA SIEMPRE ES WebP, sea cual sea la entrada. Es una decision de
 * implementacion: pesa bastante menos que JPEG a calidad equivalente y lo
 * soportan todos los navegadores vigentes. La configuracion administrativa
 * gobierna que se puede SUBIR, no en que formato se guarda.
 *
 * ⚠️ `rotate()` SIN ARGUMENTOS aplica la orientacion del EXIF y despues la
 * descarta. Sin esto, las fotos verticales de celular se ven acostadas: la
 * camara guarda los pixeles apaisados y anota "girar 90°" en un metadato que
 * estamos por borrar.
 */
export async function procesarImagen(
  bytes: Buffer,
  permitidos: FormatoSoportado[],
): Promise<ImagenProcesada> {
  await formatoReal(bytes, permitidos);

  // El hash es del ORIGINAL: identifica la foto que subio la persona,
  // independientemente de como la codifiquemos despues.
  const hash = createHash('sha256').update(bytes).digest('hex');

  const base = sharp(bytes, { limitInputPixels: MAX_PIXELES }).rotate();
  const { width, height } = await base.metadata();

  const variantes = await Promise.all(
    (Object.keys(VARIANTES) as NombreDeVariante[]).map(async (nombre) => {
      const salida = await sharp(bytes, { limitInputPixels: MAX_PIXELES })
        .rotate()
        .resize({ width: VARIANTES[nombre], withoutEnlargement: true })
        // ⚠️ NO se llama a `withMetadata()`. Sharp descarta EXIF, IPTC y XMP por
        // defecto, y eso es EXACTAMENTE lo que queremos: ahi viven las
        // coordenadas GPS. Agregar `withMetadata()` volveria a meterlas.
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });

      return {
        nombre,
        buffer: salida.data,
        width: salida.info.width,
        height: salida.info.height,
      };
    }),
  );

  return { hash, width: width ?? 0, height: height ?? 0, variantes };
}
