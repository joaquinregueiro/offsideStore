import { describe, expect, it } from 'vitest';

import {
  calculateCheckDigit,
  isValidTaxIdType,
  maskTaxId,
  normalizeTaxId,
  validateTaxIdSyntax,
} from './fiscal-identity.service';

/**
 * Identificadores con digito verificador CORRECTO, calculados con el algoritmo
 * de modulo 11. Son numeros sinteticos, no pertenecen a nadie.
 */
const VALIDOS = {
  cuit: '20123456786', // 20-12345678-6
  cuil: '27123456780', // 27-12345678-0
  empresa: '30123456781', // 30-12345678-1
};

describe('normalizeTaxId', () => {
  it('deja solo digitos', () => {
    expect(normalizeTaxId('20-12345678-3')).toBe('20123456783');
  });

  it('normaliza otros separadores y espacios', () => {
    expect(normalizeTaxId('20.12345678.3')).toBe('20123456783');
    expect(normalizeTaxId(' 20 12345678 3 ')).toBe('20123456783');
  });

  it('es idempotente sobre un valor ya normalizado', () => {
    expect(normalizeTaxId('20123456783')).toBe('20123456783');
  });
});

describe('calculateCheckDigit', () => {
  it('calcula el digito verificador esperado', () => {
    expect(calculateCheckDigit('2012345678')).toBe(6);
    expect(calculateCheckDigit('2712345678')).toBe(0);
    expect(calculateCheckDigit('3012345678')).toBe(1);
  });
});

describe('isValidTaxIdType', () => {
  it('acepta los tres tipos admitidos', () => {
    expect(isValidTaxIdType('CUIT')).toBe(true);
    expect(isValidTaxIdType('CUIL')).toBe(true);
    expect(isValidTaxIdType('CDI')).toBe(true);
  });

  it('rechaza un tipo inexistente', () => {
    expect(isValidTaxIdType('DNI')).toBe(false);
    expect(isValidTaxIdType('cuit')).toBe(false); // case-sensitive
  });

  it('rechaza vacio y no-strings', () => {
    expect(isValidTaxIdType('')).toBe(false);
    expect(isValidTaxIdType(undefined)).toBe(false);
    expect(isValidTaxIdType(20123456786)).toBe(false);
  });
});

describe('validateTaxIdSyntax', () => {
  it('acepta un identificador valido y lo devuelve normalizado', () => {
    const r = validateTaxIdSyntax('20-12345678-6');

    expect(r).toEqual({ valid: true, normalized: VALIDOS.cuit });
  });

  it('acepta los tres formatos validos sin guiones', () => {
    for (const id of Object.values(VALIDOS)) {
      expect(validateTaxIdSyntax(id).valid).toBe(true);
    }
  });

  it('rechaza vacio', () => {
    expect(validateTaxIdSyntax('')).toEqual({ valid: false, error: 'EMPTY' });
    expect(validateTaxIdSyntax('   ')).toEqual({ valid: false, error: 'EMPTY' });
  });

  it('rechaza caracteres invalidos', () => {
    expect(validateTaxIdSyntax('20-ABCDEFGH-6')).toEqual({
      valid: false,
      error: 'INVALID_CHARACTERS',
    });
  });

  it('rechaza longitud incorrecta', () => {
    expect(validateTaxIdSyntax('2012345678')).toEqual({ valid: false, error: 'INVALID_LENGTH' });
    expect(validateTaxIdSyntax('201234567861')).toEqual({ valid: false, error: 'INVALID_LENGTH' });
  });

  it('rechaza digito verificador incorrecto', () => {
    // 20-12345678-3: el verificador correcto es 6, no 3.
    expect(validateTaxIdSyntax('20-12345678-3')).toEqual({
      valid: false,
      error: 'INVALID_CHECK_DIGIT',
    });
  });

  it('la longitud se evalua antes que el digito verificador', () => {
    expect(validateTaxIdSyntax('1').valid).toBe(false);
    expect(validateTaxIdSyntax('1')).toEqual({ valid: false, error: 'INVALID_LENGTH' });
  });
});

describe('maskTaxId', () => {
  it('oculta el centro del identificador', () => {
    expect(maskTaxId('20123456786')).toBe('20*******86');
  });

  it('no filtra nada ante un valor demasiado corto', () => {
    expect(maskTaxId('12')).toBe('***');
  });

  it('enmascara igual con o sin guiones', () => {
    expect(maskTaxId('20-12345678-6')).toBe(maskTaxId('20123456786'));
  });
});
