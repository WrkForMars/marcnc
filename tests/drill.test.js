import { describe, expect, it } from 'vitest';
import { circleOf, drillPlan, helixDrill, pointDrill } from '../src/cam/drill.js';
import { regionEl, square } from './helpers.js';

const circle = (cx, cy, r, n = 64) => Array.from({ length: n }, (_, k) => [cx + r * Math.cos(2 * Math.PI * k / n), cy + r * Math.sin(2 * Math.PI * k / n)]);
const f = v => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);

describe('barrenos', () => {
  it('reconoce círculos y nada más', () => {
    const c = circleOf(regionEl(circle(20, 10, 3)));
    expect(c.cx).toBeCloseTo(20, 2); expect(c.cy).toBeCloseTo(10, 2); expect(c.r).toBeCloseTo(3, 2);
    expect(circleOf(regionEl(square(0, 0, 10)))).toBe(null);
    expect(circleOf(regionEl(circle(0, 0, 20), [circle(0, 0, 5).reverse()]))).toBe(null);
  });
  it('del tamaño de la herramienta, en el centro; más grande, en espiral por dentro de la orilla', () => {
    expect(drillPlan({ cx: 0, cy: 0, r: 1.6 }, { D: 3.175 }).kind).toBe('point');
    const h = drillPlan({ cx: 0, cy: 0, r: 4 }, { D: 3.175 });
    expect(h.kind).toBe('helix'); expect(h.rc).toBeCloseTo(4 - 3.175 / 2, 9);
  });
  it('Fanuc: G81 si es poco hondo, G83 con picoteo si es hondo, y G80 al final', () => {
    const o = { dialect: 'fanuc', R: 3, fz: 60, f };
    expect(pointDrill({ cx: 10, cy: 5 }, { depth: 3.2, D: 3.175 }, o).lines).toEqual(['G98 G81 X10.00 Y5.00 Z-3.20 R1.00 F60', 'G80']);
    expect(pointDrill({ cx: 10, cy: 5 }, { depth: 12, D: 3.175 }, o).lines[0]).toBe('G98 G83 X10.00 Y5.00 Z-12.00 R1.00 Q3.17 F60');
  });
  it('GRBL: sin ciclos fijos, los mismos movimientos uno por uno y nunca un rápido hacia abajo dentro del material', () => {
    const L = pointDrill({ cx: 10, cy: 5 }, { depth: 10, D: 3.175 }, { dialect: 'grbl', R: 3, fz: 60, f }).lines;
    expect(L.some(l => /G8[0-3]/.test(l))).toBe(false);
    expect(L.filter(l => l.startsWith('G01')).at(-1)).toBe('G01 Z-10.00 F60');
    // cada bajada rápida termina 0.2 mm arriba de donde ya se había llegado
    let deepest = 0;
    L.forEach(l => { const z = +(l.match(/Z(-?[\d.]+)/) || [])[1]; if (l.startsWith('G01')) deepest = Math.min(deepest, z); else if (l.startsWith('G00') && z < 0) expect(z).toBeGreaterThan(deepest); });
    expect(L.at(-1)).toBe('G00 Z3.00');
  });
  it('en espiral: medias vueltas G02 que bajan parejo, con centro exacto, vuelta de limpieza y salida por el centro', () => {
    const { lines } = helixDrill({ cx: 20, cy: 10, rc: 2.5 }, { depth: 3, D: 3.175, down: 1 }, { R: 3, fz: 60, fxy: 130, f });
    expect(lines[0]).toBe('G00 X22.50 Y10.00');
    expect(lines[1]).toBe('G01 Z0.00 F60');
    const arcs = lines.filter(l => l.startsWith('G02'));
    expect(arcs[0]).toMatch(/F130$/);
    let x = 22.5, lastZ = 0;
    arcs.forEach(l => {
      const [, nx, , nz, I] = l.match(/X(-?[\d.]+) Y(-?[\d.]+) Z(-?[\d.]+) I(-?[\d.]+)/).map(Number);
      expect(Math.abs(x + I - 20)).toBeLessThan(1e-9); // el centro siempre en X20
      expect(Math.abs(nx - 20)).toBeCloseTo(2.5, 9);
      expect(nz).toBeLessThanOrEqual(lastZ + 1e-9);
      x = nx; lastZ = nz;
    });
    expect(lastZ).toBe(-3);
    expect(arcs.filter(l => /Z-3\.00/.test(l)).length).toBeGreaterThanOrEqual(2); // la vuelta de limpieza
    expect(lines.slice(-2)).toEqual(['G01 X20.00 Y10.00', 'G00 Z3.00']);
  });
});

import { explainProgram } from '../src/cam/explain.js';
import { buildTimeline } from '../src/cam/simulate.js';
import { computePlan } from '../src/cam/plan.js';
import { generateGcode } from '../src/cam/gcode.js';
import { toolGeometry } from '../src/cam/tool.js';
import { elementOp } from '../src/cam/cut.js';
import { TAREA } from './helpers.js';

describe('barrenos en el programa', () => {
  it('el visor explica G81 y G83, y la simulación recorre sus movimientos', () => {
    const ex = explainProgram('G21 G90\nG00 Z3.00\nG98 G81 X10.00 Y5.00 Z-3.20 R1.00 F60\nG80\nG98 G83 X20.00 Y5.00 Z-3.00 R1.00 Q1.00 F60\nG80\n');
    const g81 = ex.find(e => /G81/.test(e.code)), g83 = ex.find(e => /G83/.test(e.code));
    expect(g81.kind).toBe('drill'); expect(g81.text).toMatch(/Barrena en X10\.00 Y5\.00/);
    expect(g81.text).toMatch(/regresa a la altura/);
    expect(g83.text).toMatch(/picoteo/);
    expect(g81.to).toEqual([10, 5, 3]); // G98: vuelve a la altura inicial
    const tl = buildTimeline(ex);
    const deep = tl.segs.filter(s => s.n === g83.n).map(s => s.to[2]);
    expect(Math.min(...deep)).toBe(-3);
    expect(deep.filter(z => z === 1).length).toBeGreaterThanOrEqual(3); // sube a R entre picotazos
  });
  it('un círculo en modo Barrenar sale como ciclo (Fanuc) o como movimientos (GRBL), pasante por defecto', async () => {
    const tl = toolGeometry({ toolType: 'flat', dia: 3.175, depth: 0.1, stepdown: 1 });
    const make = () => {
      const chico = regionEl(circle(20, 20, 1.6), [], 'drill'), grande = regionEl(circle(50, 20, 5), [], 'drill');
      [chico, grande].forEach(e => { e.op = elementOp(e, { depth: 0.1, thick: 3, dia: tl.D }); });
      return [chico, grande];
    };
    for (const dialect of ['fanuc', 'grbl']) {
      const els = make();
      const plan = await computePlan(els, tl, { tol: 0.01 });
      const g = generateGcode(plan, els, { ...TAREA, dialect });
      expect(g.text).toMatch(/BARRENO DE 3\.20 MM/);
      expect(g.text).toMatch(/BARRENO DE 10\.00 MM EN ESPIRAL/);
      if (dialect === 'fanuc') expect(g.text).toMatch(/G98 G81 X20\.00 Y20\.00 Z-3\.20 R1\.00 F60/);
      else expect(g.text).not.toMatch(/G8[13]/);
      expect(g.text).toMatch(/G02 X46\.59 Y20\.00 Z-/); // la espiral del grande, por dentro de su orilla
      expect(explainProgram(g.text).filter(e => e.kind === 'danger')).toEqual([]);
    }
  });
  it('una figura que no es círculo no se barrena y lo dice', async () => {
    const e = regionEl(square(0, 0, 10), [], 'drill');
    e.op = elementOp(e, { depth: 0.1, thick: 3, dia: 3.175 });
    await computePlan([e], toolGeometry({ toolType: 'flat', dia: 3.175, depth: 0.1 }), { tol: 0.01 });
    expect(e.paths).toEqual([]); expect(e.warn).toMatch(/solo los círculos/);
  });
});
