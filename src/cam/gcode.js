// Escritura del programa G y M. Función pura: no toca el DOM.
import { MODE_NAME } from '../model.js';
import { rdp } from '../geometry/simplify.js';
import { fitArcs } from './arcs.js';
import { RAPID_MM_MIN } from './simulate.js';

/**
 * @typedef {{
 *   W:number, H:number,            // pieza en mm
 *   dialect:'fanuc'|'grbl',
 *   dec:1|2|3,                     // decimales de las coordenadas
 *   retract:number,                // altura de retracción Z (mm)
 *   fz:number, fxy:number,         // avances en mm/min
 *   toolNum:number, rpm:number, prog:number,
 *   arcs:boolean,                  // convertir curvas a G02/G03 (solo con 2 o 3 decimales)
 * }} GcodeOptions
 */

const TOOL_NAME = { ball: 'BALL MILL', flat: 'FRESA PLANA', v: 'V-BIT' };

/** Texto apto para un comentario: mayúsculas ASCII, sin acentos ni paréntesis (muchos controles rechazan lo demás). */
export function commentSafe(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9 .,:;_\-+*/#=]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/**
 * Centro del arco para el control, que usa los extremos ya redondeados: se proyecta el centro sobre la mediatriz
 * de esos extremos y se prueban los redondeos vecinos de I y J hasta que el radio al inicio y al final difieran
 * menos de lo que acepta GRBL (0.005 mm; Fanuc es más tolerante). Con cuerdas cortas el centro es muy sensible al
 * redondeo: si el arco resultante se aparta del original más de maxDev, no sirve.
 * @returns {[number,number]|null} I, J ya redondeados, o null si ninguno cumple
 */
export function arcCenter(ax, ay, bx, by, c, dec, maxDev = Infinity) {
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  let nx = -(by - ay), ny = bx - ax;
  const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
  const t = (c[0] - mx) * nx + (c[1] - my) * ny;
  const I0 = mx + t * nx - ax, J0 = my + t * ny - ay;
  const u = Math.pow(10, -dec), q = v => Math.round(v / u) * u, lim = dec >= 3 ? 0.002 : 0.005;
  let best = null, bd = Infinity;
  for (const di of [0, -1, 1]) for (const dj of [0, -1, 1]) {
    const I = q(I0) + di * u, J = q(J0) + dj * u;
    const d = Math.abs(Math.hypot(I, J) - Math.hypot(bx - ax - I, by - ay - J));
    // cuánto se mueve el arco: lo que se desplaza el centro más lo que cambia el radio
    const dev = Math.hypot(ax + I - c[0], ay + J - c[1]) + Math.abs(Math.hypot(I, J) - c[2]);
    if (dev <= maxDev && d < bd - 1e-12) { bd = d; best = [I, J]; }
  }
  return bd <= lim ? best : null;
}

/**
 * Arcos ajustados sobre la trayectoria densa (la curva real, no la simplificada) y los tramos rectos entre ellos
 * simplificados con la tolerancia. fitArcs reparte: los vértices a 0.55·tol del círculo, y el redondeo del centro
 * se queda con el resto (arcCenter con 0.45·tol).
 */
function arcMoves(pts, tol) {
  const raw = fitArcs(pts, tol * 0.55), out = [];
  let run = [pts[0]];
  const flush = () => { if (run.length > 1) rdp(run, tol).slice(1).forEach(q => out.push({ arc: false, to: q })); };
  raw.forEach(m => {
    if (m.arc) { flush(); out.push(m); run = [m.to]; } else run.push(m.to);
  });
  flush();
  return out;
}

/** Puntos sobre el arco (sin el inicial) con cuerdas que se apartan menos de tol. */
function arcAsLines(x0, y0, x1, y1, mv, tol) {
  const [cx, cy, r] = mv.c;
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  let sw = Math.atan2(y1 - cy, x1 - cx) - a0;
  if (mv.ccw) { while (sw <= 0) sw += 2 * Math.PI; } else { while (sw >= 0) sw -= 2 * Math.PI; }
  const n = Math.max(1, Math.ceil(Math.abs(sw) / (2 * Math.acos(Math.max(-1, 1 - tol / r)))));
  const out = [];
  for (let k = 1; k < n; k++) out.push([cx + r * Math.cos(a0 + sw * k / n), cy + r * Math.sin(a0 + sw * k / n)]);
  out.push([x1, y1]);
  return out;
}

/**
 * @param {{tl:any, order:{i:number, seq:{pts:[number,number][], closed:boolean}[]}[], tol:number}} plan
 * @param {import('../model.js').Element[]} elements
 * @param {GcodeOptions} o
 */
export function generateGcode(plan, elements, o) {
  const { tl, order, tol } = plan;
  const dec = o.dec;
  const eps = 0.5 * Math.pow(10, -dec);
  const f = v => (Math.abs(v) < eps ? 0 : v).toFixed(dec);
  // salvaguardas: un rápido nunca a ras ni dentro de la pieza, y nunca un avance en cero
  const R = Math.max(0.5, +o.retract || 0), fz = Math.max(1, +o.fz || 0), fxy = Math.max(1, +o.fxy || 0);
  // con 1 decimal el redondeo de los extremos deforma el arco más de lo que toleran los controladores
  const useArcs = o.arcs && dec >= 2;
  const arcTol = Math.max(tol, eps * 1.5); // la tolerancia de curvas, repartida entre el ajuste (55 %) y el redondeo (45 %)
  const passes = Math.max(1, Math.ceil(tl.depth / tl.down - 1e-9));
  const zs = [];
  for (let p = 1; p <= passes; p++) zs.push(-Math.min(tl.depth, p * tl.depth / passes));

  const L = [];
  if (o.dialect === 'fanuc') L.push('%', `O${String(o.prog || 1).padStart(4, '0')} (MARCNC - PIEZA ${o.W}X${o.H})`);
  L.push(`(PIEZA ${o.W} X ${o.H} MM - CERO EN ESQUINA INFERIOR IZQUIERDA - Z0 EN CARA SUPERIOR)`);
  L.push(`(T${o.toolNum} ${TOOL_NAME[tl.type]} D${f(tl.D)} - ANCHO DE LINEA ${f(tl.w)} MM - PROF. ${f(tl.depth)} MM EN ${passes} PASADA${passes > 1 ? 'S' : ''})`);
  L.push('G21 G90 G17 G40 G49 G80');
  if (o.dialect === 'fanuc') L.push(`T${o.toolNum} M06`);
  else L.push(`(CAMBIO MANUAL A HERRAMIENTA T${o.toolNum})`);
  L.push(`S${o.rpm} M03`, 'G54', `G00 Z${f(R)}`);

  let cutLen = 0, rapLen = 0, plunges = 0, arcsN = 0, pos = [0, 0];
  order.forEach(({ i, seq }) => {
    const e = elements[i];
    const holes = e.type === 'region' && e.parts.length === 1 ? e.parts[0].holes.length : 0;
    const label = e.src === 'text' ? `TEXTO "${commentSafe(e.text.text)}"` : `FIGURA ${i + 1}`;
    L.push(`(${label} - ${MODE_NAME[e.mode]}${holes ? ` - ${holes} HUECO${holes > 1 ? 'S' : ''}` : ''})`);

    seq.forEach(p => {
      const moves = useArcs ? arcMoves(p.dense || p.pts, arcTol) : p.pts.slice(1).map(q => ({ arc: false, to: q }));
      zs.forEach((z, zi) => {
        const [x0, y0] = p.pts[0];
        // un contorno cerrado termina donde empezó: la siguiente pasada baja sin moverse
        if (zi === 0 || !p.closed) {
          if (zi > 0) L.push(`G00 Z${f(R)}`);
          rapLen += Math.hypot(x0 - pos[0], y0 - pos[1]);
          L.push(`G00 X${f(x0)} Y${f(y0)}`);
        }
        L.push(`G01 Z${f(z)} F${fz}`);
        plunges++;
        let first = true, lx = x0, ly = y0;
        moves.forEach(mv => {
          const [x, y] = mv.to;
          const sx = f(x), sy = f(y);
          if (sx === f(lx) && sy === f(ly)) return;
          let s;
          const ij = mv.arc ? arcCenter(+f(lx), +f(ly), +sx, +sy, mv.c, dec, arcTol * 0.45) : null;
          if (mv.arc && !ij) {
            // ningún centro redondeado deja los dos radios iguales: rectas cortas en vez de un arco que el control rechazaría
            arcAsLines(lx, ly, x, y, mv, tol).forEach(([px, py]) => {
              const qx = f(px), qy = f(py);
              if (qx === f(lx) && qy === f(ly)) return;
              let t = 'G01';
              if (qx !== f(lx)) t += ` X${qx}`;
              if (qy !== f(ly)) t += ` Y${qy}`;
              if (first) { t += ` F${fxy}`; first = false; }
              L.push(t);
              cutLen += Math.hypot(px - lx, py - ly);
              lx = px; ly = py;
            });
            return;
          }
          if (mv.arc) {
            s = `${mv.ccw ? 'G03' : 'G02'} X${sx} Y${sy} I${f(ij[0])} J${f(ij[1])}`;
            arcsN++;
            let da = Math.atan2(y - mv.c[1], x - mv.c[0]) - Math.atan2(ly - mv.c[1], lx - mv.c[0]);
            if (mv.ccw) { while (da < 0) da += 2 * Math.PI; } else { while (da > 0) da -= 2 * Math.PI; }
            cutLen += Math.abs(da) * mv.c[2];
          } else {
            s = 'G01';
            if (sx !== f(lx)) s += ` X${sx}`;
            if (sy !== f(ly)) s += ` Y${sy}`;
            cutLen += Math.hypot(x - lx, y - ly);
          }
          if (first) { s += ` F${fxy}`; first = false; }
          L.push(s);
          lx = x; ly = y;
        });
        pos = [lx, ly];
      });
      L.push(`G00 Z${f(R)}`);
    });
  });

  L.push('M05');
  if (o.dialect === 'fanuc') L.push('G28 G91 Z0', 'G90', 'M30', '%');
  else L.push('M30');

  const mins = cutLen / fxy + plunges * (tl.depth / passes + R) / fz + rapLen / RAPID_MM_MIN;
  return { text: L.join('\n') + '\n', lines: L.length, cutLen, mins, plunges, arcsN, passes };
}
