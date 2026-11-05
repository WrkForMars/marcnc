// Línea de tiempo del programa para la simulación: cuánto dura cada movimiento y dónde está la herramienta en cada instante.
// Función pura sobre el resultado de explainProgram.

/** Velocidad supuesta de los rápidos (G00), la misma que usa la estimación de tiempo del programa. */
export const RAPID_MM_MIN = 1500;

/**
 * @typedef {{n:number, kind:string, from:[number,number,number], to:[number,number,number],
 *   arc?:{c:[number,number], r:number, ccw:boolean, a0:number, sweep:number},
 *   len:number, t0:number, dur:number}} Seg
 */

/**
 * @param {import('./explain.js').Explained[]} ex
 * @returns {{segs:Seg[], total:number}} tiempos en segundos
 */
export function buildTimeline(ex) {
  const segs = [];
  let t = 0;
  ex.forEach(e => {
    if (!e.to) return;
    const [x0, y0, z0] = e.from, [x1, y1, z1] = e.to;
    let len, arc;
    if (e.arc) {
      const [cx, cy] = e.arc.c;
      const a0 = Math.atan2(y0 - cy, x0 - cx), a1 = Math.atan2(y1 - cy, x1 - cx);
      let sweep = a1 - a0;
      if (e.arc.ccw) { while (sweep <= 1e-12) sweep += 2 * Math.PI; } else { while (sweep >= -1e-12) sweep -= 2 * Math.PI; }
      arc = { ...e.arc, a0, sweep };
      len = Math.hypot(Math.abs(sweep) * e.arc.r, z1 - z0);
    } else len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    if (len < 1e-9) return;
    const feed = e.g === 0 || !e.f ? RAPID_MM_MIN : e.f;
    const dur = (len / feed) * 60;
    segs.push({ n: e.n, kind: e.kind, from: e.from, to: e.to, arc, len, t0: t, dur });
    t += dur;
  });
  return { segs, total: t };
}

/** Punto del movimiento a la fracción u (0–1) de su recorrido. */
export function segPoint(s, u) {
  const [x0, y0, z0] = s.from, [x1, y1, z1] = s.to;
  const z = z0 + (z1 - z0) * u;
  if (s.arc) {
    const a = s.arc.a0 + s.arc.sweep * u;
    return [s.arc.c[0] + s.arc.r * Math.cos(a), s.arc.c[1] + s.arc.r * Math.sin(a), z];
  }
  return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, z];
}

/** Índice del movimiento que está ocurriendo en el instante t (búsqueda binaria). */
export function segAt(tl, t) {
  const s = tl.segs;
  if (!s.length) return -1;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid].t0 <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Posición de la herramienta en el instante t y el movimiento en curso. */
export function positionAt(tl, t) {
  const i = segAt(tl, t);
  if (i < 0) return null;
  const s = tl.segs[i];
  const u = s.dur > 0 ? Math.min(1, Math.max(0, (t - s.t0) / s.dur)) : 1;
  return { i, seg: s, p: segPoint(s, u) };
}

/** Instante en que termina la línea n del programa (o la última línea que mueve antes de ella). */
export function timeOfLine(tl, n) {
  let t = 0;
  for (const s of tl.segs) { if (s.n > n) break; t = s.t0 + s.dur; }
  return t;
}

/** "m:ss" o "h:mm:ss". */
export function clock(sec) {
  const s = Math.max(0, Math.round(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
