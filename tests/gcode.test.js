import { describe, expect, it } from 'vitest';
import { generateGcode } from '../src/cam/gcode.js';
import { computePlan } from '../src/cam/plan.js';
import { toolGeometry } from '../src/cam/tool.js';
import { BALL_1_8, TAREA, hole, lineEl, parseMoves, regionEl, square } from './helpers.js';

// pieza de prueba: un marco con hueco, un círculo (para arcos) y un trazo abierto
function piece() {
  const circle = Array.from({ length: 72 }, (_, k) => [70 + 8 * Math.cos(k * Math.PI / 36), 25 + 8 * Math.sin(k * Math.PI / 36)]);
  return [
    regionEl(square(5, 5, 30), [hole(12, 12, 16)], 'invert'),
    regionEl(circle, [], 'contour'),
    lineEl([[5, 45], [40, 45], [60, 42]]),
  ];
}
async function program(tool = BALL_1_8, opts = {}) {
  const elements = piece();
  const tl = toolGeometry(tool);
  const plan = await computePlan(elements, tl, { tol: 0.05 });
  return generateGcode(plan, elements, { ...TAREA, ...opts });
}

describe('parámetros de la tarea', () => {
  it('usa T3, S2200, F60 en Z, F130 en XY, retracción Z3 y profundidad 0.1', async () => {
    const g = await program();
    expect(g.text).toContain('T3 M06');
    expect(g.text).toContain('S2200 M03');
    const moves = parseMoves(g.text);
    const plunges = moves.filter(m => m.g === 1 && m.to[2] < 0 && m.from[2] !== m.to[2]);
    expect(plunges.length).toBeGreaterThan(0);
    plunges.forEach(m => expect(m.F).toBe(60));
    moves.filter(m => (m.g === 1 || m.g === 2 || m.g === 3) && m.to[2] < 0 && m.from[2] === m.to[2])
      .forEach(m => expect(m.F).toBe(130));
    moves.filter(m => m.g === 0 && m.from[2] !== m.to[2]).forEach(m => expect(m.to[2]).toBe(3));
    new Set(moves.filter(m => m.to[2] < 0).map(m => m.to[2])).forEach(z => expect(z).toBe(-0.1));
  });

  it('nunca se mueve en X-Y con la herramienta abajo usando G00', async () => {
    const moves = parseMoves((await program()).text);
    moves.filter(m => m.g === 0).forEach(m => {
      const xyMove = m.from[0] !== m.to[0] || m.from[1] !== m.to[1];
      if (xyMove) expect(m.from[2]).toBeGreaterThan(0);
    });
  });

  it('todas las coordenadas quedan dentro de la pieza', async () => {
    parseMoves((await program()).text).forEach(m => {
      expect(m.to[0]).toBeGreaterThanOrEqual(0); expect(m.to[0]).toBeLessThanOrEqual(90);
      expect(m.to[1]).toBeGreaterThanOrEqual(0); expect(m.to[1]).toBeLessThanOrEqual(50);
    });
  });

  it('empieza con encabezado Fanuc y termina con M05, G28 y M30', async () => {
    const lines = (await program()).text.trim().split('\n');
    expect(lines[0]).toBe('%');
    expect(lines[1]).toMatch(/^O0001/);
    expect(lines.slice(-5)).toEqual(['M05', 'G28 G91 Z0', 'G90', 'M30', '%']);
  });
});

describe('arcos', () => {
  const radiusError = text => {
    let worst = 0;
    parseMoves(text).filter(m => m.g === 2 || m.g === 3).forEach(m => {
      const cx = m.from[0] + m.I, cy = m.from[1] + m.J;
      worst = Math.max(worst, Math.abs(Math.hypot(m.from[0] - cx, m.from[1] - cy) - Math.hypot(m.to[0] - cx, m.to[1] - cy)));
    });
    return worst;
  };

  it('con 2 decimales el radio al inicio y al final difiere menos de 0.01 mm', async () => {
    const g = await program();
    expect(g.arcsN).toBeGreaterThan(0);
    expect(radiusError(g.text)).toBeLessThan(0.01);
  });

  it('con 3 decimales difiere menos de 0.002 mm', async () => {
    expect(radiusError((await program(BALL_1_8, { dec: 3 })).text)).toBeLessThan(0.002);
  });

  it('con 1 decimal no escribe arcos', async () => {
    expect((await program(BALL_1_8, { dec: 1 })).text).not.toMatch(/^G0[23]/m);
  });
});

describe('pasadas y controlador', () => {
  it('divide la profundidad en pasadas iguales', async () => {
    const g = await program({ ...BALL_1_8, depth: 0.5, stepdown: 0.2 });
    expect(g.passes).toBe(3);
    const zs = [...new Set(parseMoves(g.text).filter(m => m.to[2] < 0).map(m => m.to[2]))].sort((a, b) => b - a);
    expect(zs).toEqual([-0.17, -0.33, -0.5]);
  });

  it('GRBL: sin %, sin número de programa, sin M06 ni G28', async () => {
    const t = (await program(BALL_1_8, { dialect: 'grbl' })).text;
    expect(t).not.toMatch(/^%/m);
    expect(t).not.toMatch(/^O\d/m);
    expect(t).not.toMatch(/M06|G28/);
    expect(t.trim().split('\n').at(-1)).toBe('M30');
  });
});
