// Trayectorias del centro de la herramienta para cada elemento según su modo.
import { area, fromC, offset, simplifyPaths } from '../geometry/clipper.js';
import { profilePaths } from './cut.js';
import { circleOf, circleOfPts, drillPlan } from './drill.js';
import { reliefPath } from './relief.js';

// 5 µm: muy por debajo de lo que repite una máquina; reduce ~5× los vértices y el tiempo del vaciado
const POCKET_TOL = 0.005;

/**
 * Vaciado por desplazamientos concéntricos hacia adentro.
 * @returns {{loops: {pts:[number,number][], closed:true}[], lost:number}} lost = mm² que la herramienta no alcanza
 */
export function pocket(paths, tl) {
  const loops = [];
  const e = tl.r * 0.98; // 2 % de holgura para que entre en ranuras del mismo ancho que la línea
  let cur = offset(simplifyPaths(paths, POCKET_TOL), -e);
  const lost = area(paths) - area(offset(cur, e));
  let guard = 0;
  while (cur.length && guard++ < 500) {
    cur.forEach(p => { const f = fromC(p); if (f.length > 2) loops.push({ pts: f, closed: true }); });
    cur = offset(simplifyPaths(cur, POCKET_TOL), -tl.step);
  }
  return { loops, lost };
}

/**
 * Tallado en V: vueltas hacia adentro, cada una más honda mientras más lejos está de la orilla (la punta en V corta a
 * la orilla justo con esa profundidad), así las esquinas salen afiladas. Al llegar a la profundidad del trabajo, lo
 * que queda adentro se vacía a esa profundidad, con fondo plano.
 * @returns {{pts:[number,number][], closed:true, z:number, w:number}[]} z: profundidad de la vuelta (negativa); w: ancho
 */
export function vcarve(paths, tl) {
  const tan = Math.tan(Math.min(170, Math.max(5, +tl.src?.vAngle || 60)) * Math.PI / 360), tip = Math.max(0, +tl.src?.vTip || 0);
  const zMax = tl.depth, out = [];
  const STEP = 0.1; // 0.1 mm hacia adentro por vuelta: las terrazas quedan de menos de 0.1 mm
  const base = simplifyPaths(paths, POCKET_TOL);
  let d = tip / 2 + STEP / 2, flat = false, guard = 0;
  while (guard++ < 600) {
    const cur = offset(base, -d);
    if (!cur.length) break;
    const z = Math.min(zMax, Math.max(0, (d - tip / 2) / tan));
    const w = tip + 2 * z * tan;
    cur.forEach(p => { const f = fromC(p); if (f.length > 2) out.push({ pts: f, closed: true, z: -z, w }); });
    if (z >= zMax - 1e-9) flat = true;
    // ya a fondo: el resto se vacía con el ancho que deja la punta a esa profundidad
    d += flat ? Math.max(0.05, w * 0.45) : STEP;
  }
  return out;
}

/**
 * @param {import('../model.js').Element} e
 * @param {ReturnType<import('./tool.js').toolGeometry>} tl
 * @returns {{paths: import('../model.js').LinePart[], warn: string|null}}
 */
export function toolpaths(e, tl) {
  const out = { paths: [], warn: null };
  if (e.mode === 'skip') return out;

  if (e.type === 'line') {
    e.parts.forEach(p => out.paths.push({ pts: p.pts, closed: p.closed }));
    if (e.src === 'text' && e.text.h < 4 * tl.w) {
      out.warn = `letras de ${e.text.h} mm con una línea de ${tl.w.toFixed(2)} mm se van a empastar; súbelas a ${Math.ceil(4 * tl.w)} mm o más`;
    }
    return out;
  }

  if (e.mode === 'relief') { out.paths.push(reliefPath(e.relief, tl.depth, tl)); return out; }

  if (e.mode === 'vcarve') {
    if (tl.type !== 'v') { out.warn = 'el tallado en V necesita un V-bit'; return out; }
    e.parts.forEach(p => out.paths.push(...vcarve([p.outer, ...p.holes], tl)));
    return out;
  }

  if (e.mode === 'drill') {
    const c = circleOf(e);
    if (!c) { out.warn = 'no es un círculo: solo los círculos se barrenan'; return out; }
    const d = drillPlan(c, tl);
    // en el centro: un punto (se dibuja como un círculo del ancho de la herramienta); en espiral: el camino del centro
    const pts = d.kind === 'point' ? [[c.cx - 1e-3, c.cy], [c.cx + 1e-3, c.cy]]
      : Array.from({ length: 48 }, (_, k) => [c.cx + d.rc * Math.cos(Math.PI * k / 24), c.cy + d.rc * Math.sin(Math.PI * k / 24)]);
    out.paths.push({ pts, closed: d.kind === 'helix', drill: d });
    if (2 * c.r < 0.9 * tl.D) out.warn = `el barreno de ${(2 * c.r).toFixed(2)} mm es más chico que la herramienta: saldrá de ${tl.D.toFixed(2)} mm`;
    return out;
  }

  if (e.mode === 'cut') {
    // por fuera del contorno y por dentro de los huecos, con el radio de la herramienta a fondo; un hueco redondo del
    // tamaño de la herramienta se barrena (si no, se perdería: la herramienta no cabe para recortarlo por dentro)
    let lostHoles = 0, narrow = 0;
    e.parts.forEach(p => {
      const rest = [];
      p.holes.forEach(h => {
        const c = circleOfPts(fromC(h));
        if (c && 2 * c.r <= tl.D * 1.1) out.paths.push({ pts: [[c.cx - 1e-3, c.cy], [c.cx + 1e-3, c.cy]], closed: false, hole: true, drill: drillPlan(c, tl) });
        else rest.push(h);
      });
      const r = profilePaths([p.outer, ...rest], tl.D / 2);
      out.paths.push(...r.paths); lostHoles += r.lost;
      // lo que la herramienta no alcanza por fuera (entre los dientes de un engrane, en esquinas hacia adentro):
      // crecer y volver a encoger el contorno rellena justo esos huecos
      const outerOnly = [p.outer];
      narrow += Math.max(0, area(offset(offset(outerOnly, tl.D / 2), -tl.D / 2)) - area(outerOnly));
    });
    if (lostHoles) out.warn = `${lostHoles} hueco${lostHoles > 1 ? 's son más chicos' : ' es más chico'} que la herramienta: no se ${lostHoles > 1 ? 'pueden' : 'puede'} recortar`;
    else if (narrow > 0.5) out.warn = `la herramienta de ${tl.D.toFixed(2)} mm no entra en las partes angostas del contorno: ${narrow.toFixed(1)} mm² quedan sin cortar (usa una más delgada)`;
    return out;
  }

  let lost = 0, tot = 0, noHoles = true;
  e.parts.forEach(p => {
    const all = [p.outer, ...p.holes];
    if (e.mode === 'contour') {
      all.forEach(q => out.paths.push({ pts: fromC(q), closed: true }));
    } else if (e.mode === 'fill') {
      const r = pocket(all, tl);
      out.paths.push(...r.loops);
      lost += r.lost; tot += Math.abs(area(all));
    } else if (e.mode === 'invert') {
      // orilla exterior + vaciado de cada hueco
      out.paths.push({ pts: fromC(p.outer), closed: true });
      if (p.holes.length) noHoles = false;
      p.holes.forEach(h => {
        const hp = h.slice().reverse(); // el hueco invertido es una región positiva
        const r = pocket([hp], tl);
        out.paths.push(...r.loops);
        lost += r.lost; tot += Math.abs(area([hp]));
      });
    }
  });
  if (e.mode === 'invert' && noHoles) out.warn = 'no tiene huecos: invertir solo graba el contorno';
  else if (lost > Math.max(0.3, 0.03 * tot)) out.warn = `${lost.toFixed(1)} mm² más finos que la herramienta quedarán sin grabar`;
  return out;
}
