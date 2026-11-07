// Varias copias en una placa: el dibujo se repite en renglones, a partir de donde está, con una separación entre copias
// (más lo que la fresa sale por fuera al recortar). Puro: mm.
import { toC, fromC } from '../geometry/clipper.js';

/**
 * Dónde van las copias. La primera es el dibujo original (sin mover); las demás, a la derecha y luego arriba.
 * @param {[number,number,number,number]} box lo que ocupa el dibujo (x0, y0, x1, y1), ya con lo que sale la fresa
 * @param {number} n copias pedidas (contando el original)
 * @param {{W:number, H:number, gap:number}} p
 * @returns {{offsets:[number,number][], fit:number}} offsets: el corrimiento de cada copia extra; fit: cuántas caben
 */
export function copyOffsets(box, n, p) {
  const w = box[2] - box[0], h = box[3] - box[1], gap = Math.max(0, p.gap || 0);
  const cols = Math.max(1, Math.floor((p.W - box[0] + gap + 1e-9) / (w + gap)));
  const rows = Math.max(1, Math.floor((p.H - box[1] + gap + 1e-9) / (h + gap)));
  const fit = cols * rows, offsets = [];
  for (let k = 1; k < Math.min(n, fit); k++) offsets.push([(k % cols) * (w + gap), Math.floor(k / cols) * (h + gap)]);
  return { offsets, fit };
}

/**
 * Copia de una figura corrida (dx, dy) mm: el mismo modo y ajustes, otra posición.
 * @param {import('../model.js').Element} e
 */
export function shiftElement(e, dx, dy) {
  const c = { ...e, paths: undefined, warn: undefined };
  const mv = ([x, y]) => [x + dx, y + dy];
  if (e.type === 'relief') c.relief = { ...e.relief, x0: e.relief.x0 + dx, y0: e.relief.y0 + dy };
  else if (e.type === 'region') c.parts = e.parts.map(p => ({ outer: toC(fromC(p.outer).map(mv)), holes: p.holes.map(q => toC(fromC(q).map(mv))) }));
  else c.parts = e.parts.map(p => ({ ...p, pts: p.pts.map(mv) }));
  return c;
}
