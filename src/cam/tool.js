// Geometría de la herramienta: qué ancho de línea deja a cierta profundidad.

/**
 * @param {{toolType:'ball'|'flat'|'v', dia:number, depth:number, vAngle?:number, vTip?:number, stepoverPct?:number, stepdown?:number}} p
 * @returns {{w:number, r:number, D:number, type:string, depth:number, step:number, down:number}}
 *   w = ancho efectivo de la línea (mm), r = w/2, step = paso de vaciado (mm), down = profundidad por pasada (mm)
 */
export function toolGeometry(p) {
  const D = Math.max(0.05, +p.dia || 1);
  const d = Math.max(0.001, +p.depth || 0.1);
  let w = D;
  if (p.toolType === 'ball') {
    // una bola de radio R a profundidad d corta una cuerda de 2·√(R² − (R − d)²)
    const R = D / 2;
    w = d >= R ? D : 2 * Math.sqrt(R * R - (R - d) * (R - d));
  } else if (p.toolType === 'v') {
    const ang = Math.min(170, Math.max(5, +p.vAngle || 60)) * Math.PI / 180;
    w = Math.min(D, (+p.vTip || 0) + 2 * d * Math.tan(ang / 2));
  }
  const pct = Math.min(90, Math.max(10, +p.stepoverPct || 45)) / 100;
  return {
    w, r: w / 2, D, type: p.toolType, depth: d,
    step: Math.max(0.05, w * pct),
    down: Math.max(0.01, +p.stepdown || d),
  };
}
