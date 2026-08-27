import { getEnv } from '@offside/config';

import type { EmailMessage } from '../infrastructure/email/email-sender.port';

/**
 * Plantillas de los emails de `auth`.
 *
 * ⚠️ ALCANCE: SOLO verificacion de email y reset de password.
 * `notifications-and-engagement.md` §2.1 lista nueve eventos (registro, venta,
 * compra, pago, envio, entrega, refund, reclamo, disputa), pero los otros siete
 * dependen de modulos que no existen. Se agregan cuando exista su disparador.
 *
 * ⚠️ Las plantillas siguen 🟡 en la documentacion: texto, tono y diseño no
 * estan definidos. Lo de aca es funcional y sobrio a proposito; cuando exista
 * la definicion de marca, se reemplaza SOLO este archivo.
 *
 * ⚠️ CADA EMAIL LLEVA UN TOKEN DE UN SOLO USO. No se loguean, no se auditan y
 * no se reutilizan entre plantillas.
 */

/** Rutas del frontend. Todavia no existen; el backend igual las construye. */
const RUTA_VERIFICACION = '/verificar-email';
const RUTA_RESET = '/restablecer-password';

function url(ruta: string, token: string): string {
  const base = getEnv().APP_URL.replace(/\/$/, '');

  return `${base}${ruta}?token=${encodeURIComponent(token)}`;
}

/** Envoltura HTML minima. Sin imagenes ni CSS externo: no cargan en la mayoria de los clientes. */
function envolver(titulo: string, cuerpo: string, boton: { texto: string; href: string }): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a1a1a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;">${titulo}</h1>
      <p style="margin:0 0 24px;line-height:1.6;font-size:15px;">${cuerpo}</p>
      <a href="${boton.href}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px;">${boton.texto}</a>
      <p style="margin:24px 0 0;font-size:13px;color:#666;line-height:1.6;">
        Si el boton no funciona, copiá este enlace:<br />
        <span style="word-break:break-all;">${boton.href}</span>
      </p>
    </div>
  </body>
</html>`;
}

export function verificacionDeEmail(
  to: string,
  token: string,
  horasDeValidez: number,
): EmailMessage {
  const enlace = url(RUTA_VERIFICACION, token);

  return {
    to,
    subject: 'Confirmá tu email — Offside Store',
    text: [
      'Bienvenido a Offside Store.',
      '',
      'Para empezar a operar necesitás confirmar tu dirección de email:',
      enlace,
      '',
      `El enlace vence en ${horasDeValidez} horas.`,
      '',
      'Si no creaste esta cuenta, ignorá este mensaje.',
    ].join('\n'),
    html: envolver(
      'Confirmá tu email',
      `Bienvenido a Offside Store. Para empezar a operar necesitás confirmar tu dirección de email. El enlace vence en ${horasDeValidez} horas.`,
      { texto: 'Confirmar mi email', href: enlace },
    ),
  };
}

export function resetDePassword(to: string, token: string, horasDeValidez: number): EmailMessage {
  const enlace = url(RUTA_RESET, token);

  return {
    to,
    subject: 'Restablecé tu contraseña — Offside Store',
    text: [
      'Pediste restablecer tu contraseña de Offside Store.',
      '',
      enlace,
      '',
      `El enlace vence en ${horasDeValidez} horas y se puede usar una sola vez.`,
      '',
      'Si no lo pediste, ignorá este mensaje: tu contraseña actual sigue funcionando.',
    ].join('\n'),
    html: envolver(
      'Restablecé tu contraseña',
      `Pediste restablecer tu contraseña de Offside Store. El enlace vence en ${horasDeValidez} horas y se puede usar una sola vez. Si no lo pediste, ignorá este mensaje: tu contraseña actual sigue funcionando.`,
      { texto: 'Elegir una contraseña nueva', href: enlace },
    ),
  };
}
