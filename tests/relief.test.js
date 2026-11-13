import { describe, expect, it } from 'vitest';
import { dropCutter, reliefLayout, reliefPath } from '../src/cam/relief.js';
import { toolGeometry } from '../src/cam/tool.js';

/** Relieve de 20 × 10 mm con un escalón: la mitad derecha 1 mm abajo. */
function step() {
  const gw = 40, gh = 20, data = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = gw / 2; i < gw; i++) data[j * gw + i] = 1;
  return { x0: 0, y0: 0, w: 20, h: 10, gw, gh, data };
}
const ball = toolGeometry({ toolType: 'ball', dia: 2, depth: 1 });

describe('relieve 3D', () => {
  it('se acomoda en la pieza con margen, o con el ancho pedido, centrado', () => {
    expect(reliefLayout(200, 100, { W: 90, H: 50, margin: 5, fit: 'fill' })).toEqual({ x0: 5, y0: 5, w: 80, h: 40 });
    const r = reliefLayout(200, 100, { W: 90, H: 50, margin: 5, fit: 'width', drawW: 40 });
    expect(r.w).toBe(40); expect(r.h).toBe(20); expect(r.x0).toBe(25);
  });
  it('la punta baja hasta la superficie, pero no se come la orilla del escalón (la bola la toca antes)', () => {
    const z = dropCutter(step(), 1, ball);
    expect(z(3, 5)).toBeCloseTo(0, 9); // arriba del escalón
    expect(z(17, 5)).toBeCloseTo(-1, 9); // abajo, lejos de la orilla
    // justo junto a la orilla (x = 10.5) la bola de radio 1 toca la parte alta antes de llegar al fondo
    expect(z(10.5, 5)).toBeGreaterThan(-1);
    // nunca más hondo que la superficie bajo el centro
    for (let x = 0.25; x < 20; x += 0.5) expect(z(x, 5)).toBeGreaterThanOrEqual(x < 10 ? -1e-9 : -1 - 1e-9);
  });
  it('fuera del relieve la superficie es la cara: la herramienta no baja más allá de su orilla', () => {
    const z = dropCutter(step(), 1, ball);
    expect(z(19.5, 5)).toBeGreaterThan(-1); // a medio radio de la orilla derecha, la bola toca la cara de afuera
  });
  it('un solo zigzag que cubre todo el relieve, sin bajar en diagonal entre renglones', () => {
    const p = reliefPath(step(), 1, ball);
    const ys = [...new Set(p.pts3.map(q => q[1].toFixed(3)))];
    expect(ys.length).toBe(Math.round(10 / 0.5) + 1); // renglones cada D/4 = 0.5 mm
    expect(Math.min(...p.pts3.map(q => q[2]))).toBeCloseTo(-1, 9);
    for (let k = 1; k < p.pts3.length; k++) {
      const [a, b] = [p.pts3[k - 1], p.pts3[k]];
      if (a[1] !== b[1]) expect(b[2]).toBeGreaterThanOrEqual(a[2] - 1e-9); // al cambiar de renglón no baja
    }
    expect(p.pts3.length).toBeLessThan(400); // los tramos planos se simplifican
  });
});

describe('tiempo del relieve', () => {
  it('las bajadas empinadas van al avance de Z y la estimación las cuenta a ese avance (igual que la simulación)', async () => {
    const { assignOps } = await import('../src/cam/tools.js');
    const { computePlan } = await import('../src/cam/plan.js');
    const { generateGcode } = await import('../src/cam/gcode.js');
    const { explainProgram } = await import('../src/cam/explain.js');
    const { buildTimeline } = await import('../src/cam/simulate.js');
    // dientes de sierra de 2 mm: muchas bajadas casi verticales
    const gw = 60, gh = 40, data = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) data[j * gw + i] = (i % 20) > 10 ? 1 : 0;
    const el = { src: 'design', type: 'relief', mode: 'relief', relief: { x0: 5, y0: 5, w: 30, h: 20, gw, gh, data }, opts: { depth: 2 } };
    const tl = toolGeometry({ toolType: 'ball', dia: 3.175, depth: 0.1, stepdown: 2, stepoverPct: 45 });
    const tools = [{ t: 3, type: 'ball', dia: 3.175, fz: 20, fxy: 600 }];
    assignOps([el], tools, tl, { thick: 5 });
    const plan = await computePlan([el], tl, { tol: 0.01 });
    const g = generateGcode(plan, [el], { W: 40, H: 30, dialect: 'grbl', dec: 2, retract: 3, fz: 20, fxy: 600, toolNum: 3, rpm: 2200, arcs: false, tools });
    expect(g.text).toMatch(/Z-\d.*F20\n/); // hay bajadas en diagonal a F20
    const sim = buildTimeline(explainProgram(g.text)).total / 60;
    expect(Math.abs(g.mins - sim) / sim).toBeLessThan(0.03);
  });
});

describe('tiempo con varias herramientas', () => {
  it('las bajadas de cada herramienta se cuentan a su propio avance de Z', async () => {
    const { assignOps } = await import('../src/cam/tools.js');
    const { computePlan } = await import('../src/cam/plan.js');
    const { generateGcode } = await import('../src/cam/gcode.js');
    const { explainProgram } = await import('../src/cam/explain.js');
    const { buildTimeline } = await import('../src/cam/simulate.js');
    const { regionEl, square } = await import('./helpers.js');
    const gw = 60, gh = 40, data = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) data[j * gw + i] = (i % 20) > 10 ? 1 : 0;
    const relieve = { src: 'design', type: 'relief', mode: 'relief', relief: { x0: 5, y0: 5, w: 30, h: 20, gw, gh, data }, opts: { depth: 2 } };
    const pieza = regionEl(square(2, 2, 36), [], 'cut');
    const tl = toolGeometry({ toolType: 'ball', dia: 3.175, depth: 0.1, stepdown: 2, stepoverPct: 45 });
    // la bola baja muy despacio (F20) y la fresa plana del recorte muy rápido (F300)
    const tools = [{ t: 3, type: 'ball', dia: 3.175, fz: 20, fxy: 600 }, { t: 1, type: 'flat', dia: 3.175, fz: 300, fxy: 600 }];
    assignOps([relieve, pieza], tools, tl, { thick: 3 });
    const plan = await computePlan([relieve, pieza], tl, { tol: 0.01 });
    const g = generateGcode(plan, [relieve, pieza], { W: 40, H: 40, dialect: 'grbl', dec: 2, retract: 3, fz: 20, fxy: 600, toolNum: 3, rpm: 2200, arcs: false, tools });
    expect(g.text).toMatch(/M00/);
    const sim = buildTimeline(explainProgram(g.text)).total / 60;
    expect(Math.abs(g.mins - sim) / sim).toBeLessThan(0.05);
  });
});
