import { describe, expect, it } from 'vitest';

import { DEFAULT_CARRIERS, parseCarriers, trackingUrlFor } from './carrier-catalog.service';
import { normalizeTrackingNumber } from './manual-shipment.service';

/**
 * Catalogo de transportistas (`shipping_carriers`) y numero de seguimiento del
 * despacho manual. Lo que se fija: que un valor mal cargado en el Config Store
 * se rechace al leer, y que el numero que el vendedor tipea llegue limpio.
 */

describe('parseCarriers', () => {
  it('acepta la forma documentada y normaliza el template ausente a null', () => {
    const lista = parseCarriers([
      { code: 'andreani', name: 'Andreani' },
      {
        code: 'otro',
        name: 'Otro',
        trackingUrlTemplate: 'https://seguimiento.example/{tracking}',
      },
    ]);

    expect(lista).toEqual([
      { code: 'andreani', name: 'Andreani', trackingUrlTemplate: null },
      { code: 'otro', name: 'Otro', trackingUrlTemplate: 'https://seguimiento.example/{tracking}' },
    ]);
  });

  it('⚠️ rechaza la lista vacia: sin transportistas nadie puede despachar', () => {
    expect(() => parseCarriers([])).toThrow(/shipping_carriers/);
  });

  it('rechaza codigos repetidos o con mayusculas', () => {
    expect(() =>
      parseCarriers([
        { code: 'oca', name: 'OCA' },
        { code: 'oca', name: 'OCA otra vez' },
      ]),
    ).toThrow(/repetidos/);
    expect(() => parseCarriers([{ code: 'OCA', name: 'OCA' }])).toThrow(/code/);
  });

  it('rechaza un template sin el marcador o sin https', () => {
    expect(() =>
      parseCarriers([{ code: 'x1', name: 'X', trackingUrlTemplate: 'https://x.example/ver' }]),
    ).toThrow(/\{tracking\}/);
    expect(() =>
      parseCarriers([
        { code: 'x1', name: 'X', trackingUrlTemplate: 'http://x.example/{tracking}' },
      ]),
    ).toThrow(/https/);
  });

  it('el default de codigo cumple su propio schema', () => {
    expect(parseCarriers(DEFAULT_CARRIERS)).toEqual(DEFAULT_CARRIERS);
  });
});

describe('trackingUrlFor', () => {
  it('reemplaza el marcador con el numero codificado', () => {
    const carrier = {
      code: 'x1',
      name: 'X',
      trackingUrlTemplate: 'https://x.example/ver/{tracking}',
    };

    expect(trackingUrlFor(carrier, 'AB 12/34')).toBe('https://x.example/ver/AB%2012%2F34');
  });

  it('sin template no hay enlace', () => {
    expect(trackingUrlFor(DEFAULT_CARRIERS[0]!, '123456')).toBeNull();
  });
});

describe('normalizeTrackingNumber', () => {
  it('recorta espacios y acepta entre 4 y 64 caracteres', () => {
    expect(normalizeTrackingNumber('  AB123456789AR ')).toBe('AB123456789AR');
    expect(normalizeTrackingNumber('1234')).toBe('1234');
    expect(normalizeTrackingNumber('x'.repeat(64))).toHaveLength(64);
  });

  it('rechaza vacio, corto, largo o con caracteres de control', () => {
    for (const malo of ['', '   ', 'abc', 'x'.repeat(65), 'AB12\n34']) {
      expect(() => normalizeTrackingNumber(malo)).toThrow(/seguimiento/);
    }
  });
});
