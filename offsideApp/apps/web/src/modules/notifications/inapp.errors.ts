/**
 * Errores de la bandeja in-app (ERD §18, `notifications`).
 *
 * ⚠️ NO EXTIENDEN `AuthError`. Los modulos anteriores reusan `AuthError` para
 * que el mapa HTTP de `lib/http.ts` sea uno solo, pero `AuthErrorCode` es una
 * union cerrada que vive en `auth/auth.errors.ts`, y este paquete no puede
 * tocarla. Se define una clase propia con la MISMA forma (`code`, `message`)
 * para que, cuando `AuthErrorCode` incorpore estos codigos, migrar sea cambiar
 * la clase base y nada mas. Mientras tanto `lib/http.ts` los traduce a 500 y
 * `lib/errores.ts` al mensaje generico: ver el reporte de integracion.
 */

export type InAppNotificationErrorCode = 'NOTIFICATION_NOT_FOUND' | 'NOTIFICATION_INVALID';

export class InAppNotificationError extends Error {
  readonly code: InAppNotificationErrorCode;

  constructor(code: InAppNotificationErrorCode, message: string) {
    super(message);
    this.name = 'InAppNotificationError';
    this.code = code;
  }
}

/**
 * La notificacion no existe O no es de quien la pide.
 *
 * ⚠️ UN SOLO ERROR PARA LOS DOS CASOS: distinguirlos permitiria enumerar
 * notificaciones ajenas probando ids.
 */
export const notificationNotFound = (): InAppNotificationError =>
  new InAppNotificationError('NOTIFICATION_NOT_FOUND', 'Esa notificación no existe');

/** El titulo o el cuerpo no tienen la forma esperada. */
export const notificationInvalid = (motivo: string): InAppNotificationError =>
  new InAppNotificationError('NOTIFICATION_INVALID', `Notificación inválida: ${motivo}`);
