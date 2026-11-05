import { describe, expect, it } from 'vitest';
import { buildDesign } from '../src/design.js';
import { fromC } from '../src/geometry/clipper.js';
import { glyph, hersheyText } from '../src/text/hershey.js';
import { square } from './helpers.js';

const P = { W: 90, H: 50, margin: 3, fit: 'fill', speck: 0.5 };
const bounds = els => {
  const pts = els.flatMap(e => (e.type === 'line' ? e.parts.flatMap(p => p.pts) : e.parts.flatMap(p => fromC(p.outer))));
  return [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
};

describe('buildDesign', () => {
  it('ajusta el dibujo a la pieza respetando el margen', () => {
    const raw = [{ kind: 'fill', white: false, rule: 'nonzero', rings: [square(0, 0, 200)] }];
    const [x0, y0, x1, y1] = bounds(buildDesign(raw, P).elements);
    expect(y0).toBeCloseTo(3, 2); expect(y1).toBeCloseTo(47, 2); // el alto limita: 50 − 2·3
    expect((x0 + x1) / 2).toBeCloseTo(45, 2);
  });

  it('con ancho fijo escala al ancho pedido, conserva la proporción y centra en la pieza', () => {
    const raw = [{ kind: 'fill', white: false, rule: 'nonzero', rings: [[[0, 0], [200, 0], [200, 100], [0, 100]]] }];
    const r = buildDesign(raw, { ...P, fit: 'width', drawW: 30 });
    expect(r.size[0]).toBeCloseTo(30, 9); expect(r.size[1]).toBeCloseTo(15, 9);
    const [x0, y0, x1, y1] = bounds(r.elements);
    expect([x0, y0, x1, y1].map(v => +v.toFixed(3))).toEqual([30, 17.5, 60, 32.5]);
    // más grande que la pieza: se respeta (la interfaz avisa que se sale)
    expect(buildDesign(raw, { ...P, fit: 'width', drawW: 120 }).size[0]).toBeCloseTo(120, 9);
  });

  it('informa cuántos mm mide una unidad de lienzo', () => {
    const raw = [{ kind: 'fill', white: false, rule: 'nonzero', rings: [square(0, 0, 200)] }];
    expect(buildDesign(raw, P).scale).toBeCloseTo(44 / 200, 9); // el alto limita: 50 − 2·3
    const nat = Object.assign([{ kind: 'fill', white: false, rule: 'nonzero', rings: [square(0, 0, 200)] }], { native: { unit: 10, h: 50 } });
    expect(buildDesign(nat, { ...P, fit: 'native' }).scale).toBe(0.1);
  });

  it('a escala 1:1 respeta las unidades del SVG y voltea Y', () => {
    // 10 px por unidad; un cuadrado en (10,10)-(20,20) unidades de un viewBox de 50 de alto
    const raw = Object.assign([{ kind: 'fill', white: false, rule: 'nonzero', rings: [square(100, 100, 100)] }], { native: { unit: 10, h: 50 } });
    const [x0, y0, x1, y1] = bounds(buildDesign(raw, { ...P, fit: 'native' }).elements);
    expect([x0, y0, x1, y1].map(v => +v.toFixed(3))).toEqual([10, 30, 20, 40]);
  });

  it('una figura blanca encima recorta a la de abajo', () => {
    const raw = [
      { kind: 'fill', white: false, rule: 'nonzero', rings: [square(0, 0, 100)] },
      { kind: 'fill', white: true, rule: 'nonzero', rings: [square(25, 25, 50)] },
    ];
    const els = buildDesign(raw, P).elements;
    expect(els).toHaveLength(1);
    expect(els[0].parts[0].holes).toHaveLength(1);
  });

  it('descarta manchas menores al mínimo', () => {
    const raw = [{ kind: 'fill', white: false, rule: 'nonzero', rings: [square(0, 0, 100), square(150, 0, 1)] }];
    expect(buildDesign(raw, P).elements).toHaveLength(1);
  });

  it('conserva los modos elegidos si se reconstruye con la misma cantidad de figuras', () => {
    const raw = [{ kind: 'fill', white: false, rule: 'nonzero', rings: [square(0, 0, 10), square(20, 0, 10)] }];
    const first = buildDesign(raw, P).elements;
    first[1].mode = 'contour';
    expect(buildDesign(raw, { ...P, W: 100 }, first).elements[1].mode).toBe('contour');
  });
});

describe('texto de una línea', () => {
  it('la altura de mayúscula sale en mm y centrada en 0', () => {
    const strokes = hersheyText({ text: 'H', font: 'futural', h: 10 });
    const ys = strokes.flatMap(s => s.pts.map(p => p[1]));
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(10, 6);
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(0, 6);
  });

  it('compone acentos, ñ y signos de apertura', () => {
    expect(glyph('futural', 'ñ')[1].length).toBe(glyph('futural', 'n')[1].length + 1);
    expect(glyph('futural', 'á')[1].length).toBe(glyph('futural', 'a')[1].length + 1);
    expect(glyph('futural', '¿')[1].length).toBe(glyph('futural', '?')[1].length);
    expect(glyph('futural', '€')).toEqual(glyph('futural', '?'));
  });

  it('el espaciado extra ensancha el texto', () => {
    const width = sp => { const xs = hersheyText({ text: 'ABC', font: 'futural', h: 5, sp }).flatMap(s => s.pts.map(p => p[0])); return Math.max(...xs) - Math.min(...xs); };
    expect(width(50)).toBeGreaterThan(width(0));
  });
});
