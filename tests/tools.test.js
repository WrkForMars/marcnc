import { describe, expect, it } from 'vitest';
import { toolFor, toolLabel } from '../src/cam/tools.js';
import { computePlan } from '../src/cam/plan.js';
import { generateGcode } from '../src/cam/gcode.js';
import { toolGeometry } from '../src/cam/tool.js';
import { elementOp } from '../src/cam/cut.js';
import { explainProgram } from '../src/cam/explain.js';
import { TAREA, regionEl, square, hole } from './helpers.js';

const TOOLS = [{ t: 3, type: 'ball', dia: 3.175 }, { t: 1, type: 'flat', dia: 6.35 }];

describe('varias herramientas', () => {
  it('recortar y barrenar usan la fresa plana; lo demás, la principal; lo que elija el usuario manda', () => {
    expect(toolFor({ mode: 'cut' }, TOOLS)).toBe(1);
    expect(toolFor({ mode: 'drill' }, TOOLS)).toBe(1);
    expect(toolFor({ mode: 'fill' }, TOOLS)).toBe(0);
    expect(toolFor({ mode: 'cut' }, [TOOLS[0]])).toBe(0);
    expect(toolFor({ mode: 'fill', opts: { tool: 1 } }, TOOLS)).toBe(1);
    expect(toolFor({ mode: 'fill', opts: { tool: 7 } }, TOOLS)).toBe(0); // ya no existe: la principal
    expect(toolLabel(TOOLS[1])).toBe('T1 · Fresa plana de 6.35 mm');
  });

  async function job(dialect) {
    const p = { toolType: 'ball', dia: 3.175, depth: 0.1, stepdown: 1 };
    const bases = TOOLS.map(t => toolGeometry({ ...p, toolType: t.type, dia: t.dia }));
    const pieza = regionEl(square(10, 10, 60), [hole(40, 30, 10)], 'cut');
    const letras = regionEl(square(20, 20, 6), [], 'contour');
    const otra = regionEl(square(55, 20, 6), [], 'contour');
    [pieza, letras, otra].forEach(e => {
      const k = toolFor(e, TOOLS);
      e.op = { ...elementOp(e, { depth: 0.1, thick: 3, dia: bases[k].D }), tool: k, base: bases[k] };
    });
    const els = [pieza, letras, otra];
    const plan = await computePlan(els, bases[0], { tol: 0.01 });
    return generateGcode(plan, els, { ...TAREA, dialect, W: 90, H: 80, tools: TOOLS }).text;
  }
  it('Fanuc: graba con la principal, cambia una sola vez a la fresa plana y recorta al final', async () => {
    const t = await job('fanuc');
    expect(t.match(/M06/g)).toHaveLength(2); // la inicial y un cambio
    const L = t.split('\n');
    const change = L.indexOf('T1 M06'), grab = L.findIndex(l => /CONTORNO/.test(l)), cut = L.findIndex(l => /RECORTE/.test(l));
    expect(L[1 + L.indexOf('%')]).toMatch(/^O0001/);
    expect(grab).toBeLessThan(change); expect(change).toBeLessThan(cut);
    expect(L.slice(change - 4, change + 3)).toEqual(['M05', 'G28 G91 Z0', 'G90', '(T1 FRESA PLANA D6.35)', 'T1 M06', 'S2200 M03', 'G00 Z3.00']);
    expect(t).toMatch(/\(HERRAMIENTAS: T3 BALL MILL D3.17 - T1 FRESA PLANA D6.35\)/);
    expect(explainProgram(t).filter(e => e.kind === 'danger')).toEqual([]);
  });
  it('GRBL: se pausa con M00 para que el operador cambie la herramienta y tome Z0 de nuevo', async () => {
    const t = await job('grbl');
    expect(t).not.toMatch(/M06/);
    expect(t).toMatch(/\(CAMBIA A T1 FRESA PLANA D6.35 Y TOMA DE NUEVO Z0\)\nM00\nS2200 M03/);
  });
});
