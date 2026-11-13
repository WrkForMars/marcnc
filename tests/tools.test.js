import { describe, expect, it } from 'vitest';
import { assignOps, toolFor, toolLabel } from '../src/cam/tools.js';
import { computePlan } from '../src/cam/plan.js';
import { generateGcode } from '../src/cam/gcode.js';
import { toolGeometry } from '../src/cam/tool.js';
import { BREAK, elementOp } from '../src/cam/cut.js';
import { explainProgram } from '../src/cam/explain.js';
import { BALL_1_8, TAREA, regionEl, square, hole, parseMoves } from './helpers.js';
import { verifyProgram } from './verify.js';

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
    expect(L.slice(change - 4, change + 3)).toEqual(['M05', 'G28 G91 Z0', 'G90', '(T1 FRESA PLANA D6.35)', 'T1 M06', 'S2200 M03', 'G00 G43 H1 Z3.00']);
    expect(t).toMatch(/\(HERRAMIENTAS: T3 BALL MILL D3.17 - T1 FRESA PLANA D6.35\)/);
    expect(explainProgram(t).filter(e => e.kind === 'danger')).toEqual([]);
  });
  it('Fanuc sin cambiador automático: también se pausa con M00', async () => {
    const p = { toolType: 'ball', dia: 3.175, depth: 0.1, stepdown: 1 };
    const bases = TOOLS.map(t => toolGeometry({ ...p, toolType: t.type, dia: t.dia }));
    const pieza = regionEl(square(10, 10, 30), [], 'cut'), letras = regionEl(square(50, 20, 6), [], 'contour');
    [pieza, letras].forEach(e => { const k = toolFor(e, TOOLS); e.op = { ...elementOp(e, { depth: 0.1, thick: 3, dia: bases[k].D }), tool: k, base: bases[k] }; });
    const plan = await computePlan([pieza, letras], bases[0], { tol: 0.01 });
    const t = generateGcode(plan, [pieza, letras], { ...TAREA, W: 90, H: 80, tools: TOOLS, changer: false }).text;
    expect(t).not.toMatch(/M06/);
    expect(t).toMatch(/G28 G91 Z0\nG90\n\(CAMBIA A T1 FRESA PLANA D6\.35 Y TOMA DE NUEVO Z0\)\nM00/);
  });
  it('cada herramienta corta con sus propios avances', async () => {
    const p = { toolType: 'ball', dia: 3.175, depth: 0.1, stepdown: 1 };
    const tools = [TOOLS[0], { ...TOOLS[1], fxy: 400, fz: 120 }];
    const bases = tools.map(t => toolGeometry({ ...p, toolType: t.type, dia: t.dia }));
    const pieza = regionEl(square(10, 10, 30), [], 'cut'), letras = regionEl(square(50, 20, 6), [], 'contour');
    [pieza, letras].forEach(e => { const k = toolFor(e, tools); e.op = { ...elementOp(e, { depth: 0.1, thick: 3, dia: bases[k].D }), tool: k, base: bases[k] }; });
    const plan = await computePlan([pieza, letras], bases[0], { tol: 0.01 });
    const g = generateGcode(plan, [pieza, letras], { ...TAREA, W: 90, H: 80, tools });
    const [antes, despues] = g.text.split('T1 M06');
    expect(antes).toMatch(/F130/); expect(antes).not.toMatch(/F400/);
    expect(despues).toMatch(/F120/); expect(despues).toMatch(/F400/); expect(despues).not.toMatch(/F130|F60\b/);
    // la duración usa el avance de cada una: con la fresa más rápida, el recorte tarda menos que todo a F130
    const lento = generateGcode(plan, [pieza, letras], { ...TAREA, W: 90, H: 80, tools: [TOOLS[0], TOOLS[1]] });
    expect(g.mins).toBeLessThan(lento.mins);
  });
  it('GRBL: se pausa con M00 para que el operador cambie la herramienta y tome Z0 de nuevo', async () => {
    const t = await job('grbl');
    expect(t).not.toMatch(/M06/);
    expect(t).toMatch(/\(CAMBIA A T1 FRESA PLANA D6.35 Y TOMA DE NUEVO Z0\)\nM00\nS2200 M03/);
  });
});

describe('assignOps: cómo se corta cada figura', () => {
  const p = { toolType: 'ball', dia: 3.175, depth: 0.1, stepdown: 1, vAngle: 60 };
  const V = { t: 9, type: 'v', dia: 6 };

  it('las copias siguen el modo, los ajustes y la herramienta de su original', () => {
    const orig = regionEl(square(10, 10, 20), [], 'cut');
    orig.opts = { tabs: 0 };
    const copia = { ...regionEl(square(40, 10, 20), [], 'fill'), copyOf: 0 };
    assignOps([orig, copia], TOOLS, toolGeometry(p), { thick: 3 });
    expect(copia.mode).toBe('cut');
    expect(copia.opts).toBe(orig.opts);
    expect(copia.op.tool).toBe(1);
    expect(copia.op.depth).toBeCloseTo(3 + BREAK);
    expect(copia.op).toEqual(orig.op);
  });

  it('el tallado en V usa el V-bit si hay uno; si no, la principal', () => {
    const e = regionEl(square(10, 10, 20), [], 'vcarve');
    assignOps([e], [...TOOLS, V], toolGeometry(p), { thick: 3 });
    expect(e.op.tool).toBe(2);
    assignOps([e], TOOLS, toolGeometry(p), { thick: 3 });
    expect(e.op.tool).toBe(0);
  });

  it('cada V-bit usa su ángulo; sin ángulo propio, el del trabajo', () => {
    const tl = toolGeometry(p);
    const bases = assignOps([], [TOOLS[0], { ...V, vAngle: 90 }, V], tl, { thick: 3 });
    expect(bases[0]).toBe(tl);
    expect(bases[1].src.vAngle).toBe(90);
    expect(bases[2].src.vAngle).toBe(60);
    expect(bases[1].w).toBeCloseTo(toolGeometry({ ...p, toolType: 'v', dia: 6, vAngle: 90 }).w);
    expect(bases[1].w).toBeGreaterThan(bases[2].w); // más abierto, línea más ancha a la misma profundidad
  });
});

describe('compensación de largo (G43)', () => {
  async function prog(tools, opts = {}) {
    const els = [regionEl(square(10, 10, 30), [], 'cut'), regionEl(square(50, 20, 6), [], 'contour')];
    const tl = toolGeometry({ toolType: 'ball', dia: 3.175, depth: 0.1, stepdown: 1 });
    assignOps(els, tools, tl, { thick: 3 });
    const plan = await computePlan(els, tl, { tol: 0.01 });
    return generateGcode(plan, els, { ...TAREA, W: 90, H: 80, tools, ...opts }).text;
  }
  it('con una sola herramienta el programa no lleva G43', async () => {
    expect(await prog([TOOLS[0]])).not.toMatch(/G43/);
  });
  it('Fanuc con cambiador y varias herramientas: cada una toma su largo al subir a la retracción', async () => {
    const t = await prog(TOOLS);
    expect(t.match(/G43/g)).toHaveLength(2);
    expect(t).toMatch(/G54\nG00 G43 H3 Z3\.00/);
    expect(t).toMatch(/T1 M06\nS2200 M03\nG00 G43 H1 Z3\.00/);
  });
  it('sin cambiador o en GRBL no hay G43: Z0 se toma a mano con cada herramienta', async () => {
    expect(await prog(TOOLS, { changer: false })).not.toMatch(/G43/);
    expect(await prog(TOOLS, { dialect: 'grbl' })).not.toMatch(/G43/);
  });
});

const vertical = m => m.from[0] === m.to[0] && m.from[1] === m.to[1];
const down = m => m.to[2] < m.from[2];
/** Pendiente de cada bajada en diagonal. */
const slopes = cuts => cuts.filter(m => down(m) && !vertical(m)).map(m => (m.from[2] - m.to[2]) / Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]));

describe('rampa de entrada', () => {
  async function contour(s) {
    const e = regionEl(square(10, 10, s), [], 'contour');
    e.opts = { depth: 1 };
    const tl = toolGeometry({ ...BALL_1_8, stepdown: 1 });
    const tools = [{ t: 3, type: 'ball', dia: 3.175, fz: 60, fxy: 130 }];
    assignOps([e], tools, tl, { thick: 3 });
    const plan = await computePlan([e], tl, { tol: 0.01 });
    const text = generateGcode(plan, [e], { ...TAREA, tools }).text;
    expect(verifyProgram(text, { ...TAREA, maxDepth: 1, tools })).toEqual([]);
    return { text, cuts: parseMoves(text).filter(m => m.g === 1) };
  }
  it('un contorno hondo entra en rampa de 5° desde la cara', async () => {
    const { text, cuts } = await contour(20);
    expect(text).toMatch(/G01 Z0\.00 F60/);
    expect(Math.max(...slopes(cuts))).toBeLessThan(Math.tan(5.5 * Math.PI / 180));
    expect(cuts.some(m => m.to[2] < 0 && vertical(m) && m.from[2] >= 0)).toBe(false);
  });
  it('si la rampa de 5° no cabe (bajar 1 mm pide ~11.4 mm), baja en la vuelta completa, más empinada', async () => {
    const { text, cuts } = await contour(2); // 8 mm de perímetro: ~7°
    expect(text).toMatch(/G01 Z0\.00 F60/);
    const s = slopes(cuts);
    expect(Math.max(...s)).toBeGreaterThan(Math.tan(6 * Math.PI / 180));
    expect(Math.max(...s)).toBeLessThan(Math.tan(20.5 * Math.PI / 180));
    expect(cuts.some(m => m.to[2] < 0 && vertical(m))).toBe(false);
  });
  it('si ni la vuelta completa alcanza (más de 20°), baja de punta al avance de Z', async () => {
    const { text, cuts } = await contour(0.5); // 2 mm de perímetro: harían falta 2.75 mm
    expect(text).not.toMatch(/G01 Z0\.00 F60/);
    const plunge = cuts.find(m => m.to[2] === -1 && vertical(m));
    expect(plunge).toBeDefined();
    expect(plunge.F).toBe(60);
    expect(slopes(cuts)).toEqual([]);
  });
});

describe('recortes chicos', () => {
  async function cut(s, thick, tabs) {
    const e = regionEl(square(20, 20, s), [], 'cut');
    e.opts = { tabs };
    const tools = [{ t: 2, type: 'flat', dia: 3.175, fz: 60, fxy: 130 }];
    const tl = toolGeometry({ toolType: 'flat', dia: 3.175, depth: 0.1, stepdown: 10 });
    assignOps([e], tools, tl, { thick });
    const plan = await computePlan([e], tl, { tol: 0.01 });
    const g = generateGcode(plan, [e], { ...TAREA, tools });
    expect(verifyProgram(g.text, { ...TAREA, maxDepth: thick + 0.2, tools })).toEqual([]);
    const cuts = parseMoves(g.text).filter(m => m.g === 1);
    expect(Math.min(...cuts.map(m => m.to[2]))).toBeCloseTo(-thick - 0.2);
    return { g, cuts };
  }
  it('rampa en la vuelta completa y los puentes pedidos', async () => {
    // cuadro de 4 mm con fresa plana de 1/8": el contorno mide ~26 mm y bajar 3.2 mm a 5° pide ~37 mm
    const { g, cuts } = await cut(4, 3, 2);
    expect(g.tabs).toBe(2);
    expect(Math.max(...slopes(cuts))).toBeLessThan(Math.tan(20.5 * Math.PI / 180));
    // sobre cada puente sube a su altura (Z-2: deja 1 mm) y vuelve a bajar de punta, a F60; la rampa también lo respeta
    const ups = cuts.filter(m => vertical(m) && m.to[2] > m.from[2] && m.to[2] < 0);
    expect(ups.length).toBeGreaterThanOrEqual(2);
    ups.forEach(m => expect(m.to[2]).toBeCloseTo(-2));
    cuts.filter(m => down(m) && vertical(m)).forEach(m => expect(m.F).toBe(60));
  });
  it('si ni así cabe la rampa, baja de punta al avance de Z y deja el puente', async () => {
    // cuadro de 1 mm: ~14 mm de contorno; bajar 6.2 mm a 20° pide ~17 mm
    const { g, cuts } = await cut(1, 6, 1);
    expect(g.tabs).toBe(1);
    expect(slopes(cuts)).toEqual([]);
    cuts.filter(down).forEach(m => expect(m.F).toBe(60));
    expect(cuts.filter(m => vertical(m) && m.to[2] > m.from[2] && m.to[2] < 0)).toHaveLength(1);
  });
});
