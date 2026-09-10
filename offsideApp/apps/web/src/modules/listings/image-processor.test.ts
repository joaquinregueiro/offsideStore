import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import type { FormatoSoportado } from '../config/services/image-settings.service';

import {
  ImagenInvalidaError,
  VARIANTES,
  procesarImagen,
} from './infrastructure/storage/image-processor';

/**
 * Tests del procesamiento de imagenes.
 *
 * ESTE ARCHIVO CUBRE LA FRONTERA DE SEGURIDAD DE LA SUBIDA. Lo que se prueba no
 * es que la imagen "salga linda": es que un archivo hostil no pase, y que los
 * metadatos que exponen a la persona que vende no sobrevivan.
 */

const PERMITIDOS: FormatoSoportado[] = ['image/jpeg', 'image/png', 'image/webp'];

/** Imagen valida, generada al vuelo para no versionar binarios en el repo. */
async function imagen(
  ancho = 1200,
  alto = 900,
  formato: 'jpeg' | 'png' | 'webp' = 'jpeg',
): Promise<Buffer> {
  const base = sharp({
    create: { width: ancho, height: alto, channels: 3, background: '#0f7a45' },
  });

  if (formato === 'png') return base.png().toBuffer();
  if (formato === 'webp') return base.webp().toBuffer();

  return base.jpeg().toBuffer();
}

describe('validacion del contenido real', () => {
  it('⚠️ rechaza un archivo que NO es una imagen aunque tenga nombre de foto', async () => {
    // El `Content-Type` y la extension los pone el cliente. Lo unico que decide
    // es si el archivo se puede DECODIFICAR.
    const texto = Buffer.from('#!/bin/sh\nrm -rf /\n', 'utf8');

    await expect(procesarImagen(texto, PERMITIDOS)).rejects.toBeInstanceOf(ImagenInvalidaError);
  });

  it('⚠️ rechaza un SVG, aunque sea una imagen valida', async () => {
    // Un SVG es un documento que puede ejecutar JavaScript. Servido desde
    // nuestro dominio seria XSS almacenado, robando la sesion de quien mire la
    // publicacion. No alcanza con no ofrecerlo en el formulario.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
        '<script>alert(1)</script></svg>',
      'utf8',
    );

    await expect(procesarImagen(svg, PERMITIDOS)).rejects.toBeInstanceOf(ImagenInvalidaError);
  });

  it('rechaza un formato valido que el administrador no permitio', async () => {
    // La lista viene del Config Store: si se saca WebP, deja de entrar aunque
    // el procesador sepa leerlo.
    const webp = await imagen(300, 300, 'webp');

    await expect(procesarImagen(webp, ['image/jpeg'])).rejects.toBeInstanceOf(ImagenInvalidaError);
  });

  it('acepta JPEG, PNG y WebP', async () => {
    for (const formato of ['jpeg', 'png', 'webp'] as const) {
      const bytes = await imagen(400, 400, formato);
      await expect(procesarImagen(bytes, PERMITIDOS)).resolves.toBeDefined();
    }
  });
});

describe('privacidad de los metadatos', () => {
  it('⚠️ BORRA EL EXIF: no filtra donde vive quien vende', async () => {
    // Es el test mas importante del archivo. Una foto sacada con el celular en
    // la casa del vendedor lleva SUS COORDENADAS GPS. Publicarla tal cual
    // filtra su domicilio a cualquiera que descargue la imagen.
    const conExif = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#ffffff' },
    })
      // Los tipos de sharp no declaran el bloque GPS, pero el EXIF que importa
      // es el mismo objeto: si `exif` sobrevive, las coordenadas tambien.
      .withExif({
        IFD0: { Copyright: 'Offside', Artist: 'Vendedor Real' },
      })
      .jpeg()
      .toBuffer();

    // El original SI tiene los metadatos: si no, el test no probaria nada.
    expect((await sharp(conExif).metadata()).exif).toBeDefined();

    const procesada = await procesarImagen(conExif, PERMITIDOS);

    for (const variante of procesada.variantes) {
      const meta = await sharp(variante.buffer).metadata();
      expect(meta.exif).toBeUndefined();
    }
  });
});

describe('normalizacion', () => {
  it('la salida SIEMPRE es WebP, entre lo que entre', async () => {
    // No se guardan nunca los bytes originales: lo que va al bucket es lo que
    // produjo el codificador.
    const png = await imagen(500, 500, 'png');
    const procesada = await procesarImagen(png, PERMITIDOS);

    for (const variante of procesada.variantes) {
      expect((await sharp(variante.buffer).metadata()).format).toBe('webp');
    }
  });

  it('genera las tres variantes y ninguna supera su ancho', async () => {
    const procesada = await procesarImagen(await imagen(3000, 2000), PERMITIDOS);

    expect(procesada.variantes.map((v) => v.nombre).sort()).toEqual(['large', 'medium', 'thumb']);

    for (const variante of procesada.variantes) {
      expect(variante.width).toBeLessThanOrEqual(VARIANTES[variante.nombre]);
    }
  });

  it('NO agranda una imagen mas chica que la variante', async () => {
    // Estirarla sumaria peso sin sumar detalle.
    const chica = await imagen(200, 150);
    const procesada = await procesarImagen(chica, PERMITIDOS);

    for (const variante of procesada.variantes) {
      expect(variante.width).toBe(200);
    }
  });

  it('el hash es del ORIGINAL y es estable', async () => {
    // Identifica la foto que subio la persona, no su codificacion. Dos subidas
    // del mismo archivo caen en la misma clave de storage.
    const bytes = await imagen(600, 400);

    const a = await procesarImagen(bytes, PERMITIDOS);
    const b = await procesarImagen(bytes, PERMITIDOS);

    expect(a.hash).toBe(b.hash);
    expect(a.hash).toHaveLength(64);
  });

  it('imagenes distintas dan hashes distintos', async () => {
    const a = await procesarImagen(await imagen(600, 400), PERMITIDOS);
    const b = await procesarImagen(await imagen(601, 400), PERMITIDOS);

    expect(a.hash).not.toBe(b.hash);
  });
});
