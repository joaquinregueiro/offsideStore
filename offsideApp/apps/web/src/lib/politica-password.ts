import { getEnv } from '@offside/config';

/**
 * La politica de contraseña que el sistema aplica de verdad.
 *
 * ⚠️ EXISTE PORQUE EL NUMERO ESTABA ESCRITO A MANO EN LA PANTALLA. Dos
 * formularios decian "Al menos 12 caracteres" en texto plano mientras el minimo
 * real vive en `AUTH_PASSWORD_MIN_LENGTH`. El dia que alguien suba el minimo a
 * 14, el servidor rechaza contraseñas que la pantalla acaba de declarar
 * validas, y la persona no tiene forma de saber por que.
 *
 * ⚠️ `getEnv()` SE LLAMA ADENTRO, NO EN EL MODULO. Al cargar el modulo tambien
 * se evaluaria durante `next build`, y `getEnv()` valida el entorno ENTERO: un
 * build no deberia romperse porque falta configurar Mercado Pago.
 */
export function largoMinimoDePassword(): number {
  return getEnv().AUTH_PASSWORD_MIN_LENGTH;
}

/** El texto de ayuda del campo, con el numero real. */
export function ayudaDePassword(): string {
  return `Al menos ${largoMinimoDePassword()} caracteres. Cuanto más larga, mejor.`;
}

/**
 * Cuanto vale un enlace de verificacion de email, en horas.
 *
 * ⚠️ EL EMAIL YA LO DICE Y LA PANTALLA NO. Quien abre `/revisa-tu-email` sin el
 * mail a la vista no tiene forma de saber si el enlace de ayer todavia sirve.
 */
export function horasDelEnlaceDeVerificacion(): number {
  return getEnv().AUTH_EMAIL_TOKEN_TTL_HOURS;
}

/** Cuanto vale un enlace para restablecer la contraseña, en horas. */
export function horasDelEnlaceDeReset(): number {
  return getEnv().AUTH_PASSWORD_RESET_TTL_HOURS;
}
