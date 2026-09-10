import { createSign, generateKeyPairSync } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _limpiarCacheDeCertificados,
  certificadoEsDeSns,
  firmaValida,
  textoFirmado,
  type SnsMessage,
} from './sns-signature';

/**
 * Tests de la firma de SNS.
 *
 * ⚠️ ES EL UNICO CONTROL que impide que cualquiera suprima la direccion de otra
 * persona posteando un rebote falso. Se testea con un par de claves REAL
 * generado en el test: firmar de verdad y verificar de verdad es lo unico que
 * demuestra que la plantilla del texto firmado es la correcta.
 */

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const CERT_URL = 'https://sns.sa-east-1.amazonaws.com/SimpleNotificationService-abc123.pem';

function mensajeBase(): Omit<SnsMessage, 'Signature'> {
  return {
    Type: 'Notification',
    MessageId: '22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324',
    TopicArn: 'arn:aws:sns:sa-east-1:123456789012:offside-ses-feedback',
    Message: '{"notificationType":"Bounce"}',
    Timestamp: '2026-09-08T12:00:00.000Z',
    SignatureVersion: '2',
    SigningCertURL: CERT_URL,
  };
}

/** Firma un mensaje como lo haria SNS. */
function firmar(mensaje: Omit<SnsMessage, 'Signature'>, algoritmo = 'RSA-SHA256'): SnsMessage {
  const firmador = createSign(algoritmo);
  firmador.update(textoFirmado({ ...mensaje, Signature: '' }), 'utf8');

  return { ...mensaje, Signature: firmador.sign(privateKey, 'base64') };
}

describe('textoFirmado', () => {
  it('arma `clave\\nvalor\\n` en el orden del proveedor', () => {
    const texto = textoFirmado({ ...mensajeBase(), Signature: '' });

    expect(texto).toBe(
      'Message\n{"notificationType":"Bounce"}\n' +
        'MessageId\n22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324\n' +
        'Timestamp\n2026-09-08T12:00:00.000Z\n' +
        'TopicArn\narn:aws:sns:sa-east-1:123456789012:offside-ses-feedback\n' +
        'Type\nNotification\n',
    );
  });

  it('omite los campos ausentes en vez de firmarlos vacios', () => {
    // `Subject` es opcional. Incluirlo como cadena vacia cambiaria el texto y
    // ninguna firma real validaria nunca.
    expect(textoFirmado({ ...mensajeBase(), Signature: '' })).not.toContain('Subject');
  });

  it('incluye Token y SubscribeURL en una confirmacion de suscripcion', () => {
    const texto = textoFirmado({
      ...mensajeBase(),
      Type: 'SubscriptionConfirmation',
      Token: 'token-largo',
      SubscribeURL: 'https://sns.sa-east-1.amazonaws.com/?Action=ConfirmSubscription',
      Signature: '',
    });

    expect(texto).toContain('Token\ntoken-largo\n');
    expect(texto).toContain('SubscribeURL\n');
  });
});

describe('certificadoEsDeSns', () => {
  it('acepta un certificado de SNS', () => {
    expect(certificadoEsDeSns(CERT_URL)).toBe(true);
  });

  it.each([
    ['http://sns.sa-east-1.amazonaws.com/cert.pem', 'no es HTTPS'],
    ['https://sns.sa-east-1.amazonaws.com/cert.txt', 'no termina en .pem'],
    ['https://atacante.com/cert.pem', 'no es un host de AWS'],
    ['https://sns.sa-east-1.amazonaws.com.atacante.com/cert.pem', 'sufijo enganoso'],
    ['https://evil-sns.sa-east-1.amazonaws.com/cert.pem', 'prefijo enganoso'],
    ['no-es-una-url', 'no parsea'],
  ])('rechaza %s (%s)', (url) => {
    // ⚠️ ES LO QUE EVITA DOS COSAS A LA VEZ: que se descargue un certificado
    // desde un servidor del atacante —y entonces cualquiera podria firmar sus
    // propios mensajes— y que el endpoint se convierta en un cliente HTTP que
    // apunta a donde quiera (SSRF).
    expect(certificadoEsDeSns(url)).toBe(false);
  });
});

describe('firmaValida', () => {
  beforeEach(() => {
    _limpiarCacheDeCertificados();

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(PEM, { status: 200 }))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('acepta un mensaje firmado de verdad', async () => {
    expect(await firmaValida(firmar(mensajeBase()))).toBe(true);
  });

  it('acepta SignatureVersion 1 (SHA1)', async () => {
    // SNS sigue firmando con la version 1 salvo que se pida la 2 en el topic.
    // Rechazarla dejaria de procesar rebotes sin que nadie se entere.
    const mensaje = { ...mensajeBase(), SignatureVersion: '1' };

    expect(await firmaValida(firmar(mensaje, 'RSA-SHA1'))).toBe(true);
  });

  it('⚠️ rechaza si cambia UN campo despues de firmar', async () => {
    // Es el ataque concreto: tomar un mensaje legitimo y cambiarle la direccion
    // que rebota. La firma cubre `Message`, asi que no se puede.
    const firmado = firmar(mensajeBase());
    const alterado = { ...firmado, Message: '{"notificationType":"Bounce","otra":"cosa"}' };

    expect(await firmaValida(alterado)).toBe(false);
  });

  it('rechaza una firma inventada', async () => {
    expect(await firmaValida({ ...mensajeBase(), Signature: 'Zm9v' })).toBe(false);
  });

  it('rechaza una SignatureVersion desconocida', async () => {
    const mensaje = { ...mensajeBase(), SignatureVersion: '99' };

    expect(await firmaValida(firmar(mensaje))).toBe(false);
  });

  it('⚠️ NO descarga el certificado si la URL no es de SNS', async () => {
    const espia = vi.mocked(fetch);
    const mensaje = firmar({ ...mensajeBase(), SigningCertURL: 'https://atacante.com/c.pem' });

    expect(await firmaValida(mensaje)).toBe(false);
    // La validacion del host va ANTES del fetch, no despues: si fuera al reves
    // el endpoint ya habria hecho la peticion saliente.
    expect(espia).not.toHaveBeenCalled();
  });

  it('cachea el certificado en vez de bajarlo en cada mensaje', async () => {
    const espia = vi.mocked(fetch);

    await firmaValida(firmar(mensajeBase()));
    await firmaValida(firmar(mensajeBase()));

    expect(espia).toHaveBeenCalledTimes(1);
  });

  it('falla CERRADO si no se puede bajar el certificado', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );

    // Lo contrario al rate limiter, y es correcto en los dos casos: alli fallar
    // cerrado dejaba a todos afuera del sitio; aca dejar pasar un mensaje sin
    // verificar ES el ataque.
    expect(await firmaValida(firmar(mensajeBase()))).toBe(false);
  });
});
