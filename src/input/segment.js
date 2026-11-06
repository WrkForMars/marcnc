// Separar un objeto del fondo en una foto con unos toques (GrabCut): el usuario toca el objeto (＋) y, si hace falta,
// lo que sobra (－). Con los colores de cada lado se arman dos modelos (mezclas de gaussianas) y un corte mínimo en el
// grafo de píxeles decide qué es objeto: cortar es barato donde cambia el color (orillas) y caro dentro de una zona pareja.
// Se repite unas vueltas reajustando los modelos con lo que salió. Puro (sin DOM): trabaja sobre los bytes RGBA.

/* ---------- corte mínimo (Boykov–Kolmogorov) ---------- */

const TERMINAL = -2, ORPHAN = -3, NONE = -1, INF_D = 1e9;

/**
 * Grafo para flujo máximo / corte mínimo. Capacidades enteras (sin errores de redondeo al restar).
 * @param {number} n nodos @param {number} maxArcs aristas dirigidas (cada addEdge usa 2)
 */
export class Graph {
  constructor(n, maxArcs) {
    this.n = n;
    this.head = new Int32Array(maxArcs); this.next = new Int32Array(maxArcs); this.cap = new Float64Array(maxArcs);
    this.first = new Int32Array(n).fill(-1); this.tr = new Float64Array(n); this.arcs = 0;
  }
  /** Arista i→j con capacidad c y j→i con capacidad rc. Las aristas van en pares: la gemela de a es a ^ 1. */
  addEdge(i, j, c, rc) {
    const a = this.arcs; this.arcs += 2;
    this.head[a] = j; this.cap[a] = c; this.next[a] = this.first[i]; this.first[i] = a;
    this.head[a + 1] = i; this.cap[a + 1] = rc; this.next[a + 1] = this.first[j]; this.first[j] = a + 1;
  }
  /** Capacidad desde la fuente (objeto) y hacia el sumidero (fondo). */
  addTWeights(i, toSource, toSink) {
    const m = Math.min(toSource, toSink); // lo común a ambos se corta siempre: no cambia la decisión
    this.tr[i] += toSource - toSink;
    return m;
  }
  /** @returns {Uint8Array} 1 = lado de la fuente (objeto) */
  maxflow() {
    const { n, head, next, cap, first, tr } = this;
    const tree = new Uint8Array(n), parent = new Int32Array(n).fill(NONE); // tree: 0 libre, 1 fuente, 2 sumidero
    const ts = new Int32Array(n), dist = new Int32Array(n);
    const active = new Int32Array(n + 1), inQ = new Uint8Array(n);
    let qh = 0, qt = 0, qn = 0;
    const push = i => { if (!inQ[i]) { inQ[i] = 1; active[qt] = i; qt = (qt + 1) % (n + 1); qn++; } };
    const pop = () => { const i = active[qh]; qh = (qh + 1) % (n + 1); qn--; inQ[i] = 0; return i; };
    for (let i = 0; i < n; i++) {
      if (tr[i] > 0) { tree[i] = 1; parent[i] = TERMINAL; dist[i] = 1; push(i); }
      else if (tr[i] < 0) { tree[i] = 2; parent[i] = TERMINAL; dist[i] = 1; push(i); }
    }
    let time = 0, cur = -1;
    const orphans = [];
    for (;;) {
      // crecer los árboles hasta que se toquen
      let mid = -1;
      if (cur >= 0 && parent[cur] === NONE) cur = -1;
      while (mid < 0) {
        if (cur < 0) { if (!qn) break; cur = pop(); if (parent[cur] === NONE) { cur = -1; continue; } }
        const t = tree[cur];
        for (let a = first[cur]; a >= 0; a = next[a]) {
          const j = head[a];
          if (t === 1 ? cap[a] <= 0 : cap[a ^ 1] <= 0) continue;
          if (parent[j] === NONE) {
            tree[j] = t; parent[j] = a ^ 1; ts[j] = ts[cur]; dist[j] = dist[cur] + 1; push(j);
          } else if (tree[j] !== t) { mid = t === 1 ? a : a ^ 1; break; }
        }
        if (mid < 0) cur = -1;
      }
      if (mid < 0) break;
      time++;
      // aumentar por el camino fuente → s → mid → t → sumidero
      const s = head[mid ^ 1], tt = head[mid];
      let f = cap[mid];
      for (let x = s; parent[x] !== TERMINAL; x = head[parent[x]]) f = Math.min(f, cap[parent[x] ^ 1]);
      { let x = s; while (parent[x] !== TERMINAL) x = head[parent[x]]; f = Math.min(f, tr[x]); }
      for (let x = tt; parent[x] !== TERMINAL; x = head[parent[x]]) f = Math.min(f, cap[parent[x]]);
      { let x = tt; while (parent[x] !== TERMINAL) x = head[parent[x]]; f = Math.min(f, -tr[x]); }
      cap[mid] -= f; cap[mid ^ 1] += f;
      for (let x = s; ;) {
        const p = parent[x];
        if (p === TERMINAL) { tr[x] -= f; if (!tr[x]) { parent[x] = ORPHAN; orphans.push(x); } break; }
        cap[p ^ 1] -= f; cap[p] += f;
        const up = head[p];
        if (!cap[p ^ 1]) { parent[x] = ORPHAN; orphans.push(x); }
        x = up;
      }
      for (let x = tt; ;) {
        const p = parent[x];
        if (p === TERMINAL) { tr[x] += f; if (!tr[x]) { parent[x] = ORPHAN; orphans.push(x); } break; }
        cap[p] -= f; cap[p ^ 1] += f;
        const up = head[p];
        if (!cap[p]) { parent[x] = ORPHAN; orphans.push(x); }
        x = up;
      }
      // adoptar huérfanos: buscarles otro padre en su árbol o dejarlos libres
      while (orphans.length) {
        const i = orphans.pop(), t = tree[i];
        let best = -1, dmin = INF_D;
        for (let a = first[i]; a >= 0; a = next[a]) {
          if (t === 1 ? cap[a ^ 1] <= 0 : cap[a] <= 0) continue;
          let j = head[a];
          if (tree[j] !== t || parent[j] === NONE) continue;
          let d = 0;
          for (;;) {
            if (ts[j] === time) { d += dist[j]; break; }
            const p = parent[j]; d++;
            if (p === TERMINAL) { ts[j] = time; dist[j] = 1; break; }
            if (p === ORPHAN) { d = INF_D; break; }
            j = head[p];
          }
          if (d < INF_D) {
            if (d < dmin) { best = a; dmin = d; }
            for (j = head[a]; ts[j] !== time; j = head[parent[j]]) { ts[j] = time; dist[j] = d--; }
          }
        }
        if (best >= 0) { parent[i] = best; ts[i] = time; dist[i] = dmin + 1; continue; }
        // sin padre: queda libre; sus vecinos del mismo árbol vuelven a crecer y sus hijos quedan huérfanos
        for (let a = first[i]; a >= 0; a = next[a]) {
          const j = head[a];
          if (tree[j] !== t || parent[j] === NONE) continue;
          if (t === 1 ? cap[a ^ 1] > 0 : cap[a] > 0) push(j);
          if (parent[j] !== TERMINAL && parent[j] !== ORPHAN && head[parent[j]] === i) { parent[j] = ORPHAN; orphans.push(j); }
        }
        parent[i] = NONE; tree[i] = 0;
        if (cur === i) cur = -1;
      }
    }
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = parent[i] !== NONE && tree[i] === 1 ? 1 : 0;
    return out;
  }
}

/* ---------- modelos de color ---------- */

/** Generador pseudoaleatorio con semilla: el mismo resultado cada vez. */
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/**
 * Mezcla de K gaussianas en RGB ajustada con k-medias.
 * @param {Float32Array} px colores (3 por muestra) @param {number[]} idx muestras a usar
 * @returns {{w:number, m:number[], inv:number[], c:number}[]} c = log del peso menos la normalización
 */
export function fitGMM(px, idx, K = 5, seed = 1) {
  const rand = rng(seed);
  const maxS = 6000;
  const S = idx.length > maxS ? Array.from({ length: maxS }, () => idx[(rand() * idx.length) | 0]) : idx;
  if (!S.length) return [];
  K = Math.min(K, S.length);
  // k-medias++
  const cent = [];
  const first = S[(rand() * S.length) | 0];
  cent.push([px[3 * first], px[3 * first + 1], px[3 * first + 2]]);
  const d2 = new Float64Array(S.length).fill(Infinity);
  while (cent.length < K) {
    const c = cent[cent.length - 1];
    let tot = 0;
    S.forEach((i, k) => { const d = (px[3 * i] - c[0]) ** 2 + (px[3 * i + 1] - c[1]) ** 2 + (px[3 * i + 2] - c[2]) ** 2; if (d < d2[k]) d2[k] = d; tot += d2[k]; });
    if (!tot) break;
    let r = rand() * tot, k = 0;
    while (k < S.length - 1 && (r -= d2[k]) > 0) k++;
    cent.push([px[3 * S[k]], px[3 * S[k] + 1], px[3 * S[k] + 2]]);
  }
  const lab = new Int32Array(S.length);
  for (let it = 0; it < 8; it++) {
    S.forEach((i, k) => {
      let b = 0, bd = Infinity;
      cent.forEach((c, q) => { const d = (px[3 * i] - c[0]) ** 2 + (px[3 * i + 1] - c[1]) ** 2 + (px[3 * i + 2] - c[2]) ** 2; if (d < bd) { bd = d; b = q; } });
      lab[k] = b;
    });
    const sum = cent.map(() => [0, 0, 0, 0]);
    S.forEach((i, k) => { const s = sum[lab[k]]; s[0] += px[3 * i]; s[1] += px[3 * i + 1]; s[2] += px[3 * i + 2]; s[3]++; });
    sum.forEach((s, q) => { if (s[3]) cent[q] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  // media, covarianza e inversa de cada grupo
  return cent.map((_, q) => {
    let n = 0; const m = [0, 0, 0], C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    S.forEach((i, k) => { if (lab[k] === q) { n++; m[0] += px[3 * i]; m[1] += px[3 * i + 1]; m[2] += px[3 * i + 2]; } });
    if (!n) return null;
    m[0] /= n; m[1] /= n; m[2] /= n;
    S.forEach((i, k) => {
      if (lab[k] !== q) return;
      const d = [px[3 * i] - m[0], px[3 * i + 1] - m[1], px[3 * i + 2] - m[2]];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[3 * r + c] += d[r] * d[c];
    });
    for (let k = 0; k < 9; k++) C[k] /= n;
    for (let k = 0; k < 3; k++) C[4 * k] += 9; // ruido de la cámara: sin esto un grupo de un solo color sería infinitamente estrecho
    const [a, b, c, d, e, f, g, h, i] = C;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    const inv = [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d].map(v => v / det);
    return { w: n / S.length, m, inv, c: Math.log(n / S.length) - 0.5 * Math.log(det) - 1.5 * Math.log(2 * Math.PI) };
  }).filter(Boolean);
}

/** −log de la probabilidad del color (r, g, b) según el modelo (más = menos parecido). */
export function gmmCost(g, r, gr, b) {
  let best = -Infinity; const ls = [];
  for (const k of g) {
    const x = r - k.m[0], y = gr - k.m[1], z = b - k.m[2], v = k.inv;
    const q = x * (v[0] * x + v[1] * y + v[2] * z) + y * (v[3] * x + v[4] * y + v[5] * z) + z * (v[6] * x + v[7] * y + v[8] * z);
    const l = k.c - 0.5 * q; ls.push(l); if (l > best) best = l;
  }
  let s = 0; for (const l of ls) s += Math.exp(l - best);
  return Math.min(60, -(best + Math.log(s)));
}

/* ---------- máscaras ---------- */

/** Etiqueta componentes 4-conexos de los píxeles con m[i] === v. */
function components(m, w, h, v) {
  const lab = new Int32Array(w * h).fill(-1), sizes = [], stack = [];
  for (let s = 0; s < w * h; s++) {
    if (m[s] !== v || lab[s] >= 0) continue;
    const id = sizes.length; let n = 0;
    lab[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop(); n++;
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && m[i - 1] === v && lab[i - 1] < 0) { lab[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && m[i + 1] === v && lab[i + 1] < 0) { lab[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && m[i - w] === v && lab[i - w] < 0) { lab[i - w] = id; stack.push(i - w); }
      if (y < h - 1 && m[i + w] === v && lab[i + w] < 0) { lab[i + w] = id; stack.push(i + w); }
    }
    sizes.push(n);
  }
  return { lab, sizes };
}

/**
 * Suaviza la orilla: promedio en una caja de radio r, tres veces (casi una gaussiana). El corte entre píxeles
 * deja escalones; al promediar y cortar a la mitad la orilla sigue la forma sin los dientes.
 * @returns {Float32Array} 0–1
 */
export function smoothMask(m, w, h, r) {
  let a = Float32Array.from(m);
  const b = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) { // horizontal
      let s = 0, c = 0;
      for (let x = -r; x < w; x++) {
        if (x + r < w) { s += a[y * w + x + r]; c++; }
        if (x - r - 1 >= 0) { s -= a[y * w + x - r - 1]; c--; }
        if (x >= 0) b[y * w + x] = s / c;
      }
    }
    for (let x = 0; x < w; x++) { // vertical
      let s = 0, c = 0;
      for (let y = -r; y < h; y++) {
        if (y + r < h) { s += b[(y + r) * w + x]; c++; }
        if (y - r - 1 >= 0) { s -= b[(y - r - 1) * w + x]; c--; }
        if (y >= 0) a[y * w + x] = s / c;
      }
    }
  }
  return a;
}

/** Escala la máscara (o el campo 0–1 de smoothMask) con interpolación bilineal y umbral a la mitad. */
export function resizeMask(m, w, h, W, H) {
  const out = new Uint8Array(W * H);
  for (let Y = 0; Y < H; Y++) {
    const fy = Math.min(h - 1, Math.max(0, (Y + 0.5) * h / H - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let X = 0; X < W; X++) {
      const fx = Math.min(w - 1, Math.max(0, (X + 0.5) * w / W - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const v = (m[y0 * w + x0] * (1 - tx) + m[y0 * w + x1] * tx) * (1 - ty) + (m[y1 * w + x0] * (1 - tx) + m[y1 * w + x1] * tx) * ty;
      out[Y * W + X] = v >= 0.5 ? 1 : 0;
    }
  }
  return out;
}

/* ---------- GrabCut ---------- */

/**
 * @typedef {{x:number, y:number, fg:boolean}} Seed toque en píxeles de la imagen que se pasa
 */

/**
 * Separa el objeto tocado del fondo.
 * @param {Uint8ClampedArray} rgba @param {number} W @param {number} H
 * @param {{seeds:Seed[], work?:number, iters?:number}} o work = lado mayor con el que se calcula (px)
 * @returns {Uint8Array} 1 = objeto, de W × H
 */
export function segmentObject(rgba, W, H, o) {
  const seeds = o.seeds || [];
  if (!seeds.some(s => s.fg)) return new Uint8Array(W * H);
  // se calcula en chico (rápido) y la máscara se agranda al final
  const k = Math.min(1, (o.work || 360) / Math.max(W, H));
  const w = Math.max(4, Math.round(W * k)), h = Math.max(4, Math.round(H * k)), n = w * h;
  const px = new Float32Array(3 * n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // promedio del bloque que cae en este píxel (quita ruido de la foto)
    const X0 = Math.floor(x * W / w), X1 = Math.max(X0 + 1, Math.floor((x + 1) * W / w));
    const Y0 = Math.floor(y * H / h), Y1 = Math.max(Y0 + 1, Math.floor((y + 1) * H / h));
    let r = 0, g = 0, b = 0, c = 0;
    for (let yy = Y0; yy < Y1; yy++) for (let xx = X0; xx < X1; xx++) { const i = 4 * (yy * W + xx); r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; c++; }
    const i = 3 * (y * w + x); px[i] = r / c; px[i + 1] = g / c; px[i + 2] = b / c;
  }
  const L = Math.max(w, h);
  // toques: lo que cubre el pincel queda fijo; un círculo mayor alrededor sirve para conocer los colores de cada lado
  const hard = new Int8Array(n); // 1 objeto, -1 fondo
  const near = new Int8Array(n);
  const brush = Math.max(2, Math.round(L * 0.012)), reach = Math.max(4, Math.round(L * 0.06));
  const paint = (s, r, arr, v) => {
    const cx = s.x * k, cy = s.y * k;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) arr[y * w + x] = v;
  };
  seeds.forEach(s => { paint(s, reach, near, s.fg ? 1 : -1); });
  seeds.forEach(s => { paint(s, brush, hard, s.fg ? 1 : -1); });
  // primer modelo: el objeto, cerca de sus toques; el fondo, la orilla de la imagen y los toques de fondo
  let fgIdx = [], bgIdx = [];
  const edge = Math.max(2, Math.round(L * 0.03));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (hard[i] === 1 || (near[i] === 1 && hard[i] !== -1)) fgIdx.push(i);
    else if (hard[i] === -1 || near[i] === -1 || x < edge || y < edge || x >= w - edge || y >= h - edge) bgIdx.push(i);
  }
  if (!bgIdx.length) for (let i = 0; i < n; i++) if (!hard[i]) bgIdx.push(i);
  // vecinos (8) y contraste promedio para la suavidad
  const nb = [[1, 0, 1], [0, 1, 1], [1, 1, Math.SQRT1_2], [-1, 1, Math.SQRT1_2]];
  let sum = 0, cnt = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (const [dx, dy] of nb) {
    const X = x + dx, Y = y + dy;
    if (X < 0 || X >= w || Y >= h) continue;
    const a = 3 * (y * w + x), b = 3 * (Y * w + X);
    sum += (px[a] - px[b]) ** 2 + (px[a + 1] - px[b + 1]) ** 2 + (px[a + 2] - px[b + 2]) ** 2; cnt++;
  }
  const beta = cnt && sum ? 1 / (2 * sum / cnt) : 0, gamma = 50, SC = 16, BIG = 1e9;
  let mask = new Uint8Array(n);
  const iters = o.iters || 4;
  for (let it = 0; it < iters; it++) {
    const fg = fitGMM(px, fgIdx, 5, 7 + it), bg = fitGMM(px, bgIdx, 5, 11 + it);
    const G = new Graph(n, n * 8);
    for (let i = 0; i < n; i++) {
      let s, t;
      if (hard[i] === 1) { s = BIG; t = 0; }
      else if (hard[i] === -1) { s = 0; t = BIG; }
      else {
        // s = cuesta llamarlo fondo, t = cuesta llamarlo objeto
        s = Math.round(SC * gmmCost(bg, px[3 * i], px[3 * i + 1], px[3 * i + 2]));
        t = Math.round(SC * gmmCost(fg, px[3 * i], px[3 * i + 1], px[3 * i + 2]));
      }
      G.addTWeights(i, s, t);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (const [dx, dy, f] of nb) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || X >= w || Y >= h) continue;
      const a = y * w + x, b = Y * w + X;
      const d = (px[3 * a] - px[3 * b]) ** 2 + (px[3 * a + 1] - px[3 * b + 1]) ** 2 + (px[3 * a + 2] - px[3 * b + 2]) ** 2;
      const c = Math.round(SC * gamma * f * Math.exp(-beta * d));
      if (c > 0) G.addEdge(a, b, c, c);
    }
    mask = G.maxflow();
    fgIdx = []; bgIdx = [];
    for (let i = 0; i < n; i++) (mask[i] ? fgIdx : bgIdx).push(i);
    if (!fgIdx.length || !bgIdx.length) break;
  }
  // solo lo unido a los toques del objeto; los huecos chicos se tapan (brillos, sombras dentro del objeto)
  const { lab } = components(mask, w, h, 1), keep = new Set();
  for (let i = 0; i < n; i++) if (hard[i] === 1 && lab[i] >= 0) keep.add(lab[i]);
  for (let i = 0; i < n; i++) mask[i] = mask[i] && keep.has(lab[i]) ? 1 : 0;
  const holes = components(mask, w, h, 0), touches = new Set();
  for (let x = 0; x < w; x++) { touches.add(holes.lab[x]); touches.add(holes.lab[(h - 1) * w + x]); }
  for (let y = 0; y < h; y++) { touches.add(holes.lab[y * w]); touches.add(holes.lab[y * w + w - 1]); }
  for (let i = 0; i < n; i++) {
    const id = holes.lab[i];
    if (id >= 0 && !touches.has(id) && holes.sizes[id] < n * 0.01 && hard[i] !== -1) mask[i] = 1;
  }
  return resizeMask(smoothMask(mask, w, h, Math.max(1, Math.round(L / 240))), w, h, W, H);
}
