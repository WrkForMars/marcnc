// Perfiles de material: avances sugeridos a partir de la carga de viruta (lo que corta cada filo por vuelta)
// con la velocidad de husillo que tenga la máquina, y avisos cuando un valor se sale de lo prudente.
// Valores conservadores para fresas de 2 filos en una CNC escolar; la carga de viruta escala con el diámetro.

/** Carga de viruta (mm por filo) con una herramienta de 1/8" y profundidad por pasada en fracción del diámetro. */
export const MATERIALS = {
  mdf: { name: 'Madera / MDF', chip: 0.05, stepD: 0.3, burns: true },
  acrilico: { name: 'Acrílico', chip: 0.035, stepD: 0.15, burns: true },
  aluminio: { name: 'Aluminio', chip: 0.012, stepD: 0.06 },
  laton: { name: 'Latón', chip: 0.015, stepD: 0.06 },
};
const FLUTES = 2, REF_D = 3.175;
const round = (v, s) => Math.round(v / s) * s;

/**
 * @param {string} key clave de MATERIALS
 * @param {{rpm:number, dia:number}} p
 * @returns {{fxy:number, fz:number, stepdown:number}|null} mm/min y mm
 */
export function suggestFeeds(key, p) {
  const m = MATERIALS[key];
  if (!m || !(p.rpm > 0) || !(p.dia > 0)) return null;
  const chip = m.chip * Math.min(2, Math.max(0.3, p.dia / REF_D));
  const fxy = Math.max(5, round(p.rpm * FLUTES * chip, 5));
  return { fxy, fz: Math.max(5, round(fxy / 3, 5)), stepdown: Math.max(0.05, +round(p.dia * m.stepD, 0.05).toFixed(2)) };
}

/**
 * Avisos de valores arriesgados para el material elegido (vacío si no hay material o todo está bien).
 * @param {string} key
 * @param {{rpm:number, dia:number, fxy:number, fz:number, stepdown:number, depth:number}} p
 * @returns {string[]}
 */
export function feedRisks(key, p) {
  const m = MATERIALS[key], s = suggestFeeds(key, p);
  if (!m || !s) return [];
  const out = [], name = m.name.toLowerCase();
  if (p.fxy > s.fxy * 2.5) out.push(`Avance X-Y de F${p.fxy} es alto para ${name} con S${p.rpm}: puede romper la herramienta. Sugerido: F${s.fxy}.`);
  else if (m.burns && p.fxy < s.fxy * 0.3) out.push(`Avance X-Y de F${p.fxy} es lento para ${name} con S${p.rpm}: puede quemar o derretir. Sugerido: F${s.fxy}, o baja el husillo.`);
  if (p.fz > p.fxy) out.push(`El avance en Z (F${p.fz}) es mayor que en X-Y (F${p.fxy}): de punta la herramienta corta peor; bájalo.`);
  else if (p.fz > s.fz * 3.5) out.push(`Avance en Z de F${p.fz} es alto para ${name}. Sugerido: F${s.fz}.`);
  if (Math.min(p.stepdown, p.depth) > s.stepdown * 2) out.push(`Bajar ${+Math.min(p.stepdown, p.depth).toFixed(2)} mm por pasada es mucho para ${name}. Sugerido: ${s.stepdown} mm.`);
  return out;
}
