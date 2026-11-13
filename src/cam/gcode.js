// Escritura del programa G y M. Función pura: no toca el DOM.
import { MODE_NAME } from '../model.js';
import { rdp } from '../geometry/simplify.js';
import { fitArcs } from './arcs.js';
import { RAPID_MM_MIN } from './simulate.js';
import { passWalk, perimeter, rampLength, tabIntervals } from './cut.js';
import { usedTools } from './tools.js';
import { helixDrill, pointDrill } from './drill.js';

/**
 * @typedef {{
 *   W:number, H:number,            // pieza en mm
 *   dialect:'fanuc'|'grbl',
 *   dec:1|2|3,                     // decimales de las coordenadas
 *   retract:number,                // altura de retracción Z (mm)
 *   fz:number, fxy:number,         // avances en mm/min
 *   toolNum:number, rpm:number, prog:number,
 *   arcs:boolean,                  // convertir curvas a G02/G03 (solo con 2 o 3 decimales)
 *   changer?:boolean,              // false: la máquina no cambia herramientas sola (Fanuc también pausa con M00)
 *   tools?:{t:number, type:string, dia:number, fxy?:number, fz?:number}[],  // fxy/fz: avances propios (si no, los del trabajo)  // con varias herramientas: la 0 es la principal (toolNum); el plan
 *                                  // dice cuál usa cada figura (order[].tool) y entre una y otra se cambia
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

/** Pendiente (tan 30°) desde la que una bajada va al avance de Z. */
export const STEEP = Math.tan(Math.PI / 6);

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
  const R = Math.max(0.5, +o.retract || 0);
  // avances de la herramienta puesta (cada una puede tener los suyos); nunca en cero
  let fz = Math.max(1, +o.fz || 0), fxy = Math.max(1, +o.fxy || 0);
  // con 1 decimal el redondeo de los extremos deforma el arco más de lo que toleran los controladores
  const useArcs = o.arcs && dec >= 2;
  const arcTol = Math.max(tol, eps * 1.5); // la tolerancia de curvas, repartida entre el ajuste (55 %) y el redondeo (45 %)
  /** Pasadas de igual profundidad hasta llegar al fondo. */
  const levels = t => {
    const n = Math.max(1, Math.ceil(t.depth / t.down - 1e-9)), out = [];
    for (let p = 1; p <= n; p++) out.push(-Math.min(t.depth, p * t.depth / n));
    return out;
  };
  const zs = levels(tl), passes = zs.length;

  const tools = o.tools && o.tools.length ? o.tools : [{ t: o.toolNum, type: tl.type, dia: tl.D }];
  const tname = k => `T${tools[k].t} ${TOOL_NAME[tools[k].type]} D${f(tools[k].dia)}`;
  let cur = order.length ? order[0].tool || 0 : 0; // empieza con la que usa lo primero que se corta
  const feedsOf = k => [Math.max(1, +(tools[k].fz || o.fz) || 0), Math.max(1, +(tools[k].fxy || o.fxy) || 0)];
  [fz, fxy] = feedsOf(cur);
  // tiempo de corte por herramienta: cada tramo a su avance
  let cutMins = 0, lastCut = 0, lastZ = 0, lastPl = 0;
  const flushTime = () => {
    cutMins += (cutLen - lastCut) / fxy + (zLen - lastZ) / fz + (plunges - lastPl) * (tl.depth / passes + R) / fz;
    lastCut = cutLen; lastZ = zLen; lastPl = plunges;
  };
  const L = [];
  if (o.dialect === 'fanuc') L.push('%', `O${String(o.prog || 1).padStart(4, '0')} (MARCNC - PIEZA ${o.W}X${o.H})`);
  L.push(`(PIEZA ${o.W} X ${o.H} MM - CERO EN ESQUINA INFERIOR IZQUIERDA - Z0 EN CARA SUPERIOR)`);
  if (cur === 0) L.push(`(T${o.toolNum} ${TOOL_NAME[tl.type]} D${f(tl.D)} - ANCHO DE LINEA ${f(tl.w)} MM - PROF. ${f(tl.depth)} MM EN ${passes} PASADA${passes > 1 ? 'S' : ''})`);
  else L.push(`(${tname(cur)})`);
  const used = usedTools(order);
  if (used.length > 1) L.push(`(HERRAMIENTAS: ${used.map(tname).join(' - ')})`);
  L.push('G21 G90 G17 G40 G49 G80');
  const auto = o.dialect === 'fanuc' && o.changer !== false; // cambiador automático
  if (auto) L.push(`T${tools[cur].t} M06`);
  else L.push(`(CAMBIO MANUAL A HERRAMIENTA T${tools[cur].t})`);
  // con cambiador y más de una herramienta, cada una lleva su largo de la tabla (G43 H#): sin eso la segunda quedaría
  // a otra altura. Con una sola herramienta el programa no cambia (Z0 se toma con ella).
  const comp = auto && used.length > 1;
  const safeZ = k => (comp ? `G00 G43 H${tools[k].t} Z${f(R)}` : `G00 Z${f(R)}`);
  L.push(`S${o.rpm} M03`, 'G54', safeZ(cur));
  /** Cambio de herramienta a media obra: Fanuc la cambia sola; GRBL se pausa para que el operador la cambie. */
  const changeTool = k => {
    flushTime();
    L.push('M05');
    if (auto) L.push('G28 G91 Z0', 'G90', `(${tname(k)})`, `T${tools[k].t} M06`);
    else L.push(...(o.dialect === 'fanuc' ? ['G28 G91 Z0', 'G90'] : []), `(CAMBIA A ${tname(k)} Y TOMA DE NUEVO Z0)`, 'M00');
    L.push(`S${o.rpm} M03`, safeZ(k));
    cur = k;
    [fz, fxy] = feedsOf(k);
  };

  let cutLen = 0, rapLen = 0, plunges = 0, arcsN = 0, pos = [0, 0], zLen = 0, tabsN = 0;
  order.forEach(({ i, seq, tool }) => {
    const e = elements[i];
    if ((tool || 0) !== cur) changeTool(tool || 0);
    const te = e.tl || tl, zsE = te === tl ? zs : levels(te);
    const holes = e.type === 'region' && e.parts.length === 1 ? e.parts[0].holes.length : 0;
    const label = (e.src === 'text' ? `TEXTO "${commentSafe(e.text.text)}"` : `FIGURA ${(e.copyOf ?? i) + 1}`) + (e.copyOf != null ? ` COPIA ${e.copyN}` : '');
    // la profundidad solo se repite si esta figura tiene la suya
    const own = te.depth === tl.depth ? '' : e.mode === 'drill' ? ` - PROF. ${f(te.depth)} MM`
      : ` - PROF. ${f(te.depth)} MM EN ${zsE.length} PASADA${zsE.length > 1 ? 'S' : ''}`;
    // tramo libre de puentes al inicio del contorno: la rampa de 5°. Si da la vuelta completa (más empinada) o no hay
    // rampa, los puentes van donde sea: sobre un puente la rampa solo deja de bajar
    const dzPass = te.depth / zsE.length, rampFor = len => { const r = rampLength(dzPass, len); return r < len ? r : 0; };
    const ring = p => (p.pts[0][0] === p.pts[p.pts.length - 1][0] && p.pts[0][1] === p.pts[p.pts.length - 1][1] ? p.pts.slice(0, -1) : p.pts);
    // puentes: los del usuario (o automáticos) en el contorno de afuera; dos en los huecos grandes para que no salten
    const tabsOf = p => {
      if (e.mode !== 'cut' || !e.op) return [];
      const len = perimeter(ring(p));
      return tabIntervals(len, p.hole ? (e.op.tabs ?? (len > 40 ? 2 : 0)) : e.op.tabs, e.op.tabW, rampFor(len));
    };
    const nTabs = seq.reduce((a, p) => a + (p.closed ? tabsOf(p).length : 0), 0);
    const dr = seq[0] && seq[0].drill;
    L.push(`(${label} - ${MODE_NAME[e.mode]}${dr ? ` DE ${f(2 * dr.r)} MM${dr.kind === 'helix' ? ' EN ESPIRAL' : ''}` : ''}${holes ? ` - ${holes} HUECO${holes > 1 ? 'S' : ''}` : ''}${own}${nTabs ? ` - ${nTabs} PUENTE${nTabs > 1 ? 'S' : ''}` : ''})`);

    seq.forEach(p0 => {
      // una vuelta de tallado en V va a su propia profundidad (en pasadas si es más honda que la profundidad por pasada)
      const zsP = p0.z != null ? levels({ depth: -p0.z, down: te.down }) : zsE;
      if (p0.z != null && -p0.z < 1e-6) return; // a ras de la cara no corta nada
      const p = p0;
      if (p.pts3) {
        // relieve: el mismo zigzag en cada nivel, sin bajar de ese nivel (desbaste por capas hasta el acabado)
        zsE.forEach(level => {
          const q = p.pts3.map(([x, y, z]) => [x, y, Math.max(z, level)]);
          const [x0, y0, z0] = q[0];
          rapLen += Math.hypot(x0 - pos[0], y0 - pos[1]);
          L.push(`G00 X${f(x0)} Y${f(y0)}`, `G01 Z${f(z0)} F${fz}`);
          plunges++;
          let lx = x0, ly = y0, lz = z0, lastF = fz;
          q.slice(1).forEach(([x, y, z]) => {
            const sx = f(x), sy = f(y), sz = f(z);
            if (sx === f(lx) && sy === f(ly) && sz === f(lz)) return;
            let t = 'G01';
            if (sx !== f(lx)) t += ` X${sx}`;
            if (sy !== f(ly)) t += ` Y${sy}`;
            if (sz !== f(lz)) t += ` Z${sz}`;
            // una bajada de más de 30° es casi de punta: va al avance de Z. Se mide con lo ya redondeado, que es lo que corre
            const dz = +sz - +f(lz), dxy = Math.hypot(+sx - +f(lx), +sy - +f(ly));
            const want = dz < 0 && -dz > STEEP * dxy ? fz : fxy;
            if (want !== lastF) { t += ` F${want}`; lastF = want; }
            L.push(t);
            if (want === fz) zLen += Math.hypot(x - lx, y - ly, z - lz); // el tiempo, a su avance
            else cutLen += Math.hypot(x - lx, y - ly, z - lz);
            lx = x; ly = y; lz = z;
          });
          pos = [lx, ly];
          L.push(`G00 Z${f(R)}`);
        });
        return;
      }
      if (p.drill) {
        const d = p.drill;
        const start = d.kind === 'point' ? [d.cx, d.cy] : [d.cx + d.rc, d.cy];
        rapLen += Math.hypot(start[0] - pos[0], start[1] - pos[1]);
        if (d.kind === 'point') {
          const r = pointDrill(d, te, { dialect: o.dialect, R, fz, f });
          L.push(...r.lines); zLen += r.zLen;
          pos = [d.cx, d.cy];
        } else {
          const r = helixDrill(d, te, { R, fz, fxy, f });
          L.push(...r.lines); cutLen += r.cutLen; zLen += R;
          pos = [d.cx, d.cy];
        }
        return;
      }
      // contorno cerrado que entra hondo (o un recorte): rampa de entrada y puentes, en vez de bajar de punta.
      // Si la rampa de 5° no cabe, baja en la vuelta completa (hasta 20°); en un contorno todavía más chico baja de punta
      // al avance de Z. Los puentes se respetan igual.
      const dzP = p.z != null ? -p.z / zsP.length : dzPass;
      if (p.closed && p.pts.length > 2 && (e.mode === 'cut' || dzP > 0.25)) {
        const pts = ring(p), tabs = tabsOf(p);
        const ramp = rampLength(dzP, perimeter(pts)) > 0;
        tabsN += tabs.length;
        const [x0, y0] = pts[0];
        rapLen += Math.hypot(x0 - pos[0], y0 - pos[1]);
        L.push(`G00 X${f(x0)} Y${f(y0)}`);
        if (ramp) { L.push(`G01 Z${f(0)} F${fz}`); plunges++; } // a ras de la cara; de ahí baja en rampa
        let lx = x0, ly = y0, lz = ramp ? 0 : R;
        zsP.forEach((z, zi) => {
          const w = passWalk(pts, { zFrom: zi ? zsP[zi - 1] : 0, z, ramp, tabs, tabTop: e.op?.tabTop, cleanup: zi === zsP.length - 1 });
          let needF = true;
          // sin rampa, el primer punto ya está a la profundidad de la pasada: es la bajada de punta
          w.forEach(([x, y, zz]) => {
            const sx = f(x), sy = f(y), sz = f(zz);
            if (sx === f(lx) && sy === f(ly) && sz === f(lz)) return;
            const vertical = sx === f(lx) && sy === f(ly);
            let t = 'G01';
            if (sx !== f(lx)) t += ` X${sx}`;
            if (sy !== f(ly)) t += ` Y${sy}`;
            if (sz !== f(lz)) t += ` Z${sz}`;
            if (vertical && zz < lz) { t += ` F${fz}`; needF = true; zLen += lz - zz; } // baja después de un puente: de punta, despacio
            else {
              if (needF) { t += ` F${fxy}`; needF = false; }
              cutLen += Math.hypot(x - lx, y - ly, zz - lz);
            }
            L.push(t);
            lx = x; ly = y; lz = zz;
          });
        });
        pos = [lx, ly];
        L.push(`G00 Z${f(R)}`);
        return;
      }
      const moves = useArcs ? arcMoves(p.dense || p.pts, arcTol) : p.pts.slice(1).map(q => ({ arc: false, to: q }));
      zsP.forEach((z, zi) => {
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

  flushTime();
  const mins = cutMins + rapLen / RAPID_MM_MIN;
  return { text: L.join('\n') + '\n', lines: L.length, cutLen, mins, plunges, arcsN, passes, tabs: tabsN };
}
