// Varias herramientas en un programa: cuál usa cada figura y en qué orden se cambian.
import { toolGeometry } from './tool.js';
import { elementOp } from './cut.js';

/** @typedef {{t:number, type:'ball'|'flat'|'v', dia:number, vAngle?:number, fxy?:number, fz?:number}} ToolDef  t: número en el carrusel (T#) */

/**
 * Índice (en `tools`) de la herramienta con que se corta la figura: la que eligió el usuario; si no, para recortar o
 * barrenar la primera fresa plana que haya (corta bien de lado y deja la orilla recta); para lo demás, la principal (0).
 * @param {{mode:string, opts?:{tool?:number}}} e
 * @param {ToolDef[]} tools
 */
export function toolFor(e, tools) {
  const k = e.opts?.tool;
  if (k != null && k >= 0 && k < tools.length) return k;
  if (e.mode === 'cut' || e.mode === 'drill') {
    const flat = tools.findIndex(t => t.type === 'flat');
    if (flat >= 0) return flat;
  }
  if (e.mode === 'vcarve') {
    const v = tools.findIndex(t => t.type === 'v');
    if (v >= 0) return v;
  }
  return 0;
}

/**
 * Decide cómo se corta cada figura y lo deja en `e.op`: su herramienta (`tool`, y `base`: esa herramienta a la
 * profundidad del trabajo), su profundidad (la del trabajo, la suya o atravesar el grosor) y sus puentes.
 * Las copias siguen el modo y los ajustes de su original.
 * @param {import('../model.js').Element[]} elements
 * @param {ToolDef[]} tools la 0 es la principal
 * @param {ReturnType<typeof toolGeometry>} tl la principal a la profundidad del trabajo
 * @param {{thick:number}} p
 * @returns {ReturnType<typeof toolGeometry>[]} cada herramienta a la profundidad del trabajo
 */
export function assignOps(elements, tools, tl, p) {
  const bases = tools.map((t, k) => (k ? toolGeometry({ ...tl.src, depth: tl.depth, toolType: t.type, dia: t.dia, vAngle: t.vAngle ?? tl.src.vAngle }) : tl));
  elements.forEach(e => {
    if (e.copyOf != null) { const b = elements[e.copyOf]; e.mode = b.mode; e.opts = b.opts; }
    const k = toolFor(e, tools);
    e.op = { ...elementOp(e, { depth: tl.depth, thick: p.thick, dia: bases[k].D }), tool: k, base: bases[k] };
  });
  return bases;
}

/** Herramientas (índices) que usa el programa, en el orden en que entran. */
export const usedTools = order => [...new Set(order.map(x => x.tool || 0))];

const NAME = { ball: 'Ball mill', flat: 'Fresa plana', v: 'V-bit' };
/** "T3 · Ball mill de 3.175 mm" */
export const toolLabel = t => `T${t.t} · ${NAME[t.type] || t.type} de ${+(+t.dia).toFixed(3)} mm`;
