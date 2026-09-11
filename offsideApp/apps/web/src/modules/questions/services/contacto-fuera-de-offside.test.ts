import { describe, expect, it } from 'vitest';

import { detectarContacto, mensajeDeContacto } from './contacto-fuera-de-offside';

/**
 * ⚠️ LA MITAD QUE MAS IMPORTA DE ESTE ARCHIVO ES LA DE LOS FALSOS POSITIVOS.
 * Bloquear una pregunta legítima rompe una venta honesta y la persona no tiene
 * forma de saber por qué; dejar pasar un teléfono lo revisa alguien después.
 * Por eso hay más casos de "esto TIENE que pasar" que de "esto se frena".
 */

describe('detección de datos de contacto', () => {
  describe('frena lo que saca la operación de Offside', () => {
    it.each([
      ['un teléfono con característica', 'Llamame al 11 5555 0102', 'teléfono'],
      ['un teléfono pegado', 'mi numero es 1155550102', 'teléfono'],
      ['un teléfono con +54', 'escribime al +54 9 11 5555-0102', 'teléfono'],
      ['un CBU de 22 dígitos', 'te paso el 0170099220000067797370', 'CBU o CVU'],
      ['la palabra CBU', 'pasame tu cbu y te transfiero', 'CBU o CVU'],
      ['CBU con puntos', 'mandame el C.B.U.', 'CBU o CVU'],
      ['la palabra alias', 'mi alias para transferir', 'alias'],
      ['un alias con puntos', 'transferime a juan.perez.mp', 'alias'],
      ['un email', 'escribime a juan@gmail.com', 'email'],
      ['un email disfrazado', 'juan (arroba) gmail.com', 'email'],
      ['un arroba de red social', 'seguime en @retrocancha', 'red social'],
      ['WhatsApp por su nombre', '¿tenés whatsapp?', 'red social'],
      ['wsp abreviado', 'pasame el wsp', 'red social'],
      ['Instagram', 'te respondo por instagram', 'red social'],
      ['una URL', 'mirá https://otrositio.com/oferta', 'enlace'],
      ['un dominio suelto', 'entrá a mitienda.com.ar', 'enlace'],
    ])('detecta %s', (_caso, texto, tipoEsperado) => {
      const deteccion = detectarContacto(texto);

      expect(deteccion.hay).toBe(true);
      expect(deteccion.tipos).toContain(tipoEsperado);
    });

    it('nombra los dos tipos cuando hay más de uno', () => {
      const deteccion = detectarContacto('mi wsp es 1155550102');

      expect(deteccion.tipos).toHaveLength(2);
      expect(deteccion.tipos).toEqual(expect.arrayContaining(['teléfono', 'red social']));
    });
  });

  describe('⚠️ NO frena una pregunta legítima', () => {
    it.each([
      ['un año', '¿Es la camiseta de 1996 o la de 1998?'],
      ['una medida', '¿Cuánto mide de ancho de pecho? ¿56 cm?'],
      ['un talle', '¿Te queda en talle 42 o sólo 40?'],
      ['un precio', '¿Aceptás 150000 en efectivo al retirar?'],
      ['un número de camiseta', '¿Tiene el 10 de Riquelme estampado?'],
      ['dos años juntos', 'Entre la 2001 y la 2003, ¿cuál es esta?'],
      ['una fecha', '¿La compraste en 2019?'],
      ['un texto largo sin datos', '¿La podés mandar al interior? ¿Está sin roturas ni manchas?'],
      ['una temporada con barra', '¿Es la 2001/2002?'],
    ])('deja pasar %s', (_caso, texto) => {
      expect(detectarContacto(texto).hay).toBe(false);
    });
  });

  describe('el mensaje', () => {
    it('nombra el tipo sin repetir lo que la persona escribió', () => {
      const texto = 'llamame al 11 5555 0102';
      const mensaje = mensajeDeContacto(detectarContacto(texto));

      expect(mensaje).toContain('teléfono');
      // Lo que se escribió no vuelve: ese mensaje termina en un log.
      expect(mensaje).not.toContain('5555');
    });

    it('explica el motivo y qué hacer en su lugar', () => {
      const mensaje = mensajeDeContacto(detectarContacto('pasame tu cbu'));

      expect(mensaje).toContain('reclamo');
      expect(mensaje).toContain('después de comprar');
    });
  });
});
