import { getEnv } from '@offside/config';

import type { EmailSenderPort } from './email-sender.port';
import { createLogEmailSender } from './log-email.sender';
import { createSesEmailSender } from './ses-email.sender';

/**
 * Elige el adaptador de email segun la configuracion presente.
 *
 * REGLA, y es de seguridad, no de comodidad:
 *
 *   - Con las tres variables de SES cargadas -> SES, en cualquier entorno.
 *   - Sin ellas y FUERA de produccion        -> log (el log es la casilla).
 *   - Sin ellas y EN produccion              -> se rompe a proposito.
 *
 * El ultimo caso es el importante. Caer al adaptador de log en produccion
 * escribiria tokens de verificacion y de reset —que valen tanto como una
 * contrasena— en el log del servidor, y ademas el usuario nunca recibiria nada
 * mientras el sistema informa exito. Preferible que el envio falle ruidosamente
 * y el job se reintente.
 */
export function createEmailSender(): EmailSenderPort {
  const env = getEnv();

  const configurado =
    env.AWS_REGION !== undefined &&
    env.AWS_ACCESS_KEY_ID !== undefined &&
    env.AWS_SECRET_ACCESS_KEY !== undefined &&
    env.EMAIL_FROM_ADDRESS !== undefined;

  if (configurado) return createSesEmailSender();

  if (env.APP_ENV === 'production') {
    throw new Error(
      'Email sin configurar en produccion: faltan AWS_REGION, AWS_ACCESS_KEY_ID, ' +
        'AWS_SECRET_ACCESS_KEY o EMAIL_FROM_ADDRESS. No se cae al adaptador de log ' +
        'porque escribiria tokens en el log del servidor.',
    );
  }

  return createLogEmailSender();
}

export type { EmailMessage, EmailSenderPort } from './email-sender.port';
export { EmailSendError } from './email-sender.port';
