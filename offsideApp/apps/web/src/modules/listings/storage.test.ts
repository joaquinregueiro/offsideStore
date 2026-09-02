import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALLOWED_IMAGE_TYPES_KEY,
  FORMATOS_SOPORTADOS,
  MAX_IMAGES_KEY,
} from '../config/services/image-settings.service';

/**
 * Tests de la eleccion del adaptador de storage y de los topes de la
 * configuracion de imagenes.
 *
 * No tocan S3 ni la base: se manipula el entorno y se comprueba QUE adaptador
 * sale y QUE valores se rechazan.
 */

const ORIGINAL = { ...process.env };

/** Las cinco variables que hacen que el storage se considere configurado. */
const S3 = {
  S3_ENDPOINT: 'https://cuenta.r2.cloudflarestorage.com',
  S3_BUCKET: 'offside-imagenes',
  S3_ACCESS_KEY: 'no-es-una-credencial',
  S3_SECRET_KEY: 'no-es-una-credencial',
  S3_PUBLIC_URL: 'https://img.offside.com.ar',
};

function limpiarS3(): void {
  for (const clave of Object.keys(S3)) delete process.env[clave];
}

async function cargarSelector(): Promise<typeof import('./infrastructure/storage/index')> {
  // `getEnv()` cachea, asi que hay que reimportar tras cambiar el entorno.
  const { resetEnvCache } = await import('@offside/config');
  resetEnvCache();

  return import('./infrastructure/storage/index');
}

beforeEach(() => {
  process.env.DATABASE_URL ??= 'postgresql://unit:unit@localhost:5432/unit';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.APP_URL ??= 'http://localhost:3000';
  limpiarS3();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('eleccion del adaptador de storage', () => {
  it('usa S3 cuando esta configurado', async () => {
    Object.assign(process.env, S3);
    process.env.APP_ENV = 'development';

    const { createStorage } = await cargarSelector();
    expect(createStorage().name).toBe('s3');
  });

  it('cae al disco local fuera de produccion cuando falta configuracion', async () => {
    process.env.APP_ENV = 'development';

    const { createStorage } = await cargarSelector();
    expect(createStorage().name).toBe('local');
  });

  it('⚠️ EN PRODUCCION SIN CONFIGURAR, SE ROMPE en vez de escribir en el disco', async () => {
    // Es el test que mas vale de este archivo. Caer al adaptador local en
    // produccion escribiria las fotos DENTRO del contenedor: desaparecerian en
    // el proximo deploy y dos instancias verian catalogos distintos, mientras
    // el sistema informa exito.
    process.env.APP_ENV = 'production';

    const { createStorage } = await cargarSelector();
    expect(() => createStorage()).toThrow(/Storage sin configurar en produccion/);
  });

  it('no le alcanza con las credenciales sin la URL publica', async () => {
    // Sin `S3_PUBLIC_URL` se puede escribir pero no se puede construir la URL
    // que va a `listing_images.url`: quedarian filas apuntando a ningun lado.
    Object.assign(process.env, S3);
    delete process.env.S3_PUBLIC_URL;
    process.env.APP_ENV = 'development';

    const { createStorage } = await cargarSelector();
    expect(createStorage().name).toBe('local');
  });
});

describe('formatos de imagen', () => {
  it('⚠️ SVG NO es un formato soportado', () => {
    // Un SVG es un documento que puede ejecutar JavaScript. Servido desde
    // nuestro dominio seria XSS almacenado. No alcanza con no ofrecerlo: no
    // tiene que estar en la lista que el sistema sabe procesar.
    expect(FORMATOS_SOPORTADOS as readonly string[]).not.toContain('image/svg+xml');
  });

  it('solo acepta los tres formatos rasterizados', () => {
    expect([...FORMATOS_SOPORTADOS].sort()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
});

describe('claves de configuracion', () => {
  it('los nombres son estables: los persiste `app_settings`', () => {
    // Cambiarlos sin migracion dejaria la configuracion vigente huerfana.
    expect(MAX_IMAGES_KEY).toBe('listing_max_images');
    expect(ALLOWED_IMAGE_TYPES_KEY).toBe('listing_allowed_image_types');
  });
});
