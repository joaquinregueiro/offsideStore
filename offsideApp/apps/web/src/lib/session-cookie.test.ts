import { describe, expect, it } from 'vitest';

import { readSessionToken, SESSION_COOKIE_NAME } from './session-cookie';

function conCookie(valor: string): Request {
  return new Request('http://localhost/api/auth/me', {
    headers: { cookie: `otra=1; ${SESSION_COOKIE_NAME}=${valor}` },
  });
}

describe('readSessionToken', () => {
  it('lee el token de la cookie', () => {
    expect(readSessionToken(conCookie('abc-123'))).toBe('abc-123');
  });

  it('⚠️ una cookie mal codificada es "sin sesion", no un 500', () => {
    // `decodeURIComponent('%')` lanza URIError.
    expect(() => readSessionToken(conCookie('%E0%A4%A'))).not.toThrow();
    expect(readSessionToken(conCookie('%'))).toBeNull();
  });

  it('acepta Authorization: Bearer cuando no hay cookie', () => {
    const request = new Request('http://localhost/', {
      headers: { authorization: 'Bearer tok-1' },
    });
    expect(readSessionToken(request)).toBe('tok-1');
  });
});
