// Trayectorias del centro de la herramienta para cada elemento según su modo.
import { area, fromC, offset } from '../geometry/clipper.js';

/**
 * Vaciado por desplazamientos concéntricos hacia adentro.
 * @returns {{loops: {pts:[number,number][], closed:true}[], lost:number}} lost = mm² que la herramienta no alcanza
 */
export function pocket(paths, tl) {
  const loops = [];
  const e = tl.r * 0.98; // 2 % de holgura para que entre en ranuras del mismo ancho que la línea
  let cur = offset(paths, -e);
  const lost = area(paths) - area(offset(cur, e));
  let guard = 0;
  while (cur.length && guard++ < 500) {
    cur.forEach(p => { const f = fromC(p); if (f.length > 2) loops.push({ pts: f, closed: true }); });
    cur = offset(cur, -tl.step);
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
