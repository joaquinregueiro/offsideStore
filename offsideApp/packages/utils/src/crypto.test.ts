import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  DecryptionError,
  ENCRYPTION_KEY_BYTES,
  decodeEncryptionKey,
  decryptSecret,
  encryptSecret,
} from './crypto';

/**
 * ⚠️ Los valores de prueba de este archivo son ALEATORIOS y locales. No hay
 * ningun token, clave ni credencial real: ni de Mercado Pago ni de ningun otro
 * servicio (CLAUDE.md §10).
 */

const key = randomBytes(ENCRYPTION_KEY_BYTES);
const otraKey = randomBytes(ENCRYPTION_KEY_BYTES);

describe('encryptSecret / decryptSecret', () => {
  it('devuelve el mismo valor al descifrar', () => {
    const valor = 'valor-secreto-de-prueba';

    expect(decryptSecret(encryptSecret(valor, key), key)).toBe(valor);
  });

  it('preserva caracteres no ASCII', () => {
    const valor = 'acentos: áéíóú ñ — símbolos ✓';

    expect(decryptSecret(encryptSecret(valor, key), key)).toBe(valor);
  });

  it('preserva el string vacio', () => {
    expect(decryptSecret(encryptSecret('', key), key)).toBe('');
  });

  it('nunca deja el valor original visible en el texto cifrado', () => {
    const valor = 'token-que-no-debe-aparecer';

    expect(encryptSecret(valor, key)).not.toContain(valor);
  });

  it('produce textos cifrados distintos para el mismo valor', () => {
    // El IV es aleatorio en cada llamada: reutilizarlo rompe GCM. Dos
    // resultados iguales delatarian un IV fijo.
    const valor = 'mismo-valor';

    expect(encryptSecret(valor, key)).not.toBe(encryptSecret(valor, key));
  });

  it('falla con una clave distinta', () => {
    const cifrado = encryptSecret('valor', key);

    expect(() => decryptSecret(cifrado, otraKey)).toThrowError(DecryptionError);
  });

  it('detecta un texto cifrado alterado', () => {
    // Esto es lo que aporta GCM frente a CBC: manipular la base no pasa
    // desapercibido.
    const cifrado = encryptSecret('valor', key);
    const [version, iv, ciphertext, tag] = cifrado.split('.') as [string, string, string, string];
    const alterado = [version, iv, `${ciphertext.slice(0, -2)}AA`, tag].join('.');

    expect(() => decryptSecret(alterado, otraKey)).toThrowError(DecryptionError);
  });

  it('detecta un tag de autenticacion alterado', () => {
    const cifrado = encryptSecret('valor', key);
    const [version, iv, ciphertext, tag] = cifrado.split('.') as [string, string, string, string];
    const alterado = [version, iv, ciphertext, `${tag.slice(0, -2)}AA`].join('.');

    expect(() => decryptSecret(alterado, key)).toThrowError(DecryptionError);
  });

  it('rechaza un formato desconocido', () => {
    expect(() => decryptSecret('no-es-un-valor-cifrado', key)).toThrowError(DecryptionError);
  });

  it('rechaza una version de formato no soportada', () => {
    const cifrado = encryptSecret('valor', key);
    const [, iv, ciphertext, tag] = cifrado.split('.') as [string, string, string, string];

    expect(() => decryptSecret(['v99', iv, ciphertext, tag].join('.'), key)).toThrowError(
      /Version de cifrado no soportada/,
    );
  });

  it('no filtra el valor cifrado en el mensaje de error', () => {
    const cifrado = encryptSecret('valor-sensible', key);

    try {
      decryptSecret(cifrado, otraKey);
      expect.unreachable('deberia haber fallado');
    } catch (error) {
      expect((error as Error).message).not.toContain(cifrado);
    }
  });

  it('rechaza una clave que no mide 32 bytes', () => {
    expect(() => encryptSecret('valor', randomBytes(16))).toThrowError(/32 bytes/);
  });
});

describe('decodeEncryptionKey', () => {
  it('decodifica una clave base64 de 32 bytes', () => {
    const base64 = randomBytes(ENCRYPTION_KEY_BYTES).toString('base64');

    expect(decodeEncryptionKey(base64)).toHaveLength(ENCRYPTION_KEY_BYTES);
  });

  it('rechaza una clave demasiado corta', () => {
    expect(() => decodeEncryptionKey(randomBytes(16).toString('base64'))).toThrowError(/32 bytes/);
  });
});
