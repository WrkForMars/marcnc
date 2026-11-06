// Piezas aleatorias (semilla fija) por todo el flujo: plan → G-code. Revisa las reglas que protegen la máquina.
import { describe, expect, it } from 'vitest';
import { explainProgram } from '../src/cam/explain.js';
import { generateGcode } from '../src/cam/gcode.js';
import { computePlan } from '../src/cam/plan.js';
import { buildTimeline, segPoint } from '../src/cam/simulate.js';
import { elementOp } from '../src/cam/cut.js';
import { toolGeometry } from '../src/cam/tool.js';
import { toC } from '../src/geometry/clipper.js';
import { distSeg } from '../src/geometry/simplify.js';

const W = 90, H = 50;
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const ring = (cx, cy, r, n, jitter = 0) => Array.from({ length: n }, (_, k) => {
  const a = 2 * Math.PI * k / n, rr = r * (1 - jitter * rnd());
  return [Math.min(W - 1, Math.max(1, cx + rr * Math.cos(a))), Math.min(H - 1, Math.max(1, cy + rr * Math.sin(a)))];
});
/** Polígonos regulares (vértices sobre un círculo: el caso de los arcos falsos), círculos, estrellas y figuras muy finas. */
function shape() {
  const t = rnd(), cx = 10 + rnd() * 70, cy = 8 + rnd() * 34, r = 0.5 + rnd() * 10;
  if (t < 0.3) return ring(cx, cy, r, 3 + Math.floor(rnd() * 8));
  if (t < 0.55) return ring(cx, cy, r, 8 + Math.floor(rnd() * 150));
  if (t < 0.85) return ring(cx, cy, r, 5 + Math.floor(rnd() * 12), 0.7);
  return [[cx, cy], [cx + 2 * r, cy], [cx + 2 * r, cy + 0.05 + rnd() * 0.6], [cx, cy + 0.05 + rnd() * 0.6]];
}
const TOOLS = [
  { toolType: 'ball', dia: 3.175, depth: 0.1 }, { toolType: 'v', dia: 3.175, depth: 0.1, vAngle: 30, vTip: 0.05 },
  { toolType: 'flat', dia: 1, depth: 0.5, stepdown: 0.2 }, { toolType: 'ball', dia: 6, depth: 2, stepdown: 0.5 },
];

describe('piezas aleatorias', () => {
  it('60 programas cumplen las reglas de seguridad y los arcos son fieles', async () => {
    const problems = [];
    for (let it = 0; it < 60; it++) {
      const elements = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => {
        const pts = shape();
        return rnd() < 0.3
          ? { src: 'design', type: 'line', mode: 'line', parts: [{ pts, closed: rnd() < 0.5 }] }
          : { src: 'design', type: 'region', mode: ['fill', 'contour', 'invert', 'cut'][Math.floor(rnd() * 4)], parts: [{ outer: toC(pts), holes: [] }] };
      });
      const tl = toolGeometry({ stepoverPct: 30 + rnd() * 50, stepdown: 0.2, ...TOOLS[Math.floor(rnd() * TOOLS.length)] });
      // recortes de 1 a 4 mm de grosor, con puentes automáticos (o ninguno) y rampas
      const thick = 1 + Math.floor(rnd() * 4);
      elements.forEach(e => { e.op = elementOp(e, { depth: tl.depth, thick, dia: tl.D }); if (e.mode === 'cut' && rnd() < 0.3) e.op.tabs = 0; });
      const dec = [2, 3][Math.floor(rnd() * 2)], tol = [0.005, 0.02, 0.05, 0.2][Math.floor(rnd() * 4)];
      const plan = await computePlan(elements, tl, { tol });
      const g = generateGcode(plan, elements, { W, H, dialect: rnd() < 0.5 ? 'fanuc' : 'grbl', dec, retract: 3, fz: 60, fxy: 130, toolNum: 3, rpm: 2200, prog: 1, arcs: true });
      const tag = `pieza ${it}`;
      if (/NaN|Infinity|undefined/.test(g.text)) problems.push(`${tag}: valor inválido en el código`);
      const ex = explainProgram(g.text);
      ex.filter(e => e.kind === 'danger').forEach(e => problems.push(`${tag}: rápido con la herramienta abajo (línea ${e.n})`));
      // primer corte tras cada bajada lleva el avance X-Y
      let after = false;
      ex.forEach(e => {
        if (e.kind === 'plunge') after = true;
        else if (after && (e.kind === 'cut' || e.kind === 'arc')) { if (!/F130/.test(e.code)) problems.push(`${tag}: corte sin F130 tras bajada (línea ${e.n})`); after = false; }
        else if (e.kind === 'rapid' || e.kind === 'retract') after = false;
      });
      // arcos: radios iguales para el control y pegados a la trayectoria
      const segs = elements.flatMap(e => (e.paths || []).flatMap(p => { const d = p.dense || p.pts; return d.slice(1).map((q, i) => [d[i], q]); }));
      const lim = dec === 2 ? 0.005 : 0.002, arcTol = Math.max(tol, 0.75 * 10 ** -dec) + 3 * 10 ** -dec;
      buildTimeline(ex).segs.filter(s => s.arc).forEach(s => {
        const r0 = Math.hypot(s.from[0] - s.arc.c[0], s.from[1] - s.arc.c[1]), r1 = Math.hypot(s.to[0] - s.arc.c[0], s.to[1] - s.arc.c[1]);
        if (Math.abs(r0 - r1) > lim) problems.push(`${tag}: arco con radios ${r0.toFixed(4)} y ${r1.toFixed(4)} (línea ${s.n})`);
        for (let u = 0; u <= 1; u += 0.125) {
          const p = segPoint(s, u);
          const d = Math.min(...segs.map(([a, b]) => distSeg(p, a, b)));
          if (d > arcTol) { problems.push(`${tag}: arco se aparta ${d.toFixed(3)} mm (línea ${s.n})`); break; }
        }
      });
    }
    expect(problems).toEqual([]);
  });
});
