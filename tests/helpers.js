// Utilidades de prueba: figuras de ejemplo y un lector simple de G-code.
import { toC } from '../src/geometry/clipper.js';

export const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
/** Hueco = mismo cuadrado en sentido contrario. */
export const hole = (x, y, s) => square(x, y, s).reverse();

export const regionEl = (outer, holes = [], mode = 'fill') => ({
  src: 'design', type: 'region', mode,
  parts: [{ outer: toC(outer), holes: holes.map(toC) }],
});
export const lineEl = (pts, closed = false) => ({ src: 'design', type: 'line', mode: 'line', parts: [{ pts, closed }] });

/** Parámetros de la tarea de la placa (T3, S2200, F60 en Z, F130 en XY, retracción Z3, 0.1 mm). */
export const TAREA = {
  W: 90, H: 50, dialect: 'fanuc', dec: 2, retract: 3, fz: 60, fxy: 130, toolNum: 3, rpm: 2200, prog: 1, arcs: true,
};
export const BALL_1_8 = { toolType: 'ball', dia: 3.175, depth: 0.1, stepoverPct: 45, stepdown: 0.2 };

/**
 * Recorre el programa con estado modal y devuelve cada movimiento.
 * @returns {{line:string, g:string, from:[number,number,number], to:[number,number,number], I?:number, J?:number, F?:number}[]}
 */
export function parseMoves(text) {
  let x = 0, y = 0, z = 0, g = null, f = null;
  const moves = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\(.*?\)/g, '').trim();
    if (!line) continue;
    const w = {};
    for (const m of line.matchAll(/([GXYZIJFRSTM])(-?\d+(?:\.\d+)?)/g)) {
      if (m[1] === 'G') { const v = +m[2]; if ([0, 1, 2, 3].includes(v)) w.G = v; } else w[m[1]] = +m[2];
    }
    if (/G91|G28/.test(line)) continue; // regreso a home: no es un movimiento de corte
    if (w.G !== undefined) g = w.G;
    if (w.F !== undefined) f = w.F;
    if (g === null || (w.X === undefined && w.Y === undefined && w.Z === undefined)) continue;
    const from = [x, y, z];
    if (w.X !== undefined) x = w.X;
    if (w.Y !== undefined) y = w.Y;
    if (w.Z !== undefined) z = w.Z;
    moves.push({ line: raw, g, from, to: [x, y, z], I: w.I, J: w.J, F: f });
  }
  return moves;
}
