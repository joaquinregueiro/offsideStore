import { describe, expect, it } from 'vitest';

import { condicion, estadoDeOrden, horas, precio, rutaInternaSegura } from './formato';

/**
 * Formateo de la interfaz.
 *
 * Lo que mas importa acá es `rutaInternaSegura`: es seguridad, no presentación.
 */

describe('precio', () => {
  it('convierte centavos a pesos', () => {
    // 12.000.000 centavos = $120.000
    expect(precio('12000000')).toContain('120.000');
  });

  it('no muestra centavos', () => {
    expect(precio('12050')).not.toContain(',50');
  });

  it('el cero es un precio valido', () => {
    expect(precio('0')).toContain('0');
  });
});

describe('condicion', () => {
  it('vuelve legible el enum del ERD', () => {
    expect(condicion('COMO_NUEVO')).toBe('Como nuevo');
    expect(condicion('NUEVO')).toBe('Nuevo');
    expect(condicion('MUY_BUENO')).toBe('Muy bueno');
  });
});

describe('estadoDeOrden', () => {
  it('traduce los estados tecnicos', () => {
    expect(estadoDeOrden('PENDING_PAYMENT')).toBe('Esperando pago');
    expect(estadoDeOrden('PAID')).toBe('Pagada');
  });

  it('un estado desconocido se muestra tal cual, sin romper', () => {
    // Si el ERD agrega un estado y nadie actualiza el mapa, es mejor mostrar
    // el valor crudo que una pantalla en blanco.
    expect(estadoDeOrden('ESTADO_NUEVO')).toBe('ESTADO_NUEVO');
  });
});

describe('rutaInternaSegura', () => {
  it('acepta rutas internas', () => {
    expect(rutaInternaSegura('/mis-compras')).toBe('/mis-compras');
    expect(rutaInternaSegura('/p/123?x=1')).toBe('/p/123?x=1');
  });

  it('⚠️ RECHAZA URLs externas: seria un redirector abierto', () => {
    // La victima ve nuestro dominio, se autentica, y termina en un sitio
    // ajeno. Es un vector clasico de phishing.
    expect(rutaInternaSegura('https://sitio-falso.test')).toBe('/');
    expect(rutaInternaSegura('http://sitio-falso.test')).toBe('/');
  });

  it('⚠️ RECHAZA protocol-relative: `//otro` es EXTERNO', () => {
    // El navegador completa el protocolo y sale del sitio, aunque empiece con
    // una barra como cualquier ruta interna.
    expect(rutaInternaSegura('//sitio-falso.test')).toBe('/');
  });

  it('⚠️ RECHAZA la variante con barra invertida', () => {
    expect(rutaInternaSegura('/\\sitio-falso.test')).toBe('/');
  });

  it('cae al destino por defecto si no hay nada', () => {
    expect(rutaInternaSegura(undefined)).toBe('/');
    expect(rutaInternaSegura('')).toBe('/');
    expect(rutaInternaSegura(undefined, '/vendedor')).toBe('/vendedor');
  });
});

describe('horas', () => {
  it('⚠️ menos de una hora NO es "0 h"', () => {
    // Aparecio mirando la ficha de un vendedor que contesta en minutos: el
    // promedio redondeaba a cero y la pantalla decia "responde en ~0 h", que se
    // lee como un dato roto justo donde se quiere mostrar lo contrario.
    expect(horas(0)).toBe('menos de 1 h');
    expect(horas(0.4)).toBe('menos de 1 h');
  });

  it('cuenta horas hasta el dia y dias despues', () => {
    expect(horas(1)).toBe('1 h');
    expect(horas(5.6)).toBe('6 h');
    expect(horas(24)).toBe('1 día');
    expect(horas(26)).toBe('1 día y 2 h');
    expect(horas(48)).toBe('2 días');
  });

  it('un valor negativo no produce una hora negativa', () => {
    expect(horas(-3)).toBe('menos de 1 h');
  });
});
