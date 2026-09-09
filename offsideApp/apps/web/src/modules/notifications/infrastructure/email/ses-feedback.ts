import { z } from 'zod';

/**
 * Lectura de las notificaciones de rebote y queja de Amazon SES.
 *
 * VIVE EN `infrastructure/` PORQUE ES ESPECIFICA DEL PROVEEDOR (CLAUDE.md §11).
 * El dominio no sabe que existe `bounceSubType`: recibe "esta direccion no
 * recibe mas, por este motivo". Cambiar de proveedor es escribir otro lector.
 *
 * ⚠️ EL CONTRATO NO SE INVENTO. Sale de
 * `docs.aws.amazon.com/ses/latest/dg/notification-contents.html`, verificado el
 * 2026-09-08. Lo que se lee de ahi y determina el comportamiento:
 *
 *  - el campo de tipo se llama `notificationType`, salvo con *event
 *    publishing*, donde se llama `eventType`. Se aceptan los dos.
 *  - una notificacion puede referirse a VARIOS destinatarios, y AWS dice
 *    explicitamente que el codigo tiene que soportar los dos casos.
 *  - `bounceType` es `Permanent` (duro), `Transient` (blando) o `Undetermined`.
 *  - AWS se reserva agregar campos, asi que el parseo tiene que tolerar lo
 *    desconocido. Por eso los schemas NO son estrictos.
 */

/** Una direccion que deja de recibir email, ya interpretada. */
export interface SupresionDetectada {
  email: string;
  reason: 'BOUNCE' | 'COMPLAINT';
  /** Subtipo crudo del proveedor, para poder diagnosticar despues. */
  subtype: string | null;
  messageId: string | null;
}

const destinatarioSchema = z.object({ emailAddress: z.string().min(1) });

const feedbackSchema = z.object({
  notificationType: z.string().optional(),
  eventType: z.string().optional(),
  mail: z.object({ messageId: z.string().optional() }).optional(),
  bounce: z
    .object({
      bounceType: z.string().optional(),
      bounceSubType: z.string().optional(),
      bouncedRecipients: z.array(destinatarioSchema).optional(),
    })
    .optional(),
  complaint: z
    .object({
      complaintFeedbackType: z.string().optional(),
      complaintSubType: z.string().nullish(),
      complainedRecipients: z.array(destinatarioSchema).optional(),
    })
    .optional(),
});

/**
 * Interpreta el cuerpo de una notificacion de SES.
 *
 * Devuelve la lista de direcciones a suprimir. Vacia si la notificacion no
 * corresponde a una supresion —una entrega exitosa, un rebote blando— y `null`
 * si el cuerpo no tiene la forma esperada.
 */
export function leerFeedback(cuerpo: unknown): SupresionDetectada[] | null {
  const parseado = feedbackSchema.safeParse(cuerpo);
  if (!parseado.success) return null;

  const notificacion = parseado.data;
  const tipo = notificacion.notificationType ?? notificacion.eventType;
  const messageId = notificacion.mail?.messageId ?? null;

  if (tipo === 'Bounce') return rebotes(notificacion, messageId);
  if (tipo === 'Complaint') return quejas(notificacion, messageId);

  // `Delivery`, `Send`, `Open`, … no suprimen nada. No es un error.
  return [];
}

/**
 * ⚠️ SOLO LOS REBOTES `Permanent` SUPRIMEN, y es la decision mas importante de
 * este archivo.
 *
 * Un `Transient` es la casilla llena o el servidor caido: AWS dice que se puede
 * volver a enviar cuando se resuelva, y SES ya reintenta solo. Suprimir por eso
 * dejaria a alguien sin su cuenta porque tuvo el buzon lleno un martes.
 *
 * Un `Undetermined` es "el proveedor rebotó y no se entiende por que". Adivinar
 * ahi es peor que no hacer nada: el costo de equivocarse es dejar afuera a una
 * persona real, y el de no actuar es un rebote mas.
 */
function rebotes(
  notificacion: z.infer<typeof feedbackSchema>,
  messageId: string | null,
): SupresionDetectada[] {
  const bounce = notificacion.bounce;
  if (bounce?.bounceType !== 'Permanent') return [];

  return (bounce.bouncedRecipients ?? []).map((destinatario) => ({
    email: destinatario.emailAddress,
    reason: 'BOUNCE' as const,
    subtype: bounce.bounceSubType ?? null,
    messageId,
  }));
}

/**
 * Quejas por spam.
 *
 * ⚠️ `not-spam` NO SUPRIME. Es el unico valor del registro de IANA que significa
 * lo contrario que los demas: quien reporta dice que el mensaje **no** era spam,
 * normalmente para corregir una clasificacion previa. Tratarlo como queja seria
 * dar de baja a alguien por haber sido defendido.
 */
function quejas(
  notificacion: z.infer<typeof feedbackSchema>,
  messageId: string | null,
): SupresionDetectada[] {
  const complaint = notificacion.complaint;
  if (complaint === undefined) return [];
  if (complaint.complaintFeedbackType === 'not-spam') return [];

  return (complaint.complainedRecipients ?? []).map((destinatario) => ({
    email: destinatario.emailAddress,
    reason: 'COMPLAINT' as const,
    subtype: complaint.complaintFeedbackType ?? complaint.complaintSubType ?? null,
    messageId,
  }));
}
