import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getEnv, requireEnv } from '@offside/config';

import {
  StorageError,
  type PutObjectInput,
  type StoragePort,
  type StoredObject,
} from './storage.port';

/**
 * Adaptador de storage S3-compatible. Hoy apunta a **Cloudflare R2**.
 *
 * UNICO lugar del sistema que conoce S3. No sabe que es una publicacion ni un
 * vendedor: recibe bytes y una clave.
 *
 * ⚠️ `forcePathStyle: true`. R2 no soporta el estilo `bucket.host/...` que usa
 * S3 por defecto; espera `host/bucket/...`. Sin esto, cada subida falla con un
 * error de DNS que no dice nada sobre la causa real.
 *
 * ⚠️ NO SE FIRMA LA LECTURA. Las fotos de una publicacion son publicas por
 * definicion —estan en la vitrina—, asi que se sirven desde `S3_PUBLIC_URL` sin
 * credenciales. Firmar cada lectura obligaria a que el servidor intervenga en
 * cada imagen de cada visita, que es exactamente lo que un CDN viene a evitar.
 */

let client: S3Client | null = null;

/**
 * Valida que el endpoint sea una URL absoluta ANTES de darselo al SDK.
 *
 * ⚠️ SIN ESTO EL FALLO ES OPACO. `S3_ENDPOINT` se valida como string en el
 * schema de entorno, no como URL, asi que un valor sin `https://` —o con un
 * espacio de mas— pasa la validacion y revienta recien adentro del SDK como un
 * `TypeError` generico, sin decir cual es el problema.
 *
 * No se valida con `.url()` en el schema global a proposito: eso haria que la
 * APLICACION ENTERA no arranque por una variable que solo usa la subida de
 * fotos. El borde del adaptador es el lugar correcto.
 */
function endpointValido(valor: string): string {
  let url;

  try {
    url = new URL(valor);
  } catch {
    throw new StorageError(
      'not_configured',
      `S3_ENDPOINT no es una URL valida ("${valor}"). Tiene que incluir el esquema, ` +
        'por ejemplo https://<account-id>.r2.cloudflarestorage.com',
    );
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new StorageError(
      'not_configured',
      `S3_ENDPOINT tiene un esquema invalido: ${url.protocol}`,
    );
  }

  // ⚠️ EL BUCKET NO VA EN EL ENDPOINT. Con `forcePathStyle`, el SDK arma
  // `<endpoint>/<bucket>/<key>`: si el endpoint ya trae el bucket, la ruta
  // queda `/<bucket>/<bucket>/<key>` y R2 responde "Bucket does not exist".
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new StorageError(
      'not_configured',
      `S3_ENDPOINT no debe llevar ruta (tiene "${url.pathname}"). El bucket va en S3_BUCKET.`,
    );
  }

  return valor;
}

/** Se construye una sola vez: el cliente mantiene su pool de conexiones. */
function getClient(): S3Client {
  if (client !== null) return client;

  const env = getEnv();

  client = new S3Client({
    endpoint: endpointValido(requireEnv(env, 'S3_ENDPOINT')),
    // R2 ignora la region pero el SDK exige una.
    region: env.S3_REGION ?? 'auto',
    credentials: {
      accessKeyId: requireEnv(env, 'S3_ACCESS_KEY'),
      secretAccessKey: requireEnv(env, 'S3_SECRET_KEY'),
    },
    forcePathStyle: true,
  });

  return client;
}

/** Para tests: fuerza reconstruir el cliente tras cambiar el entorno. */
export function resetS3Client(): void {
  client = null;
}

/** URL publica de una clave. Sin barra doble aunque la base la traiga. */
export function publicUrlFor(key: string): string {
  const base = requireEnv(getEnv(), 'S3_PUBLIC_URL').replace(/\/$/, '');

  return `${base}/${key}`;
}

function nombreDe(error: unknown): string {
  return error instanceof Error ? error.name : 'desconocido';
}

/**
 * Registra un fallo del storage con el detalle suficiente para diagnosticarlo.
 *
 * ⚠️ ESTO SE LOGUEA, NO SE PROPAGA. Al cliente se le devuelve solo la
 * categoria del fallo; el detalle queda en el log del servidor.
 *
 * ⚠️ SE LOGUEA `cause`, Y ES LO QUE MAS IMPORTA. Un `TypeError: fetch failed`
 * del SDK no dice nada por si solo: la causa real —ENOTFOUND, ECONNREFUSED, un
 * certificado invalido— vive en `error.cause`. Sin esto el diagnostico es
 * imposible, que es exactamente lo que paso la primera vez que se conecto R2.
 *
 * ⚠️ NO SE LOGUEA el cuerpo del archivo ni las credenciales. El mensaje del
 * SDK describe la PETICION, no el contenido.
 */
function registrarFallo(operacion: string, key: string, error: unknown): void {
  const detalle = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const causa =
    error instanceof Error && error.cause instanceof Error
      ? ` | causa: ${error.cause.name}: ${error.cause.message}`
      : '';

  // ⚠️ SE LOGUEA CONTRA QUE HOST SE INTENTO. Un fallo de red o de TLS no dice
  // nada sin saber a donde se estaba conectando: un handshake rechazado puede
  // ser el endpoint equivocado, un dominio publico puesto donde va el privado,
  // o el VPS sin salida. El host distingue los tres. NO es un secreto —sale
  // del id de cuenta— y las credenciales no se tocan.
  const destino = hostDelEndpoint();

  console.error(
    `[storage] fallo la ${operacion} de "${key}" contra ${destino}: ${detalle}${causa}`,
  );
}

/** Host configurado, o el motivo por el que no se pudo leer. */
function hostDelEndpoint(): string {
  const valor = getEnv().S3_ENDPOINT;
  if (valor === undefined) return 'S3_ENDPOINT sin configurar';

  try {
    return new URL(valor).host;
  } catch {
    return `endpoint invalido (${valor})`;
  }
}

export function createS3Storage(): StoragePort {
  return {
    name: 's3',

    publicUrl: publicUrlFor,

    async put(input: PutObjectInput): Promise<StoredObject> {
      const env = getEnv();

      try {
        await getClient().send(
          new PutObjectCommand({
            Bucket: requireEnv(env, 'S3_BUCKET'),
            Key: input.key,
            Body: input.body,
            ContentType: input.contentType,
            /**
             * ⚠️ SEGURIDAD, NO OPTIMIZACION. `Content-Disposition: inline` con
             * un `Content-Type` de imagen fijado por NOSOTROS —nunca el que
             * declaro el cliente— impide que el navegador interprete el archivo
             * como otra cosa. Combinado con no aceptar SVG, cierra el vector de
             * XSS almacenado.
             */
            ContentDisposition: 'inline',
            // Las fotos no cambian: la clave lleva un hash, asi que una URL
            // siempre devuelve el mismo contenido y se puede cachear para
            // siempre.
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
      } catch (error) {
        registrarFallo('subida', input.key, error);

        // ⚠️ UN ERROR DE CONFIGURACION SE PROPAGA TAL CUAL. Envolverlo diria
        // "el storage rechazo la subida" cuando en realidad la peticion nunca
        // salio: son dos problemas distintos y el mensaje tiene que
        // distinguirlos, porque se arreglan en lugares distintos.
        if (error instanceof StorageError) throw error;

        throw new StorageError('rejected', `El storage rechazo la subida (${nombreDe(error)})`);
      }

      return {
        key: input.key,
        url: publicUrlFor(input.key),
        sizeBytes: input.body.byteLength,
      };
    },

    async delete(key: string): Promise<void> {
      try {
        await getClient().send(
          new DeleteObjectCommand({ Bucket: requireEnv(getEnv(), 'S3_BUCKET'), Key: key }),
        );
      } catch (error) {
        registrarFallo('borrado', key, error);

        if (error instanceof StorageError) throw error;

        throw new StorageError('rejected', `El storage rechazo el borrado (${nombreDe(error)})`);
      }
    },
  };
}
