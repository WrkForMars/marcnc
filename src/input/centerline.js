// Línea central de una imagen: adelgaza el dibujo a un píxel (Zhang–Suen), quita las espinas
// que deja en las esquinas y lo recorre como polilíneas, para grabar trazos delgados en una pasada.
// Puro (sin DOM): trabaja sobre una máscara de píxeles.
import { rdp } from '../geometry/simplify.js';

// Vecinos en el orden de Zhang–Suen: N, NE, E, SE, S, SW, W, NW (Y hacia abajo)
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];

const popcount = m => { let n = 0; for (; m; m &= m - 1) n++; return n; };

/** Tablas por máscara de vecinos: borrables en cada subpaso de Zhang–Suen y en la limpieza final. */
const ZS1 = new Uint8Array(256), ZS2 = new Uint8Array(256), THIN = new Uint8Array(256);
for (let m = 0; m < 256; m++) {
  const b = k => (m >> k) & 1;
  const B = popcount(m);
  let A = 0;
  for (let k = 0; k < 8; k++) if (!b(k) && b((k + 1) % 8)) A++;
  const ok = B >= 2 && B <= 6 && A === 1;
  ZS1[m] = +(ok && !(b(0) && b(2) && b(4)) && !(b(2) && b(4) && b(6)));
  ZS2[m] = +(ok && !(b(0) && b(2) && b(6)) && !(b(0) && b(4) && b(6)));
  // limpieza: se puede borrar si no es punta y sus vecinos siguen conectados entre sí (8-conexos)
  const on = [];
  for (let k = 0; k < 8; k++) if (b(k)) on.push(k);
  const seen = new Set([on[0]]), st = on.length ? [on[0]] : [];
  while (st.length) {
    const k = st.pop();
    on.forEach(j => {
      if (!seen.has(j) && Math.abs(DX[j] - DX[k]) <= 1 && Math.abs(DY[j] - DY[k]) <= 1) { seen.add(j); st.push(j); }
    });
  }
  THIN[m] = +(B >= 2 && B <= 6 && seen.size === on.length);
}

/**
 * @param {Uint8Array} ink 1 = dibujo, fila por fila
 * @param {number} w @param {number} h
 * @returns {{lines: {pts:[number,number][], closed:boolean}[], width:number}[]}
 *   un grupo por pieza conectada del dibujo; coordenadas en píxeles (centro del píxel), Y hacia abajo;
 *   `width` = grosor máximo del trazo en píxeles
 */
export function centerlines(ink, w, h) {
  // borde de un píxel vacío para no revisar límites
  const W = w + 2, H = h + 2, N = W * H;
  const sk = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sk[(y + 1) * W + x + 1] = ink[y * w + x] ? 1 : 0;
  const off = DX.map((dx, k) => DY[k] * W + dx);
  const mask = i => {
    let m = 0;
    for (let k = 0; k < 8; k++) if (sk[i + off[k]]) m |= 1 << k;
    return m;
  };
  const dist = distance(sk, W, H);

  // piezas conectadas del dibujo original, con su píxel más grueso (para no perder puntos sueltos)
  const label = new Int32Array(N).fill(-1);
  const peaks = [];
  for (let s = 0; s < N; s++) {
    if (!sk[s] || label[s] >= 0) continue;
    const g = peaks.length;
    let pk = s;
    label[s] = g;
    for (const st = [s]; st.length;) {
      const i = st.pop();
      if (dist[i] > dist[pk]) pk = i;
      for (let k = 0; k < 8; k++) { const q = i + off[k]; if (sk[q] && label[q] < 0) { label[q] = g; st.push(q); } }
    }
    peaks.push(pk);
  }

  // Zhang–Suen: solo se revisan los píxeles de la orilla; al borrar uno, sus vecinos pasan a la orilla
  let live = [];
  const inB = new Uint8Array(N);
  let border = [];
  for (let i = 0; i < N; i++) {
    if (!sk[i]) continue;
    live.push(i);
    if (!sk[i - 1] || !sk[i + 1] || !sk[i - W] || !sk[i + W]) { border.push(i); inB[i] = 1; }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const T of [ZS1, ZS2]) {
      const del = border.filter(i => T[mask(i)]);
      if (!del.length) continue;
      changed = true;
      del.forEach(i => { sk[i] = 0; inB[i] = 0; });
      border = border.filter(i => sk[i]);
      del.forEach(i => { for (let k = 0; k < 8; k++) { const q = i + off[k]; if (sk[q] && !inB[q]) { inB[q] = 1; border.push(q); } } });
    }
  }
  const clean = () => { live = live.filter(i => sk[i]); live.forEach(i => { if (THIN[mask(i)]) sk[i] = 0; }); live = live.filter(i => sk[i]); };
  clean();

  // dos rondas: quitar espinas cortas (salen de las esquinas de trazos gruesos) y volver a limpiar
  for (let round = 0; round < 2; round++) {
    const paths = trace(sk, live, mask, off);
    const deg = i => popcount(mask(i));
    const atJ = new Map(); // nodo de cruce → ramas que llegan a él
    paths.forEach(p => {
      if (p.closed) return;
      [p.px[0], p.px[p.px.length - 1]].forEach(j => { if (deg(j) >= 3) { if (!atJ.has(j)) atJ.set(j, []); atJ.get(j).push(p); } });
    });
    let removed = false;
    atJ.forEach((list, j) => {
      const lim = 1.5 * dist[j] + 2;
      const spurs = list.filter(p => {
        const other = p.px[0] === j ? p.px[p.px.length - 1] : p.px[0];
        return deg(other) === 1 && p.px.length - 1 < lim;
      });
      // si todas las ramas son cortas, se conserva la más larga
      if (spurs.length === list.length) spurs.sort((a, b) => b.px.length - a.px.length).shift();
      spurs.forEach(p => p.px.forEach(i => { if (i !== j) { sk[i] = 0; removed = true; } }));
    });
    if (!removed) break;
    clean();
  }

  // una pieza que el adelgazamiento borró por completo (un punto redondo) queda como su píxel más grueso
  live = live.filter(i => sk[i]);
  const has = new Uint8Array(peaks.length);
  live.forEach(i => { has[label[i]] = 1; });
  peaks.forEach((pk, g) => { if (!has[g] && dist[pk] >= 1.5) { sk[pk] = 1; live.push(pk); } });

  const groups = peaks.map(pk => ({ lines: [], width: 2 * dist[pk] }));
  const xy = i => [i % W - 0.5, Math.floor(i / W) - 0.5];
  trace(sk, live, mask, off).forEach(p => {
    const g = groups[label[p.px[0]]];
    if (p.px.length === 1) {
      // punto suelto: solo si era una mancha de verdad (p. ej. el punto de la i), no ruido
      if (dist[p.px[0]] < 1.5) return;
      const [x, y] = xy(p.px[0]);
      g.lines.push({ pts: [[x - 0.25, y], [x + 0.25, y]], closed: false });
      return;
    }
    let pts = p.px.map(xy);
    if (p.closed) pts.push(pts[0]);
    pts = rdp(smooth(pts, p.closed), 0.5);
    g.lines.push({ pts, closed: p.closed });
  });
  return groups.filter(g => g.lines.length && (g.width >= 3 || g.lines.some(l => l.pts.length > 2 || len(l.pts) >= 3)));
}

const len = pts => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/** Suaviza la escalera de píxeles; las puntas (y el cierre de un lazo) no se mueven. */
function smooth(pts, closed) {
  let a = pts;
  for (let it = 0; it < 2; it++) {
    const n = a.length, b = a.map(p => p.slice());
    for (let i = 1; i < n - 1; i++) {
      b[i] = [(a[i - 1][0] + 2 * a[i][0] + a[i + 1][0]) / 4, (a[i - 1][1] + 2 * a[i][1] + a[i + 1][1]) / 4];
    }
    if (closed && n > 3) {
      const p = [(a[n - 2][0] + 2 * a[0][0] + a[1][0]) / 4, (a[n - 2][1] + 2 * a[0][1] + a[1][1]) / 4];
      b[0] = p; b[n - 1] = p.slice();
    }
    a = b;
  }
  return a;
}

/** Distancia de cada píxel de dibujo al fondo, en píxeles (chaflán 3-4). */
function distance(a, W, H) {
  const d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = a[i] ? 1e9 : 0;
  const pass = (y0, y1, dy, x0, x1, dx) => {
    for (let y = y0; y !== y1; y += dy) for (let x = x0; x !== x1; x += dx) {
      const i = y * W + x;
      if (!d[i]) continue;
      const v = Math.min(d[i], d[i - dx] + 3, d[i - dy * W] + 3, d[i - dy * W - dx] + 4, d[i - dy * W + dx] + 4);
      d[i] = v;
    }
  };
  pass(1, H - 1, 1, 1, W - 1, 1);
  pass(H - 2, 0, -1, W - 2, 0, -1);
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/**
 * Recorre el esqueleto: caminos entre puntas y cruces, y lazos cerrados sin cruces.
 * @returns {{px:number[], closed:boolean}[]} índices de píxel (con el borde)
 */
function trace(sk, live, mask, off) {
  const deg = i => popcount(mask(i));
  const seen = new Uint8Array(sk.length);
  const pairs = new Set();
  const out = [];
  const nbrs = i => { const r = []; for (let k = 0; k < 8; k++) if (sk[i + off[k]]) r.push(i + off[k]); return r; };
  const walk = (start, first) => {
    const px = [start];
    let prev = start, cur = first;
    for (;;) {
      px.push(cur);
      if (cur === start || deg(cur) !== 2) break;
      seen[cur] = 1;
      const next = nbrs(cur).find(q => q !== prev);
      if (next === undefined) break;
      prev = cur; cur = next;
    }
    return px;
  };
  live.forEach(p => {
    if (!sk[p] || deg(p) === 2) return;
    const ns = nbrs(p);
    if (!ns.length) { out.push({ px: [p], closed: false }); return; }
    ns.forEach(q => {
      if (deg(q) !== 2) {
        const key = Math.min(p, q) + ':' + Math.max(p, q);
        if (!pairs.has(key)) { pairs.add(key); out.push({ px: [p, q], closed: false }); }
      } else if (!seen[q]) {
        out.push({ px: walk(p, q), closed: false });
      }
    });
  });
  // lo que queda sin visitar son lazos sin puntas ni cruces (una O, un círculo)
  live.forEach(p => {
    if (!sk[p] || seen[p] || deg(p) !== 2) return;
    seen[p] = 1;
    const px = walk(p, nbrs(p)[0]);
    px.pop(); // walk termina repitiendo el inicio
    out.push({ px, closed: true });
  });
  return out;
}
