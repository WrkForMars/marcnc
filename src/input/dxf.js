// Lector de DXF (lo que exportan SolidWorks, AutoCAD, Fusion, Inkscape), puro: sin DOM.
// Lee LINE, ARC, CIRCLE, LWPOLYLINE y POLYLINE (con abombado), ELLIPSE, SPLINE e INSERT (bloques),
// pasa todo a mm según $INSUNITS y une los tramos sueltos que se tocan en contornos.
// Cotas, textos, sombreados y lo que está en el espacio papel se ignoran (se cuentan para avisar).

const RAD = Math.PI / 180;
/** mm por unidad, según $INSUNITS (0 = sin unidad: se toma como mm). */
const UNITS = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4, 13: 0.001, 14: 100 };
const UNIT_NAME = { 1: 'pulgadas', 2: 'pies', 5: 'cm', 6: 'm' };

/** Pares (código, valor) del archivo. */
function pairs(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i], 10);
    if (Number.isNaN(code)) { i--; continue; } // renglón vacío suelto: se recupera el ritmo
    out.push([code, lines[i + 1].trim()]);
  }
  return out;
}

/** Divide una lista de pares en entidades: cada una empieza en un código 0. */
function splitEntities(ps) {
  const out = [];
  let cur = null;
  for (const [c, v] of ps) {
    if (c === 0) { cur = { type: v, g: [] }; out.push(cur); } else if (cur) cur.g.push([c, v]);
  }
  return out;
}
const num = (e, code, def = 0) => { const p = e.g.find(q => q[0] === code); return p ? parseFloat(p[1]) : def; };
const all = (e, code) => e.g.filter(q => q[0] === code).map(q => parseFloat(q[1]));
const str = (e, code) => (e.g.find(q => q[0] === code) || [])[1];

/** Puntos de un arco de centro c, radio r, del ángulo a0 al a1 (radianes, con signo), con flecha ≤ tol. */
function arcPts(cx, cy, r, a0, sweep, tol) {
  const step = r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / r)) : Math.PI / 4;
  const n = Math.min(720, Math.max(2, Math.ceil(Math.abs(sweep) / Math.max(step, 1e-3))));
  return Array.from({ length: n + 1 }, (_, k) => { const a = a0 + (sweep * k) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
}

/**
 * Tramo entre dos vértices de una polilínea con abombado (bulge = tan(ángulo/4), positivo = antihorario).
 * Devuelve los puntos intermedios y el final (sin el inicial).
 */
export function bulgePts(p1, p2, b, tol) {
  if (Math.abs(b) < 1e-9) return [p2];
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], c = Math.hypot(dx, dy);
  if (c < 1e-12) return [p2];
  const s = (Math.abs(b) * c) / 2, d = c / 2, r = (d * d + s * s) / (2 * s);
  const k = Math.sign(b) * (r - s) / c; // del punto medio al centro, sobre la normal izquierda
  const cx = (p1[0] + p2[0]) / 2 - dy * k, cy = (p1[1] + p2[1]) / 2 + dx * k;
  const pts = arcPts(cx, cy, r, Math.atan2(p1[1] - cy, p1[0] - cx), 4 * Math.atan(b), tol);
  pts[pts.length - 1] = p2;
  return pts.slice(1);
}

/** Polilínea con abombados → puntos. */
function polyPts(verts, closed, tol) {
  if (!verts.length) return [];
  const pts = [verts[0].p];
  const n = verts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) pts.push(...bulgePts(verts[i].p, verts[(i + 1) % n].p, verts[i].b, tol));
  if (closed) pts.pop(); // el último repite el primero
  return pts;
}

/** Curva B-spline racional (de Boor) muestreada; si no hay nodos válidos, une los puntos de control o de ajuste. */
function splinePts(e, tol) {
  const deg = num(e, 71, 3), knots = all(e, 40), w = all(e, 41);
  const xs = all(e, 10), ys = all(e, 20);
  const ctrl = xs.map((x, i) => [x, ys[i] ?? 0]);
  if (ctrl.length < 2 || knots.length !== ctrl.length + deg + 1) {
    const fx = all(e, 11), fy = all(e, 21);
    return fx.length >= 2 ? fx.map((x, i) => [x, fy[i] ?? 0]) : ctrl;
  }
  const W = ctrl.map((_, i) => (w.length === ctrl.length ? w[i] : 1));
  const t0 = knots[deg], t1 = knots[ctrl.length];
  const at = t => {
    let k = deg;
    while (k < ctrl.length - 1 && t >= knots[k + 1]) k++;
    const d = Array.from({ length: deg + 1 }, (_, j) => { const q = ctrl[j + k - deg], ww = W[j + k - deg]; return [q[0] * ww, q[1] * ww, ww]; });
    for (let r = 1; r <= deg; r++) {
      for (let j = deg; j >= r; j--) {
        const i = j + k - deg, den = knots[i + deg - r + 1] - knots[i];
        const a = den ? (t - knots[i]) / den : 0;
        d[j] = d[j].map((v, m) => (1 - a) * d[j - 1][m] + a * v);
      }
    }
    return [d[deg][0] / d[deg][2], d[deg][1] / d[deg][2]];
  };
  // largo del polígono de control → número de muestras para quedar dentro de la tolerancia
  let L = 0;
  for (let i = 1; i < ctrl.length; i++) L += Math.hypot(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1]);
  const n = Math.min(4000, Math.max(ctrl.length * 8, Math.ceil(L / (50 * tol)))); // cuerdas de ~0.5 mm con tol = 0.01
  return Array.from({ length: n + 1 }, (_, i) => at(t0 + ((t1 - t0) * i) / n));
}

/** Transformación de un INSERT: escala, giro y traslado (y el punto base del bloque). */
const insertTf = (e, base) => {
  const sx = num(e, 41, 1), sy = num(e, 42, 1), rot = num(e, 50, 0) * RAD, x = num(e, 10), y = num(e, 20);
  const c = Math.cos(rot), s = Math.sin(rot);
  return ([px, py]) => { const u = (px - base[0]) * sx, v = (py - base[1]) * sy; return [x + u * c - v * s, y + u * s + v * c]; };
};

/**
 * @param {string} text contenido del .dxf (ASCII; el DXF binario no se acepta)
 * @param {{tol?:number}} [o] tol: flecha máxima al dividir arcos y curvas, en mm
 * @returns {{paths:{pts:[number,number][], closed:boolean}[], circles:{cx:number, cy:number, r:number}[],
 *   unit:number, unitName:string, skipped:Record<string,number>}} todo en mm
 */
export function parseDxf(text, o = {}) {
  if (/^AutoCAD Binary DXF/.test(text)) throw new Error('Ese DXF es binario. Expórtalo como DXF de texto (ASCII).');
  const ps = pairs(text);
  if (!ps.some(([c, v]) => c === 0 && v === 'SECTION')) throw new Error('Ese archivo no parece un DXF.');

  // secciones
  const sections = {};
  for (let i = 0; i < ps.length; i++) {
    if (ps[i][0] === 0 && ps[i][1] === 'SECTION' && ps[i + 1] && ps[i + 1][0] === 2) {
      const name = ps[i + 1][1], start = i + 2;
      let j = start;
      while (j < ps.length && !(ps[j][0] === 0 && ps[j][1] === 'ENDSEC')) j++;
      sections[name] = ps.slice(start, j);
      i = j;
    }
  }
  const header = sections.HEADER || [];
  const iu = header.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
  const units = iu >= 0 ? parseInt(header[iu + 1][1], 10) : 0;
  const k = UNITS[units] ?? 1;
  const tol = (o.tol ?? 0.01) / k; // en unidades del archivo

  // bloques: nombre → { base, entidades }
  const blocks = {};
  let cur = null;
  splitEntities(sections.BLOCKS || []).forEach(e => {
    if (e.type === 'BLOCK') { cur = { base: [num(e, 10), num(e, 20)], ents: [] }; blocks[str(e, 2)] = cur; } else if (e.type === 'ENDBLK') cur = null;
    else if (cur) cur.ents.push(e);
  });

  const paths = [], circles = [], skipped = {};
  const skip = t => { skipped[t] = (skipped[t] || 0) + 1; };

  /** @param {(p:[number,number])=>[number,number]} T transformación acumulada de los bloques */
  function walk(ents, T, scaleOK, depth) {
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (str(e, 67) === '1') { skip('espacio papel'); continue; }
      // dirección de extrusión (0,0,-1): la figura está reflejada en X (pasa con algunos arcos y polilíneas)
      const flip = num(e, 230, 1) < 0;
      const F = flip ? p => T([-p[0], p[1]]) : T;
      const add = (pts, closed) => { if (pts.length >= 2) paths.push({ pts: pts.map(F), closed }); };
      switch (e.type) {
        case 'LINE': add([[num(e, 10), num(e, 20)], [num(e, 11), num(e, 21)]], false); break;
        case 'CIRCLE': {
          const c = [num(e, 10), num(e, 20)], r = num(e, 40);
          if (scaleOK) { const q = F(c), q2 = F([c[0] + r, c[1]]); circles.push({ cx: q[0], cy: q[1], r: Math.hypot(q2[0] - q[0], q2[1] - q[1]) }); }
          else add(arcPts(c[0], c[1], r, 0, 2 * Math.PI, tol).slice(0, -1), true);
          break;
        }
        case 'ARC': {
          const a0 = num(e, 50) * RAD;
          let sw = num(e, 51) * RAD - a0;
          while (sw <= 0) sw += 2 * Math.PI;
          add(arcPts(num(e, 10), num(e, 20), num(e, 40), a0, sw, tol), false);
          break;
        }
        case 'LWPOLYLINE': {
          const verts = [];
          e.g.forEach(([c, v]) => {
            if (c === 10) verts.push({ p: [parseFloat(v), 0], b: 0 });
            else if (c === 20 && verts.length) verts[verts.length - 1].p[1] = parseFloat(v);
            else if (c === 42 && verts.length) verts[verts.length - 1].b = parseFloat(v);
          });
          const closed = (num(e, 70) & 1) === 1;
          add(polyPts(verts, closed, tol), closed);
          break;
        }
        case 'POLYLINE': {
          const verts = [];
          let j = i + 1;
          for (; j < ents.length && ents[j].type === 'VERTEX'; j++) verts.push({ p: [num(ents[j], 10), num(ents[j], 20)], b: num(ents[j], 42) });
          if (ents[j] && ents[j].type === 'SEQEND') j++;
          i = j - 1;
          if (num(e, 70) & (16 | 64)) { skip('malla 3D'); break; }
          const closed = (num(e, 70) & 1) === 1;
          add(polyPts(verts, closed, tol), closed);
          break;
        }
        case 'ELLIPSE': {
          const c = [num(e, 10), num(e, 20)], mx = num(e, 11), my = num(e, 21), ratio = num(e, 40, 1);
          const a = Math.hypot(mx, my), rot = Math.atan2(my, mx), b = a * ratio;
          let t0 = num(e, 41, 0), t1 = num(e, 42, 2 * Math.PI);
          while (t1 <= t0) t1 += 2 * Math.PI;
          const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6;
          const step = 2 * Math.acos(Math.max(-1, 1 - tol / Math.max(a, tol)));
          const n = Math.min(720, Math.max(16, Math.ceil((t1 - t0) / step)));
          const pts = Array.from({ length: n + 1 }, (_, q) => {
            const t = t0 + ((t1 - t0) * q) / n, u = a * Math.cos(t), v = b * Math.sin(t);
            return [c[0] + u * Math.cos(rot) - v * Math.sin(rot), c[1] + u * Math.sin(rot) + v * Math.cos(rot)];
          });
          if (full) pts.pop();
          add(pts, full);
          break;
        }
        case 'SPLINE': {
          const closed = (num(e, 70) & 1) === 1;
          const pts = splinePts(e, tol);
          if (closed && pts.length > 2) pts.pop();
          add(pts, closed);
          break;
        }
        case 'INSERT': {
          const blk = blocks[str(e, 2)];
          if (!blk || depth > 8) { skip('bloque'); break; }
          const same = Math.abs(Math.abs(num(e, 41, 1)) - Math.abs(num(e, 42, 1))) < 1e-9 && num(e, 41, 1) > 0 && num(e, 42, 1) > 0;
          const t = insertTf(e, blk.base);
          walk(blk.ents, p => F(t(p)), scaleOK && same, depth + 1);
          break;
        }
        case 'DIMENSION': skip('cota'); break;
        case 'TEXT': case 'MTEXT': skip('texto'); break;
        case 'HATCH': skip('sombreado'); break;
        case 'VERTEX': case 'SEQEND': case 'ATTRIB': case 'ATTDEF': case 'POINT': case 'VIEWPORT': break;
        default: skip(e.type.toLowerCase());
      }
    }
  }
  walk(splitEntities(sections.ENTITIES || []), p => p, true, 0);

  const mm = p => [p[0] * k, p[1] * k];
  return {
    paths: joinPaths(paths.map(p => ({ pts: p.pts.map(mm), closed: p.closed })), 0.01),
    circles: circles.map(c => ({ cx: c.cx * k, cy: c.cy * k, r: c.r * k })),
    unit: k, unitName: UNIT_NAME[units] || 'mm', skipped,
  };
}

/**
 * Une los tramos abiertos cuyos extremos se tocan (a menos de tol) en cadenas; la que termina donde empieza queda cerrada.
 * Así un contorno de SolidWorks (líneas y arcos sueltos) se vuelve una sola figura que se puede rellenar.
 */
export function joinPaths(paths, tol) {
  const out = paths.filter(p => p.closed).map(p => ({ pts: p.pts.slice(), closed: true }));
  const open = paths.filter(p => !p.closed && p.pts.length >= 2).map(p => p.pts.slice());
  const key = p => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const near = p => { const [x, y] = key(p).split(',').map(Number); const ks = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) ks.push(`${x + i},${y + j}`); return ks; };
  // extremos → tramos que tienen un extremo ahí
  const ends = new Map();
  const put = (p, i) => { const k = key(p); if (!ends.has(k)) ends.set(k, new Set()); ends.get(k).add(i); };
  open.forEach((p, i) => { put(p[0], i); put(p[p.length - 1], i); });
  const used = new Array(open.length).fill(false);
  const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
  const takeAt = p => {
    for (const k of near(p)) for (const i of ends.get(k) || []) {
      if (used[i]) continue;
      const q = open[i];
      if (same(q[0], p)) { used[i] = true; return q; }
      if (same(q[q.length - 1], p)) { used[i] = true; return q.slice().reverse(); }
    }
    return null;
  };
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let chain = open[i].slice();
    for (let q; !same(chain[chain.length - 1], chain[0]) && (q = takeAt(chain[chain.length - 1]));) chain.push(...q.slice(1));
    for (let q; !same(chain[chain.length - 1], chain[0]) && (q = takeAt(chain[0]));) chain = [...q.reverse().slice(0, -1), ...chain];
    const closed = chain.length > 3 && same(chain[chain.length - 1], chain[0]);
    if (closed) chain.pop();
    out.push({ pts: chain, closed });
  }
  return out;
}

/**
 * Lo leído → figuras del croquis (en mm de la pieza). Si el dibujo ya cabe en la pieza con sus coordenadas
 * (el origen de SolidWorks en la esquina), se respeta; si no, se centra en la pieza. Siempre a escala 1:1.
 * @returns {{entities:object[], size:[number,number], moved:boolean}}
 */
export function dxfEntities(r, W, H) {
  const r3 = v => Math.round(v * 1000) / 1000;
  const xs = [], ys = [];
  r.paths.forEach(p => p.pts.forEach(([x, y]) => { xs.push(x); ys.push(y); }));
  r.circles.forEach(c => { xs.push(c.cx - c.r, c.cx + c.r); ys.push(c.cy - c.r, c.cy + c.r); });
  if (!xs.length) return { entities: [], size: [0, 0], moved: false };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  xs.forEach(v => { if (v < x0) x0 = v; if (v > x1) x1 = v; });
  ys.forEach(v => { if (v < y0) y0 = v; if (v > y1) y1 = v; });
  const fits = x0 >= -1e-6 && y0 >= -1e-6 && x1 <= W + 1e-6 && y1 <= H + 1e-6;
  const dx = fits ? 0 : W / 2 - (x0 + x1) / 2, dy = fits ? 0 : H / 2 - (y0 + y1) / 2;
  // sin repetidos: algunos programas exportan la misma figura dos veces, y un hueco doble se volvería relleno
  const seen = new Set();
  const once = e => { const k = JSON.stringify(e); if (seen.has(k)) return false; seen.add(k); return true; };
  const entities = [
    ...r.paths.map(p => ({ type: 'line', pts: p.pts.map(([x, y]) => [r3(x + dx), r3(y + dy)]), closed: p.closed })),
    ...r.circles.map(c => ({ type: 'circle', cx: r3(c.cx + dx), cy: r3(c.cy + dy), r: r3(c.r) })),
  ].filter(once);
  return { entities, size: [x1 - x0, y1 - y0], moved: !fits };
}
