// Trayectorias del centro de la herramienta para cada elemento según su modo.
import { area, fromC, offset, simplifyPaths } from '../geometry/clipper.js';
import { profilePaths } from './cut.js';
import { circleOf, circleOfPts, drillPlan } from './drill.js';

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
    let lostHoles = 0;
    e.parts.forEach(p => {
      const rest = [];
      p.holes.forEach(h => {
        const c = circleOfPts(fromC(h));
        if (c && 2 * c.r <= tl.D * 1.1) out.paths.push({ pts: [[c.cx - 1e-3, c.cy], [c.cx + 1e-3, c.cy]], closed: false, hole: true, drill: drillPlan(c, tl) });
        else rest.push(h);
      });
      const r = profilePaths([p.outer, ...rest], tl.D / 2);
      out.paths.push(...r.paths); lostHoles += r.lost;
    });
    if (lostHoles) out.warn = `${lostHoles} hueco${lostHoles > 1 ? 's son más chicos' : ' es más chico'} que la herramienta: no se ${lostHoles > 1 ? 'pueden' : 'puede'} recortar`;
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
