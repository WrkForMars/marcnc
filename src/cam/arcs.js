// Ajuste de arcos: agrupa puntos consecutivos que caen sobre una circunferencia
// para escribirlos como un solo G02/G03.

/** Circunferencia por tres puntos → [cx, cy, r] o null si son colineales. */
export function circ3(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const A = a[0] * a[0] + a[1] * a[1], B = b[0] * b[0] + b[1] * b[1], C = c[0] * c[0] + c[1] * c[1];
  const x = (A * (b[1] - c[1]) + B * (c[1] - a[1]) + C * (a[1] - b[1])) / d;
  const y = (A * (c[0] - b[0]) + B * (a[0] - c[0]) + C * (b[0] - a[0])) / d;
  return [x, y, Math.hypot(a[0] - x, a[1] - y)];
}

/**
 * @param {[number,number][]} pts polilínea en mm (Y hacia arriba)
 * @param {number} tol desviación máxima permitida de cada punto respecto al arco (mm)
 * @returns {({arc:false,to:[number,number]}|{arc:true,to:[number,number],c:[number,number,number],ccw:boolean})[]}
 */
export function fitArcs(pts, tol) {
  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    let best = null;
    if (i + 3 < pts.length) {
      let j = i + 3;
      while (j < pts.length) {
        const m = pts[Math.floor((i + j) / 2)];
        const c = circ3(pts[i], m, pts[j]);
        if (!c || c[2] > 500 || c[2] < 0.3) break;
        let ok = true;
        const cr = (pts[j][0] - pts[i][0]) * (m[1] - pts[i][1]) - (pts[j][1] - pts[i][1]) * (m[0] - pts[i][0]);
        for (let k = i + 1; k < j && ok; k++) {
          if (Math.abs(Math.hypot(pts[k][0] - c[0], pts[k][1] - c[1]) - c[2]) > tol) ok = false;
          // todos los puntos deben girar en el mismo sentido (sin inflexiones)
          const ck = (pts[k + 1][0] - pts[k - 1][0]) * (pts[k][1] - pts[k - 1][1]) - (pts[k + 1][1] - pts[k - 1][1]) * (pts[k][0] - pts[k - 1][0]);
          if (ck * cr < -1e-12) ok = false;
        }
        let sweep = 0;
        for (let k = i; k < j; k++) {
          const a1 = Math.atan2(pts[k][1] - c[1], pts[k][0] - c[0]);
          const a2 = Math.atan2(pts[k + 1][1] - c[1], pts[k + 1][0] - c[0]);
          let da = a2 - a1;
          while (da > Math.PI) da -= 2 * Math.PI;
          while (da < -Math.PI) da += 2 * Math.PI;
          sweep += da;
        }
        if (!ok || Math.abs(sweep) > Math.PI * 1.9) break;
        best = { j, c, ccw: sweep > 0 };
        j++;
      }
    }
    if (best) { out.push({ arc: true, to: pts[best.j], c: best.c, ccw: best.ccw }); i = best.j; }
    else { out.push({ arc: false, to: pts[i + 1] }); i++; }
  }
  return out;
}
