// Croquis: figuras definidas por coordenadas en mm sobre la pieza (origen abajo a la izquierda, Y hacia arriba).
// Puro (sin DOM): geometría, lectura de coordenadas tecleadas, ajuste a puntos y conversión a elementos.
import { regionsFromPaths, toC } from '../geometry/clipper.js';
import { distSeg, pointInPolygon } from '../geometry/simplify.js';

/**
 * Ángulos en grados, antihorario desde +X. El arco va de a1 a a2 en sentido antihorario.
 * El polígono regular se define por su círculo circunscrito (r) y el ángulo del primer vértice (rot).
 * Cualquier figura puede ser de construcción (`construction: true`): se dibuja punteada de referencia y no se graba.
 * La ranura va de centro (x1, y1) a centro (x2, y2) con ancho w (extremos redondos).
 * @typedef {{id:number, type:'line', pts:[number,number][], closed:boolean}
 *   |{id:number, type:'rect', x:number, y:number, w:number, h:number, rr?:number}
 *   |{id:number, type:'slot', x1:number, y1:number, x2:number, y2:number, w:number}
 *   |{id:number, type:'circle', cx:number, cy:number, r:number}
 *   |{id:number, type:'arc', cx:number, cy:number, r:number, a1:number, a2:number}
 *   |{id:number, type:'poly', cx:number, cy:number, r:number, n:number, rot:number}} Entity
 */

export const ENTITY_NAME = { line: 'Línea', rect: 'Rectángulo', circle: 'Círculo', arc: 'Arco', poly: 'Polígono', slot: 'Ranura' };
/** Nombre para mostrar: una línea cerrada (un contorno de un DXF, por ejemplo) es un perfil. */
export const entityName = e => (e.type === 'line' && e.closed && e.pts.length > 2 ? 'Perfil' : ENTITY_NAME[e.type]);

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
      const r = Math.min(Math.max(0, e.rr || 0), (x1 - x0) / 2, (y1 - y0) / 2);
      if (r <= 1e-6) return { pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true };
      // esquinas redondeadas: un cuarto de círculo en cada esquina, en sentido antihorario
      const n = arcSteps(r, 90, tol), pts = [];
      [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]].forEach(([cx, cy, a0]) => {
        for (let k = 0; k <= n; k++) { const a = (a0 + 90 * k / n) * RAD; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
      });
      return { pts, closed: true };
    }
    case 'slot': {
      const r = Math.max(1e-6, e.w / 2), a = Math.atan2(e.y2 - e.y1, e.x2 - e.x1) / RAD, n = arcSteps(r, 180, tol), pts = [];
      [[e.x2, e.y2, a - 90], [e.x1, e.y1, a + 90]].forEach(([cx, cy, a0]) => {
        for (let k = 0; k <= n; k++) { const b = (a0 + 180 * k / n) * RAD; pts.push([cx + r * Math.cos(b), cy + r * Math.sin(b)]); }
      });
      return { pts, closed: true };
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
  if (e.type === 'slot') {
    out.push({ p: [e.x1, e.y1], kind: 'centro' }, { p: [e.x2, e.y2], kind: 'centro' }, { p: [(e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2], kind: 'medio' });
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
  if (e.type === 'slot') return { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy };
  return { ...e, cx: e.cx + dx, cy: e.cy + dy };
}

/** Gira la figura `deg` grados antihorario alrededor de (ox, oy). Un rectángulo girado (no a 90°) pasa a ser línea cerrada. */
export function rotate(e, ox, oy, deg) {
  const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
  const R = ([x, y]) => [ox + (x - ox) * c - (y - oy) * s, oy + (x - ox) * s + (y - oy) * c];
  const q = ((deg % 90) + 90) % 90;
  if (e.type === 'rect') {
    if (q > 1e-9 && 90 - q > 1e-9) return { id: e.id, type: 'line', pts: entityPts(e, 0.005).pts.map(R), closed: true, construction: e.construction };
    const a = R([e.x, e.y]), b = R([e.x + e.w, e.y + e.h]), r9 = v => Math.round(v * 1e9) / 1e9;
    return { ...e, x: r9(Math.min(a[0], b[0])), y: r9(Math.min(a[1], b[1])), w: r9(Math.abs(b[0] - a[0])), h: r9(Math.abs(b[1] - a[1])) };
  }
  if (e.type === 'line') return { ...e, pts: e.pts.map(R) };
  if (e.type === 'slot') { const [x1, y1] = R([e.x1, e.y1]), [x2, y2] = R([e.x2, e.y2]); return { ...e, x1, y1, x2, y2 }; }
  const [cx, cy] = R([e.cx, e.cy]);
  if (e.type === 'arc') return { ...e, cx, cy, a1: e.a1 + deg, a2: e.a2 + deg };
  if (e.type === 'poly') return { ...e, cx, cy, rot: e.rot + deg };
  return { ...e, cx, cy };
}

/** Refleja la figura en el eje vertical x = c (axis 'x') o en el horizontal y = c (axis 'y'). */
export function mirror(e, axis, c) {
  const M = ([x, y]) => (axis === 'x' ? [2 * c - x, y] : [x, 2 * c - y]);
  if (e.type === 'line') return { ...e, pts: e.pts.map(M) };
  if (e.type === 'rect') { const [a] = [M([e.x, e.y])], b = M([e.x + e.w, e.y + e.h]); return { ...e, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }; }
  if (e.type === 'slot') { const [x1, y1] = M([e.x1, e.y1]), [x2, y2] = M([e.x2, e.y2]); return { ...e, x1, y1, x2, y2 }; }
  const [cx, cy] = M([e.cx, e.cy]);
  // un reflejo invierte el sentido: el arco antihorario de a1 a a2 pasa a ir de a2' a a1'
  const ref = a => (axis === 'x' ? 180 - a : -a);
  if (e.type === 'arc') return { ...e, cx, cy, a1: ref(e.a2), a2: ref(e.a1) };
  if (e.type === 'poly') return { ...e, cx, cy, rot: ref(e.rot) };
  return { ...e, cx, cy };
}

/** Texto corto con las medidas, para la lista de figuras. */
export function describe(e) {
  switch (e.type) {
    case 'rect': return `${fmt(Math.abs(e.w))} × ${fmt(Math.abs(e.h))} mm${e.rr > 0 ? ` · R${fmt(e.rr)}` : ''}`;
    case 'circle': return `Ø ${fmt(2 * e.r)} mm`;
    case 'slot': return `${fmt(Math.hypot(e.x2 - e.x1, e.y2 - e.y1))} × ${fmt(e.w)} mm`;
    case 'arc': return `R ${fmt(e.r)} · ${fmt(arcSweep(e))}°`;
    case 'poly': return `${Math.round(e.n)} lados · Ø ${fmt(2 * e.r)}`;
    case 'line': {
      let L = 0;
      e.pts.forEach((p, i) => { if (i) L += Math.hypot(p[0] - e.pts[i - 1][0], p[1] - e.pts[i - 1][1]); });
      if (e.closed && e.pts.length > 2) L += Math.hypot(e.pts[0][0] - e.pts.at(-1)[0], e.pts[0][1] - e.pts.at(-1)[1]);
      if (e.closed && e.pts.length > 2) {
        const xs = e.pts.map(p => p[0]), ys = e.pts.map(p => p[1]);
        return `${fmt(Math.max(...xs) - Math.min(...xs))} × ${fmt(Math.max(...ys) - Math.min(...ys))} mm`;
      }
      return `${fmt(L)} mm de largo`;
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
  entities = entities.filter(e => !e.construction); // la geometría de construcción es solo de referencia
  const closed = entities.filter(isClosed).map(e => {
    const pts = entityPts(e).pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; });
    return { e, pts, a: Math.abs(signedArea(pts)), b: [x0, y0, x1, y1] };
  }).filter(c => c.pts.length > 2 && c.a > 1e-9);
  // padre = la figura cerrada más chica que contiene a esta por completo (la caja descarta rápido, útil con DXF grandes)
  const boxIn = (c, o) => c.b[0] >= o.b[0] && c.b[1] >= o.b[1] && c.b[2] <= o.b[2] && c.b[3] <= o.b[3];
  const inside = (c, o) => o !== c && o.a > c.a && boxIn(c, o) && c.pts.every(p => pointInPolygon(p, o.pts));
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
      label: entityName(c.e), detail: describe(c.e) + (nh ? ` · ${nh} hueco${nh > 1 ? 's' : ''}` : ''),
      sig: JSON.stringify([c.e, ...holes.map(h => h.e)]),
    });
  });
  entities.filter(e => !isClosed(e)).forEach(e => {
    const lp = entityPts(e);
    if (lp.pts.length < 2) return;
    out.push({
      src: 'sketch', type: 'line', sketchId: e.id, mode: get(e.id) || 'line', parts: [lp],
      label: entityName(e), detail: describe(e), sig: JSON.stringify(e),
    });
  });
  return out;
}

/* ---------- cotas ---------- */

/** Caja [x0, y0, x1, y1] de la figura en mm (de su trazo real, también para arcos y polígonos). */
export function entityBox(e) {
  // exacta para círculos y arcos (el polígono aproximado se queda un poco adentro de la curva)
  if (e.type === 'circle') return [e.cx - e.r, e.cy - e.r, e.cx + e.r, e.cy + e.r];
  let pts = entityPts(e, 0.01).pts;
  if (e.type === 'arc') {
    const s = arcSweep(e), at = a => [e.cx + e.r * Math.cos(a * RAD), e.cy + e.r * Math.sin(a * RAD)];
    pts = [at(e.a1), at(e.a1 + s)];
    for (let q = Math.ceil(e.a1 / 90) * 90; q < e.a1 + s; q += 90) pts.push(at(q));
  }
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  pts.forEach(([x, y]) => { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; });
  return [a, b, c, d];
}

/**
 * Cotas de la figura dentro de la pieza: distancia al borde más cercano en X y en Y, y su tamaño.
 * @returns {{kind:'edge'|'size', axis:'x'|'y'|'d'|'r', side?:'left'|'right'|'bottom'|'top', value:number,
 *   from:[number,number], to:[number,number], label:string}[]} from/to: extremos de la línea de cota en mm
 */
export function dimensions(e, W, H) {
  const [x0, y0, x1, y1] = entityBox(e), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const out = [];
  // al borde: el más cercano de cada eje
  if (x0 <= W - x1) out.push({ kind: 'edge', axis: 'x', side: 'left', value: x0, from: [0, cy], to: [x0, cy] });
  else out.push({ kind: 'edge', axis: 'x', side: 'right', value: W - x1, from: [x1, cy], to: [W, cy] });
  if (y0 <= H - y1) out.push({ kind: 'edge', axis: 'y', side: 'bottom', value: y0, from: [cx, 0], to: [cx, y0] });
  else out.push({ kind: 'edge', axis: 'y', side: 'top', value: H - y1, from: [cx, y1], to: [cx, H] });
  // tamaño
  if (e.type === 'circle') out.push({ kind: 'size', axis: 'd', value: 2 * e.r, from: [e.cx - e.r, e.cy], to: [e.cx + e.r, e.cy] });
  else if (e.type === 'arc') out.push({ kind: 'size', axis: 'r', value: e.r, from: [e.cx, e.cy], to: entityPts(e).pts[0] });
  else if (e.type === 'slot') {
    const L = Math.hypot(e.x2 - e.x1, e.y2 - e.y1), ux = L ? (e.x2 - e.x1) / L : 1, uy = L ? (e.y2 - e.y1) / L : 0, h = e.w / 2;
    out.push({ kind: 'size', axis: 'l', value: L, from: [e.x1 - uy * h, e.y1 + ux * h], to: [e.x2 - uy * h, e.y2 + ux * h] });
    out.push({ kind: 'size', axis: 'w', value: e.w, from: [e.x2 - uy * h, e.y2 + ux * h], to: [e.x2 + uy * h, e.y2 - ux * h] });
  }
  else {
    out.push({ kind: 'size', axis: 'x', value: x1 - x0, from: [x0, y1], to: [x1, y1] });
    out.push({ kind: 'size', axis: 'y', value: y1 - y0, from: [x1, y0], to: [x1, y1] });
  }
  return out.map(d => ({ ...d, label: dimLabel(d.axis, d.value) }));
}

/** Escala la figura respecto a un punto fijo (sx, sy por eje). */
function scaleAbout(e, ox, oy, sx, sy) {
  const P = ([x, y]) => [ox + (x - ox) * sx, oy + (y - oy) * sy];
  if (e.type === 'line') return { ...e, pts: e.pts.map(P) };
  if (e.type === 'rect') { const [x, y] = P([e.x, e.y]); return { ...e, x, y, w: e.w * sx, h: e.h * sy }; }
  if (e.type === 'slot') { const [x1, y1] = P([e.x1, e.y1]), [x2, y2] = P([e.x2, e.y2]); return { ...e, x1, y1, x2, y2 }; }
  const [cx, cy] = P([e.cx, e.cy]);
  return { ...e, cx, cy, r: e.r * Math.max(sx, sy) };
}

/**
 * Aplica el valor que el usuario escribió en una cota y devuelve la figura nueva.
 * Al borde: se mueve la figura. Tamaño: rectángulos y líneas se estiran desde su esquina inferior izquierda;
 * círculos, arcos y polígonos cambian de radio sin mover el centro.
 * @param {ReturnType<typeof dimensions>[number]} d
 */
export function applyDimension(e, d, value, W, H) {
  if (!(value >= 0) || !Number.isFinite(value)) return e;
  if (d.kind === 'edge') {
    const [x0, y0, x1, y1] = entityBox(e);
    if (d.side === 'left') return translate(e, value - x0, 0);
    if (d.side === 'right') return translate(e, (W - value) - x1, 0);
    if (d.side === 'bottom') return translate(e, 0, value - y0);
    return translate(e, 0, (H - value) - y1);
  }
  if (value <= 0) return e;
  if (d.axis === 'd') return { ...e, r: value / 2 };
  if (d.axis === 'r') return { ...e, r: value };
  if (d.axis === 'w') return { ...e, w: value };
  if (d.axis === 'l') {
    // largo de la ranura: se mueve el segundo centro sobre la misma dirección
    const L = Math.hypot(e.x2 - e.x1, e.y2 - e.y1), ux = L ? (e.x2 - e.x1) / L : 1, uy = L ? (e.y2 - e.y1) / L : 0;
    return { ...e, x2: e.x1 + ux * value, y2: e.y1 + uy * value };
  }
  if (e.type === 'poly') {
    // el ancho o alto del polígono se ajusta cambiando el radio (sigue regular)
    const [x0, y0, x1, y1] = entityBox(e), cur = d.axis === 'x' ? x1 - x0 : y1 - y0;
    return cur > 0 ? { ...e, r: e.r * value / cur } : e;
  }
  const [x0, y0, x1, y1] = entityBox(e), cur = d.axis === 'x' ? x1 - x0 : y1 - y0;
  if (!(cur > 0)) return e;
  const s = value / cur;
  return scaleAbout(e, x0, y0, d.axis === 'x' ? s : 1, d.axis === 'y' ? s : 1);
}

const dimLabel = (axis, v) => (axis === 'd' ? 'Ø' : axis === 'r' ? 'R' : '') + fmt(v);

/* ---------- inferencias al dibujar ---------- */

/**
 * Como `snap`, pero además infiere como un CAD: horizontal o vertical respecto al punto anterior, y alineación
 * con los puntos notables de las demás figuras (con una línea guía). Lo que quede libre va a la cuadrícula.
 * @param {{grid:number, snap:boolean, tol:number, extra?:[number,number][], last?:[number,number]|null}} o
 * @returns {{p:[number,number], kind:string, guides:{from:[number,number], to:[number,number]}[]}}
 */
export function infer(p, entities, o) {
  if (!o.snap) return { p, kind: '', guides: [] };
  const s = snap(p, entities, { ...o, grid: 0 });
  if (s.kind && s.kind !== 'cuadrícula') return { ...s, guides: [] };
  let [x, y] = p, lx = false, ly = false, kind = '';
  const guides = [];
  if (o.last) {
    if (Math.abs(y - o.last[1]) <= o.tol) { y = o.last[1]; ly = true; kind = 'horizontal'; }
    else if (Math.abs(x - o.last[0]) <= o.tol) { x = o.last[0]; lx = true; kind = 'vertical'; }
  }
  const pts = entities.flatMap(e => snapPoints(e).map(q => q.p)).concat(o.extra || []);
  let bx = null, by = null;
  pts.forEach(q => {
    if (!lx && Math.abs(q[0] - x) <= o.tol && (!bx || Math.abs(q[0] - x) < Math.abs(bx[0] - x))) bx = q;
    if (!ly && Math.abs(q[1] - y) <= o.tol && (!by || Math.abs(q[1] - y) < Math.abs(by[1] - y))) by = q;
  });
  if (bx) { x = bx[0]; lx = true; }
  if (by) { y = by[1]; ly = true; }
  const g = o.grid > 0 ? o.grid : 1;
  if (!lx) x = Math.round(x / g) * g;
  if (!ly) y = Math.round(y / g) * g;
  if (bx) guides.push({ from: bx, to: [x, y] });
  if (by) guides.push({ from: by, to: [x, y] });
  if (kind && o.last) guides.push({ from: o.last, to: [x, y] });
  return { p: [x, y], kind: kind || (bx || by ? 'alineado' : 'cuadrícula'), guides };
}

/* ---------- cotas que mandan (como en un croquis de CAD) ---------- */

/**
 * Una cota guardada. size: tamaño de la figura; edge: distancia de la figura a un borde de la pieza;
 * between: distancia entre los centros de dos figuras en X o en Y (la figura `ent` se mueve, `ref` no).
 * @typedef {{id:number, kind:'size'|'edge'|'between', ent:number, axis:'x'|'y'|'d'|'r'|'l'|'w',
 *   side?:'left'|'right'|'bottom'|'top', ref?:number, value:number}} Dim
 */

const center = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

/** Valor actual de la cota en el croquis (NaN si su figura ya no existe). */
export function measure(d, byId, W, H) {
  const e = byId.get(d.ent);
  if (!e) return NaN;
  const b = entityBox(e);
  if (d.kind === 'size') {
    const g = dimensions(e, W, H).find(x => x.kind === 'size' && x.axis === d.axis);
    return g ? g.value : NaN;
  }
  if (d.kind === 'edge') return { left: b[0], right: W - b[2], bottom: b[1], top: H - b[3] }[d.side];
  const r = byId.get(d.ref);
  if (!r) return NaN;
  const c = center(b), cr = center(entityBox(r));
  return Math.abs(d.axis === 'x' ? c[0] - cr[0] : c[1] - cr[1]);
}

/** Dónde se dibuja la cota (extremos en mm) y su texto. */
export function dimGeometry(d, byId, W, H) {
  const e = byId.get(d.ent);
  if (!e) return null;
  const b = entityBox(e), c = center(b);
  let from, to;
  if (d.kind === 'size') {
    const g = dimensions(e, W, H).find(x => x.kind === 'size' && x.axis === d.axis);
    if (!g) return null;
    ({ from, to } = g);
  } else if (d.kind === 'edge') {
    ({ from, to } = { left: { from: [0, c[1]], to: [b[0], c[1]] }, right: { from: [b[2], c[1]], to: [W, c[1]] },
      bottom: { from: [c[0], 0], to: [c[0], b[1]] }, top: { from: [c[0], b[3]], to: [c[0], H] } }[d.side]);
  } else {
    const r = byId.get(d.ref);
    if (!r) return null;
    const cr = center(entityBox(r));
    // la cota corre por fuera de ambas figuras: a la altura (o al lado) del centro de referencia
    from = d.axis === 'x' ? [cr[0], cr[1]] : [cr[0], cr[1]];
    to = d.axis === 'x' ? [c[0], cr[1]] : [cr[0], c[1]];
  }
  return { from, to, label: dimLabel(d.axis, d.value) };
}

/**
 * Hace cumplir las cotas, en el orden en que se crearon: cada una mueve o ajusta su figura. Una figura acotada
 * vuelve a su lugar si se intenta arrastrar en esa dirección, igual que en un croquis completamente definido.
 */
export function applyDims(entities, dims, W, H) {
  const list = entities.slice(), idx = new Map(list.map((e, i) => [e.id, i]));
  for (const d of dims) {
    const i = idx.get(d.ent);
    if (i === undefined) continue;
    const e = list[i];
    if (d.kind === 'between') {
      const j = idx.get(d.ref);
      if (j === undefined) continue;
      const c = center(entityBox(e)), cr = center(entityBox(list[j]));
      const cur = d.axis === 'x' ? c[0] - cr[0] : c[1] - cr[1];
      const delta = (cur < 0 ? -1 : 1) * d.value - cur;
      list[i] = d.axis === 'x' ? translate(e, delta, 0) : translate(e, 0, delta);
    } else list[i] = applyDimension(e, d, d.value, W, H);
  }
  return list;
}

/** Medidas de tamaño que necesita cada tipo de figura para quedar definida. */
const SIZE_NEEDS = { rect: ['x', 'y'], line: ['x', 'y'], circle: ['d'], arc: ['r'], poly: ['x|y'], slot: ['l', 'w'] };

/**
 * Qué tan definida está cada figura: su posición en X y en Y (por una cota al borde o a otra figura que a su vez
 * esté fija) y su tamaño. Devuelve, por id, lo que le falta.
 * @returns {Map<number, {full:boolean, missing:string[]}>}
 */
export function definedState(entities, dims) {
  const fx = new Set(), fy = new Set();
  for (let changed = true; changed;) {
    changed = false;
    dims.forEach(d => {
      const set = d.axis === 'x' ? fx : d.axis === 'y' ? fy : null;
      if (!set || set.has(d.ent)) return;
      if (d.kind === 'edge' || (d.kind === 'between' && set.has(d.ref))) { set.add(d.ent); changed = true; }
    });
  }
  const out = new Map();
  entities.forEach(e => {
    const missing = [];
    if (!fx.has(e.id)) missing.push('posición X');
    if (!fy.has(e.id)) missing.push('posición Y');
    const sizes = dims.filter(d => d.ent === e.id && d.kind === 'size').map(d => d.axis);
    (SIZE_NEEDS[e.type] || []).forEach(n => {
      if (!n.split('|').some(a => sizes.includes(a))) missing.push({ x: 'ancho', y: 'alto', d: 'diámetro', r: 'radio', l: 'largo', w: 'ancho', 'x|y': 'tamaño' }[n]);
    });
    out.set(e.id, { full: !missing.length, missing });
  });
  return out;
}
