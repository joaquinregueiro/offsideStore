import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { deriveCodeChallenge, generateCodeVerifier, generateState } from './pkce';

/**
 * PKCE y `state` (mercadopago-oauth-spec.md §5 y §6).
 *
 * ⚠️ Ningun valor de este archivo es una credencial real: todos se generan al
 * vuelo y se descartan.
 */

const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe('generateCodeVerifier', () => {
  it('mide 86 caracteres, dentro del rango 43-128 que admite Mercado Pago', () => {
    expect(generateCodeVerifier()).toHaveLength(86);
  });

  it('usa el alfabeto base64url, sin relleno', () => {
    // `+`, `/` y `=` romperian el parametro dentro de una URL.
    expect(generateCodeVerifier()).toMatch(BASE64URL);
  });

  it('genera un valor distinto en cada llamada', () => {
    const generados = new Set(Array.from({ length: 50 }, () => generateCodeVerifier()));

    expect(generados.size).toBe(50);
  });
});

describe('deriveCodeChallenge', () => {
  it('es BASE64URL(SHA256(code_verifier))', () => {
    const verifier = generateCodeVerifier();
    const esperado = createHash('sha256').update(verifier).digest('base64url');

    expect(deriveCodeChallenge(verifier)).toBe(esperado);
  });

  it('coincide con el vector de ejemplo del RFC 7636', () => {
    // Verifica que el metodo sea S256 de verdad y no otra transformacion.
    expect(deriveCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('no deja el verifier visible en el challenge', () => {
    const verifier = generateCodeVerifier();

    expect(deriveCodeChallenge(verifier)).not.toContain(verifier);
  });

  it('es determinista', () => {
    const verifier = generateCodeVerifier();

    expect(deriveCodeChallenge(verifier)).toBe(deriveCodeChallenge(verifier));
  });
});

describe('generateState', () => {
  it('tiene 256 bits de entropia', () => {
    // 32 bytes en base64url, sin relleno.
    expect(Buffer.from(generateState(), 'base64url')).toHaveLength(32);
  });

  it('usa el alfabeto base64url', () => {
    expect(generateState()).toMatch(BASE64URL);
  });

  it('es opaco: no repite valores', () => {
    const generados = new Set(Array.from({ length: 50 }, () => generateState()));

    expect(generados.size).toBe(50);
  });
});
