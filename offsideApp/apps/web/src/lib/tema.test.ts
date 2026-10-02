import { describe, expect, it } from 'vitest';

import { atributoDeTema } from './tema';

describe('tema del sitio', () => {
  /**
   * ⚠️ EL ATRIBUTO ES LO QUE APAGA EL OSCURO DEL SISTEMA OPERATIVO. El bloque de
   * `prefers-color-scheme: dark` de `tokens.css` solo aplica a
   * `:root:not([data-tema='claro'])`: si esto dejara de escribir `claro`, un
   * telefono en modo oscuro veria el sitio oscuro sin que nadie lo eligiera.
   */
  it('escribe siempre data-tema="claro"', () => {
    expect(atributoDeTema()).toEqual({ 'data-tema': 'claro' });
  });
});
