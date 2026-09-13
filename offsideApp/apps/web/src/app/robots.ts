import type { MetadataRoute } from 'next';

/**
 * `robots.txt`.
 *
 * ⚠️ LO QUE MAS IMPORTA ACA ES LO QUE SE BLOQUEA. Todo lo privado —cuenta,
 * vendedor, back-office, carrito y checkout— redirige al login: si un buscador
 * lo rastrea, gasta presupuesto de rastreo en pantallas que nunca va a poder
 * indexar y aprende que el sitio responde cualquier cosa. Ademas `/api` no tiene
 * nada que un buscador deba leer.
 *
 * ⚠️ NO ES UNA MEDIDA DE SEGURIDAD Y NO SE USA COMO TAL. `robots.txt` es una
 * PETICION que un rastreador puede ignorar; lo que protege esas pantallas son las
 * guardas de sesion y el mapa de capacidades. Bloquearlas acá es higiene de
 * rastreo, no control de acceso.
 */

const BASE = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin', '/cuenta', '/vendedor', '/carrito', '/checkout', '/ingresar'],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
