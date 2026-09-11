import { AuthError, type AuthErrorCode } from '../auth/auth.errors';

/**
 * Errores del modulo disputes (reclamos).
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 *
 * ⚠️ MISMO ESQUEMA QUE `trust.errors.ts`, y por el mismo motivo: `AuthErrorCode`
 * es una union CERRADA que vive en `auth/auth.errors.ts` y en `lib/http.ts`, y
 * ninguno de los dos pertenece a este modulo. Cada error lleva DOS codigos:
 * `code` es uno ya existente —elegido por el STATUS HTTP que `lib/http.ts` le
 * asigna: 404, 409, 422— y `reason` es el motivo preciso, para que pantallas y
 * tests distingan "ese reclamo no existe" de "la ventana de reclamo vencio"
 * sin leer el mensaje. Cuando `auth.errors.ts` incorpore los codigos de este
 * modulo, `reason` pasa a ser `code` y nada mas cambia.
 *
 * ⚠️ El `code` visible puede desorientar a un cliente de la API (un reclamo
 * inexistente sale como `LISTING_NOT_FOUND`). Es deuda conocida y esta
 * anotada en NECESITA-DE-OTROS; el mensaje visible es el correcto.
 */

export type DisputeErrorReason =
  | 'DISPUTE_NOT_FOUND'
  | 'DISPUTE_ALREADY_EXISTS'
  | 'DISPUTE_NOT_ALLOWED'
  | 'DISPUTE_WINDOW_CLOSED'
  | 'DISPUTE_INVALID_TRANSITION'
  | 'DISPUTE_INVALID'
  | 'DISPUTE_CONFLICT_OF_INTEREST';

export class DisputeError extends AuthError {
  readonly reason: DisputeErrorReason;

  constructor(code: AuthErrorCode, reason: DisputeErrorReason, message: string) {
    super(code, message);
    this.name = 'DisputeError';
    this.reason = reason;
  }
}

/**
 * El reclamo no existe O el usuario no es parte ni tiene la capacidad.
 *
 * ⚠️ NO SE DISTINGUEN, igual que `getMyOrder` en `orders`: un 404 distinto para
 * "existe pero es ajeno" permitiria enumerar reclamos de otros.
 */
export const disputeNotFound = (): DisputeError =>
  new DisputeError('LISTING_NOT_FOUND', 'DISPUTE_NOT_FOUND', 'Ese reclamo no existe');

/** La orden no existe o no es del comprador. Mismo criterio: no se distinguen. */
export const orderNotFound = (): AuthError =>
  new AuthError('ORDER_NOT_FOUND', 'Esa orden no existe');

/** ERD §20.11: UNA disputa por orden, en cualquier estado. */
export const disputeAlreadyExists = (): DisputeError =>
  new DisputeError(
    'ORDER_NOT_PAYABLE',
    'DISPUTE_ALREADY_EXISTS',
    'Esta orden ya tiene un reclamo abierto',
  );

/** El estado de la orden (o el motivo elegido) no admite reclamo. */
export const disputeNotAllowed = (motivo: string): DisputeError =>
  new DisputeError('ORDER_NOT_PAYABLE', 'DISPUTE_NOT_ALLOWED', motivo);

/** Paso la ventana de reclamo (BR-034 / TS-050). */
export const disputeWindowClosed = (): DisputeError =>
  new DisputeError(
    'ORDER_NOT_PAYABLE',
    'DISPUTE_WINDOW_CLOSED',
    'El plazo para reclamar por esta orden ya venció',
  );

/** La disputa no esta en el estado desde el que se intenta operar (DEC-009). */
export const disputeInvalidTransition = (motivo: string): DisputeError =>
  new DisputeError('ORDER_NOT_PAYABLE', 'DISPUTE_INVALID_TRANSITION', motivo);

/** Datos invalidos: motivo, descripcion, evidencias, importe, nota. */
export const disputeInvalid = (motivo: string): DisputeError =>
  new DisputeError('VALIDATION_FAILED', 'DISPUTE_INVALID', motivo);

/**
 * El administrador es parte del reclamo.
 *
 * Un ADMIN tambien puede comprar y vender (DEC-023: los ejes son
 * independientes). Resolver el propio reclamo —o el de un comprador contra su
 * propia tienda— es un conflicto de interes que ninguna capacidad deberia
 * habilitar.
 */
export const disputeConflictOfInterest = (): DisputeError =>
  new DisputeError(
    'FORBIDDEN',
    'DISPUTE_CONFLICT_OF_INTEREST',
    'No podés resolver un reclamo en el que sos parte',
  );
