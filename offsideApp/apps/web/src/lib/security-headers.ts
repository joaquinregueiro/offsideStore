/**
 * Cabeceras de seguridad HTTP de TODAS las respuestas.
 *
 * Auditoria de seguridad del 2026-11-06: el sitio no mandaba NINGUNA. La
 * consecuencia concreta era el CLICKJACKING: cualquier pagina ajena podia
 * cargar `offside.com.ar` en un `<iframe>` transparente y hacerle apretar a la
 * persona, con su sesion, "Pagar", "Despachar", "Desvincular Mercado Pago" o
 * "Reembolsar" en el back-office. `SameSite=Lax` no lo frena: dentro del iframe
 * la navegacion es del propio sitio y la cookie viaja.
 *
 * Lo usa `next.config.ts` (`headers()`), que las aplica tambien a `/public` y a
 * `/_next/*`. Vive en `lib/` y no adentro del config para poder testearlo.
 *
 * ⚠️ NO HAY `script-src` NI `default-src`, Y ES DELIBERADO. Una CSP estricta de
 * scripts en Next exige nonces por request (todo el sitio pasaria a depender de
 * un proxy que los genere) y, mal hecha, deja la pagina en blanco. Esta CSP
 * cubre lo que se puede cerrar sin romper nada: quien puede embeber el sitio,
 * `<base>` y plugins. La CSP de scripts queda como trabajo aparte.
 *
 * ⚠️ NO HAY `form-action`. El pago y la conexion con Mercado Pago terminan en un
 * redirect a `mercadopago.com.ar` despues de un POST, y Chrome aplica
 * `form-action` tambien a esos redirects: restringirlo a `'self'` rompe el
 * checkout.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

export const CONTENT_SECURITY_POLICY = [
  // Nadie puede embeber el sitio: es la defensa moderna contra clickjacking.
  "frame-ancestors 'none'",
  // Un `<base href>` inyectado reescribiria a donde apuntan todos los enlaces
  // y formularios relativos.
  "base-uri 'self'",
  // Sin plugins (Flash, PDF embebidos por <object>): no hay ningun uso legitimo.
  "object-src 'none'",
].join('; ');

export function securityHeaders(): SecurityHeader[] {
  return [
    { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
    // Navegadores viejos que no entienden `frame-ancestors`.
    { key: 'X-Frame-Options', value: 'DENY' },
    /*
     * Que el navegador no "adivine" el tipo: una respuesta que se declara
     * `text/plain` o una imagen no puede terminar ejecutandose como HTML. Pesa
     * en la etiqueta de envio, que reenvia el Content-Type de un tercero.
     */
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    /*
     * Los enlaces de verificacion de email y de reset de password llevan el
     * token en la URL. Con esta politica, al salir del sitio solo viaja el
     * origen, nunca la ruta ni la query.
     */
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    /*
     * HTTPS obligatorio por un año. El navegador IGNORA esta cabecera si la
     * recibe por HTTP, asi que no afecta a `npm run dev` en localhost.
     * ⚠️ Sin `includeSubDomains` ni `preload`: el DNS de offside.com.ar tiene
     * registros de terceros (SES) y comprometer todos los subdominios a HTTPS
     * es una decision del owner, no un efecto secundario de este cambio.
     */
    { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
    // Ninguna pantalla usa camara, microfono ni ubicacion: se apagan.
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
    },
    /*
     * Aisla la ventana de otras que la abran o que ella abra. El checkout y el
     * OAuth de Mercado Pago son redirects de pagina completa, no popups, asi
     * que no dependen de `window.opener`.
     */
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
}
