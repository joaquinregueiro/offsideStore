import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { getEnv, requireEnv } from '@offside/config';

import { EmailSendError, type EmailMessage, type EmailSenderPort } from './email-sender.port';

/**
 * Adaptador de Amazon SES (API v2).
 *
 * UNICO lugar del sistema que conoce SES. No sabe que es un usuario, un token
 * ni una verificacion: recibe un mensaje ya armado y lo manda.
 *
 * ⚠️ SES EXIGE UN DOMINIO (o al menos una direccion) VERIFICADO. Mientras la
 * cuenta este en el sandbox de SES, ademas, solo se puede enviar a direcciones
 * verificadas: no alcanza con verificar el remitente. Salir del sandbox es un
 * tramite ante AWS. Hasta entonces, el alta de un usuario real no se puede
 * completar por email.
 *
 * ⚠️ NO LOGUEA el cuerpo del mensaje: los emails de verificacion y de reset
 * llevan tokens de un solo uso que valen tanto como una contrasena.
 */

let client: SESv2Client | null = null;

/** Se construye una sola vez: el cliente mantiene su pool de conexiones. */
function getClient(): SESv2Client {
  if (client !== null) return client;

  const env = getEnv();

  client = new SESv2Client({
    region: requireEnv(env, 'AWS_REGION'),
    credentials: {
      accessKeyId: requireEnv(env, 'AWS_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv(env, 'AWS_SECRET_ACCESS_KEY'),
    },
  });

  return client;
}

/** Para tests: fuerza reconstruir el cliente tras cambiar el entorno. */
export function resetSesClient(): void {
  client = null;
}

/** `Nombre <casilla@dominio>` si hay nombre; si no, la casilla sola. */
function fromAddress(): string {
  const env = getEnv();
  const address = requireEnv(env, 'EMAIL_FROM_ADDRESS');
  const name = env.EMAIL_FROM_NAME;

  return name === undefined || name === '' ? address : `${name} <${address}>`;
}

export function createSesEmailSender(): EmailSenderPort {
  return {
    name: 'ses',

    async send(message: EmailMessage): Promise<void> {
      const command = new SendEmailCommand({
        FromEmailAddress: fromAddress(),
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: message.text, Charset: 'UTF-8' },
              ...(message.html === undefined
                ? {}
                : { Html: { Data: message.html, Charset: 'UTF-8' } }),
            },
          },
        },
      });

      try {
        await getClient().send(command);
      } catch (error) {
        // Se propaga la CATEGORIA del fallo, nunca el cuerpo del mensaje.
        // El nombre del error de AWS alcanza para diagnosticar y no arrastra
        // el contenido del email.
        const nombre = error instanceof Error ? error.name : 'desconocido';

        throw new EmailSendError('rejected', `SES rechazo el envio (${nombre})`);
      }
    },
  };
}
