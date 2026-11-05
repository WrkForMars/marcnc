import { describe, expect, it } from 'vitest';
import { bulgePts, dxfEntities, joinPaths, parseDxf } from '../src/input/dxf.js';

/** Arma un DXF de texto a partir de pares [código, valor]. */
const dxf = (ents, { units = 4, blocks = [] } = {}) => [
  0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, units, 0, 'ENDSEC',
  ...(blocks.length ? [0, 'SECTION', 2, 'BLOCKS', ...blocks, 0, 'ENDSEC'] : []),
  0, 'SECTION', 2, 'ENTITIES', ...ents, 0, 'ENDSEC', 0, 'EOF',
].join('\n');
const line = (x1, y1, x2, y2) => [0, 'LINE', 8, '0', 10, x1, 20, y1, 11, x2, 21, y2];
const bbox = pts => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];

describe('parseDxf', () => {
  it('une líneas sueltas de un contorno (como las exporta SolidWorks) en una figura cerrada', () => {
    const r = parseDxf(dxf([...line(0, 0, 40, 0), ...line(40, 20, 0, 20), ...line(40, 0, 40, 20), ...line(0, 20, 0, 0)]));
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0].closed).toBe(true);
    expect(r.paths[0].pts).toHaveLength(4);
    expect(bbox(r.paths[0].pts)).toEqual([0, 0, 40, 20]);
  });
  it('arcos y líneas forman una ranura cerrada; el arco queda dentro de la tolerancia', () => {
    const arc = (cx, a1, a2) => [0, 'ARC', 10, cx, 20, 5, 40, 5, 50, a1, 51, a2];
    const r = parseDxf(dxf([...line(10, 0, 30, 0), ...arc(30, 270, 90), ...line(30, 10, 10, 10), ...arc(10, 90, 270)]), { tol: 0.01 });
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0].closed).toBe(true);
    const b = bbox(r.paths[0].pts);
    expect(Math.abs(b[0] - 5)).toBeLessThanOrEqual(0.01); expect(Math.abs(b[2] - 35)).toBeLessThanOrEqual(0.01); // flecha ≤ tol
    r.paths[0].pts.filter(p => p[0] > 30.001).forEach(p => expect(Math.hypot(p[0] - 30, p[1] - 5)).toBeCloseTo(5, 6));
  });
  it('círculos quedan como círculos; pulgadas pasan a mm', () => {
    const r = parseDxf(dxf([0, 'CIRCLE', 10, 1, 20, 1, 40, 0.5], { units: 1 }));
    expect(r.circles[0]).toEqual({ cx: 25.4, cy: 25.4, r: 12.7 });
    expect(r.unitName).toBe('pulgadas');
  });
  it('LWPOLYLINE cerrada con abombado (rectángulo con un lado redondo)', () => {
    const r = parseDxf(dxf([0, 'LWPOLYLINE', 90, 4, 70, 1, 10, 0, 20, 0, 10, 20, 20, 0, 42, 1, 10, 20, 20, 10, 10, 0, 20, 10]));
    expect(r.paths[0].closed).toBe(true);
    const b = bbox(r.paths[0].pts);
    expect(Math.abs(b[2] - 25)).toBeLessThanOrEqual(0.01); // medio círculo de radio 5 a la derecha
  });
  it('bloques insertados con escala, giro y traslado', () => {
    const blocks = [0, 'BLOCK', 2, 'B1', 10, 0, 20, 0, ...line(0, 0, 10, 0), 0, 'ENDBLK'];
    const r = parseDxf(dxf([0, 'INSERT', 2, 'B1', 10, 5, 20, 5, 41, 2, 42, 2, 50, 90], { blocks }));
    const p = r.paths[0].pts;
    expect(p[0][0]).toBeCloseTo(5, 9); expect(p[0][1]).toBeCloseTo(5, 9);
    expect(p[1][0]).toBeCloseTo(5, 9); expect(p[1][1]).toBeCloseTo(25, 9);
  });
  it('elipse completa, spline y lo que no se graba (cotas, textos, espacio papel)', () => {
    const r = parseDxf(dxf([
      0, 'ELLIPSE', 10, 0, 20, 0, 11, 10, 21, 0, 40, 0.5, 41, 0, 42, 6.283185307179586,
      0, 'SPLINE', 70, 8, 71, 2, 72, 6, 73, 3, 40, 0, 40, 0, 40, 0, 40, 1, 40, 1, 40, 1, 10, 0, 20, 0, 10, 5, 20, 10, 10, 10, 20, 0,
      0, 'DIMENSION', 1, '20', 0, 'TEXT', 1, 'HOLA', ...[0, 'LINE', 67, 1, 10, 0, 20, 0, 11, 1, 21, 1],
    ]));
    const el = r.paths.find(p => p.closed);
    const b = bbox(el.pts);
    expect(b[2]).toBeCloseTo(10, 2); expect(b[3]).toBeCloseTo(5, 2);
    const sp = r.paths.find(p => !p.closed).pts;
    expect(sp[0]).toEqual([0, 0]); expect(sp.at(-1)[0]).toBeCloseTo(10, 9);
    expect(Math.max(...sp.map(p => p[1]))).toBeCloseTo(5, 2); // Bézier cuadrática: la mitad del control
    expect(r.skipped).toEqual({ cota: 1, texto: 1, 'espacio papel': 1 });
  });
  it('avisa si no es un DXF o si es binario', () => {
    expect(() => parseDxf('hola')).toThrow(/no parece un DXF/);
    expect(() => parseDxf('AutoCAD Binary DXF\r\n')).toThrow(/binario/);
  });
});

describe('bulgePts y joinPaths', () => {
  it('abombado 1 = medio círculo antihorario', () => {
    const pts = bulgePts([0, 0], [2, 0], 1, 0.001);
    pts.forEach(p => expect(Math.hypot(p[0] - 1, p[1])).toBeCloseTo(1, 9));
    expect(Math.min(...pts.map(p => p[1]))).toBeCloseTo(-1, 3); // pasa por abajo
  });
  it('une tramos aunque vengan al revés y deja abierto lo que no cierra', () => {
    const r = joinPaths([{ pts: [[0, 0], [1, 0]], closed: false }, { pts: [[2, 0], [1, 0]], closed: false }, { pts: [[5, 5], [6, 6]], closed: false }], 0.01);
    expect(r.map(p => p.pts.length).sort()).toEqual([2, 3]);
    expect(r.every(p => !p.closed)).toBe(true);
  });
});

describe('dxfEntities', () => {
  const r = parseDxf(dxf([...line(-20, -10, 20, -10), ...line(20, -10, 20, 10), ...line(20, 10, -20, 10), ...line(-20, 10, -20, -10), 0, 'CIRCLE', 10, 0, 20, 0, 40, 3]));
  it('centra en la pieza un dibujo con el origen al centro, a 1:1', () => {
    const o = dxfEntities(r, 90, 50);
    expect(o.moved).toBe(true);
    expect(o.size).toEqual([40, 20]);
    expect(o.entities.find(e => e.type === 'circle')).toMatchObject({ cx: 45, cy: 25, r: 3 });
    expect(o.entities.find(e => e.type === 'line')).toMatchObject({ closed: true });
  });
  it('quita figuras repetidas (un hueco doble se volvería relleno)', () => {
    const o = dxfEntities(parseDxf(dxf([0, 'CIRCLE', 10, 10, 20, 10, 40, 2, 0, 'CIRCLE', 10, 10, 20, 10, 40, 2])), 90, 50);
    expect(o.entities).toHaveLength(1);
  });
  it('respeta las coordenadas si ya cabe en la pieza', () => {
    const o = dxfEntities(parseDxf(dxf(line(5, 5, 15, 5))), 90, 50);
    expect(o.moved).toBe(false);
    expect(o.entities[0].pts).toEqual([[5, 5], [15, 5]]);
  });
});
