import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';

import { z } from 'zod';

/**
 * Validacion de la firma de los mensajes de Amazon SNS.
 *
 * =============================================================================
 * ⚠️ POR QUE ESTO NO PUEDE SER UN ENDPOINT INGENUO
 * =============================================================================
 *
 * SNS entrega por HTTP POST a una URL publica. Sin verificar la firma,
 * **cualquiera que descubra la URL puede postear un rebote falso** con la
 * direccion de otra persona y dejar esa cuenta sin poder recibir email nunca
 * mas: no hace falta robar nada, solo saber un email ajeno. Es un DoS dirigido
 * contra usuarios arbitrarios, y el unico control que lo frena es este archivo.
 *
 * Por eso el endpoint rechaza ANTES de mirar el contenido, y por eso hay dos
 * puertas independientes: la firma criptografica y el `TopicArn` esperado.
 *
 * =============================================================================
 * MECANISMO (documentado por AWS, no inferido)
 * =============================================================================
 *
 * `docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html` y la
 * implementacion de referencia `aws/aws-js-sns-message-validator`:
 *
 *  - se arma un texto canonico concatenando `clave\nvalor\n` por cada campo
 *    firmable PRESENTE, en orden alfabetico;
 *  - se verifica con RSA contra el certificado de `SigningCertURL`;
 *  - `SignatureVersion` 1 = SHA1, 2 = SHA256.
 *
 * ⚠️ SE ACEPTAN LAS DOS VERSIONES. SHA1 esta roto para colisiones, pero SNS
 * todavia firma con la version 1 salvo que se pida explicitamente la 2 en el
 * topic, y rechazarla dejaria de procesar rebotes sin avisar. La mitigacion es
 * de configuracion, no de codigo: conviene habilitar SignatureVersion 2 en el
 * topic. Queda anotado en `notifications-email-module.md`.
 */

/** Campos firmables por tipo de mensaje, en orden alfabetico (byte-sort). */
const CAMPOS_FIRMABLES = {
  SubscriptionConfirmation: [
    'Message',
    'MessageId',
    'Subject',
    'SubscribeURL',
    'Timestamp',
    'Token',
    'TopicArn',
    'Type',
  ],
  UnsubscribeConfirmation: [
    'Message',
    'MessageId',
    'Subject',
    'SubscribeURL',
    'Timestamp',
    'Token',
    'TopicArn',
    'Type',
  ],
  Notification: [
    'Message',
    'MessageId',
    'Subject',
    'SubscribeURL',
    'Timestamp',
    'TopicArn',
    'Type',
  ],
} as const;

export const snsMessageSchema = z.object({
  Type: z.enum(['SubscriptionConfirmation', 'UnsubscribeConfirmation', 'Notification']),
  MessageId: z.string().min(1),
  TopicArn: z.string().min(1),
  Message: z.string(),
  Timestamp: z.string().min(1),
  SignatureVersion: z.string().min(1),
  Signature: z.string().min(1),
  SigningCertURL: z.string().url(),
  Subject: z.string().optional(),
  SubscribeURL: z.string().url().optional(),
  Token: z.string().optional(),
});

export type SnsMessage = z.infer<typeof snsMessageSchema>;

/**
 * Arma el texto canonico que SNS firmo.
 *
 * ⚠️ SE INCLUYE SOLO LO PRESENTE, y el orden NO se ordena en runtime: sale de
 * la constante de arriba. Ordenar dinamicamente parece equivalente pero no lo
 * es —el orden es parte del contrato del proveedor— y un cambio de locale
 * podria alterarlo.
 */
export function textoFirmado(mensaje: SnsMessage): string {
  const campos = CAMPOS_FIRMABLES[mensaje.Type];
  const fuente = mensaje as unknown as Record<string, string | undefined>;

  let texto = '';

  for (const campo of campos) {
    const valor = fuente[campo];
    if (valor === undefined) continue;

    texto += `${campo}\n${valor}\n`;
  }

  return texto;
}

/**
 * Comprueba que el certificado venga de SNS.
 *
 * ⚠️ ESTO SE VALIDA ANTES DE HACER EL FETCH, y ese orden es el punto. La URL
 * viene DENTRO del mensaje que todavia no verificamos: descargarla sin mirar
 * seria darle a cualquiera un cliente HTTP que apunta a donde quiera desde
 * nuestro servidor —SSRF—, y ademas permitiria firmar con un certificado
 * propio y pasar la verificacion.
 *
 * Las tres condiciones son las de `aws-js-sns-message-validator`: HTTPS, el
 * path termina en `.pem`, y el host es un `sns.<region>.amazonaws.com`.
 */
export function certificadoEsDeSns(url: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return (
    parsed.protocol === 'https:' &&
    parsed.pathname.endsWith('.pem') &&
    /^sns\.[a-zA-Z0-9-]{3,}\.amazonaws\.com(\.cn)?$/.test(parsed.hostname)
  );
}

/**
 * Cache de claves publicas por URL de certificado.
 *
 * SNS rota el certificado cada tanto y usa un puñado de URLs. Sin cache, cada
 * notificacion dispararia una descarga: latencia y una dependencia externa en
 * el camino caliente. La cache no puede crecer sin control porque las claves
 * solo pueden ser URLs que ya pasaron `certificadoEsDeSns`.
 */
const clavesPorUrl = new Map<string, KeyObject>();

async function clavePublica(url: string): Promise<KeyObject | null> {
  const cacheada = clavesPorUrl.get(url);
  if (cacheada !== undefined) return cacheada;

  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) return null;

    const pem = await respuesta.text();
    const clave = createPublicKey(pem);

    clavesPorUrl.set(url, clave);

    return clave;
  } catch (error) {
    console.error(
      '[sns] no se pudo obtener el certificado de firma:',
      error instanceof Error ? error.message : String(error),
    );

    return null;
  }
}

/** Solo para tests: vacia la cache de certificados. */
export function _limpiarCacheDeCertificados(): void {
  clavesPorUrl.clear();
}

/**
 * Verifica la firma de un mensaje de SNS.
 *
 * FALLA CERRADO: cualquier duda —version desconocida, certificado que no es de
 * SNS, descarga fallida— devuelve `false`. Es lo contrario al rate limiter, y
 * la asimetria es correcta: alli fallar cerrado dejaba a todos afuera del
 * sitio; aca dejar pasar un mensaje sin verificar es exactamente el ataque.
 */
export async function firmaValida(mensaje: SnsMessage): Promise<boolean> {
  const algoritmo =
    mensaje.SignatureVersion === '1'
      ? 'RSA-SHA1'
      : mensaje.SignatureVersion === '2'
        ? 'RSA-SHA256'
        : null;

  if (algoritmo === null) return false;
  if (!certificadoEsDeSns(mensaje.SigningCertURL)) return false;

  const clave = await clavePublica(mensaje.SigningCertURL);
  if (clave === null) return false;

  try {
    const verificador = createVerify(algoritmo);
    verificador.update(textoFirmado(mensaje), 'utf8');

    return verificador.verify(clave, mensaje.Signature, 'base64');
  } catch (error) {
    console.error(
      '[sns] la verificacion de la firma fallo:',
      error instanceof Error ? error.message : String(error),
    );

    return false;
  }
}
