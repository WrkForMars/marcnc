// Relieve 3D desde una imagen en grises: lo claro queda arriba y lo oscuro se hunde (o al revés). La herramienta barre
// en zigzag y, en cada punto, baja hasta donde toca la superficie con la forma real de su punta ("drop cutter"), para
// no comerse lo que está a un lado. Puro: mm y números.

/**
 * @typedef {{x0:number, y0:number, w:number, h:number, gw:number, gh:number, data:Float32Array}} Relief
 *   rectángulo en mm sobre la pieza; data: qué tan hondo va cada píxel (0 = la cara, 1 = lo más hondo), gw × gh, fila 0 arriba
 */

/**
 * Dónde queda el relieve en la pieza: ajustado con margen, o con el ancho pedido; centrado.
 * @param {number} gw @param {number} gh tamaño de la imagen en píxeles
 * @param {{W:number, H:number, margin:number, fit:string, drawW?:number}} p
 */
export function reliefLayout(gw, gh, p) {
  const M = Math.max(0, p.margin || 0);
  let w, h;
  if (p.fit === 'width' && p.drawW > 0) { w = p.drawW; h = w * gh / gw; } else {
    const k = Math.min((p.W - 2 * M) / gw, (p.H - 2 * M) / gh);
    w = gw * k; h = gh * k;
  }
  return { x0: (p.W - w) / 2, y0: (p.H - h) / 2, w, h };
}

/**
 * Profundidad de la punta de la herramienta en cada punto de una cuadrícula, sin cortar de más:
 * la mayor de (superficie − perfil de la punta) en su alrededor.
 * @param {Relief} r @param {number} depth mm de lo más hondo
 * @param {{type:string, D:number, src?:{vAngle?:number}}} tl
 * @returns {(x:number, y:number)=>number} z (≤ 0)
 */
export function dropCutter(r, depth, tl) {
  const cs = r.w / r.gw, R = tl.D / 2, n = Math.ceil(R / cs);
  const tan = Math.tan(Math.min(170, Math.max(5, +tl.src?.vAngle || 60)) * Math.PI / 360);
  // cuánto sube la punta a una distancia d del centro (0 en el centro)
  const prof = tl.type === 'ball' ? d => R - Math.sqrt(Math.max(0, R * R - d * d)) : tl.type === 'v' ? d => d / tan : () => 0;
  // superficie: −depth·data dentro del relieve; fuera de él, la cara de la pieza (0)
  const surf = (i, j) => (i < 0 || j < 0 || i >= r.gw || j >= r.gh ? 0 : -depth * r.data[j * r.gw + i]);
  return (x, y) => {
    // en píxeles, con la fila 0 arriba; cada píxel cuenta desde su punto más cercano a la herramienta (lo seguro)
    const u = (x - r.x0) / cs, v = (r.y0 + r.h - y) / cs;
    let z = -Infinity;
    for (let j = Math.floor(v - n - 1); j <= Math.ceil(v + n); j++) {
      const dv = Math.max(0, j - v, v - (j + 1)) * cs;
      if (dv > R) continue;
      for (let i = Math.floor(u - n - 1); i <= Math.ceil(u + n); i++) {
        const du = Math.max(0, i - u, u - (i + 1)) * cs, d = Math.hypot(du, dv);
        if (d > R) continue;
        const val = surf(i, j) - prof(d);
        if (val > z) z = val;
      }
    }
    return Math.min(0, z);
  };
}

/** RDP en 3D: quita los puntos que no se apartan más de `tol` de la recta entre sus vecinos. */
function simplify3(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay, az] = pts[a], [bx, by, bz] = pts[b];
    const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz;
    let best = -1, bd = tol;
    for (let k = a + 1; k < b; k++) {
      const [px, py, pz] = pts[k];
      const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / L2)) : 0;
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy, pz - az - t * dz);
      if (d > bd) { bd = d; best = k; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, k) => keep[k]);
}

/**
 * Zigzag de acabado sobre todo el relieve, en un solo camino: renglones a lo largo de X separados `step`, cada uno
 * en sentido contrario al anterior; entre renglones sube a la mayor de las dos alturas para no rozar.
 * @param {Relief} r @param {number} depth
 * @param {{type:string, D:number, w:number, src?:object}} tl
 * @param {{step?:number, dx?:number, tol?:number}} [o] step: entre renglones (por omisión un cuarto del diámetro)
 * @returns {{pts3:[number,number,number][], pts:[number,number][], closed:false}}
 */
export function reliefPath(r, depth, tl, o = {}) {
  const z = dropCutter(r, depth, tl);
  const step = o.step || Math.max(0.05, tl.D / 4), dx = o.dx || Math.max(0.05, r.w / r.gw), tol = o.tol || 0.01;
  const rows = Math.max(1, Math.round(r.h / step));
  const out = [];
  for (let k = 0; k <= rows; k++) {
    const y = r.y0 + (r.h * k) / rows;
    const n = Math.max(1, Math.round(r.w / dx));
    const row = [];
    for (let i = 0; i <= n; i++) { const x = r.x0 + (r.w * i) / n; row.push([x, y, z(x, y)]); }
    if (k % 2) row.reverse();
    const s = simplify3(row, tol);
    if (out.length) {
      // paso al siguiente renglón: sube primero (o baja después) para no cortar en diagonal sobre lo que hay entre los dos
      const a = out[out.length - 1], b = s[0], top = Math.max(a[2], b[2], z(a[0], (a[1] + b[1]) / 2));
      if (top > a[2]) out.push([a[0], a[1], top]);
      if (top > b[2]) out.push([b[0], b[1], top]);
    }
    out.push(...s);
  }
  return { pts3: out, pts: out.map(([x, y]) => [x, y]), closed: false };
}
