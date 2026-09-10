import type { EmailMessage, EmailSenderPort } from './email-sender.port';

/**
 * Adaptador que escribe el email en el log del servidor en vez de enviarlo.
 *
 * PARA QUE EXISTE: sin dominio verificado en SES no se puede mandar email a
 * direcciones ajenas, y en desarrollo local no hay credenciales de AWS. Este
 * adaptador deja que el flujo completo —registro, encolado, worker, plantilla—
 * funcione y sea verificable de punta a punta sin proveedor.
 *
 * ⚠️ IMPRIME EL CUERPO, TOKEN INCLUIDO. Es deliberado: en desarrollo el log ES
 * la casilla de correo. Por eso `createEmailSender()` NUNCA lo elige cuando
 * `APP_ENV=production`: ahi, si falta configuracion, se falla en vez de
 * escribir tokens de un solo uso en el log de produccion.
 */
export function createLogEmailSender(): EmailSenderPort {
  return {
    name: 'log',

    send(message: EmailMessage): Promise<void> {
      console.warn(
        [
          '',
          '=============================== EMAIL (no enviado) ===============================',
          `Para:    ${message.to}`,
          `Asunto:  ${message.subject}`,
          '---------------------------------------------------------------------------------',
          message.text,
          '=================================================================================',
          '',
        ].join('\n'),
      );

      return Promise.resolve();
    },
  };
}
