import { describe, it, expect } from 'vitest';
import { Graph, segmentObject, resizeMask } from '../src/input/segment.js';

/** Corte mínimo por fuerza bruta: prueba todas las asignaciones. */
function bruteCut(n, edges, tw) {
  let best = Infinity;
  for (let m = 0; m < 1 << n; m++) {
    let c = 0;
    tw.forEach(([s, t], i) => { c += (m >> i) & 1 ? t : s; }); // en la fuente paga t, en el sumidero paga s
    edges.forEach(([i, j, a, b]) => { const si = (m >> i) & 1, sj = (m >> j) & 1; if (si && !sj) c += a; if (sj && !si) c += b; });
    best = Math.min(best, c);
  }
  return best;
}
const cutOf = (lab, edges, tw) => {
  let c = 0;
  tw.forEach(([s, t], i) => { c += lab[i] ? t : s; });
  edges.forEach(([i, j, a, b]) => { if (lab[i] && !lab[j]) c += a; if (lab[j] && !lab[i]) c += b; });
  return c;
};

describe('corte mínimo', () => {
  it('da el corte de costo mínimo en grafos al azar', () => {
    let s = 3;
    const r = k => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % k);
    for (let trial = 0; trial < 200; trial++) {
      const n = 2 + r(8), edges = [], tw = [];
      for (let i = 0; i < n; i++) tw.push([r(10), r(10)]);
      for (let e = 0; e < n * 2; e++) { const i = r(n), j = r(n); if (i !== j) edges.push([i, j, r(8), r(8)]); }
      const G = new Graph(n, edges.length * 2);
      tw.forEach(([a, b], i) => G.addTWeights(i, a, b));
      edges.forEach(([i, j, a, b]) => G.addEdge(i, j, a, b));
      expect(cutOf(G.maxflow(), edges, tw)).toBe(bruteCut(n, edges, tw));
    }
  });
});

/** Foto sintética: objeto claro sobre un fondo revuelto, con ruido. */
function scene(W, H, inside) {
  const d = new Uint8ClampedArray(W * H * 4);
  let s = 9;
  const noise = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % 21) - 10;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = 4 * (y * W + x);
    let c;
    if (inside(x, y)) c = [235, 238, 245];
    else if (x < W * 0.3) c = [30, 30, 32];                // sillas negras
    else if (y > H * 0.6) c = [190, 190, 185];             // piso gris claro
    else c = [215, 205, 150];                              // pared amarilla
    d[i] = c[0] + noise(); d[i + 1] = c[1] + noise(); d[i + 2] = c[2] + noise(); d[i + 3] = 255;
  }
  return d;
}

describe('separar objeto', () => {
  const W = 200, H = 160;
  const disk = (x, y) => (x - 110) ** 2 + (y - 90) ** 2 < 40 ** 2;
  it('con un toque separa el objeto del fondo revuelto', () => {
    const m = segmentObject(scene(W, H, disk), W, H, { seeds: [{ x: 110, y: 90, fg: true }] });
    let inter = 0, uni = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = m[y * W + x], b = disk(x, y) ? 1 : 0; inter += a & b; uni += a | b; }
    expect(inter / uni).toBeGreaterThan(0.95);
  });
  it('sin toques del objeto no devuelve nada', () => {
    const m = segmentObject(scene(W, H, disk), W, H, { seeds: [] });
    expect(m.reduce((a, v) => a + v, 0)).toBe(0);
  });
  it('un toque de fondo quita lo pegado del mismo color', () => {
    // un disco con una "mano" del mismo color pegada a la derecha
    const shape = (x, y) => disk(x, y) || (x > 140 && x < 190 && y > 82 && y < 98);
    const img = scene(W, H, shape);
    const one = segmentObject(img, W, H, { seeds: [{ x: 110, y: 90, fg: true }] });
    expect(one[90 * W + 175]).toBe(1);
    const two = segmentObject(img, W, H, { seeds: [{ x: 110, y: 90, fg: true }, { x: 175, y: 90, fg: false }] });
    expect(two[90 * W + 175]).toBe(0);
    expect(two[90 * W + 110]).toBe(1);
  });
  it('agranda la máscara sin moverla', () => {
    const m = new Uint8Array(16); m[5] = m[6] = m[9] = m[10] = 1; // cuadro central de 4×4
    const big = resizeMask(m, 4, 4, 8, 8);
    expect(big[3 * 8 + 3]).toBe(1); expect(big[0]).toBe(0); expect(big.reduce((a, v) => a + v, 0)).toBe(16);
  });
});
