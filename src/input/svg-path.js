// Lector de rutas SVG sin DOM: convierte el atributo `d` y las figuras básicas
// en polilíneas. Unidades: las del propio SVG (sin transformar).

/**
 * @typedef {[number, number]} Pt
 * @typedef {{pts: Pt[], closed: boolean}} Polyline
 */

/**
 * Convierte el atributo `d` de un <path> en subtrayectorias.
 * Las curvas se dividen según su curvatura: ningún punto de la curva queda a más de `tol` de la polilínea,
 * así un tramo casi recto da 1 segmento y una curva cerrada los que necesite.
 * @param {string} d
 * @param {number} tol  desviación máxima entre la curva y la polilínea (unidades del SVG)
 * @returns {Polyline[]}
 */
export function parsePathD(d, tol = 0.1) {
  const toks = d.match(/[MmZzLlHhVvCcSsQqTtAa]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, pcx = 0, pcy = 0, pqx = 0, pqy = 0, prev = '';
  const subs = [];
  let cur = null;
  const num = () => parseFloat(toks[i++]);
  const isNum = () => i < toks.length && !/^[A-Za-z]$/.test(toks[i]);
  const start = (nx, ny) => { if (cur && cur.pts.length > 1) subs.push(cur); cur = { pts: [[nx, ny]], closed: false }; };
  const add = (nx, ny) => { if (!cur) cur = { pts: [[x, y]], closed: false }; cur.pts.push([nx, ny]); };
  // cota de Wang: con n segmentos el error de una Bézier de grado g es ≤ g(g−1)/8 · max|Pi − 2Pi+1 + Pi+2| / n²
  const nseg = (k, m) => Math.min(256, Math.max(1, Math.ceil(Math.sqrt(k * m / tol))));
  const dd = (ax, ay, bx, by, cx, cy) => Math.hypot(ax - 2 * bx + cx, ay - 2 * by + cy);

  while (i < toks.length) {
    if (/^[A-Za-z]$/.test(toks[i])) cmd = toks[i++];
    else if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      if (cur) { cur.closed = true; x = sx; y = sy; subs.push(cur); cur = null; }
      prev = 'Z';
      continue;
    }
    if (!isNum()) continue;
    if (C === 'M') {
      let nx = num(), ny = num();
      if (rel) { nx += x; ny += y; }
      x = sx = nx; y = sy = ny;
      start(x, y);
      cmd = rel ? 'l' : 'L'; // pares extra después de M son L implícitas
      prev = 'M';
      continue;
    }
    if (C === 'L') {
      let nx = num(), ny = num();
      if (rel) { nx += x; ny += y; }
      add(nx, ny); x = nx; y = ny;
    } else if (C === 'H') {
      let nx = num(); if (rel) nx += x;
      add(nx, y); x = nx;
    } else if (C === 'V') {
      let ny = num(); if (rel) ny += y;
      add(x, ny); y = ny;
    } else if (C === 'C' || C === 'S') {
      let x1, y1;
      if (C === 'C') { x1 = num(); y1 = num(); if (rel) { x1 += x; y1 += y; } }
      else if (prev === 'C' || prev === 'S') { x1 = 2 * x - pcx; y1 = 2 * y - pcy; }
      else { x1 = x; y1 = y; }
      let x2 = num(), y2 = num(), ex = num(), ey = num();
      if (rel) { x2 += x; y2 += y; ex += x; ey += y; }
      const n = nseg(0.75, Math.max(dd(x, y, x1, y1, x2, y2), dd(x1, y1, x2, y2, ex, ey)));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        add(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex,
            u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey);
      }
      pcx = x2; pcy = y2; x = ex; y = ey;
    } else if (C === 'Q' || C === 'T') {
      let x1, y1;
      if (C === 'Q') { x1 = num(); y1 = num(); if (rel) { x1 += x; y1 += y; } }
      else if (prev === 'Q' || prev === 'T') { x1 = 2 * x - pqx; y1 = 2 * y - pqy; }
      else { x1 = x; y1 = y; }
      let ex = num(), ey = num();
      if (rel) { ex += x; ey += y; }
      const n = nseg(0.25, dd(x, y, x1, y1, ex, ey));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        add(u * u * x + 2 * u * t * x1 + t * t * ex, u * u * y + 2 * u * t * y1 + t * t * ey);
      }
      pqx = x1; pqy = y1; x = ex; y = ey;
    } else if (C === 'A') {
      const rx = Math.abs(num()), ry = Math.abs(num());
      const phi = num() * Math.PI / 180;
      const fa = +toks[i++] ? 1 : 0, fs = +toks[i++] ? 1 : 0;
      let ex = num(), ey = num();
      if (rel) { ex += x; ey += y; }
      arcPts(x, y, rx, ry, phi, fa, fs, ex, ey, tol).forEach(p => add(p[0], p[1]));
      x = ex; y = ey;
    } else {
      i++;
    }
    prev = C;
  }
  if (cur && cur.pts.length > 1) subs.push(cur);
  return subs;
}

/** Arco elíptico SVG (parametrización por extremos) → puntos, sin incluir el inicial; flecha de cada cuerda ≤ tol. */
export function arcPts(x1, y1, rx, ry, phi, fa, fs, x2, y2, tol = 0.1) {
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const c = Math.cos(phi), s = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = c * dx + s * dy, yp = -s * dx + c * dy;
  const l = xp * xp / (rx * rx) + yp * yp / (ry * ry);
  if (l > 1) { rx *= Math.sqrt(l); ry *= Math.sqrt(l); }
  let num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  if (num < 0) num = 0;
  let co = Math.sqrt(num / (rx * rx * yp * yp + ry * ry * xp * xp));
  if (fa === fs) co = -co;
  const cxp = co * rx * yp / ry, cyp = -co * ry * xp / rx;
  const cx = c * cxp - s * cyp + (x1 + x2) / 2, cy = s * cxp + c * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  else if (fs && dt < 0) dt += 2 * Math.PI;
  const R = Math.max(rx, ry);
  const step = tol >= R ? Math.PI / 2 : 2 * Math.acos(1 - tol / R); // ángulo cuya cuerda se aleja tol del arco
  const n = Math.min(360, Math.max(2, Math.ceil(Math.abs(dt) / Math.min(step, Math.PI / 2))));
  const out = [];
  for (let k = 1; k <= n; k++) {
    const t = t1 + dt * k / n;
    out.push([c * rx * Math.cos(t) - s * ry * Math.sin(t) + cx, s * rx * Math.cos(t) + c * ry * Math.sin(t) + cy]);
  }
  return out;
}

/**
 * Convierte una figura SVG básica en un atributo `d` equivalente.
 * Acepta cualquier objeto con `tagName`, `getAttribute` y `hasAttribute` (un Element o un sustituto en pruebas).
 */
export function shapeToD(el) {
  const g = a => parseFloat(el.getAttribute(a)) || 0;
  switch (el.tagName.toLowerCase()) {
    case 'path':
      return el.getAttribute('d') || '';
    case 'rect': {
      const x = g('x'), y = g('y'), w = g('width'), h = g('height');
      let rx = g('rx'), ry = g('ry');
      if (!el.hasAttribute('ry')) ry = rx;
      if (!el.hasAttribute('rx')) rx = ry;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (w <= 0 || h <= 0) return '';
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle': {
      const cx = g('cx'), cy = g('cy'), r = g('r');
      if (r <= 0) return '';
      return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
    }
    case 'ellipse': {
      const cx = g('cx'), cy = g('cy'), rx = g('rx'), ry = g('ry');
      if (rx <= 0 || ry <= 0) return '';
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case 'line':
      return `M${g('x1')} ${g('y1')}L${g('x2')} ${g('y2')}`;
    case 'polyline':
    case 'polygon': {
      const p = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(parseFloat);
      if (p.length < 4) return '';
      let d = 'M' + p[0] + ' ' + p[1];
      for (let k = 2; k + 1 < p.length; k += 2) d += 'L' + p[k] + ' ' + p[k + 1];
      return el.tagName.toLowerCase() === 'polygon' ? d + 'Z' : d;
    }
  }
  return '';
}
