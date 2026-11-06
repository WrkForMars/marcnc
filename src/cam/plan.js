// Calcula las trayectorias de todos los elementos (con caché) y el orden de corte.
import { simplify } from '../geometry/simplify.js';
import { toolpaths } from './toolpaths.js';
import { toolAt } from './tool.js';

const tick = () => new Promise(r => setTimeout(r, 0));

/**
 * Ordena por vecino más cercano: primero entre elementos, luego entre los caminos de cada uno.
 * Los recortes van al final (una pieza suelta ya no se puede grabar) y, dentro de cada uno, los huecos antes que el
 * contorno de afuera.
 * @returns {{i:number, seq: import('../model.js').LinePart[]}[]}
 */
export function orderPaths(elements, start = [0, 0]) {
  const order = [];
  const has = i => elements[i].paths && elements[i].paths.length;
  const all = elements.map((_, i) => i).filter(has);
  let pos = start;
  for (const left of [all.filter(i => elements[i].mode !== 'cut'), all.filter(i => elements[i].mode === 'cut')]) {
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach((i, j) => {
        const p = elements[i].paths[0].pts[0];
        const d = Math.hypot(p[0] - pos[0], p[1] - pos[1]);
        if (d < bd) { bd = d; bi = j; }
      });
      const i = left.splice(bi, 1)[0];
      const seq = [];
      const groups = elements[i].mode === 'cut' ? [elements[i].paths.filter(p => p.hole), elements[i].paths.filter(p => !p.hole)] : [elements[i].paths.slice()];
      groups.forEach(ps => {
        while (ps.length) {
          let bj = 0, bdd = Infinity;
          ps.forEach((p, j) => { const d = Math.hypot(p.pts[0][0] - pos[0], p.pts[0][1] - pos[1]); if (d < bdd) { bdd = d; bj = j; } });
          const p = ps.splice(bj, 1)[0];
          seq.push(p);
          pos = p.pts[p.pts.length - 1];
        }
      });
      order.push({ i, seq });
    }
  }
  return order;
}

/**
 * Calcula trayectorias sin bloquear la página: cede el hilo cada ~30 ms.
 * @param {import('../model.js').Element[]} elements
 * @param {ReturnType<import('./tool.js').toolGeometry>} tl
 * @param {{tol:number, cache?:Map<string,any>, keyOf?:(e:any)=>string, onProgress?:(msg:string)=>void, isCancelled?:()=>boolean}} opts
 * @returns {Promise<{tl:any, order:any[], tol:number}|null>} null si se canceló
 */
export async function computePlan(elements, tl, opts) {
  const { tol, cache, keyOf, onProgress = () => {}, isCancelled = () => false } = opts;
  let last = performance.now();
  for (let n = 0; n < elements.length; n++) {
    const e = elements[n];
    // cada figura con la herramienta a su profundidad (la del trabajo, la suya propia o la del recorte)
    const te = e.tl = e.op ? toolAt(tl, e.op.depth) : tl;
    const k = keyOf ? `${keyOf(e)}|${e.mode}|${te.r.toFixed(4)}|${te.step.toFixed(4)}|${te.D}|${tol}` : null;
    if (k && cache && cache.has(k)) {
      const c = cache.get(k);
      e.paths = c.paths; e.warn = c.warn;
    } else {
      const t = toolpaths(e, te);
      e.warn = t.warn;
      // pts: simplificada (vista previa, orden, rectas); dense: la original, para ajustar arcos sobre la curva real
      e.paths = t.paths
        .map(p => {
          const pts = simplify(p.pts, p.closed, tol);
          const dense = p.closed ? simplify(p.pts, true, 0) : p.pts;
          const q = dense.length > pts.length ? { pts, closed: p.closed, dense } : { pts, closed: p.closed };
          if (p.hole) q.hole = true;
          return q;
        })
        .filter(p => p.pts.length > 1);
      if (k && cache) cache.set(k, { paths: e.paths, warn: e.warn });
    }
    if (performance.now() - last > 30) {
      onProgress(`Calculando trayectorias ${n + 1}/${elements.length}`);
      await tick();
      if (isCancelled()) return null;
      last = performance.now();
    }
  }
  if (cache && cache.size > 4000) cache.clear();
  return { tl, order: orderPaths(elements), tol };
}
