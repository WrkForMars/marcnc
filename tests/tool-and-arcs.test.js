import { describe, expect, it } from 'vitest';
import { fitArcs } from '../src/cam/arcs.js';
import { toolGeometry } from '../src/cam/tool.js';

describe('toolGeometry', () => {
  it('ball mill de 1/8": el ancho depende de la profundidad', () => {
    // valores calculados para la placa de la tarea
    expect(toolGeometry({ toolType: 'ball', dia: 3.175, depth: 0.1 }).w).toBeCloseTo(1.109, 3);
    expect(toolGeometry({ toolType: 'ball', dia: 3.175, depth: 0.15 }).w).toBeCloseTo(1.347, 3);
    expect(toolGeometry({ toolType: 'ball', dia: 3.175, depth: 0.2 }).w).toBeCloseTo(1.543, 3);
  });

  it('ball mill más profunda que su radio corta el diámetro completo', () => {
    expect(toolGeometry({ toolType: 'ball', dia: 3.175, depth: 2 }).w).toBeCloseTo(3.175, 6);
  });

  it('fresa plana corta su diámetro; V-bit según ángulo y punta', () => {
    expect(toolGeometry({ toolType: 'flat', dia: 1, depth: 0.15 }).w).toBe(1);
    const v = toolGeometry({ toolType: 'v', dia: 6, depth: 0.1, vAngle: 60, vTip: 0.1 });
    expect(v.w).toBeCloseTo(0.1 + 2 * 0.1 * Math.tan(Math.PI / 6), 6);
  });

  it('el paso de vaciado es un porcentaje del ancho de línea', () => {
    const t = toolGeometry({ toolType: 'flat', dia: 2, depth: 0.1, stepoverPct: 40 });
    expect(t.step).toBeCloseTo(0.8, 6);
  });
});

describe('fitArcs', () => {
  const circlePts = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, k) => {
    const a = a0 + (a1 - a0) * k / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

  it('agrupa puntos de un cuarto de círculo en un solo arco antihorario', () => {
    const moves = fitArcs(circlePts(10, 10, 5, 0, Math.PI / 2, 24), 0.01);
    expect(moves).toHaveLength(1);
    expect(moves[0].arc).toBe(true);
    expect(moves[0].ccw).toBe(true);
    expect(moves[0].c[0]).toBeCloseTo(10, 6);
    expect(moves[0].c[2]).toBeCloseTo(5, 6);
  });

  it('detecta el sentido horario', () => {
    const moves = fitArcs(circlePts(0, 0, 5, Math.PI / 2, 0, 24), 0.01);
    expect(moves[0].arc && moves[0].ccw).toBe(false);
  });

  it('no convierte líneas rectas en arcos', () => {
    const moves = fitArcs([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 0.01);
    expect(moves.every(m => !m.arc)).toBe(true);
  });

  it('no convierte un rectángulo en círculo aunque sus esquinas caigan en una circunferencia', () => {
    // las 4 esquinas están exactamente sobre el círculo de centro (5, 5); los lados rectos no
    const sq = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    expect(fitArcs(sq, 0.05).every(m => !m.arc)).toBe(true);
    // orilla recta larga de un contorno redondeado: tampoco se vuelve un arco grande que sale de la pieza
    const loop = [...circlePts(50, 10, 2, -Math.PI / 2, 0, 6), ...circlePts(50, 30, 2, 0, Math.PI / 2, 6).slice(0), ...circlePts(10, 30, 2, Math.PI / 2, Math.PI, 6), ...circlePts(10, 10, 2, Math.PI, 1.5 * Math.PI, 6)];
    fitArcs(loop, 0.05).filter(m => m.arc).forEach(m => expect(m.c[2]).toBeLessThan(3)); // solo las esquinas (r = 2)
  });

  it('cada arco queda cerca de la polilínea original también entre vértices (a 1.25·tol: la polilínea ya aproxima la curva)', () => {
    const pts = [...circlePts(0, 0, 20, 0, Math.PI / 3, 3), [30, 30], [40, 25]];
    const tol = 0.05;
    let i = 0;
    fitArcs(pts, tol).forEach(m => {
      const j = pts.indexOf(m.to);
      if (m.arc) for (let k = i; k < j; k++) {
        const ch = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
        expect(m.c[2] - Math.sqrt(m.c[2] ** 2 - ch * ch / 4)).toBeLessThanOrEqual(1.25 * tol);
      }
      i = j;
    });
  });

  it('no cruza un punto de inflexión con un solo arco', () => {
    const s = [...circlePts(0, 0, 5, Math.PI, Math.PI / 2, 12), ...circlePts(0, 10, 5, -Math.PI / 2, 0, 12).slice(1)];
    expect(fitArcs(s, 0.01).filter(m => m.arc).length).toBeGreaterThanOrEqual(2);
  });
});
