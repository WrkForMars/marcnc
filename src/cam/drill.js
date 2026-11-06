// Barrenos: un círculo del tamaño de la herramienta se barrena en su centro (ciclo G81, o G83 con picoteo si es hondo);
// uno más grande se abre bajando en espiral (interpolación helicoidal) por dentro de su orilla. Puro: mm y texto.
import { fromC } from '../geometry/clipper.js';

/**
 * El círculo que forma una figura, si es un círculo (contorno sin huecos con todos sus puntos a la misma distancia del
 * centro, ±1 %); null si no.
 * @returns {{cx:number, cy:number, r:number}|null}
 */
export function circleOf(e) {
  if (e.type !== 'region' || e.parts.length !== 1 || e.parts[0].holes.length) return null;
  const pts = fromC(e.parts[0].outer);
  if (pts.length < 12) return null;
  let cx = 0, cy = 0;
  pts.forEach(([x, y]) => { cx += x; cy += y; });
  cx /= pts.length; cy /= pts.length;
  const rs = pts.map(([x, y]) => Math.hypot(x - cx, y - cy));
  const r = rs.reduce((a, v) => a + v, 0) / rs.length;
  return r > 0 && rs.every(v => Math.abs(v - r) <= 0.01 * r + 0.002) ? { cx, cy, r } : null;
}

/**
 * Cómo se hace el barreno con esta herramienta.
 * @param {{cx:number, cy:number, r:number}} c
 * @param {{D:number}} tl
 * @returns {{kind:'point'|'helix', cx:number, cy:number, r:number, rc:number}} rc: radio del camino del centro de la
 *   herramienta (0 si se barrena en el centro)
 */
export function drillPlan(c, tl) {
  // hasta 10 % más grande que la herramienta se barrena de un golpe; más grande, en espiral
  if (2 * c.r <= tl.D * 1.1) return { kind: 'point', cx: c.cx, cy: c.cy, r: c.r, rc: 0 };
  return { kind: 'helix', cx: c.cx, cy: c.cy, r: c.r, rc: c.r - tl.D / 2 };
}

/**
 * Líneas de un barreno en el centro.
 * @param {{cx:number, cy:number}} d
 * @param {{depth:number, D:number}} t
 * @param {{dialect:string, R:number, fz:number, f:(v:number)=>string}} o R: retracción; f: formato de números
 * @returns {{lines:string[], zLen:number}} zLen: mm recorridos a avance de Z (para el tiempo)
 */
export function pointDrill(d, t, o) {
  const { f } = o, rPlane = Math.min(1, o.R), z = -t.depth;
  const peck = t.depth > 2.5 * t.D; // hondo: picoteo para sacar la viruta
  const q = Math.max(0.5, t.D);
  if (o.dialect === 'fanuc') {
    const cyc = peck ? `G98 G83 X${f(d.cx)} Y${f(d.cy)} Z${f(z)} R${f(rPlane)} Q${f(q)} F${o.fz}` : `G98 G81 X${f(d.cx)} Y${f(d.cy)} Z${f(z)} R${f(rPlane)} F${o.fz}`;
    return { lines: [cyc, 'G80'], zLen: t.depth + rPlane };
  }
  // GRBL no tiene ciclos fijos: los mismos movimientos, escritos uno por uno
  const L = [`G00 X${f(d.cx)} Y${f(d.cy)}`, `G00 Z${f(rPlane)}`];
  if (!peck) L.push(`G01 Z${f(z)} F${o.fz}`);
  else {
    for (let dd = q; ; dd += q) {
      const zz = -Math.min(t.depth, dd);
      L.push(`G01 Z${f(zz)} F${o.fz}`);
      if (zz <= z + 1e-9) break;
      L.push(`G00 Z${f(rPlane)}`, `G00 Z${f(zz + 0.2)}`);
    }
  }
  L.push(`G00 Z${f(o.R)}`);
  return { lines: L, zLen: t.depth + rPlane };
}

/**
 * Líneas de un barreno en espiral (helicoidal): baja por media vuelta con G02 (a favor del corte, por dentro del hueco),
 * da una vuelta completa al fondo para limpiar y sale por el centro.
 * @param {{cx:number, cy:number, rc:number}} d
 * @param {{depth:number, D:number, down:number}} t
 * @param {{R:number, fz:number, fxy:number, f:(v:number)=>string}} o
 * @returns {{lines:string[], cutLen:number}}
 */
export function helixDrill(d, t, o) {
  const { f } = o;
  // centro y radio ya redondeados: los extremos y el centro del arco cuadran exactos para el control
  const cx = +f(d.cx), cy = +f(d.cy), rc = Math.max(+f(d.rc), 10 ** -2);
  const circ = 2 * Math.PI * rc;
  const pitch = Math.min(t.down, circ * Math.tan(5 * Math.PI / 180)); // bajada por vuelta: rampa de 5° o menos
  const halves = Math.max(2, Math.ceil(2 * t.depth / pitch));
  const L = [`G00 X${f(cx + rc)} Y${f(cy)}`, `G01 Z${f(0)} F${o.fz}`];
  let first = true;
  const half = (k, z) => {
    const [x0, x1] = k % 2 ? [cx - rc, cx + rc] : [cx + rc, cx - rc];
    L.push(`G02 X${f(x1)} Y${f(cy)} Z${f(z)} I${f(cx - x0)} J${f(0)}${first ? ` F${o.fxy}` : ''}`);
    first = false;
  };
  for (let k = 1; k <= halves; k++) half(k - 1, -t.depth * k / halves);
  for (let k = 0; k < 2; k++) half(halves + k, -t.depth); // vuelta de limpieza al fondo
  L.push(`G01 X${f(cx)} Y${f(cy)}`, `G00 Z${f(o.R)}`);
  return { lines: L, cutLen: Math.hypot(circ * (halves + 2) / 2, t.depth) + rc };
}
