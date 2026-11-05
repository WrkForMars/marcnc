// Del dibujo cargado (SVG o imagen) a elementos en mm sobre la pieza.
import { CL, diff, regionsFromPaths, toC, treeToPaths, union } from './geometry/clipper.js';
import { MAX_ELEMENTS } from './model.js';

/**
 * @param {import('./input/svg.js').RawShape[] & {native?:{unit:number,h:number}}} raw
 * @param {{W:number, H:number, margin:number, fit:'fill'|'native', speck:number}} p
 * @param {import('./model.js').Element[]} [previous] para conservar los modos si la geometría no cambió de forma
 * @returns {{elements: import('./model.js').Element[], note: string, scale: number}} scale = mm por unidad de lienzo
 */
export function buildDesign(raw, p, previous = []) {
  const out = { elements: [], note: '', scale: 0 };
  if (!raw) return out;
  const { W, H } = p;
  const M = Math.max(0, p.margin || 0);
  const minA = Math.max(0, p.speck || 0);

  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  raw.forEach(s => {
    const sets = s.kind === 'fill' ? (s.white ? [] : s.rings) : s.lines.map(l => l.pts);
    sets.forEach(r => r.forEach(([x, y]) => {
      if (x < minx) minx = x; if (y < miny) miny = y;
      if (x > maxx) maxx = x; if (y > maxy) maxy = y;
    }));
  });
  if (!isFinite(minx)) return out;

  const bw = Math.max(maxx - minx, 1e-6), bh = Math.max(maxy - miny, 1e-6);
  const k = Math.min((W - 2 * M) / bw, (H - 2 * M) / bh);
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  const native = p.fit === 'native' && raw.native;
  out.scale = native ? 1 / raw.native.unit : k;
  // Y del lienzo crece hacia abajo; la máquina, hacia arriba
  const T = native
    ? ([x, y]) => [x / raw.native.unit, raw.native.h - y / raw.native.unit]
    : ([x, y]) => [W / 2 + (x - cx) * k, H / 2 - (y - cy) * k];

  // composición en orden de pintura: una figura blanca recorta lo que ya estaba
  let list = [];
  raw.forEach(s => {
    if (s.kind === 'fill') {
      const ft = s.rule === 'evenodd' ? CL.PolyFillType.pftEvenOdd : CL.PolyFillType.pftNonZero;
      const paths = treeToPaths(union(s.rings.map(r => toC(r.map(T))), ft));
      if (s.white) list = list.map(r => (r.kind === 'fill' ? { ...r, paths: diff(r.paths, paths) } : r));
      else list.push({ kind: 'fill', paths });
    } else {
      list.push({ kind: 'stroke', group: !!s.group, lines: s.lines.map(l => ({ pts: l.pts.map(T), closed: l.closed })) });
    }
  });

  let regs = [], lines = [];
  list.forEach(r => {
    // cada línea es una figura, salvo que vengan agrupadas (una pieza de la imagen = una figura)
    if (r.kind === 'stroke') lines.push(...(r.group ? [r.lines] : r.lines.map(l => [l])));
    else regs.push(...regionsFromPaths(r.paths, minA));
  });
  if (regs.length + lines.length > MAX_ELEMENTS) {
    const before = regs.length + lines.length;
    regs.sort((a, b) => b.a - a.a);
    regs = regs.slice(0, Math.max(0, MAX_ELEMENTS - lines.length));
    lines = lines.slice(0, MAX_ELEMENTS);
    out.note = `El dibujo tiene ${before} figuras; se conservaron las ${MAX_ELEMENTS} más grandes. Sube el valor de "Ignorar manchas" o usa una imagen más limpia.`;
  }
  regs.forEach(r => out.elements.push({ src: 'design', type: 'region', parts: [{ outer: r.outer, holes: r.holes }], mode: 'fill' }));
  lines.forEach(g => out.elements.push({ src: 'design', type: 'line', parts: g, mode: 'line' }));

  if (previous.length === out.elements.length) {
    out.elements.forEach((e, i) => { if (previous[i].type === e.type) e.mode = previous[i].mode; });
  }
  return out;
}
