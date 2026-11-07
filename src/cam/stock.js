// Simulación del material: una placa virtual (cuadrícula de alturas) que se va tallando con la forma de cada
// herramienta a lo largo del programa ya escrito. Así se ve la pieza como queda: hondos, puentes, barrenos y relieve.
// Puro: corre en el worker.
import { explainProgram } from './explain.js';
import { buildTimeline, segPoint } from './simulate.js';

/**
 * @param {string} text programa G
 * @param {{W:number, H:number, res?:number, toolNum:number, tools:{t:number, type:string, dia:number, vAngle?:number}[]}} o
 *   tools: las herramientas por número T; el programa dice cuál está puesta (T#)
 * @returns {{gw:number, gh:number, res:number, z:Float32Array, deepest:number}} z: altura de cada celda (0 = la cara,
 *   negativa = tallada), fila 0 abajo (Y = 0)
 */
export function carveStock(text, o) {
  const res = o.res || Math.max(0.05, Math.min(0.25, Math.max(o.W, o.H) / 700));
  const gw = Math.max(1, Math.ceil(o.W / res)), gh = Math.max(1, Math.ceil(o.H / res));
  const z = new Float32Array(gw * gh);
  const ex = explainProgram(text);
  // qué herramienta está puesta en cada línea
  const toolAt = new Map();
  let cur = o.toolNum;
  ex.forEach(e => { const m = e.code.match(/T(\d+)/i); if (m && !/^\s*\(/.test(e.code)) cur = +m[1]; toolAt.set(e.n, cur); });
  const byT = new Map(o.tools.map(t => [t.t, t]));
  // sello de cada herramienta: celdas dentro de su radio y cuánto sube la punta en cada una
  const stamps = new Map();
  const stampOf = t => {
    if (stamps.has(t)) return stamps.get(t);
    const tool = byT.get(t) || o.tools[0];
    const R = tool.dia / 2, n = Math.ceil(R / res), tan = Math.tan(Math.min(170, Math.max(5, +tool.vAngle || 60)) * Math.PI / 360);
    const prof = tool.type === 'ball' ? d => R - Math.sqrt(Math.max(0, R * R - d * d)) : tool.type === 'v' ? d => d / tan : () => 0;
    const cells = [];
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) { const d = Math.hypot(i, j) * res; if (d <= R) cells.push(i, j, prof(d)); }
    // entre sello y sello: una celda, o un quinto del radio con herramientas grandes (la orilla se aparta < 0.02 mm)
    const s = { cells, step: Math.max(res * 0.75, R * 0.2, 0.02) };
    stamps.set(t, s);
    return s;
  };
  let deepest = 0;
  const stamp = (s, x, y, zz) => {
    const ci = Math.floor(x / res), cj = Math.floor(y / res), c = s.cells;
    for (let k = 0; k < c.length; k += 3) {
      const i = ci + c[k], j = cj + c[k + 1];
      if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
      const v = zz + c[k + 2], q = j * gw + i;
      if (v < z[q]) { z[q] = v; if (v < deepest) deepest = v; }
    }
  };
  buildTimeline(ex).segs.forEach(sg => {
    if (Math.min(sg.from[2], sg.to[2]) >= 0) return; // por encima de la cara no corta
    const s = stampOf(toolAt.get(sg.n));
    const xy = sg.arc ? Math.abs(sg.arc.sweep) * sg.arc.r : Math.hypot(sg.to[0] - sg.from[0], sg.to[1] - sg.from[1]);
    const n = Math.max(1, Math.ceil(xy / s.step));
    for (let k = 0; k <= n; k++) {
      const [x, y, zz] = segPoint(sg, k / n);
      if (zz < 0) stamp(s, x, y, zz);
    }
  });
  return { gw, gh, res, z, deepest };
}

/**
 * Imagen sombreada de la placa tallada: el color va de la placa (la cara) al del corte (lo más hondo), con luz desde
 * arriba a la izquierda para que se lean los bordes y el relieve.
 * @param {{gw:number, gh:number, res:number, z:Float32Array, deepest:number}} s
 * @param {[number,number,number]} top color de la cara (RGB) @param {[number,number,number]} low color de lo más hondo
 * @returns {Uint8ClampedArray} RGBA, fila 0 arriba (como una imagen)
 */
export function shadeStock(s, top, low) {
  const { gw, gh, res, z } = s, out = new Uint8ClampedArray(gw * gh * 4);
  const span = Math.max(0.05, -s.deepest);
  const L = [-0.5, 0.5, 0.7], ln = Math.hypot(...L);
  const at = (i, j) => z[Math.min(gh - 1, Math.max(0, j)) * gw + Math.min(gw - 1, Math.max(0, i))];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const h = at(i, j);
    // normal por diferencias centrales (exagerada para que un grabado de décimas se alcance a ver)
    const k = 4, dx = (at(i + 1, j) - at(i - 1, j)) / (2 * res) * k, dy = (at(i, j + 1) - at(i, j - 1)) / (2 * res) * k;
    const nl = Math.hypot(dx, dy, 1), lit = Math.max(0, (-dx * L[0] - dy * L[1] + L[2]) / (nl * ln));
    const t = Math.min(1, -h / span), sh = 0.55 + 0.45 * lit;
    const q = 4 * ((gh - 1 - j) * gw + i);
    for (let c = 0; c < 3; c++) out[q + c] = (top[c] + (low[c] - top[c]) * t) * sh;
    out[q + 3] = 255;
  }
  return out;
}
