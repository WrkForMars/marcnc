// Revisión del trabajo antes de cortar: lo que hay que preparar en la máquina (herramienta, ceros, husillo)
// y los valores que, aunque el programa sea válido, no tienen sentido en un taller (husillo parado, días de corte…).

/** Medidas en pulgadas de las herramientas comunes, para reconocer la que tiene el alumno en la mano. */
const INCH = [[1 / 32, '1/32"'], [1 / 16, '1/16"'], [1 / 8, '1/8"'], [3 / 16, '3/16"'], [1 / 4, '1/4"'], [3 / 8, '3/8"'], [1 / 2, '1/2"']];
export const TOOL_LABEL = { ball: 'Ball mill', flat: 'Fresa plana', v: 'V-bit' };

/** "1/8"" si el diámetro es una medida en pulgadas común (±0.01 mm), si no ''. */
export function inchName(dia) {
  const m = INCH.find(([v]) => Math.abs(v * 25.4 - dia) < 0.01);
  return m ? m[1] : '';
}

const n = (v, d = 2) => String(+(+v).toFixed(d));
/** "2 h 15 min" o "45 min". */
export function duration(mins) {
  const m = Math.max(1, Math.round(mins));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/**
 * Lo que hay que preparar en la máquina para este programa, en el orden en que se hace.
 * @param {{toolNum:number, rpm:number, fz:number, fxy:number, W:number, H:number, dialect:string, materialName?:string}} p
 * @param {{type:string, D:number, w:number, depth:number}} tl
 * @param {{passes:number, mins:number}} g
 * @returns {{k:string, v:string}[]}
 */
export function setupSheet(p, tl, g) {
  const inch = inchName(tl.D);
  return [
    { k: 'Herramienta', v: `T${p.toolNum} · ${TOOL_LABEL[tl.type] || tl.type} de ${n(tl.D, 3)} mm${inch ? ` (${inch})` : ''}${p.dialect === 'grbl' ? ' · cámbiala a mano' : ''}` },
    { k: 'Pieza', v: `${n(p.W)} × ${n(p.H)} mm${p.materialName ? ` de ${p.materialName.toLowerCase()}` : ''}, bien sujeta` },
    { k: 'Ceros', v: 'X0 Y0 en la esquina inferior izquierda; Z0 en la cara de arriba' },
    { k: 'Corte', v: `${n(tl.depth)} mm de profundidad en ${g.passes} pasada${g.passes > 1 ? 's' : ''} · línea de ${n(tl.w)} mm` },
    { k: 'Husillo y avances', v: `S${p.rpm} a la derecha (M03) · F${p.fz} al bajar · F${p.fxy} al cortar` },
    { k: 'Duración', v: `~${duration(g.mins)}` },
  ];
}

/**
 * Avisos de valores que la máquina acepta pero que no tienen sentido (vacío si todo está bien).
 * @param {{rpm:number, fz:number, fxy:number, vAngle?:number, vTip?:number}} p
 * @param {{type:string, D:number, depth:number, down:number}} tl
 * @param {{passes:number, mins:number, lines:number}} g
 * @param {{material?:boolean}} [o] material: ya hay un perfil de material que revisa los avances
 */
export function jobRisks(p, tl, g, o = {}) {
  const out = [];
  if (!(p.rpm >= 100)) out.push(`El husillo está en S${p.rpm}: la herramienta no giraría y se rompe al tocar la pieza. Ponlo en Ajustes de máquina.`);
  if (!o.material && p.fz > p.fxy) out.push(`El avance en Z (F${p.fz}) es mayor que en X-Y (F${p.fxy}): de punta la herramienta corta peor; bájalo.`);
  // el filo de una fresa chica mide unas 3 veces su diámetro: más abajo roza el cuerpo, o el portaherramientas
  if (tl.depth > 3 * tl.D) out.push(`${n(tl.depth)} mm de profundidad con una herramienta de ${n(tl.D, 3)} mm: es más de lo que alcanza su filo (unas 3 veces el diámetro).`);
  if (tl.type === 'v') {
    const ang = Math.min(170, Math.max(5, +p.vAngle || 60)) * Math.PI / 180;
    const cone = Math.max(0, (tl.D - (+p.vTip || 0)) / 2) / Math.tan(ang / 2);
    if (tl.depth > cone + 1e-9) out.push(`A ${n(tl.depth)} mm el V-bit ya entró más que su punta (${n(cone)} mm): la línea no crece más y corta con el cuerpo.`);
  }
  if (g.passes > 50) out.push(`${g.passes} pasadas de ${n(tl.depth / g.passes, 3)} mm: el programa se vuelve enorme. Sube la profundidad por pasada.`);
  if (g.mins > 8 * 60) out.push(`El corte dura ~${duration(g.mins)}. Revisa los avances y la profundidad por pasada, o usa Contorno en vez de Relleno.`);
  if (g.lines > 100000) out.push(`El programa tiene ${g.lines.toLocaleString('es-MX')} líneas: muchos controles no tienen memoria para tanto (habría que mandarlo por DNC).`);
  return out;
}
