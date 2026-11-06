import { describe, expect, it } from 'vitest';
import { BREAK, elementOp, passWalk, perimeter, profilePaths, tabIntervals } from '../src/cam/cut.js';
import { toC } from '../src/geometry/clipper.js';
import { square, hole } from './helpers.js';

const box = pts => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };

describe('recortar', () => {
  it('profundidad: el recorte atraviesa el grosor; las demás figuras usan la suya o la del trabajo', () => {
    const p = { depth: 0.1, thick: 6, dia: 3.175 };
    const c = elementOp({ mode: 'cut' }, p);
    expect(c.depth).toBeCloseTo(6 + BREAK, 9);
    expect(c.tabTop).toBeCloseTo(-4, 9); // puente de 2 mm (un tercio de 6, máximo 2)
    expect(elementOp({ mode: 'fill' }, p).depth).toBe(0.1);
    expect(elementOp({ mode: 'contour', opts: { depth: 0.5 } }, p).depth).toBe(0.5);
    expect(elementOp({ mode: 'cut', opts: { tabs: 0 } }, p).tabs).toBe(0);
  });
  it('la herramienta va por fuera del contorno y por dentro de los huecos, y los huecos van primero', () => {
    const r = profilePaths([toC(square(0, 0, 40)), toC(hole(10, 10, 20))], 1.5);
    expect(r.paths).toHaveLength(2);
    expect(r.paths[0].hole).toBe(true);
    const [hx0, hy0, hx1, hy1] = box(r.paths[0].pts), [ox0, oy0, ox1, oy1] = box(r.paths[1].pts);
    expect([hx0, hy0, hx1, hy1].map(v => +v.toFixed(2))).toEqual([11.5, 11.5, 28.5, 28.5]);
    expect([ox0, oy0, ox1, oy1].map(v => +v.toFixed(2))).toEqual([-1.5, -1.5, 41.5, 41.5]);
    expect(r.lost).toBe(0);
  });
  it('un hueco más chico que la herramienta se cuenta como perdido', () => {
    const r = profilePaths([toC(square(0, 0, 40)), toC(hole(10, 10, 2))], 1.5);
    expect(r.paths).toHaveLength(1); expect(r.lost).toBe(1);
  });
  it('puentes repartidos parejo, fuera de la rampa, y ninguno en contornos chicos', () => {
    const t = tabIntervals(200, null, 6, 20);
    expect(t).toHaveLength(3);
    t.forEach(([a, b]) => { expect(b - a).toBeCloseTo(6, 9); expect(a).toBeGreaterThan(20); });
    expect(tabIntervals(20, null, 6)).toEqual([]);
    expect(tabIntervals(200, 0, 6)).toEqual([]);
  });
  it('una pasada baja en rampa, da la vuelta, repasa la rampa y sube sobre los puentes', () => {
    const sq = square(0, 0, 40); // perímetro 160
    const w = passWalk(sq, { zFrom: 0, z: -1, ramp: true, tabs: [[50, 56]], tabTop: -0.5 });
    expect(w[0]).toEqual([0, 0, 0]);
    const rampLen = 1 / Math.tan(5 * Math.PI / 180); // ~11.4 mm para bajar 1 mm
    // a la mitad de la rampa va a media profundidad
    let s = 0, zMid = null;
    for (let i = 1; i < w.length; i++) { s += Math.hypot(w[i][0] - w[i - 1][0], w[i][1] - w[i - 1][1]); if (zMid === null && s >= rampLen / 2) zMid = w[i][2]; }
    expect(s).toBeCloseTo(160 + rampLen, 6);
    expect(Math.min(...w.map(p => p[2]))).toBeCloseTo(-1, 9);
    // sobre el puente (x de 40, y de 10 a 16) la herramienta queda a la altura del puente
    const onTab = w.filter(p => Math.abs(p[0] - 40) < 1e-9 && p[1] > 10.01 && p[1] < 15.99);
    const tabPts = w.filter(p => Math.abs(p[0] - 40) < 1e-9 && p[1] >= 10 - 1e-9 && p[1] <= 16 + 1e-9);
    expect(tabPts.some(p => Math.abs(p[2] + 0.5) < 1e-9)).toBe(true);
    onTab.forEach(p => expect(p[2]).toBeCloseTo(-0.5, 9));
    // sube y baja en vertical: dos puntos con el mismo XY en cada orilla del puente
    const edges = w.filter((p, i) => i && Math.abs(p[0] - w[i - 1][0]) < 1e-9 && Math.abs(p[1] - w[i - 1][1]) < 1e-9);
    expect(edges.length).toBeGreaterThanOrEqual(2);
    expect(perimeter(sq)).toBeCloseTo(160, 9);
  });
  it('en pasadas por encima del puente no hay puentes, y sin rampa empieza a fondo', () => {
    const w = passWalk(square(0, 0, 10), { zFrom: 0, z: -0.3, ramp: false, tabs: [[5, 8]], tabTop: -0.5 });
    expect(w.every(p => Math.abs(p[2] + 0.3) < 1e-9 || p === w[0])).toBe(true);
  });
});

import { computePlan } from '../src/cam/plan.js';
import { generateGcode } from '../src/cam/gcode.js';
import { toolGeometry } from '../src/cam/tool.js';
import { explainProgram } from '../src/cam/explain.js';
import { TAREA, parseMoves, regionEl } from './helpers.js';

describe('recortar en el programa', () => {
  async function program(extra = {}) {
    const pieza = regionEl(square(10, 10, 40), [hole(25, 25, 10)], 'cut');
    const grabado = regionEl(square(60, 20, 8), [], 'contour');
    const p = { depth: 0.1, thick: 3, dia: 3.175 };
    [pieza, grabado].forEach(e => { e.op = elementOp(e, p); Object.assign(e.op, extra); });
    const tl = toolGeometry({ toolType: 'flat', dia: 3.175, depth: 0.1, stepdown: 1 });
    const plan = await computePlan([pieza, grabado], tl, { tol: 0.01 });
    return { g: generateGcode(plan, [pieza, grabado], { ...TAREA, W: 90, H: 70 }), pieza };
  }
  it('graba primero, recorta al final: el hueco antes que el contorno, a fondo, con puentes y sin rápidos abajo', async () => {
    const { g } = await program();
    const L = g.text.split('\n');
    const iGrab = L.findIndex(l => /FIGURA 2 - CONTORNO/.test(l)), iCut = L.findIndex(l => /FIGURA 1 - RECORTE/.test(l));
    expect(iGrab).toBeGreaterThan(0); expect(iCut).toBeGreaterThan(iGrab);
    expect(L[iCut]).toMatch(/PROF\. 3\.20 MM EN 4 PASADAS/);
    expect(L[iCut]).toMatch(/PUENTE/);
    expect(explainProgram(g.text).filter(x => x.kind === 'danger')).toEqual([]);
    const mv = parseMoves(g.text);
    const cut = mv.filter(m => m.g === 1 && m.to[2] < -0.2); // lo del recorte (el grabado va a 0.1)
    expect(Math.min(...cut.map(m => m.to[2]))).toBeCloseTo(-3.2, 6);
    // el primer corte hondo es del hueco (dentro de 25..35), y el contorno de afuera pasa por fuera (x < 10)
    const firstDeep = cut[0];
    expect(firstDeep.to[0]).toBeGreaterThan(24); expect(firstDeep.to[0]).toBeLessThan(36);
    expect(Math.min(...cut.map(m => m.to[0]))).toBeCloseTo(10 - 3.175 / 2, 1);
    // los puentes: en las pasadas más hondas hay tramos a la altura del puente (−3 + 1 = −2)
    expect(cut.some(m => Math.abs(m.to[2] + 2) < 1e-6 && m.from[2] === m.to[2])).toBe(true);
  });
  it('baja de punta solo con el avance en Z, y el primer corte después lleva el avance X-Y', async () => {
    const { g } = await program();
    const L = g.text.split('\n').filter(l => !l.startsWith('('));
    L.forEach((l, k) => {
      if (/^G01 Z-?[\d.]+ F/.test(l) && !/X|Y/.test(l)) {
        expect(l).toMatch(/F60$/);
        const next = L.slice(k + 1).find(n => /^G0[123]/.test(n));
        if (/X|Y/.test(next)) expect(next).toMatch(/F130/);
      }
    });
  });
  it('sin puentes si se piden cero', async () => {
    const { g } = await program({ tabs: 0 });
    expect(g.text).not.toMatch(/PUENTE/);
    expect(g.tabs).toBe(0);
  });
});
