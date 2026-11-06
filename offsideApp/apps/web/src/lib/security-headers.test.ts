import { describe, expect, it } from 'vitest';

import { CONTENT_SECURITY_POLICY, securityHeaders } from './security-headers';

function valor(key: string): string | undefined {
  return securityHeaders().find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

describe('securityHeaders', () => {
  it('⚠️ prohibe embeber el sitio en un iframe (clickjacking)', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(valor('X-Frame-Options')).toBe('DENY');
  });

  it('no deja que el navegador adivine el tipo de contenido', () => {
    expect(valor('X-Content-Type-Options')).toBe('nosniff');
  });

  it('no filtra rutas con tokens en el Referer al salir del sitio', () => {
    expect(valor('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('exige HTTPS sin comprometer subdominios de terceros', () => {
    const hsts = valor('Strict-Transport-Security');
    expect(hsts).toMatch(/max-age=\d{7,}/);
    expect(hsts).not.toContain('includeSubDomains');
  });

  it('⚠️ NO restringe form-action: el checkout termina en un redirect a Mercado Pago', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain('form-action');
  });

  it('⚠️ NO restringe scripts: sin nonces, una script-src deja la pagina en blanco', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain('script-src');
    expect(CONTENT_SECURITY_POLICY).not.toContain('default-src');
  });

  it('no repite cabeceras', () => {
    const claves = securityHeaders().map((h) => h.key.toLowerCase());
    expect(new Set(claves).size).toBe(claves.length);
  });
});
