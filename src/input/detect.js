// Detección del dibujo en una imagen: qué píxeles son dibujo (1) y cuáles fondo (0).
// Puro (sin DOM): trabaja sobre los bytes RGBA. Así una foto con sombra, un logo sobre color o un dibujo
// claro sobre fondo oscuro se separan del fondo sin mover el umbral a mano.

/** @typedef {'auto'|'photo'|'color'|'manual'} DetectMode */

/** Brillo 0–255 de cada píxel. */
export function luminance(rgba, n) {
  const g = new Uint8Array(n);
  for (let i = 0; i < n; i++) g[i] = (0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2]) | 0;
  return g;
}

/** Umbral de Otsu: el que mejor separa dos grupos de valores (dibujo y fondo). */
export function otsu(values) {
  const hist = new Float64Array(256);
  values.forEach(v => { hist[v]++; });
  const n = values.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let wB = 0, sumB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t + 1; }
  }
  return thr;
}

/** Píxeles de la orilla (el fondo casi siempre la toca). */
function borderIdx(w, h) {
  const out = [];
  for (let x = 0; x < w; x++) out.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) out.push(y * w, y * w + w - 1);
  return out;
}

/**
 * Umbral adaptativo (Bradley): cada píxel se compara con el promedio de su vecindario, así una sombra
 * que oscurece medio papel no se confunde con dibujo.
 * @param {number} k qué tan más oscuro que su entorno debe ser (0.15 = 15 %)
 */
export function adaptive(gray, w, h, k = 0.15, minContrast = 12) {
  const S = new Float64Array((w + 1) * (h + 1)); // imagen integral
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += gray[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; }
  }
  const r = Math.max(4, Math.round(Math.max(w, h) / 16)), m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const mean = (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      const v = gray[y * w + x];
      m[y * w + x] = v < mean * (1 - k) && mean - v > minContrast ? 1 : 0;
    }
  }
  return m;
}

/** Color del fondo: la mediana de cada canal en la orilla de la imagen. */
export function borderColor(rgba, w, h) {
  const idx = borderIdx(w, h), med = c => { const a = idx.map(i => rgba[4 * i + c]).sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(0), med(1), med(2)];
}

/** Erosión o dilatación con un cuadrado de lado 2r+1 (por renglones y luego columnas, con sumas acumuladas). */
function morph(m, w, h, r, dilate) {
  const pass = (src, len, count, at) => {
    const out = new Uint8Array(src.length), pre = new Int32Array(len + 1);
    for (let line = 0; line < count; line++) {
      for (let i = 0; i < len; i++) pre[i + 1] = pre[i] + src[at(line, i)];
      for (let i = 0; i < len; i++) {
        const a = Math.max(0, i - r), b = Math.min(len, i + r + 1), s = pre[b] - pre[a];
        out[at(line, i)] = dilate ? (s > 0 ? 1 : 0) : (s === b - a ? 1 : 0);
      }
    }
    return out;
  };
  return pass(pass(m, w, h, (y, x) => y * w + x), h, w, (x, y) => y * w + x);
}

/** Limpieza: abre (quita puntitos sueltos) y cierra (tapa huecos chicos) con radio r. */
export function clean(m, w, h, r) {
  if (r <= 0) return m;
  const open = morph(morph(m, w, h, r, false), w, h, r, true);
  return morph(morph(open, w, h, r, true), w, h, r, false);
}

/**
 * @param {Uint8ClampedArray} rgba
 * @param {{mode:DetectMode, thr?:number, invert?:boolean, clean?:number}} o
 * @returns {{mask:Uint8Array, inverted:boolean, ink:number, used:DetectMode}} ink = fracción de la imagen tomada como dibujo;
 *   used = el modo que se aplicó (en automático puede ser 'photo')
 */
export function detectInk(rgba, w, h, o) {
  const n = w * h;
  let m, inverted = false, mode = o.mode;
  if (mode === 'auto') {
    // orilla con brillo muy desigual = papel con sombra: el umbral adaptativo la ignora. Un logo o un escaneo
    // tienen la orilla pareja y se quedan con Otsu (el adaptativo vaciaría sus rellenos grandes).
    const b = borderIdx(w, h).map(i => (0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2]) | 0).sort((p, q) => p - q);
    if (b[Math.floor(b.length * 0.9)] - b[Math.floor(b.length * 0.1)] > 50) mode = 'photo';
  }
  if (mode === 'color') {
    const [r, g, b] = borderColor(rgba, w, h), d = new Uint8Array(n);
    for (let i = 0; i < n; i++) d[i] = Math.min(255, Math.hypot(rgba[4 * i] - r, rgba[4 * i + 1] - g, rgba[4 * i + 2] - b)) | 0;
    const t = Math.max(40, otsu(d)); // menos de 40 es ruido o compresión, no otro color
    m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = d[i] >= t ? 1 : 0;
  } else {
    const gray = luminance(rgba, n);
    if (mode === 'photo') m = adaptive(gray, w, h);
    else {
      let t = mode === 'manual' ? (o.thr ?? 128) : otsu(gray);
      // una imagen casi lisa no tiene dibujo: Otsu partiría el ruido en dos
      if (mode === 'auto') { let lo = 255, hi = 0; gray.forEach(v => { if (v < lo) lo = v; if (v > hi) hi = v; }); if (hi - lo < 24) t = -1; }
      m = new Uint8Array(n);
      for (let i = 0; i < n; i++) m[i] = gray[i] < t ? 1 : 0;
      // en automático, si la orilla es casi toda "dibujo", el fondo es oscuro: se invierte
      if (mode === 'auto') {
        const b = borderIdx(w, h);
        if (b.reduce((a, i) => a + m[i], 0) > 0.6 * b.length) { for (let i = 0; i < n; i++) m[i] ^= 1; inverted = true; }
      }
    }
  }
  if (o.invert) { for (let i = 0; i < n; i++) m[i] ^= 1; inverted = !inverted; }
  m = clean(m, w, h, o.clean || 0);
  let ink = 0;
  for (let i = 0; i < n; i++) ink += m[i];
  return { mask: m, inverted, ink: ink / n, used: mode };
}

/** Máscara → RGBA en blanco y negro, que es lo que espera ImageTracer. */
export function maskToRGBA(m, w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = m[i] ? 0 : 255; d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v; d[4 * i + 3] = 255; }
  return { width: w, height: h, data: d };
}
