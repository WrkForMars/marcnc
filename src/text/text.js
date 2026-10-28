// Textos sobre la pieza: geometría local (centrada en 0,0) + posición en mm.
import { CL, fromC, regionsFromPaths, toC, treeToPaths, union } from '../geometry/clipper.js';
import { binarize, tracedRings } from '../input/image.js';
import { hersheyText } from './hershey.js';

/** Estilos de letra disponibles en la interfaz. Las rellenas usan fuentes de Google Fonts cargadas en index.html. */
export const TEXT_FONTS = [
  ['futural', 'Una línea · Sencilla (ideal para grabar)'],
  ['scripts', 'Una línea · Cursiva'],
  ['fill:600 "IBM Plex Sans Condensed"', 'Rellena · Condensada'],
  ['fill:600 "IBM Plex Serif"', 'Rellena · Con remates'],
  ['fill:600 "IBM Plex Mono"', 'Rellena · Monoespaciada'],
];

/** Letra rellena: se dibuja en un canvas, se binariza y se vectoriza. Devuelve anillos en mm centrados. */
async function fillTextRings(t) {
  const fam = t.font.slice(5);
  const px = 160;
  const cut = fam.indexOf(' ');
  const weight = fam.slice(0, cut), name = fam.slice(cut + 1);
  const font = `${weight} ${px}px ${name}, sans-serif`;
  try { await document.fonts.load(`${weight} ${px}px ${name}`); } catch { /* usa la de respaldo */ }
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  x.font = font;
  const sp = (t.sp || 0) / 100 * px * 0.6;
  const chars = [...t.text];
  let wsum = 0;
  chars.forEach(ch => { wsum += x.measureText(ch).width + sp; });
  const cap = x.measureText('H').actualBoundingBoxAscent || px * 0.7;
  const W = Math.ceil(wsum + px * 0.6), H = Math.ceil(px * 1.8);
  c.width = W; c.height = H;
  x.font = font;
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#000'; x.textBaseline = 'alphabetic';
  const base = Math.round(px * 1.2);
  let cx0 = px * 0.3;
  chars.forEach(ch => { x.fillText(ch, cx0, base); cx0 += x.measureText(ch).width + sp; });
  const rings = tracedRings(binarize(x.getImageData(0, 0, W, H), 128));
  const s = t.h / cap, mx = px * 0.3 + wsum / 2, my = base - cap / 2;
  return rings.map(r => r.map(([a, b]) => [(a - mx) * s, -(b - my) * s]));
}

/** Calcula `t.local` (geometría sin posicionar). */
export async function buildText(t) {
  if (!t.text.trim()) { t.local = null; return; }
  if (t.font.startsWith('fill:')) {
    const rings = await fillTextRings(t);
    const regs = regionsFromPaths(treeToPaths(union(rings.map(toC), CL.PolyFillType.pftEvenOdd)), 0.01);
    t.local = { type: 'region', parts: regs.map(r => ({ outer: fromC(r.outer), holes: r.holes.map(fromC) })) };
  } else {
    t.local = { type: 'line', parts: hersheyText(t) };
  }
}

/** Elemento listo para la lista y las trayectorias, con el texto movido a (t.x, t.y). */
export function textElement(t) {
  if (!t.local) return null;
  const mv = ([x, y]) => [x + t.x, y + t.y];
  const parts = t.local.type === 'region'
    ? t.local.parts.map(p => ({ outer: toC(p.outer.map(mv)), holes: p.holes.map(h => toC(h.map(mv))) }))
    : t.local.parts.map(p => ({ pts: p.pts.map(mv), closed: p.closed }));
  const fallback = t.local.type === 'line' ? 'line' : 'fill';
  const valid = t.local.type === 'line' ? ['line', 'skip'] : ['fill', 'contour', 'invert', 'skip'];
  return { src: 'text', text: t, type: t.local.type, parts, mode: valid.includes(t.mode) ? t.mode : fallback };
}
