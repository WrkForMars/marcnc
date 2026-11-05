import { describe, expect, it } from 'vitest';
import { buildDesign } from '../src/design.js';
import { centerlines } from '../src/input/centerline.js';

const W = 120, H = 80;
/** Máscara W×H: 1 donde `f` es verdadero en el centro del píxel. */
const mask = f => {
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = f(x + 0.5, y + 0.5) ? 1 : 0;
  return a;
};
const ends = l => [l.pts[0], l.pts[l.pts.length - 1]];

describe('centerlines', () => {
  it('una barra gruesa da una sola línea por su centro', () => {
    const g = centerlines(mask((x, y) => x > 10 && x < 100 && y > 30 && y < 38), W, H);
    expect(g).toHaveLength(1);
    expect(g[0].lines).toHaveLength(1); // sin espinas en las esquinas
    const l = g[0].lines[0];
    expect(l.closed).toBe(false);
    // ancho par (8 px): el centro cae medio píxel a un lado
    l.pts.forEach(p => expect(Math.abs(p[1] - 34)).toBeLessThanOrEqual(0.5));
    const xs = ends(l).map(p => p[0]).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(18); expect(xs[1]).toBeGreaterThan(92);
    expect(g[0].width).toBeCloseTo(8, 0);
  });

  it('un anillo da un lazo cerrado sobre el radio medio', () => {
    const g = centerlines(mask((x, y) => { const r = Math.hypot(x - 60, y - 40); return r > 20 && r < 26; }), W, H);
    expect(g).toHaveLength(1);
    expect(g[0].lines).toHaveLength(1);
    const l = g[0].lines[0];
    expect(l.closed).toBe(true);
    l.pts.forEach(([x, y]) => expect(Math.hypot(x - 60, y - 40)).toBeGreaterThan(21.5));
    l.pts.forEach(([x, y]) => expect(Math.hypot(x - 60, y - 40)).toBeLessThan(24.5));
  });

  it('una T da tres tramos que se unen en el cruce', () => {
    const g = centerlines(mask((x, y) => (y > 10 && y < 16 && x > 20 && x < 100) || (x > 57 && x < 63 && y > 10 && y < 70)), W, H);
    expect(g).toHaveLength(1);
    expect(g[0].lines).toHaveLength(3);
    const tips = g[0].lines.flatMap(ends);
    // los tres tramos comparten un punto cerca de (60, 13)
    const near = tips.filter(([x, y]) => Math.hypot(x - 60, y - 13) < 2);
    expect(near).toHaveLength(3);
  });

  it('cada pieza conectada es un grupo aparte, y el ruido se descarta', () => {
    const g = centerlines(mask((x, y) =>
      (x > 10 && x < 50 && y > 10 && y < 14) || (x > 70 && x < 110 && y > 60 && y < 64) // dos trazos
      || (x > 5 && x < 6.5 && y > 70 && y < 71.5)), W, H); // un píxel suelto
    expect(g).toHaveLength(2);
  });

  it('un punto redondo no desaparece', () => {
    const g = centerlines(mask((x, y) => Math.hypot(x - 60, y - 40) < 4), W, H);
    expect(g).toHaveLength(1);
    const [a, b] = ends(g[0].lines[0]);
    expect(Math.hypot((a[0] + b[0]) / 2 - 60, (a[1] + b[1]) / 2 - 40)).toBeLessThan(1.5);
  });

  it('una imagen vacía no da nada', () => {
    expect(centerlines(new Uint8Array(W * H), W, H)).toEqual([]);
  });
});

describe('buildDesign con líneas agrupadas', () => {
  it('las líneas de un grupo forman una sola figura; las sueltas, una cada una', () => {
    const raw = [
      { kind: 'stroke', group: true, lines: [{ pts: [[0, 0], [10, 0]], closed: false }, { pts: [[10, 0], [10, 10]], closed: false }] },
      { kind: 'stroke', lines: [{ pts: [[20, 0], [30, 0]], closed: false }, { pts: [[20, 5], [30, 5]], closed: false }] },
    ];
    const els = buildDesign(raw, { W: 90, H: 50, margin: 3, fit: 'fill', speck: 0.5 }).elements;
    expect(els.map(e => e.parts.length)).toEqual([2, 1, 1]);
    els.forEach(e => { expect(e.type).toBe('line'); expect(e.mode).toBe('line'); });
  });
});
