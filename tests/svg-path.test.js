import { describe, expect, it } from 'vitest';
import { parsePathD, shapeToD } from '../src/input/svg-path.js';

const fakeEl = (tag, attrs) => ({
  tagName: tag,
  getAttribute: k => (k in attrs ? String(attrs[k]) : null),
  hasAttribute: k => k in attrs,
});

describe('parsePathD', () => {
  it('lee comandos absolutos y cierra la figura', () => {
    const [p] = parsePathD('M0 0 L10 0 L10 5 L0 5 Z');
    expect(p.closed).toBe(true);
    expect(p.pts).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
  });

  it('lee comandos relativos, H/V y L implícitas después de M', () => {
    const [p] = parsePathD('m10 10 5 0 v5 h-5 z');
    expect(p.pts).toEqual([[10, 10], [15, 10], [15, 15], [10, 15]]);
  });

  it('separa subtrayectorias (contorno y hueco)', () => {
    const subs = parsePathD('M0 0H10V10H0Z M3 3H7V7H3Z');
    expect(subs).toHaveLength(2);
    expect(subs.every(s => s.closed)).toBe(true);
  });

  it('discretiza un arco con el sentido correcto (sweep-flag)', () => {
    // medio círculo de (0,0) a (10,0) con radio 5: sweep=1 pasa por y<0 en coordenadas SVG (Y hacia abajo)
    const [up] = parsePathD('M0 0 A5 5 0 0 1 10 0', 0.5);
    const [down] = parsePathD('M0 0 A5 5 0 0 0 10 0', 0.5);
    const minY = pts => Math.min(...pts.map(p => p[1]));
    const maxY = pts => Math.max(...pts.map(p => p[1]));
    expect(minY(up.pts)).toBeCloseTo(-5, 1);
    expect(maxY(down.pts)).toBeCloseTo(5, 1);
    up.pts.forEach(([x, y]) => expect(Math.hypot(x - 5, y)).toBeCloseTo(5, 6));
  });

  it('pasa por los extremos de una curva cúbica', () => {
    const [p] = parsePathD('M0 0 C0 10 10 10 10 0');
    expect(p.pts[0]).toEqual([0, 0]);
    expect(p.pts.at(-1)[0]).toBeCloseTo(10, 9);
    expect(p.pts.at(-1)[1]).toBeCloseTo(0, 9);
  });
});

describe('shapeToD', () => {
  it('convierte un círculo en un contorno cerrado de radio constante', () => {
    const [p] = parsePathD(shapeToD(fakeEl('circle', { cx: 20, cy: 10, r: 4 })), 0.2);
    expect(p.closed).toBe(true);
    p.pts.forEach(([x, y]) => expect(Math.hypot(x - 20, y - 10)).toBeCloseTo(4, 6));
  });

  it('convierte rectángulos con y sin esquinas redondeadas', () => {
    expect(shapeToD(fakeEl('rect', { x: 1, y: 2, width: 3, height: 4 }))).toBe('M1 2H4V6H1Z');
    const [p] = parsePathD(shapeToD(fakeEl('rect', { x: 0, y: 0, width: 10, height: 6, rx: 2 })), 0.2);
    const xs = p.pts.map(q => q[0]), ys = p.pts.map(q => q[1]);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(10, 6);
    expect(Math.max(...ys)).toBeCloseTo(6, 6);
  });

  it('cierra polygon y deja abierta polyline', () => {
    expect(shapeToD(fakeEl('polygon', { points: '0,0 4,0 4,4' }))).toBe('M0 0L4 0L4 4Z');
    expect(shapeToD(fakeEl('polyline', { points: '0 0 4 0 4 4' }))).toBe('M0 0L4 0L4 4');
  });
});

describe('discretización por tolerancia', () => {
  // distancia máxima de la curva real a la polilínea, muestreando la curva fina
  const maxDev = (fine, pts) => Math.max(...fine.map(p => Math.min(...pts.slice(1).map((b, i) => {
    const a = pts[i], L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2));
    return Math.hypot(p[0] - a[0] - t * (b[0] - a[0]), p[1] - a[1] - t * (b[1] - a[1]));
  }))));

  it('ninguna curva se aleja más de la tolerancia', () => {
    for (const d of ['M0 0 C0 40 60 40 60 0', 'M0 0 Q30 50 60 0', 'M0 0 A30 20 0 0 1 60 0']) {
      const fine = parsePathD(d, 0.0005)[0].pts;
      for (const tol of [1, 0.2, 0.05]) expect(maxDev(fine, parsePathD(d, tol)[0].pts)).toBeLessThanOrEqual(tol * 1.02);
    }
  });

  it('menos tolerancia da más puntos, y un tramo recto escrito como curva da uno solo', () => {
    const d = 'M0 0 C0 40 60 40 60 0';
    expect(parsePathD(d, 0.05)[0].pts.length).toBeGreaterThan(parsePathD(d, 0.5)[0].pts.length);
    expect(parsePathD('M0 0 C10 0 20 0 30 0', 0.01)[0].pts).toHaveLength(2);
  });
});
