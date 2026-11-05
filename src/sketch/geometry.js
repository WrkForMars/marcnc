// Croquis: figuras definidas por coordenadas en mm sobre la pieza (origen abajo a la izquierda, Y hacia arriba).
// Puro (sin DOM): geometría, lectura de coordenadas tecleadas, ajuste a puntos y conversión a elementos.
import { regionsFromPaths, toC } from '../geometry/clipper.js';
import { distSeg, pointInPolygon } from '../geometry/simplify.js';

/**
 * Ángulos en grados, antihorario desde +X. El arco va de a1 a a2 en sentido antihorario.
 * El polígono regular se define por su círculo circunscrito (r) y el ángulo del primer vértice (rot).
 * @typedef {{id:number, type:'line', pts:[number,number][], closed:boolean}
 *   |{id:number, type:'rect', x:number, y:number, w:number, h:number}
 *   |{id:number, type:'circle', cx:number, cy:number, r:number}
 *   |{id:number, type:'arc', cx:number, cy:number, r:number, a1:number, a2:number}
 *   |{id:number, type:'poly', cx:number, cy:number, r:number, n:number, rot:number}} Entity
 */

export const ENTITY_NAME = { line: 'Línea', rect: 'Rectángulo', circle: 'Círculo', arc: 'Arco', poly: 'Polígono' };

const RAD = Math.PI / 180;
const fmt = v => String(+v.toFixed(2));

/** Barrido del arco en grados (0 < s ≤ 360). */
export const arcSweep = e => { const s = (((e.a2 - e.a1) % 360) + 360) % 360; return s || 360; };

export const isClosed = e => (e.type === 'line' ? e.closed : e.type !== 'arc');

/** Pasos para que la cuerda no se aleje más de `tol` del arco de radio r. */
const arcSteps = (r, deg, tol) => Math.max(2, Math.ceil((deg * RAD) / (2 * Math.acos(Math.max(-1, 1 - tol / Math.max(r, 1e-9))))));

/**
 * Polilínea de la figura (sin repetir el primer punto en las cerradas).
 * @param {Entity} e @param {number} [tol] desviación máxima de las curvas en mm
 * @returns {{pts:[number,number][], closed:boolean}}
 */
export function entityPts(e, tol = 0.005) {
  switch (e.type) {
    case 'line': return { pts: e.pts.map(p => [p[0], p[1]]), closed: e.closed };
    case 'rect': {
      const x0 = Math.min(e.x, e.x + e.w), x1 = Math.max(e.x, e.x + e.w), y0 = Math.min(e.y, e.y + e.h), y1 = Math.max(e.y, e.y + e.h);
      return { pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true };
    }
    case 'circle': {
      const n = Math.max(12, arcSteps(e.r, 360, tol));
      return { pts: Array.from({ length: n }, (_, k) => [e.cx + e.r * Math.cos(2 * Math.PI * k / n), e.cy + e.r * Math.sin(2 * Math.PI * k / n)]), closed: true };
    }
    case 'arc': {
      const s = arcSweep(e), n = arcSteps(e.r, s, tol);
      return { pts: Array.from({ length: n + 1 }, (_, k) => { const a = (e.a1 + s * k / n) * RAD; return [e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a)]; }), closed: false };
    }
    case 'poly': {
      const n = Math.max(3, Math.round(e.n));
      return { pts: Array.from({ length: n }, (_, k) => { const a = (e.rot + 360 * k / n) * RAD; return [e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a)]; }), closed: true };
    }
  }
  return { pts: [], closed: false };
}

/** Puntos a los que se puede pegar el cursor: extremos y vértices, puntos medios y centros. */
export function snapPoints(e) {
  const out = [];
  const { pts, closed } = entityPts(e, 0.05);
  if (e.type === 'circle') {
    out.push({ p: [e.cx, e.cy], kind: 'centro' });
    [0, 90, 180, 270].forEach(a => out.push({ p: [e.cx + e.r * Math.cos(a * RAD), e.cy + e.r * Math.sin(a * RAD)], kind: 'cuadrante' }));
    return out;
  }
  if (e.type === 'arc') {
    out.push({ p: [e.cx, e.cy], kind: 'centro' }, { p: pts[0], kind: 'extremo' }, { p: pts[pts.length - 1], kind: 'extremo' });
    const am = (e.a1 + arcSweep(e) / 2) * RAD;
    out.push({ p: [e.cx + e.r * Math.cos(am), e.cy + e.r * Math.sin(am)], kind: 'medio' });
    return out;
  }
  if (e.type === 'poly') out.push({ p: [e.cx, e.cy], kind: 'centro' });
  if (e.type === 'rect') out.push({ p: [e.x + e.w / 2, e.y + e.h / 2], kind: 'centro' });
  pts.forEach((p, i) => {
    out.push({ p, kind: 'extremo' });
    const q = pts[i + 1] || (closed ? pts[0] : null);
    if (q) out.push({ p: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], kind: 'medio' });
  });
  return out;
}

/**
 * Ajuste del cursor: primero a un punto notable cercano, si no a la cuadrícula.
 * @param {[number,number]} p cursor en mm
 * @param {Entity[]} entities
 * @param {{grid:number, snap:boolean, tol:number, extra?:[number,number][]}} o extra = puntos ya marcados de la figura en curso
 * @returns {{p:[number,number], kind:string}}
 */
export function snap(p, entities, o) {
  if (!o.snap) return { p, kind: '' };
  let best = null, bd = o.tol;
  const consider = (q, kind) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d <= bd) { bd = d; best = { p: [q[0], q[1]], kind }; } };
  entities.forEach(e => snapPoints(e).forEach(s => consider(s.p, s.kind)));
  (o.extra || []).forEach(q => consider(q, 'extremo'));
  if (best) return best;
  const g = o.grid > 0 ? o.grid : 1;
  return { p: [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g], kind: 'cuadrícula' };
}

/**
 * Lee lo que el usuario teclea como punto: "x y", "x;y" o "x,y" absoluto; "@dx dy" relativo al último punto;
 * "@d<ángulo" polar relativo. Acepta coma decimal si los valores se separan con espacio o punto y coma.
 * @returns {[number,number]|null}
 */
export function parsePoint(str, last = [0, 0]) {
  let s = String(str).trim();
  if (!s) return null;
  const rel = s.startsWith('@');
  if (rel) s = s.slice(1).trim();
  const polar = s.match(/^([-+]?[\d.,]+)\s*<\s*([-+]?[\d.,]+)$/);
  if (polar) {
    const d = parseNum(polar[1]), a = parseNum(polar[2]);
    if (d === null || a === null) return null;
    const o = rel ? last : [0, 0];
    return [o[0] + d * Math.cos(a * RAD), o[1] + d * Math.sin(a * RAD)];
  }
  let parts = s.split(/\s*;\s*|\s+/).filter(Boolean);
  if (parts.length === 1) parts = s.split(',');
  if (parts.length !== 2) return null;
  const x = parseNum(parts[0]), y = parseNum(parts[1]);
  if (x === null || y === null) return null;
  return rel ? [last[0] + x, last[1] + y] : [x, y];
}

/** Número con punto o coma decimal; null si no es número. */
export function parseNum(str) {
  const s = String(str).trim().replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  return parseFloat(s);
}

/** Distancia del punto al trazo de la figura (para seleccionar con el cursor). */
export function entityDist(e, p) {
  const { pts, closed } = entityPts(e, 0.05);
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distSeg(p, pts[i - 1], pts[i]));
  if (closed && pts.length > 2) d = Math.min(d, distSeg(p, pts[pts.length - 1], pts[0]));
  return d;
}

/** Figura más cercana al punto dentro de `tol` mm, o null. */
export function hitEntity(entities, p, tol) {
  let best = null, bd = tol;
  entities.forEach(e => { const d = entityDist(e, p); if (d <= bd) { bd = d; best = e; } });
  return best;
}

export function translate(e, dx, dy) {
  if (e.type === 'line') return { ...e, pts: e.pts.map(([x, y]) => [x + dx, y + dy]) };
  if (e.type === 'rect') return { ...e, x: e.x + dx, y: e.y + dy };
  return { ...e, cx: e.cx + dx, cy: e.cy + dy };
}

/** Texto corto con las medidas, para la lista de figuras. */
export function describe(e) {
  switch (e.type) {
    case 'rect': return `${fmt(Math.abs(e.w))} × ${fmt(Math.abs(e.h))} mm`;
    case 'circle': return `Ø ${fmt(2 * e.r)} mm`;
    case 'arc': return `R ${fmt(e.r)} · ${fmt(arcSweep(e))}°`;
    case 'poly': return `${Math.round(e.n)} lados · Ø ${fmt(2 * e.r)}`;
    case 'line': {
      let L = 0;
      e.pts.forEach((p, i) => { if (i) L += Math.hypot(p[0] - e.pts[i - 1][0], p[1] - e.pts[i - 1][1]); });
      if (e.closed && e.pts.length > 2) L += Math.hypot(e.pts[0][0] - e.pts.at(-1)[0], e.pts[0][1] - e.pts.at(-1)[1]);
      return `${e.pts.length} puntos · ${fmt(L)} mm${e.closed ? ' · cerrada' : ''}`;
    }
  }
  return '';
}

const signedArea = pts => pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

/**
 * Convierte el croquis en elementos. Una figura cerrada dentro de otra es su hueco (como en un croquis de CAD);
 * una dentro de un hueco vuelve a ser figura. Las abiertas (líneas y arcos) se graban como trazos.
 * @param {Entity[]} entities
 * @param {Map<number,string>|Object<number,string>} [modes] modo elegido para cada figura (por id de la exterior)
 * @returns {import('../model.js').Element[]}
 */
export function sketchElements(entities, modes = {}) {
  const get = id => (modes instanceof Map ? modes.get(id) : modes[id]);
  const closed = entities.filter(isClosed).map(e => {
    const pts = entityPts(e).pts;
    return { e, pts, a: Math.abs(signedArea(pts)) };
  }).filter(c => c.pts.length > 2 && c.a > 1e-9);
  // padre = la figura cerrada más chica que contiene a esta por completo
  const inside = (c, o) => o !== c && o.a > c.a && c.pts.every(p => pointInPolygon(p, o.pts));
  closed.forEach(c => {
    c.parent = null;
    closed.forEach(o => { if (inside(c, o) && (!c.parent || o.a < c.parent.a)) c.parent = o; });
  });
  closed.forEach(c => { let d = 0; for (let q = c.parent; q; q = q.parent) d++; c.depth = d; });

  const out = [];
  closed.filter(c => c.depth % 2 === 0).forEach(c => {
    const holes = closed.filter(h => h.parent === c);
    const ccw = pts => (signedArea(pts) > 0 ? pts : pts.slice().reverse());
    const cw = pts => (signedArea(pts) < 0 ? pts : pts.slice().reverse());
    const regs = regionsFromPaths([toC(ccw(c.pts)), ...holes.map(h => toC(cw(h.pts)))], 0);
    if (!regs.length) return;
    const nh = holes.length;
    out.push({
      src: 'sketch', type: 'region', sketchId: c.e.id, mode: get(c.e.id) || 'fill',
      parts: regs.map(r => ({ outer: r.outer, holes: r.holes })),
      label: ENTITY_NAME[c.e.type], detail: describe(c.e) + (nh ? ` · ${nh} hueco${nh > 1 ? 's' : ''}` : ''),
      sig: JSON.stringify([c.e, ...holes.map(h => h.e)]),
    });
  });
  entities.filter(e => !isClosed(e)).forEach(e => {
    const lp = entityPts(e);
    if (lp.pts.length < 2) return;
    out.push({
      src: 'sketch', type: 'line', sketchId: e.id, mode: get(e.id) || 'line', parts: [lp],
      label: ENTITY_NAME[e.type], detail: describe(e), sig: JSON.stringify(e),
    });
  });
  return out;
}
