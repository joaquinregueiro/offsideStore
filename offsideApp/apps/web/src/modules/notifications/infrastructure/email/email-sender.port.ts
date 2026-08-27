/**
 * Puerto de envio de email.
 *
 * El dominio conoce ESTA interfaz y nada mas. Amazon SES vive detras de ella
 * (CLAUDE.md §11): cambiar de proveedor es escribir otro adaptador, no tocar
 * `auth` ni `notifications`.
 *
 * ⚠️ El proveedor sigue 🟡 en la documentacion
 * (`notifications-and-engagement.md` §2.1): SES es una decision de
 * implementacion tomada por el owner el 2026-08-26, no una decision documentada
 * en `docs/`. Por eso el puerto existe desde el primer dia.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Cuerpo en texto plano. SIEMPRE presente: es el fallback universal. */
  text: string;
  /** Cuerpo HTML. Opcional. */
  html?: string;
}

/** Categorias de fallo. Gruesas a proposito. */
export type EmailFailure = 'rejected' | 'unreachable' | 'not_configured';

export class EmailSendError extends Error {
  readonly failure: EmailFailure;

  constructor(failure: EmailFailure, message: string) {
    super(message);
    this.name = 'EmailSendError';
    this.failure = failure;
  }
}

export interface EmailSenderPort {
  /** Nombre del adaptador, para poder leerlo en los logs. */
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}
