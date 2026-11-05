// Cotas sobre la vista previa: línea con remates, líneas de referencia y una etiqueta que se puede tocar para editar.

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{from:[number,number], to:[number,number], label:string, kind:string}[]} dims
 * @param {(x:number)=>number} X @param {(y:number)=>number} Y mm → px
 * @param {(v:string)=>string} css
 * @param {boolean} editable si las etiquetas se pueden tocar (dibuja el subrayado de "editable")
 * @returns {{x:number, y:number, w:number, h:number, i:number}[]} rectángulos de las etiquetas, en px
 */
export function drawDims(ctx, dims, X, Y, css, editable) {
  const hits = [];
  const col = css('--plate-accent');
  ctx.save();
  ctx.font = '600 12px "IBM Plex Mono", monospace';
  dims.forEach((d, i) => {
    const ax = X(d.from[0]), ay = Y(d.from[1]), bx = X(d.to[0]), by = Y(d.to[1]);
    const len = Math.hypot(bx - ax, by - ay);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
    ctx.setLineDash(d.kind === 'edge' ? [4, 3] : []);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    // remates: flechas cortas hacia los extremos (si cabe) o marcas perpendiculares
    if (len > 4) {
      const ux = (bx - ax) / len, uy = (by - ay) / len, s = Math.min(6, len / 3);
      [[ax, ay, 1], [bx, by, -1]].forEach(([px, py, dir]) => {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + dir * (ux * s) - uy * s * 0.5, py + dir * (uy * s) + ux * s * 0.5);
        ctx.lineTo(px + dir * (ux * s) + uy * s * 0.5, py + dir * (uy * s) - ux * s * 0.5);
        ctx.closePath(); ctx.fill();
      });
    }
    // etiqueta en el centro de la cota
    const w = ctx.measureText(d.label).width + 12, h = 20;
    const x = (ax + bx) / 2 - w / 2, y = (ay + by) / 2 - h / 2;
    ctx.fillStyle = col; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 4); else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.fillStyle = css('--plate-on'); ctx.textBaseline = 'middle'; ctx.fillText(d.label, x + 6, y + h / 2 + 1);
    if (editable) { ctx.strokeStyle = css('--plate-on'); ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(x + 6, y + h - 4); ctx.lineTo(x + w - 6, y + h - 4); ctx.stroke(); ctx.globalAlpha = 1; }
    hits.push({ x, y, w, h, i });
  });
  ctx.restore();
  return hits;
}

/** Etiqueta de cota bajo el punto (px), o null. Un poco de margen para el dedo. */
export function dimAt(hits, px, py) {
  return hits.find(r => px >= r.x - 4 && px <= r.x + r.w + 4 && py >= r.y - 6 && py <= r.y + r.h + 6) || null;
}
