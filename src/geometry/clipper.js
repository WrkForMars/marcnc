// Operaciones de polígonos con Clipper. Clipper trabaja con enteros:
// todas las coordenadas en mm se multiplican por S (1 unidad = 1 µm).
import ClipperLib from 'clipper-lib';
import { rdp } from './simplify.js';

export const CL = ClipperLib;
export const S = 1000;

/** @param {[number,number][]} p puntos en mm → camino de Clipper */
export const toC = p => p.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }));
/** camino de Clipper → puntos en mm */
export const fromC = p => p.map(q => [q.X / S, q.Y / S]);

/** Área con signo en mm² (contornos positivos, huecos negativos). */
export const area = paths => paths.reduce((a, p) => a + CL.Clipper.Area(p), 0) / (S * S);

/** Desplaza polígonos cerrados `d` mm (negativo = hacia adentro). */
export function offset(paths, d) {
  if (!paths.length) return [];
  const co = new CL.ClipperOffset(2, 0.02 * S);
  co.AddPaths(paths, CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
  const out = new CL.Paths();
  co.Execute(out, d * S);
  return out;
}

/**
 * Quita vértices de polígonos cerrados que se desvían menos de `tol` mm (RDP).
 * Los desplazamientos con esquinas redondas multiplican los vértices; sin esto cada vuelta del vaciado es más cara que la anterior.
 */
export function simplifyPaths(paths, tol) {
  const t = tol * S;
  return paths.map(p => {
    const a = rdp(p.map(q => [q.X, q.Y]).concat([[p[0].X, p[0].Y]]), t);
    a.pop();
    return a.map(([X, Y]) => ({ X, Y }));
  }).filter(p => p.length > 2);
}

export function union(paths, fillType = CL.PolyFillType.pftNonZero) {
  const c = new CL.Clipper();
  c.AddPaths(paths, CL.PolyType.ptSubject, true);
  const tree = new CL.PolyTree();
  c.Execute(CL.ClipType.ctUnion, tree, fillType, fillType);
  return tree;
}

export function diff(a, b) {
  const c = new CL.Clipper();
  c.AddPaths(a, CL.PolyType.ptSubject, true);
  c.AddPaths(b, CL.PolyType.ptClip, true);
  const out = new CL.Paths();
  c.Execute(CL.ClipType.ctDifference, out, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  return out;
}

export const treeToPaths = tree => CL.Clipper.PolyTreeToPaths(tree);

/**
 * Separa caminos en regiones: cada contorno exterior con sus huecos.
 * Las islas dentro de un hueco salen como regiones propias.
 * @param {any[]} paths caminos de Clipper
 * @param {number} minA área mínima en mm² (lo menor se descarta como mancha)
 * @returns {{outer:any[], holes:any[][], a:number}[]}
 */
export function regionsFromPaths(paths, minA = 0) {
  const tree = union(paths, CL.PolyFillType.pftNonZero);
  const out = [];
  const walk = node => node.Childs().forEach(ch => {
    if (ch.IsHole()) return;
    const a = Math.abs(area([ch.Contour()]));
    if (a >= minA) {
      const holes = ch.Childs().map(h => h.Contour()).filter(h => Math.abs(area([h])) >= minA);
      out.push({ outer: ch.Contour(), holes, a });
    }
    ch.Childs().forEach(walk);
  });
  walk(tree);
  return out;
}
