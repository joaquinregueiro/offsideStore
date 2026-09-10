import type { Database } from '@offside/database';

import { leerFeedback } from '../infrastructure/email/ses-feedback';
import * as suppressionRepo from '../repositories/email-suppression.repository';

/**
 * Direcciones que dejaron de recibir email.
 *
 * =============================================================================
 * POR QUE EXISTE SI SES YA TIENE SU PROPIA LISTA DE SUPRESION
 * =============================================================================
 *
 * Porque resuelven problemas distintos y ninguno cubre al otro.
 *
 * La lista de SES protege la REPUTACION de la cuenta de AWS: deja de entregar a
 * las direcciones que rebotaron duro y esos envios no cuentan para la tasa de
 * rebote. Eso ya funciona solo, sin este codigo.
 *
 * Lo que NO hace es avisarnos. SES **acepta** el mensaje: nuestro job termina
 * bien, el log dice "enviado", y nadie se entera de que no llego nunca. El
 * resultado es una CUENTA MUERTA EN SILENCIO —quien se registro con un typo no
 * puede ingresar por BR-001, pide reenvio, el reenvio "sale bien" y no llega—,
 * que es el mismo agujero que cerro el reenvio de verificacion, un escalon mas
 * abajo.
 *
 * Este modulo es lo que permite que alguien pueda VERLO.
 */

/**
 * ¿Esta direccion dejo de recibir email?
 *
 * ⚠️ FALLA ABIERTO: si la consulta falla, se deja mandar. Es el mismo criterio
 * que el rate limiter y por la misma razon —un fallo de infraestructura no
 * puede convertirse en "nadie recibe emails"—, y aca ademas el costo de
 * equivocarse es barato: SES no lo va a entregar igual, porque su propia lista
 * sigue vigente.
 */
export async function isSuppressed(email: string, db?: Database): Promise<boolean> {
  try {
    return (await suppressionRepo.findActive(email, db)) !== undefined;
  } catch (error) {
    console.error(
      '[notifications] no se pudo consultar la lista de supresion, se deja pasar el envio:',
      error instanceof Error ? error.message : String(error),
    );

    return false;
  }
}

export interface FeedbackResult {
  /** Cuantas direcciones se suprimieron. */
  suprimidas: number;
  /** `false` si el cuerpo no tenia la forma de una notificacion de SES. */
  reconocida: boolean;
}

/**
 * Procesa una notificacion de rebote o queja.
 *
 * ⚠️ EL CUERPO YA VIENE AUTENTICADO. Este Service NO verifica la firma: eso lo
 * hace el Controller con `lib/sns-signature.ts`, antes de llegar aca. Si se
 * llamara con un cuerpo sin verificar, cualquiera podria suprimir la direccion
 * de otra persona.
 *
 * ⚠️ UNA NOTIFICACION PUEDE TRAER VARIOS DESTINATARIOS. AWS lo dice
 * explicitamente y no garantiza ni orden ni agrupamiento, asi que se recorren
 * todos: quedarse con el primero perderia supresiones en silencio.
 */
export async function processFeedback(cuerpo: unknown, db?: Database): Promise<FeedbackResult> {
  const detectadas = leerFeedback(cuerpo);

  if (detectadas === null) return { suprimidas: 0, reconocida: false };

  for (const deteccion of detectadas) {
    await suppressionRepo.suppress(
      {
        email: deteccion.email,
        reason: deteccion.reason,
        providerSubtype: deteccion.subtype,
        providerMessageId: deteccion.messageId,
        // Se conserva el payload crudo del tercero ademas de nuestra
        // interpretacion, mismo criterio que DEC-035 con Mercado Pago: cuando
        // algo no cierre, el original es la unica forma de saber que paso.
        raw: cuerpo,
      },
      db,
    );

    // Se registra QUE direccion y por que. Es un dato personal, pero sin el no
    // se puede diagnosticar por que una cuenta quedo muda, que es justamente lo
    // que este modulo viene a resolver.
    console.warn(
      `[notifications] ${deteccion.email} suprimida por ${deteccion.reason}` +
        `${deteccion.subtype === null ? '' : ` (${deteccion.subtype})`}`,
    );
  }

  return { suprimidas: detectadas.length, reconocida: true };
}

/**
 * Levanta la supresion de una direccion.
 *
 * ⚠️ HOY NO TIENE PANTALLA NI ENDPOINT. Se expone para que exista un unico
 * lugar con la regla, pero liberar una direccion todavia se hace por SQL —el
 * mismo criterio que los roles de admin (DEC-023)—. Darle una pantalla exige
 * decidir QUE CAPACIDAD la gobierna, y el mapa de `lib/permissions.ts` no tiene
 * ninguna que aplique: es una decision 🟡 que no se toma desde el codigo.
 */
export async function release(email: string, adminId: string, db?: Database): Promise<boolean> {
  return suppressionRepo.release(email, adminId, db);
}
