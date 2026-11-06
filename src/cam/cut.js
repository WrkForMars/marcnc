// Recortar piezas: la herramienta va por fuera del contorno y por dentro de los huecos (la pieza sale a la medida),
// atraviesa el material, deja puentes para que la pieza no se suelte y entra en rampa en vez de bajar de punta.
// Puro: trabaja en mm sobre polilíneas.
import { offset, fromC } from '../geometry/clipper.js';

/** Cuánto más abajo del grosor baja el recorte, para que atraviese aunque la cara no esté perfectamente plana. */
export const BREAK = 0.2;
/** Pendiente de la rampa de entrada: 5° (una fresa corta bien de lado, mal de punta). */
const RAMP = Math.tan(5 * Math.PI / 180);

/**
 * Profundidad y puentes de cada figura según su modo.
 * @param {{mode:string, opts?:{depth?:number, tabs?:number}}} e
 * @param {{depth:number, thick:number, dia:number}} p profundidad del trabajo, grosor del material, diámetro de la herramienta
 * @returns {{depth:number, tabTop?:number, tabW?:number, tabs?:number|null}}
 *   tabTop: Z de la cara de arriba del puente; tabs: cuántos (null = automático)
 */
export function elementOp(e, p) {
  if (e.mode === 'cut') {
    const tabH = Math.min(2, Math.max(0.6, p.thick / 3));
    return { depth: p.thick + BREAK, tabTop: -(p.thick - tabH), tabW: 3 + p.dia, tabs: e.opts?.tabs ?? null };
  }
  const d = e.opts?.depth;
  return { depth: d > 0 ? d : p.depth };
}

/**
 * Trayectorias de recorte: la región se agranda medio ancho de la herramienta (el exterior crece, los huecos se encogen).
 * Los huecos van primero: si la pieza se suelta antes, se mueve mientras se cortan.
 * @param {{X:number,Y:number}[][]} paths contorno y huecos (Clipper)
 * @param {number} r radio de la herramienta a la profundidad de corte
 * @returns {{paths:{pts:[number,number][], closed:true, hole:boolean}[], lost:number}} lost = huecos donde la herramienta no cabe
 */
export function profilePaths(paths, r) {
  const loops = offset(paths, r).map(p => fromC(p)).filter(p => p.length > 2);
  const sa = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; a += x0 * y1 - x1 * y0; } return a / 2; };
  const out = loops.map(pts => ({ pts, closed: true, hole: sa(pts) < 0 }));
  const holesIn = paths.length - 1, holesOut = out.filter(p => p.hole).length;
  out.sort((a, b) => Number(b.hole) - Number(a.hole));
  return { paths: out, lost: Math.max(0, holesIn - holesOut) };
}

/** Largo de una polilínea cerrada. */
export function perimeter(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; s += Math.hypot(x1 - x0, y1 - y0); }
  return s;
}

/**
 * Dónde van los puentes, como tramos [desde, hasta] medidos a lo largo del contorno, repartidos parejo.
 * Se dejan libres los primeros `skip` mm (la rampa de entrada).
 * @param {number} len perímetro @param {number|null} n cuántos (null: uno cada ~70 mm, de 2 a 8; 0 si es muy chico)
 */
export function tabIntervals(len, n, w, skip = 0) {
  if (n == null) n = len < 30 ? 0 : Math.min(8, Math.max(2, Math.round(len / 70)));
  if (!n || len < n * (w + 2) + skip) return [];
  const free = len - skip;
  return Array.from({ length: n }, (_, k) => { const c = skip + free * (k + 0.5) / n; return [c - w / 2, c + w / 2]; });
}

/**
 * Recorrido 3D de una pasada sobre un contorno cerrado: baja en rampa desde `zFrom` hasta `z` a lo largo del contorno,
 * da la vuelta completa (y en la última pasada repasa el tramo de la rampa ya a fondo), y sube sobre los puentes.
 * @param {[number,number][]} pts contorno cerrado (sin repetir el primer punto)
 * @param {{zFrom:number, z:number, tabs?:[number,number][], tabTop?:number, ramp?:boolean, cleanup?:boolean}} o
 *   cleanup: en la última pasada repasa el tramo de la rampa ya a fondo; en las demás termina donde empezó, para que
 *   la siguiente baje desde ahí
 * @returns {[number,number,number][]} puntos (x, y, z), empezando en el inicio del contorno a zFrom
 */
export function passWalk(pts, o) {
  const len = perimeter(pts);
  const dz = o.zFrom - o.z;
  const rampLen = o.ramp && dz > 0 ? Math.min(len, dz / RAMP) : 0;
  const tabs = o.z < (o.tabTop ?? -Infinity) ? (o.tabs || []) : [];
  const total = len + (o.cleanup === false ? 0 : rampLen); // vuelta completa (+ repaso de la rampa)
  // profundidad a lo largo del recorrido (s de 0 a total)
  const zAt = s => {
    let z = s < rampLen ? o.zFrom - dz * (s / rampLen) : o.z;
    const sl = s % len;
    if (tabs.some(([a, b]) => sl > a + 1e-9 && sl < b - 1e-9)) z = Math.max(z, o.tabTop);
    return z;
  };
  // puntos de quiebre: vértices, fin de la rampa y orillas de los puentes, en las dos vueltas
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i % pts.length][0] - pts[i - 1][0], pts[i % pts.length][1] - pts[i - 1][1]));
  const marks = new Set();
  for (let lap = 0; lap * len <= total + 1e-9; lap++) {
    cum.forEach(c => marks.add(lap * len + c));
    tabs.forEach(([a, b]) => { marks.add(lap * len + a); marks.add(lap * len + b); });
  }
  marks.add(rampLen); marks.add(total);
  const ss = [...marks].filter(s => s >= -1e-9 && s <= total + 1e-9).sort((a, b) => a - b);
  const xyAt = s => {
    const sl = ((s % len) + len) % len;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < sl) i++;
    const t = (sl - cum[i - 1]) / Math.max(1e-12, cum[i] - cum[i - 1]);
    const a = pts[i - 1], b = pts[i % pts.length];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const out = [];
  const push = (x, y, z) => {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - x) < 1e-9 && Math.abs(q[1] - y) < 1e-9 && Math.abs(q[2] - z) < 1e-9) return;
    out.push([x, y, z]);
  };
  ss.forEach(s => {
    const [x, y] = xyAt(s);
    // en la orilla de un puente: subir o bajar en el mismo punto (no en diagonal)
    const zb = zAt(s - 1e-6), za = s ? zAt(s + 1e-6) : zAt(0);
    if (s > 0) push(x, y, zb);
    if (s < total) push(x, y, za); else push(x, y, zAt(s - 1e-6));
  });
  return out;
}
