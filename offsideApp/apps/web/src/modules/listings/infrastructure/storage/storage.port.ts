/**
 * Puerto de almacenamiento de archivos.
 *
 * El dominio conoce ESTA interfaz y nada mas. Cloudflare R2 vive detras de ella
 * (CLAUDE.md §11): cambiar de proveedor es escribir otro adaptador, no tocar
 * `listings`.
 *
 * ⚠️ EL PROVEEDOR CONCRETO SIGUE ABIERTO EN `docs/`. OQ-I3 ("Storage/CDN de
 * imagenes") no esta cerrada; lo que SI esta decidido es la capa: "S3
 * compatible" (DEC-012) y "imagenes en S3, no en PostgreSQL" (tech-stack §3.6).
 * R2 es una decision de implementacion del owner del 2026-09-02, igual que SES.
 * Por eso el puerto existe desde el primer dia.
 *
 * ⚠️ NO SABE QUE ES UNA PUBLICACION. Recibe bytes y una clave; no conoce
 * listings, vendedores ni posiciones. Esa es la frontera que permite reusarlo
 * el dia que haya que guardar otra cosa.
 */

/** Tipos de imagen aceptados. Deriva de la configuracion, no se hardcodea. */
export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface StoredObject {
  /** Ruta dentro del bucket. Es lo que se persiste en `listing_images`. */
  key: string;
  /** URL publica de lectura. */
  url: string;
  sizeBytes: number;
}

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: ImageMimeType;
}

/** Categorias de fallo. Gruesas a proposito, como en el puerto de email. */
export type StorageFailure = 'rejected' | 'unreachable' | 'not_configured';

export class StorageError extends Error {
  readonly failure: StorageFailure;

  constructor(failure: StorageFailure, message: string) {
    super(message);
    this.name = 'StorageError';
    this.failure = failure;
  }
}

export interface StoragePort {
  /** Nombre del adaptador, para poder leerlo en los logs. */
  readonly name: string;
  /**
   * Direccion publica de una clave.
   *
   * ⚠️ SE COMPONE AL LEER, NO SE GUARDA. La base guarda la CLAVE del objeto;
   * el dominio desde el que se sirve es configuracion y puede cambiar —una URL
   * de prueba hoy, un dominio propio manana—. Si la URL completa quedara
   * persistida, cambiar el dominio dejaria a todas las fotos ya subidas
   * apuntando al lugar viejo y habria que migrar filas.
   *
   * Es una funcion pura sobre la configuracion: no consulta al proveedor.
   */
  publicUrl(key: string): string;
  put(input: PutObjectInput): Promise<StoredObject>;
  /**
   * Borra un objeto. Idempotente: borrar algo que no existe no es un error.
   *
   * ⚠️ El borrado NO puede ser la unica garantia de limpieza. Si la fila de
   * `listing_images` se borra y esto falla, queda un huerfano en el bucket que
   * nadie referencia. Es basura que cuesta plata, no un problema de
   * correctitud, y se resuelve con un barrido, no con una transaccion
   * distribuida.
   */
  delete(key: string): Promise<void>;
}
