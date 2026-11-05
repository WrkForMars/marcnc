// Escritura del programa G y M. Función pura: no toca el DOM.
import { MODE_NAME } from '../model.js';
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
  const R = o.retract, fz = o.fz, fxy = o.fxy;
  // con 1 decimal el redondeo de los extremos deforma el arco más de lo que toleran los controladores
  const useArcs = o.arcs && dec >= 2;
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
    const label = e.src === 'text' ? `TEXTO "${e.text.text.toUpperCase().replace(/[()]/g, '')}"` : `FIGURA ${i + 1}`;
    L.push(`(${label} - ${MODE_NAME[e.mode]}${holes ? ` - ${holes} HUECO${holes > 1 ? 'S' : ''}` : ''})`);

    seq.forEach(p => {
      const moves = useArcs ? fitArcs(p.pts, Math.max(tol, eps * 1.5)) : p.pts.slice(1).map(q => ({ arc: false, to: q }));
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
          if (mv.arc) {
            // el controlador usa los extremos redondeados: recalcular el centro sobre su mediatriz
            const ax = +f(lx), ay = +f(ly), bx = +sx, by = +sy;
            const mx = (ax + bx) / 2, my = (ay + by) / 2;
            let nx = -(by - ay), ny = bx - ax;
            const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
            const tt = (mv.c[0] - mx) * nx + (mv.c[1] - my) * ny;
            const cx = mx + tt * nx, cy = my + tt * ny;
            s = `${mv.ccw ? 'G03' : 'G02'} X${sx} Y${sy} I${f(cx - ax)} J${f(cy - ay)}`;
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
