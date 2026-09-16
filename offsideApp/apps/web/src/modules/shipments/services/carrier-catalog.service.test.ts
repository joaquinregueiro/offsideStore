import { describe, expect, it } from 'vitest';

import { normalizeTrackingNumber } from './manual-shipment.service';

/**
 * Numero de seguimiento del despacho manual: que lo que el vendedor tipea
 * llegue limpio.
 *
 * ⚠️ ACA VIVIAN TAMBIEN `parseCarriers` Y `trackingUrlFor`, Y SE FUERON CON SU
 * CODIGO. No se perdio cobertura: las dos estaban DUPLICADAS en `config`, que
 * es de donde ahora salen.
 *
 *  - las reglas del catalogo —lista vacia, codigos repetidos, mayusculas,
 *    plantilla sin `{tracking}` o sin https— las fija `settings-registry.test`
 *    sobre el schema del REGISTRO, que ademas es el que se aplica cuando un
 *    administrador guarda la lista desde el back-office;
 *  - `trackingUrlFor` la fija `setting-store.test`, con un caso mas que el que
 *    habia aca: que el numero se codifica antes de entrar en un `href`.
 */

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
