import { describe, expect, it } from 'vitest';

import type { CatalogRow } from '../repositories/catalog.repository';
import { normalizar, resolverPorNombre } from './catalogo-por-nombre';

/**
 * Resolver un item de catalogo por lo que la persona escribio.
 *
 * Los casos que fija este archivo son los que pidio el owner el 2026-11-10
 * —"river" tiene que traer River Plate, "Newbalance" tiene que traer New
 * Balance— y, sobre todo, los que NO se pueden resolver solos: adivinar entre
 * dos clubes parecidos ensucia el catalogo para siempre.
 */

const fila = (name: string, aliases: string[] | null = null): CatalogRow => ({
  id: `id-${name}`,
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  aliases,
});

/** Los nombres y alias son los que siembra la migracion `0007`. */
const CLUBES = [
  fila('River Plate', ['River', 'CARP', 'Millonario', 'Riber']),
  fila('Boca Juniors', ['Boca', 'Xeneize']),
  fila('Racing Club', ['Racing', 'La Academia']),
  fila('Independiente', ['El Rojo']),
  fila('Manchester United', ['Man United', 'ManU']),
  fila('Manchester City', ['Man City']),
];

const MARCAS = [fila('New Balance', ['NB']), fila('Nike'), fila('Adidas'), fila('Puma')];

describe('normalizar', () => {
  it('⚠️ SACA LOS ESPACIOS: es lo que hace que "Newbalance" encuentre "New Balance"', () => {
    expect(normalizar('New Balance')).toBe('newbalance');
    expect(normalizar('Newbalance')).toBe('newbalance');
    expect(normalizar('  NEW   balance ')).toBe('newbalance');
  });

  it('saca tildes y puntuacion', () => {
    expect(normalizar('Atlético')).toBe('atletico');
    expect(normalizar('C.A.R.P.')).toBe('carp');
    expect(normalizar('Saint-Étienne')).toBe('saintetienne');
  });

  it('⚠️ LA EÑE SIGUE SIENDO UNA N, no se convierte en otra letra', () => {
    expect(normalizar('Niño')).toBe('nino');
  });
});

describe('lo que el owner pidio', () => {
  it('"river" trae River Plate', () => {
    const r = resolverPorNombre('river', CLUBES);

    expect(r.tipo).toBe('encontrado');
    expect(r.tipo === 'encontrado' && r.fila.name).toBe('River Plate');
  });

  it('"Newbalance" trae New Balance', () => {
    const r = resolverPorNombre('Newbalance', MARCAS);

    expect(r.tipo).toBe('encontrado');
    expect(r.tipo === 'encontrado' && r.fila.name).toBe('New Balance');
  });
});

describe('coincidencia exacta', () => {
  it('el texto que manda el datalist al elegir de la lista resuelve directo', () => {
    // Es el camino normal: la persona eligio y el navegador mando el nombre.
    const r = resolverPorNombre('Boca Juniors', CLUBES);

    expect(r.tipo === 'encontrado' && r.fila.name).toBe('Boca Juniors');
  });

  it('un alias resuelve igual que el nombre', () => {
    expect(resolverPorNombre('Xeneize', CLUBES)).toMatchObject({ tipo: 'encontrado' });
    expect(resolverPorNombre('CARP', CLUBES)).toMatchObject({ tipo: 'encontrado' });
    expect(resolverPorNombre('NB', MARCAS)).toMatchObject({ tipo: 'encontrado' });
  });
});

describe('⚠️ lo que NO se resuelve solo', () => {
  it('"manchester" NO elige: son dos y se pregunta', () => {
    // Adivinar aca manda una camiseta del City al United para siempre.
    const r = resolverPorNombre('manchester', CLUBES);

    expect(r.tipo).toBe('sugerencias');
    expect(r.tipo === 'sugerencias' && r.opciones.map((o) => o.name)).toEqual([
      'Manchester United',
      'Manchester City',
    ]);
  });

  it('⚠️ "united" NO resuelve aunque hoy haya UNO SOLO', () => {
    // Que sea unico hoy es una casualidad del catalogo sembrado: mañana se
    // siembra otro club con "united" y la misma publicacion habria elegido
    // distinto. Una coincidencia por el medio de la palabra se pregunta.
    const r = resolverPorNombre('united', CLUBES);

    expect(r.tipo).toBe('sugerencias');
    expect(r.tipo === 'sugerencias' && r.opciones.map((o) => o.name)).toEqual([
      'Manchester United',
    ]);
  });

  it('un typo sugiere, no elige', () => {
    const r = resolverPorNombre('indepediente', CLUBES);

    expect(r.tipo).toBe('sugerencias');
    expect(r.tipo === 'sugerencias' && r.opciones[0]?.name).toBe('Independiente');
  });

  it('"oca" sugiere Boca y no lo elige: es una subcadena, no una coincidencia', () => {
    // Lo agarra la pasada de "contiene" antes que la de typos. Y esta bien que
    // sugiera: lo que no puede hacer es elegir.
    const r = resolverPorNombre('oca', CLUBES);

    expect(r.tipo).toBe('sugerencias');
    expect(r.tipo === 'sugerencias' && r.opciones[0]?.name).toBe('Boca Juniors');
  });

  it('⚠️ CON TEXTOS CORTOS NO SE PERDONA NINGUNA LETRA: "mike" no es "Nike"', () => {
    // Con una tolerancia fija de 1, cuatro letras alcanzan para confundir dos
    // marcas distintas. Por eso la tolerancia arranca en CERO y escala con el
    // largo: hasta cuatro caracteres se exige prefijo o subcadena, no parecido.
    const r = resolverPorNombre('mike', MARCAS);

    expect(r.tipo).toBe('sin-coincidencias');
  });
});

describe('sin coincidencias: recien ahi se propone un alta (DEC-041)', () => {
  it('un club que no esta en el catalogo devuelve el texto tal como se escribio', () => {
    const r = resolverPorNombre('  Deportivo Morón  ', CLUBES);

    expect(r.tipo).toBe('sin-coincidencias');
    // Recortado, pero SIN normalizar: lo que se propone es el nombre que la
    // persona escribio, no "deportivomoron".
    expect(r.tipo === 'sin-coincidencias' && r.texto).toBe('Deportivo Morón');
  });

  it('vacio no es una propuesta: es no haber elegido', () => {
    expect(resolverPorNombre('', CLUBES)).toMatchObject({ tipo: 'vacio' });
    expect(resolverPorNombre('   ', CLUBES)).toMatchObject({ tipo: 'vacio' });
  });
});
