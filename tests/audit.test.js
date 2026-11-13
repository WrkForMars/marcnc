// Auditoría del programa G: muchas piezas (las plantillas con todos sus modos, herramientas, grosores, controladores,
// copias y relieves) pasan por el mismo camino que la app y un verificador independiente revisa cada línea.
import { describe, expect, it } from 'vitest';
import { verifyProgram } from './verify.js';
import { TEMPLATES } from '../src/templates.js';
import { sketchElements } from '../src/sketch/geometry.js';
import { hersheyText } from '../src/text/hershey.js';
import { toolGeometry } from '../src/cam/tool.js';
import { assignOps } from '../src/cam/tools.js';
import { computePlan } from '../src/cam/plan.js';
import { generateGcode } from '../src/cam/gcode.js';
import { copyOffsets, shiftElement } from '../src/cam/copies.js';
import { bbox } from '../src/preview/canvas.js';
import { circleOf } from '../src/cam/drill.js';

let seed = 20261112;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];

/** Figuras de una plantilla como las arma la app: croquis → elementos, y cada texto como trazos de una línea. */
function templateElements(t) {
  const ents = t.entities.map((e, i) => ({ ...e, id: i + 1 }));
  const els = sketchElements(ents, Object.fromEntries(t.modes.map((m, i) => [i + 1, m])));
  t.texts.forEach((x, k) => {
    const parts = hersheyText({ text: x.text, font: 'futural', h: x.h, sp: 0 }).map(p => ({ pts: p.pts.map(([a, b]) => [a + x.x, b + x.y]), closed: false }));
    els.push({ src: 'text', type: 'line', mode: 'line', parts, text: { id: k + 1, text: x.text, h: x.h } });
  });
  return els;
}

const TOOLSETS = [
  { name: 'ball 1/8 a 0.1', p: { toolType: 'ball', dia: 3.175, depth: 0.1, stepdown: 0.2 }, tools: [{ t: 3, type: 'ball', dia: 3.175 }] },
  { name: 'plana 1/8 a 0.5', p: { toolType: 'flat', dia: 3.175, depth: 0.5, stepdown: 0.2 }, tools: [{ t: 2, type: 'flat', dia: 3.175 }] },
  { name: 'plana 1 mm', p: { toolType: 'flat', dia: 1, depth: 0.3, stepdown: 0.3 }, tools: [{ t: 7, type: 'flat', dia: 1 }] },
  { name: 'V 60°', p: { toolType: 'v', dia: 6, depth: 1.5, stepdown: 0.5, vAngle: 60, vTip: 0.1 }, tools: [{ t: 5, type: 'v', dia: 6 }] },
  { name: 'ball + plana 1/4', p: { toolType: 'ball', dia: 3.175, depth: 0.1, stepdown: 0.5 }, tools: [{ t: 3, type: 'ball', dia: 3.175 }, { t: 1, type: 'flat', dia: 6.35, fxy: 400, fz: 120 }] },
  { name: 'ball + plana 1/8 + V', p: { toolType: 'ball', dia: 3.175, depth: 0.2, stepdown: 1 }, tools: [{ t: 3, type: 'ball', dia: 3.175 }, { t: 4, type: 'flat', dia: 3.175, fxy: 300, fz: 90 }, { t: 9, type: 'v', dia: 6, vAngle: 90, fxy: 200, fz: 80 }] },
];

/** Corre una pieza por todo el camino y devuelve los problemas que encuentra el verificador. */
async function run(els, sc) {
  const { W, H } = sc, p = { stepoverPct: 45, ...sc.set.p };
  const fz = 60, fxy = 130;
  const tools = sc.set.tools.map((t, k) => ({ fxy, fz, ...t, ...(k === 0 ? { fxy, fz } : {}) }));
  const tl = toolGeometry(p);
  let all = els;
  if (sc.copies > 1) {
    const boxes = els.filter(e => e.mode !== 'skip').map(bbox).filter(Boolean), r = Math.max(...tools.map(t => t.dia)) / 2;
    const box = [Math.min(...boxes.map(b => b[0])) - r, Math.min(...boxes.map(b => b[1])) - r, Math.max(...boxes.map(b => b[2])) + r, Math.max(...boxes.map(b => b[3])) + r];
    const { offsets } = copyOffsets(box, sc.copies, { W, H, gap: 2 });
    all = els.concat(offsets.flatMap(([dx, dy], k) => els.map((e, i) => Object.assign(shiftElement(e, dx, dy), { copyOf: i, copyN: k + 2 }))));
  }
  assignOps(all, tools, tl, { thick: sc.thick });
  const plan = await computePlan(all, tl, { tol: sc.tol });
  const o = { W, H, dialect: sc.dialect, dec: sc.dec, retract: sc.retract, fz, fxy, toolNum: tools[0].t, rpm: 2200, prog: 1, arcs: sc.arcs, changer: sc.changer, tools };
  const g = generateGcode(plan, all, o);
  const maxDepth = Math.max(tl.depth, ...all.filter(e => e.mode !== 'skip').map(e => e.op.depth));
  const probs = verifyProgram(g.text, { dialect: sc.dialect, W, H, retract: sc.retract, dec: sc.dec, maxDepth, changer: sc.changer, tools });
  if (!Number.isFinite(g.mins) || (g.cutLen > 0 && !(g.mins > 0))) probs.push(`duración inválida: ${g.mins}`);
  return { probs, g, all };
}

const scenario = (t, over = {}) => ({
  W: t.W, H: t.H, set: pick(TOOLSETS), thick: pick([1.5, 3, 6, 12]), dialect: pick(['fanuc', 'grbl']), changer: rnd() < 0.7,
  dec: pick([2, 3]), arcs: rnd() < 0.8, tol: pick([0.01, 0.05]), retract: pick([1, 3, 5]), copies: 1, ...over,
});
const tag = sc => `${sc.set.name} · grosor ${sc.thick} · ${sc.dialect}${sc.changer ? '' : ' sin cambiador'} · ${sc.dec} dec${sc.arcs ? '' : ' sin arcos'}${sc.copies > 1 ? ` · ${sc.copies} copias` : ''}`;

describe('auditoría del programa G', () => {
  it('las plantillas tal como vienen, con cada juego de herramientas y los dos controladores', async () => {
    const problems = [];
    for (const [name, t] of Object.entries(TEMPLATES)) for (const set of TOOLSETS) for (const dialect of ['fanuc', 'grbl']) {
      const sc = scenario(t, { set, dialect, changer: true, thick: 3 });
      const { probs } = await run(templateElements(t), sc);
      probs.slice(0, 3).forEach(m => problems.push(`${name} · ${tag(sc)} · ${m}`));
    }
    expect(problems).toEqual([]);
  }, 180000);

  it('150 combinaciones al azar de modo, herramienta, grosor, controlador, decimales y copias', async () => {
    const problems = [];
    const names = Object.keys(TEMPLATES);
    for (let k = 0; k < 150; k++) {
      const name = pick(names), t = TEMPLATES[name];
      const els = templateElements(t);
      const copies = rnd() < 0.25 ? pick([2, 3, 5]) : 1;
      const sc = scenario(t, copies > 1 ? { copies, W: t.W * 3 + 30, H: t.H * 2 + 20 } : {});
      const hasV = sc.set.tools.some(x => x.type === 'v');
      els.forEach(e => {
        if (e.type !== 'region') { if (rnd() < 0.1) e.mode = 'skip'; return; }
        const modes = ['fill', 'contour', 'invert', 'cut', 'skip', ...(hasV ? ['vcarve'] : []), ...(circleOf(e) ? ['drill', 'drill'] : [])];
        if (rnd() < 0.8) e.mode = pick(modes);
        if (rnd() < 0.2) e.opts = { depth: pick([0.05, 0.4, 1, 2.5]) };
        if (e.mode === 'cut' && rnd() < 0.4) e.opts = { tabs: pick([0, 2, 5]) };
      });
      const { probs } = await run(els, sc);
      probs.slice(0, 3).forEach(m => problems.push(`${name} #${k} · ${tag(sc)} · ${m}`));
    }
    expect(problems).toEqual([]);
  }, 300000);

  it('barrenos: de un golpe, con picoteo y en espiral, en los dos controladores', async () => {
    const problems = [];
    const circle = (cx, cy, r) => ({ type: 'circle', cx, cy, r });
    for (const thick of [2, 6, 15]) for (const dialect of ['fanuc', 'grbl']) for (const dia of [3.175, 6]) {
      const t = { W: 80, H: 40 };
      const ents = [circle(10, 10, dia / 2), circle(30, 12, dia / 2 + 0.1), circle(50, 20, dia * 1.2), circle(70, 28, dia * 0.56)].map((e, i) => ({ ...e, id: i + 1 }));
      const els = sketchElements(ents, { 1: 'drill', 2: 'drill', 3: 'drill', 4: 'drill' });
      const set = { name: `plana ${dia}`, p: { toolType: 'flat', dia, depth: 0.2, stepdown: 1 }, tools: [{ t: 1, type: 'flat', dia }] };
      const sc = scenario(t, { set, thick, dialect, changer: true, arcs: true, dec: 2 });
      const { probs, g } = await run(els, sc);
      probs.slice(0, 3).forEach(m => problems.push(`barrenos · ${tag(sc)} · ${m}`));
      if (dialect === 'fanuc') {
        const deep = thick + 0.2 > 2.5 * dia;
        if (deep !== /G83/.test(g.text)) problems.push(`barrenos · ${tag(sc)} · ${deep ? 'debía' : 'no debía'} usar picoteo G83`);
        if (!/G02 .* Z-/.test(g.text)) problems.push(`barrenos · ${tag(sc)} · falta la espiral del barreno grande`);
      }
    }
    expect(problems).toEqual([]);
  }, 120000);

  it('relieves: escalón, rampa y ruido, con bola, plana y V, por niveles', async () => {
    const problems = [];
    const gw = 60, gh = 40;
    const shapes = {
      escalon: (i, j) => (i > gw / 2 ? 1 : 0),
      rampa: (i, j) => i / (gw - 1),
      ruido: () => rnd(),
      cono: (i, j) => Math.min(1, Math.hypot(i - gw / 2, j - gh / 2) / 20),
    };
    for (const [name, fn] of Object.entries(shapes)) for (const set of [TOOLSETS[0], TOOLSETS[1], TOOLSETS[3]]) for (const dialect of ['fanuc', 'grbl']) {
      const data = new Float32Array(gw * gh);
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) data[j * gw + i] = fn(i, j);
      const el = { src: 'design', type: 'relief', mode: 'relief', relief: { x0: 5, y0: 5, w: 30, h: 20, gw, gh, data }, opts: { depth: pick([0.5, 2, 4]) } };
      const sc = scenario({ W: 40, H: 30 }, { set: { ...set, p: { ...set.p, stepdown: 0.8 } }, dialect, changer: true });
      const { probs } = await run([el], sc);
      probs.slice(0, 3).forEach(m => problems.push(`relieve ${name} · ${tag(sc)} · ${m}`));
    }
    expect(problems).toEqual([]);
  }, 180000);

  it('el verificador sí detecta un programa peligroso', async () => {
    const t = TEMPLATES.llavero;
    const sc = scenario(t, { set: TOOLSETS[1], dialect: 'fanuc', changer: true, thick: 3, dec: 2, arcs: true, retract: 3 });
    const { g } = await run(templateElements(t), sc);
    const c = { dialect: 'fanuc', W: t.W, H: t.H, retract: 3, dec: 2, maxDepth: 3.2, tools: [{ t: 2, dia: 3.175, fz: 60, fxy: 130 }] };
    expect(verifyProgram(g.text, c)).toEqual([]);
    const L = g.text.split('\n');
    const mutate = fn => { const m = L.slice(); fn(m); return verifyProgram(m.join('\n'), c); };
    const iCut = L.findIndex(l => /^G01 X/.test(l));
    expect(mutate(m => { m[iCut] = m[iCut].replace('G01', 'G00'); })[0]).toMatch(/rápido en X-Y/);
    expect(mutate(m => { m.splice(m.findIndex(l => /M03/.test(l)), 1); })[0]).toMatch(/husillo apagado/);
    expect(mutate(m => { const k = m.findIndex(l => /^G01 Z-/.test(l)); m[k] = 'G01 Z-9.00 F60'; }).join()).toMatch(/más hondo/);
    expect(mutate(m => { const k = m.findIndex(l => /^G01 Z-?[\d.]+ F60$/.test(l)); m[k] = m[k].replace('F60', 'F900'); }).join()).toMatch(/en vez de F60/);
    expect(mutate(m => { m[iCut] = 'G01 X500.00 F130'; }).join()).toMatch(/fuera de la pieza/);
    expect(mutate(m => { m.splice(m.lastIndexOf('M05'), 1); }).join()).toMatch(/husillo encendido/);
    expect(mutate(m => { m[2] = '(pieza con acentó)'; }).join()).toMatch(/comentario/);
  }, 60000);
});
