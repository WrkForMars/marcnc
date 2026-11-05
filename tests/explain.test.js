import { describe, expect, it } from 'vitest';
import { blockRanges, explainProgram } from '../src/cam/explain.js';
import { generateGcode } from '../src/cam/gcode.js';
import { computePlan } from '../src/cam/plan.js';
import { toolGeometry } from '../src/cam/tool.js';
import { BALL_1_8, TAREA, hole, lineEl, regionEl, square } from './helpers.js';

async function program(opts = {}) {
  const circle = Array.from({ length: 72 }, (_, k) => [70 + 8 * Math.cos(k * Math.PI / 36), 25 + 8 * Math.sin(k * Math.PI / 36)]);
  const elements = [regionEl(square(5, 5, 30), [hole(12, 12, 16)], 'invert'), regionEl(circle, [], 'contour'), lineEl([[5, 45], [40, 45]])];
  const plan = await computePlan(elements, toolGeometry(BALL_1_8), { tol: 0.05 });
  return generateGcode(plan, elements, { ...TAREA, ...opts }).text;
}

describe('explainProgram', () => {
  it('explica todas las líneas del programa de la tarea, sin ninguna desconocida', async () => {
    for (const dialect of ['fanuc', 'grbl']) {
      const ex = explainProgram(await program({ dialect }));
      expect(ex.length).toBeGreaterThan(20);
      ex.forEach(e => {
        expect(e.text).not.toMatch(/no reconoce/);
        expect(e.kind).not.toBe('danger');
      });
    }
  });

  it('describe el encabezado Fanuc', async () => {
    const ex = explainProgram(await program());
    const t = code => ex.find(e => e.code.startsWith(code)).text;
    expect(t('%')).toMatch(/inicio/);
    expect(t('O0001')).toMatch(/Número de programa 0001/);
    expect(t('G21')).toMatch(/milímetros/);
    expect(t('T3 M06')).toBe('Cambia a la herramienta 3.');
    expect(t('S2200 M03')).toMatch(/2200 rpm.*horario/);
    expect(t('G28')).toMatch(/home/);
    expect(ex.at(-1).text).toMatch(/fin del archivo/);
  });

  it('distingue rápidos, bajadas, cortes y arcos, y sigue la posición', () => {
    const ex = explainProgram(['G90', 'G00 Z3', 'G00 X10 Y5', 'G01 Z-0.1 F60', 'G01 X20 F130', 'Y15', 'G02 X30 Y5 I0 J-10', 'G00 Z3'].join('\n'));
    expect(ex.map(e => e.kind)).toEqual(['setup', 'retract', 'rapid', 'plunge', 'cut', 'cut', 'arc', 'retract']);
    expect(ex[3].text).toMatch(/entra 0.10 mm en el material a 60 mm\/min/);
    expect(ex[5].text).toMatch(/hasta X20.00 Y15.00 \(10.00 mm\).*G01 sigue activo/);
    expect(ex[6].arc).toEqual({ c: [20, 5], r: 10, ccw: false });
    expect(ex[6].text).toMatch(/horario.*centro en X20.00 Y5.00 y radio 10.00 mm/);
    expect(ex[6].from).toEqual([20, 15, -0.1]);
  });

  it('explica una sola vez que el modo de movimiento sigue activo', () => {
    const ex = explainProgram('G01 X10 F100\nX20\nX30\nG01 X40\nX50');
    expect(ex.map(e => /sigue activo/.test(e.text))).toEqual([false, true, false, false, true]);
  });

  it('marca como peligro un rápido con la herramienta abajo', () => {
    const ex = explainProgram('G01 Z-1 F60\nG00 X10 Y10');
    expect(ex[1].kind).toBe('danger');
    expect(ex[1].text).toMatch(/Cuidado/);
  });

  it('agrupa las líneas de cada figura', async () => {
    const r = blockRanges(explainProgram(await program()));
    expect(r.map(b => b.block).sort()).toEqual(['FIGURA 1', 'FIGURA 2', 'FIGURA 3']); // en el orden de corte
    r.forEach(b => expect(b.last).toBeGreaterThan(b.first));
  });
});
