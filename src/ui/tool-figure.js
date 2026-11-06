// Dibujo de la punta de la herramienta entrando en la pieza: se ve por qué una ball mill o un V-bit dejan una
// línea más angosta que su diámetro. La profundidad se exagera si es muy poca para que se alcance a ver; la cota
// marca el surco dibujado y el texto dice el ancho real.

/**
 * @param {{type:string, D:number, w:number, depth:number}} tl
 * @param {{vAngle?:number, vTip?:number}} [p]
 * @returns {string} SVG (colores de los tokens del tema)
 */
let seq = 0;
export function toolFigure(tl, p = {}) {
  const id = `tfCut${++seq}`; // único: la figura sale en más de un diálogo
  const W = 160, H = 104, top = 48, D = 72, k = D / tl.D, cx = W / 2;
  const d = Math.min(28, Math.max(6, tl.depth * k)); // px; exagerada si hace falta
  const bottom = top + d;
  let tip, half = D / 2; // half: medio ancho del surco en la cara, en el dibujo
  if (tl.type === 'ball') {
    const r = D / 2;
    half = d >= r ? r : Math.sqrt(r * r - (r - d) * (r - d));
    tip = `M${cx - r} 0 V${bottom - r} A${r} ${r} 0 0 0 ${cx + r} ${bottom - r} V0 Z`;
  } else if (tl.type === 'v') {
    const ang = Math.min(170, Math.max(5, +p.vAngle || 60)) * Math.PI / 180;
    const t = Math.min(D, (+p.vTip || 0) * k) / 2, h = (D / 2 - t) / Math.tan(ang / 2);
    half = Math.min(D / 2, t + d * Math.tan(ang / 2));
    tip = `M${cx - D / 2} 0 V${bottom - h} L${cx - t} ${bottom} H${cx + t} L${cx + D / 2} ${bottom - h} V0 Z`;
  } else {
    tip = `M${cx - D / 2} 0 V${bottom} H${cx + D / 2} V0 Z`;
  }
  const wTxt = `${+tl.w.toFixed(2)} mm`;
  return `<svg viewBox="0 0 ${W} ${H}" class="toolfig" role="img" aria-label="La herramienta deja una línea de ${wTxt} de ancho">
  <defs><clipPath id="${id}"><rect x="0" y="${top}" width="${W}" height="${H}"/></clipPath></defs>
  <rect x="8" y="${top}" width="${W - 16}" height="${H - top - 26}" class="tf-mat"/>
  <path d="${tip}" class="tf-tool"/>
  <path d="${tip}" class="tf-cut" clip-path="url(#${id})"/>
  <path d="M${cx - half} ${H - 18} H${cx + half} M${cx - half} ${H - 22} V${H - 14} M${cx + half} ${H - 22} V${H - 14}" class="tf-dim"/>
  <text x="${cx}" y="${H - 2}" text-anchor="middle" class="tf-txt">línea de ${wTxt}</text>
</svg>`;
}
