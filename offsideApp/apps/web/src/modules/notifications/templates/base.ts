import { getEnv } from '@offside/config';

/**
 * Piezas comunes a las plantillas de email de negocio.
 *
 * `auth.templates.ts` tiene su propia envoltura y no se toca: sus emails
 * llevan tokens de un solo uso y conviene que ese archivo siga siendo pequeno
 * y auditable por si solo. Lo de aca lo usan las plantillas de ordenes,
 * reclamos, calificaciones y niveles, que NO llevan credenciales pero SI
 * llevan texto escrito por otras personas (titulos de publicaciones, nombres,
 * comentarios).
 *
 * ⚠️ TODO LO QUE VIENE DE UN USUARIO SE ESCAPA ANTES DE ENTRAR AL HTML. Un
 * comentario de una resena o el titulo de una publicacion son entrada libre:
 * sin escapar, quien escribe `<a href="https://sitio-falso">` en su comentario
 * consigue que Offside le mande un enlace de phishing al vendedor desde su
 * propio remitente. El texto plano no tiene este problema y no se escapa.
 */

/** URL absoluta a una ruta del frontend, construida con `APP_URL`. */
export function urlAbsoluta(ruta: string): string {
  const base = getEnv().APP_URL.replace(/\/$/, '');

  return `${base}${ruta}`;
}

/** Escapa los cinco caracteres que HTML interpreta. */
export function escapar(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface BotonEmail {
  texto: string;
  href: string;
}

/**
 * Envoltura HTML minima. Sin imagenes ni CSS externo: no cargan en la mayoria
 * de los clientes. Misma forma que la de `auth`, mas una lista opcional de
 * datos (numero de orden, importe, seguimiento) que en los emails de negocio
 * es lo que la persona busca primero.
 *
 * `parrafos` y `datos` se escapan aca, en un solo lugar, para que ninguna
 * plantilla pueda olvidarse. Por eso reciben texto plano, nunca HTML.
 */
export function envolver(opciones: {
  titulo: string;
  parrafos: string[];
  datos?: { etiqueta: string; valor: string }[];
  boton: BotonEmail;
}): string {
  const parrafos = opciones.parrafos
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;font-size:15px;">${escapar(p)}</p>`)
    .join('\n      ');

  const datos =
    opciones.datos !== undefined && opciones.datos.length > 0
      ? `<table role="presentation" style="margin:0 0 24px;border-collapse:collapse;font-size:14px;">
        ${opciones.datos
          .map(
            (d) =>
              `<tr><td style="padding:4px 12px 4px 0;color:#666;">${escapar(d.etiqueta)}</td><td style="padding:4px 0;">${escapar(d.valor)}</td></tr>`,
          )
          .join('\n        ')}
      </table>`
      : '';

  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a1a1a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;">${escapar(opciones.titulo)}</h1>
      ${parrafos}
      ${datos}
      <a href="${escapar(opciones.boton.href)}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px;">${escapar(opciones.boton.texto)}</a>
      <p style="margin:24px 0 0;font-size:13px;color:#666;line-height:1.6;">
        Si el botón no funciona, copiá este enlace:<br />
        <span style="word-break:break-all;">${escapar(opciones.boton.href)}</span>
      </p>
    </div>
  </body>
</html>`;
}

/**
 * Cuerpo en texto plano con la misma informacion que el HTML. Es el fallback
 * universal y los filtros puntuan peor un email sin el.
 */
export function textoPlano(opciones: {
  parrafos: string[];
  datos?: { etiqueta: string; valor: string }[];
  boton: BotonEmail;
}): string {
  const lineas: string[] = [];

  for (const p of opciones.parrafos) lineas.push(p, '');
  if (opciones.datos !== undefined && opciones.datos.length > 0) {
    for (const d of opciones.datos) lineas.push(`${d.etiqueta}: ${d.valor}`);
    lineas.push('');
  }
  lineas.push(`${opciones.boton.texto}:`, opciones.boton.href);

  return lineas.join('\n');
}

/** "1 día", "7 días". */
export function dias(cantidad: number): string {
  return cantidad === 1 ? '1 día' : `${cantidad} días`;
}
