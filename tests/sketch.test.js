import { describe, expect, it } from 'vitest';
import { fromC } from '../src/geometry/clipper.js';
import { entityPts, hitEntity, parseNum, parsePoint, sketchElements, snap, translate } from '../src/sketch/geometry.js';

const rect = (id, x, y, w, h) => ({ id, type: 'rect', x, y, w, h });
const circle = (id, cx, cy, r) => ({ id, type: 'circle', cx, cy, r });

describe('entityPts', () => {
  it('un rectángulo con ancho o alto negativo da las mismas esquinas', () => {
    expect(entityPts(rect(1, 10, 10, -4, -2)).pts).toEqual(entityPts(rect(1, 6, 8, 4, 2)).pts);
  });

  it('el círculo no se aleja de su radio más que la tolerancia', () => {
    const { pts, closed } = entityPts(circle(1, 5, 5, 10), 0.01);
    expect(closed).toBe(true);
    pts.forEach(([x, y]) => expect(Math.hypot(x - 5, y - 5)).toBeCloseTo(10, 9));
    // la flecha de cada cuerda cabe en la tolerancia
    const a = pts[0], b = pts[1];
    expect(10 - Math.hypot((a[0] + b[0]) / 2 - 5, (a[1] + b[1]) / 2 - 5)).toBeLessThanOrEqual(0.01);
  });

  it('el arco va de a1 a a2 en sentido antihorario, aunque cruce 0°', () => {
    const { pts, closed } = entityPts({ id: 1, type: 'arc', cx: 0, cy: 0, r: 10, a1: 270, a2: 90 });
    expect(closed).toBe(false);
    expect(pts[0][0]).toBeCloseTo(0, 9); expect(pts[0][1]).toBeCloseTo(-10, 9);
    expect(pts.at(-1)[1]).toBeCloseTo(10, 9);
    expect(Math.max(...pts.map(p => p[0]))).toBeCloseTo(10, 6); // pasa por la derecha (0°)
  });

  it('el polígono regular pone su primer vértice en el ángulo indicado', () => {
    const { pts } = entityPts({ id: 1, type: 'poly', cx: 0, cy: 0, r: 5, n: 6, rot: 90 });
    expect(pts).toHaveLength(6);
    expect(pts[0][0]).toBeCloseTo(0, 9); expect(pts[0][1]).toBeCloseTo(5, 9);
  });
});

describe('parsePoint', () => {
  it('lee coordenadas absolutas con espacio, punto y coma o coma', () => {
    expect(parsePoint('10 20')).toEqual([10, 20]);
    expect(parsePoint('10;20')).toEqual([10, 20]);
    expect(parsePoint('10.5,20')).toEqual([10.5, 20]);
    expect(parsePoint('10,5 20')).toEqual([10.5, 20]); // coma decimal
  });

  it('lee relativas y polares a partir del último punto', () => {
    expect(parsePoint('@5 -2', [10, 10])).toEqual([15, 8]);
    const [x, y] = parsePoint('@10<90', [1, 1]);
    expect(x).toBeCloseTo(1, 9); expect(y).toBeCloseTo(11, 9);
  });

  it('rechaza lo que no es un punto', () => {
    expect(parsePoint('')).toBeNull();
    expect(parsePoint('hola')).toBeNull();
    expect(parsePoint('1 2 3')).toBeNull();
    expect(parseNum('2,5')).toBe(2.5);
    expect(parseNum('2x')).toBeNull();
  });
});

describe('snap', () => {
  const ents = [rect(1, 10, 10, 20, 10)];
  it('prefiere un vértice cercano a la cuadrícula', () => {
    expect(snap([10.3, 9.8], ents, { grid: 1, snap: true, tol: 1 })).toEqual({ p: [10, 10], kind: 'extremo' });
  });
  it('si no hay nada cerca, redondea a la cuadrícula', () => {
    expect(snap([3.3, 7.8], ents, { grid: 0.5, snap: true, tol: 1 }).p).toEqual([3.5, 8]);
  });
  it('sin imán deja el punto tal cual', () => {
    expect(snap([3.3, 7.8], ents, { grid: 1, snap: false, tol: 1 }).p).toEqual([3.3, 7.8]);
  });
});

describe('hitEntity y translate', () => {
  it('encuentra la figura cuyo trazo está cerca', () => {
    const ents = [rect(1, 0, 0, 10, 10), circle(2, 30, 5, 3)];
    expect(hitEntity(ents, [10.2, 5], 0.5).id).toBe(1);
    expect(hitEntity(ents, [33, 5.1], 0.5).id).toBe(2);
    expect(hitEntity(ents, [5, 5], 0.5)).toBeNull(); // el centro del rectángulo no es su trazo
  });
  it('mueve cada tipo de figura', () => {
    expect(translate(rect(1, 0, 0, 2, 2), 3, 4)).toMatchObject({ x: 3, y: 4 });
    expect(translate(circle(1, 0, 0, 2), 3, 4)).toMatchObject({ cx: 3, cy: 4 });
    expect(translate({ id: 1, type: 'line', pts: [[0, 0], [1, 1]], closed: false }, 1, 1).pts).toEqual([[1, 1], [2, 2]]);
  });
});

describe('sketchElements', () => {
  it('un círculo dentro de un rectángulo es su hueco', () => {
    const els = sketchElements([rect(1, 0, 0, 40, 20), circle(2, 20, 10, 5)]);
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ src: 'sketch', type: 'region', sketchId: 1, mode: 'fill', label: 'Rectángulo' });
    expect(els[0].parts[0].holes).toHaveLength(1);
    expect(els[0].detail).toBe('40 × 20 mm · 1 hueco');
  });

  it('una figura dentro de un hueco vuelve a ser figura (isla)', () => {
    const els = sketchElements([rect(1, 0, 0, 40, 40), circle(2, 20, 20, 15), circle(3, 20, 20, 5)]);
    expect(els.map(e => e.sketchId).sort()).toEqual([1, 3]);
  });

  it('las figuras separadas son elementos aparte y las abiertas se graban como trazo', () => {
    const els = sketchElements([
      rect(1, 0, 0, 10, 10), rect(2, 20, 0, 10, 10),
      { id: 3, type: 'line', pts: [[0, 20], [30, 20]], closed: false },
      { id: 4, type: 'arc', cx: 50, cy: 10, r: 5, a1: 0, a2: 180 },
    ]);
    expect(els.map(e => [e.sketchId, e.type])).toEqual([[1, 'region'], [2, 'region'], [3, 'line'], [4, 'line']]);
  });

  it('conserva el modo elegido para cada figura', () => {
    const els = sketchElements([rect(7, 0, 0, 10, 10), { id: 8, type: 'line', pts: [[0, 20], [5, 20]], closed: false }], { 7: 'contour', 8: 'skip' });
    expect(els.map(e => e.mode)).toEqual(['contour', 'skip']);
  });

  it('las coordenadas del croquis son las de la pieza, en mm', () => {
    const [e] = sketchElements([rect(1, 5, 5, 10, 4)]);
    const xs = fromC(e.parts[0].outer).map(p => p[0]), ys = fromC(e.parts[0].outer).map(p => p[1]);
    expect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]).toEqual([5, 5, 15, 9]);
  });
});
