import { describe, expect, it } from 'vitest';
import { vcarve, toolpaths } from '../src/cam/toolpaths.js';
import { toolGeometry } from '../src/cam/tool.js';
import { computePlan } from '../src/cam/plan.js';
import { generateGcode } from '../src/cam/gcode.js';
import { explainProgram } from '../src/cam/explain.js';
import { toC } from '../src/geometry/clipper.js';
import { TAREA, parseMoves, regionEl, square } from './helpers.js';

const V90 = depth => toolGeometry({ toolType: 'v', dia: 6, depth, vAngle: 90, vTip: 0, stepdown: 10 });

describe('tallado en V', () => {
  it('cada vuelta más adentro va más honda (con 90°, tan honda como su distancia a la orilla) hasta el fondo', () => {
    const loops = vcarve([toC(square(0, 0, 10))], V90(1));
    expect(loops.length).toBeGreaterThan(8);
    let prev = 0;
    loops.forEach(l => {
      const d = Math.min(...l.pts.map(([x, y]) => Math.min(x, y, 10 - x, 10 - y))); // distancia de la vuelta a la orilla
      expect(l.z).toBeLessThanOrEqual(prev + 1e-9); prev = l.z;
      expect(-l.z).toBeCloseTo(Math.min(1, d), 1);
      expect(l.w).toBeCloseTo(-2 * l.z, 6); // con punta aguda y 90°, el ancho es el doble de la profundidad
    });
    expect(Math.min(...loops.map(l => l.z))).toBeCloseTo(-1, 9);
  });
  it('una franja angosta queda poco honda: la V alcanza las dos orillas antes de llegar al fondo', () => {
    const loops = vcarve([toC([[0, 0], [20, 0], [20, 0.6], [0, 0.6]])], V90(2));
    expect(Math.min(...loops.map(l => l.z))).toBeGreaterThan(-0.31);
  });
  it('sin V-bit no hay tallado y lo dice', () => {
    const t = toolpaths({ type: 'region', mode: 'vcarve', parts: [{ outer: toC(square(0, 0, 5)), holes: [] }] }, toolGeometry({ toolType: 'ball', dia: 3, depth: 0.5 }));
    expect(t.paths).toEqual([]); expect(t.warn).toMatch(/V-bit/);
  });
  it('el programa baja cada vuelta a su profundidad, sin pasar del fondo ni rápidos abajo', async () => {
    const e = regionEl(square(10, 10, 12), [], 'vcarve');
    const tl = V90(1.5);
    const plan = await computePlan([e], tl, { tol: 0.01 });
    const g = generateGcode(plan, [e], TAREA);
    const zs = parseMoves(g.text).filter(m => m.g === 1).map(m => m.to[2]);
    expect(Math.min(...zs)).toBeCloseTo(-1.5, 6);
    expect(new Set(zs.map(z => z.toFixed(2))).size).toBeGreaterThan(10); // muchas profundidades distintas
    expect(explainProgram(g.text).filter(x => x.kind === 'danger')).toEqual([]);
    expect(g.text).toMatch(/TALLADO V/);
  });
});
