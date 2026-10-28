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

  it('no cruza un punto de inflexión con un solo arco', () => {
    const s = [...circlePts(0, 0, 5, Math.PI, Math.PI / 2, 12), ...circlePts(0, 10, 5, -Math.PI / 2, 0, 12).slice(1)];
    expect(fitArcs(s, 0.01).filter(m => m.arc).length).toBeGreaterThanOrEqual(2);
  });
});
