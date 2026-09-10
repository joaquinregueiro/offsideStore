import { QUEUE_NAMES, defaultJobOptions, getQueue } from '@offside/jobs';

import { createEmailSender, type EmailMessage } from '../infrastructure/email/index';
import * as templates from '../templates/auth.templates';
import { isSuppressed } from './email-suppression.service';

/**
 * Envio de emails.
 *
 * POR QUE POR COLA Y NO EN LINEA: `notifications-and-engagement.md` §2.2 lo
 * decide ("el envio se procesa por BullMQ"), y ademas es lo correcto. Un
 * registro no puede fallar porque Amazon SES este caido, ni tardar lo que tarde
 * un tercero en responder. La cola reintenta con backoff exponencial
 * (`defaultJobOptions`: 5 intentos).
 *
 * ⚠️ EL JOB LLEVA EL TOKEN EN SU PAYLOAD, que vive en Redis hasta procesarse.
 * Es la misma exposicion que ya tiene el `code_verifier` de OAuth. Se acota
 * igual: `removeOnComplete` lo borra al terminar, y los tokens vencen solos.
 * NO se loguea el payload en ningun punto.
 */

/** Tipos de email que sabe mandar. Se amplia cuando exista cada disparador. */
export type EmailJobKind = 'email_verification' | 'password_reset';

export interface EmailJobData {
  kind: EmailJobKind;
  to: string;
  token: string;
  hoursValid: number;
}

function build(data: EmailJobData): EmailMessage {
  switch (data.kind) {
    case 'email_verification':
      return templates.verificacionDeEmail(data.to, data.token, data.hoursValid);
    case 'password_reset':
      return templates.resetDePassword(data.to, data.token, data.hoursValid);
  }
}

/**
 * Procesa un job de la cola. Lo ejecuta el worker, no el request.
 *
 * IDEMPOTENCIA: reintentar reenvia el email. Es aceptable —un email duplicado
 * molesta, no rompe— y es preferible a perder el unico aviso que desbloquea el
 * alta. El token que lleva adentro sigue siendo de un solo uso.
 */
export async function processEmailJob(data: EmailJobData): Promise<void> {
  /**
   * ⚠️ LA SUPRESION SE CONSULTA ACA, en el ultimo punto antes del proveedor.
   *
   * Podria mirarse al encolar y ahorrarse el job, pero entonces habria DOS
   * lugares donde se decide si una direccion recibe o no, y alcanzaria con que
   * un disparador futuro se olvidara de uno para que la lista deje de valer.
   * Aca pasa TODO el email que sale del sistema.
   *
   * ⚠️ NO LANZA: se descarta el job y listo. Tirar un error haria que BullMQ
   * reintentara cinco veces algo que por definicion nunca va a poder mandarse.
   */
  if (await isSuppressed(data.to)) {
    console.warn(
      `[notifications] email "${data.kind}" NO enviado: ${data.to} esta suprimida ` +
        '(rebote duro o queja). La cuenta no va a recibir nada hasta que se libere.',
    );

    return;
  }

  const sender = createEmailSender();
  await sender.send(build(data));

  // Se registra QUE se mando y a que tipo corresponde. Nunca el token ni el
  // cuerpo. El destinatario se deja porque sin el no se puede diagnosticar.
  console.warn(`[notifications] email "${data.kind}" enviado a ${data.to} via ${sender.name}`);
}

/**
 * Encola un email. NO espera a que se envie.
 *
 * ⚠️ NO LANZA. Si Redis no responde, el error se registra y el flujo que llamo
 * sigue adelante. El criterio: que la cola falle no puede abortar un registro
 * que ya escribio el usuario en la base. La consecuencia —un alta sin email—
 * se resuelve reenviando, no revirtiendo.
 */
export async function enqueueEmail(data: EmailJobData): Promise<boolean> {
  try {
    await getQueue<EmailJobData>(QUEUE_NAMES.NOTIFICATIONS_SEND).add(data.kind, data, {
      ...defaultJobOptions,
    });

    return true;
  } catch (error) {
    console.error(
      `[notifications] no se pudo encolar el email "${data.kind}":`,
      error instanceof Error ? error.message : String(error),
    );

    return false;
  }
}
